/**
 * P9.2c: Gold CVE Dataset — isolate detector recall from pipeline recall
 *
 * The P9.2b bottleneck: CVE descriptions → heuristic parser → broken/expected
 * sequences. If the parser is noisy, we can't tell whether the DETECTOR is
 * good or bad.
 *
 * This module builds a GOLD STANDARD: manually-verified broken/expected
 * sequences that precisely map the known vulnerability. Comparing detector
 * performance on gold vs heuristic data reveals where the bottleneck is.
 *
 * Format:
 *   GoldCVECase {
 *     cve: "CVE-2022-41850",
 *     category: "resource_leak",
 *     broken: ["open_device", "alloc_report", "register_handler"],  // VERIFIED
 *     expected: ["open_device", "alloc_report", "register_handler", "close_device"],
 *     notes: "Missing close_device() in error path. Verified from kernel patch."
 *   }
 *
 * The 20 curated cases in realworld-benchmark.ts ARE gold-standard.
 * Expanding to 50 manually-verified cases isolates the true detector recall.
 */

import type { CVECase } from "./cve-collector";

// ═══════════════════════════════════════════════════════════════
// Gold CVE types
// ═══════════════════════════════════════════════════════════════

export interface GoldCVECase {
  id: string;
  cve?: string;
  title: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  /** VERIFIED vulnerable sequence — exactly what the buggy code called. */
  broken: string[];
  /** VERIFIED patched sequence — exactly what the fix added/removed. */
  expected: string[];
  /** How this was verified ("manual", "patch_diff", "test_case"). */
  verifiedBy: string;
  /** Notes about the verification. */
  notes?: string;
  /** Project/source. */
  project?: string;
}

export interface GoldDataset {
  cases: GoldCVECase[];
  metadata: {
    total: number;
    byCategory: Record<string, number>;
    verifiedBy: Record<string, number>;
  };
}

export interface GoldBenchmarkResult {
  /** Dataset info. */
  datasetSize: number;
  lifecycleCount: number;
  /** Detection results. */
  detected: number;
  recall: number;
  /** Category-matched results (correct violation subtype). */
  categoryMatched: number;
  precision: number;
  /** Per-category breakdown. */
  byCategory: Record<string, { total: number; detected: number; matched: number; recall: number; precision: number }>;
  /** Per-case details. */
  cases: {
    id: string; category: string; detected: boolean; categoryMatch: boolean;
    templateStates: number; brokenStates: number; violationTypes: string[];
    details: string[];
  }[];
}

// ═══════════════════════════════════════════════════════════════
// Load the gold dataset from curated 20 cases (already verified)
// ═══════════════════════════════════════════════════════════════

export function loadGoldDataset(): GoldDataset {
  const { REAL_WORLD_DEFECTS } = require("./realworld-benchmark");

  const cases: GoldCVECase[] = REAL_WORLD_DEFECTS.map((d: any) => ({
    id: d.id,
    cve: d.source?.replace(" pattern", ""),
    title: d.title,
    category: d.category,
    severity: d.severity,
    broken: d.broken,
    expected: d.expected,
    verifiedBy: "manual_curation",
    notes: d.description,
    project: "curated",
  }));

  const byCategory: Record<string, number> = {};
  const verifiedBy: Record<string, number> = {};
  for (const c of cases) {
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    verifiedBy[c.verifiedBy] = (verifiedBy[c.verifiedBy] || 0) + 1;
  }

  return {
    cases,
    metadata: { total: cases.length, byCategory, verifiedBy },
  };
}

// ═══════════════════════════════════════════════════════════════
// Run the gold benchmark — detector-only recall (no parser noise)
// ═══════════════════════════════════════════════════════════════

const CWE_TO_VIOLATION: Record<string, string> = {
  resource_leak: "missing_release",
  auth_bypass: "missing_prerequisite",
  data_corruption: "missing_commit",
  use_after_free: "illegal_transition",
  race_condition: "missing_prerequisite",
};

export function runGoldBenchmark(dataset: GoldDataset): GoldBenchmarkResult {
  const { inferStateMachine } = require("./state-inference");
  const { detectStructuralViolations } = require("./protocol-invariants");

  let detected = 0;
  let categoryMatched = 0;
  const byCategory: Record<string, { total: number; detected: number; matched: number }> = {};
  const caseResults: GoldBenchmarkResult["cases"] = [];

  // Count lifecycle cases
  let lifecycleCount = 0;

  for (const c of dataset.cases) {
    const isLifecycle = ["resource_leak", "auth_bypass", "use_after_free", "data_corruption", "race_condition"].includes(c.category);
    if (isLifecycle) lifecycleCount++;

    // Build template SM from verified expected sequence
    const templateSM = inferStateMachine([c.expected]);
    // Build test SM from verified broken sequence
    const brokenSM = inferStateMachine([c.broken]);

    // Run structural violation detection
    const violations = detectStructuralViolations(brokenSM, templateSM);

    if (!byCategory[c.category]) {
      byCategory[c.category] = { total: 0, detected: 0, matched: 0 };
    }
    byCategory[c.category].total++;

    const violationTypes: string[] = violations.map((v: any) => v.violationSubtype);
    const hasDetection = violations.length > 0;
    const expectedViolation = CWE_TO_VIOLATION[c.category];
    const categoryMatch = expectedViolation ? violationTypes.includes(expectedViolation) : false;

    if (hasDetection) {
      detected++;
      byCategory[c.category].detected++;
    }
    if (categoryMatch) {
      categoryMatched++;
      byCategory[c.category].matched++;
    }

    caseResults.push({
      id: c.id,
      category: c.category,
      detected: hasDetection,
      categoryMatch,
      templateStates: templateSM.stateCount,
      brokenStates: brokenSM.stateCount,
      violationTypes,
      details: violations.map((v: any) => v.description),
    });
  }

  const total = dataset.cases.length;
  const recall = total > 0 ? detected / total : 0;
  const precision = detected > 0 ? categoryMatched / detected : 0;

  // Build per-category recall/precision
  const byCat: GoldBenchmarkResult["byCategory"] = {};
  for (const [cat, stats] of Object.entries(byCategory)) {
    byCat[cat] = {
      total: stats.total,
      detected: stats.detected,
      matched: stats.matched,
      recall: stats.total > 0 ? stats.detected / stats.total : 0,
      precision: stats.detected > 0 ? stats.matched / stats.detected : 0,
    };
  }

  return {
    datasetSize: total,
    lifecycleCount,
    detected,
    recall,
    categoryMatched,
    precision,
    byCategory: byCat,
    cases: caseResults,
  };
}

export function printGoldReport(result: GoldBenchmarkResult): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P9.2c Gold Dataset — Detector-Only Recall         ║");
  console.log("║   CVE sequences are VERIFIED (no parser noise)      ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`  Dataset:          ${result.datasetSize} cases (${result.lifecycleCount} lifecycle)`);
  console.log(`  Detected:         ${result.detected} / ${result.datasetSize}`);
  console.log(`  Detector Recall:  ${(result.recall * 100).toFixed(0)}%`);
  console.log(`  Category Match:   ${result.categoryMatched} / ${result.detected}`);
  console.log(`  Detector Precision: ${(result.precision * 100).toFixed(0)}%`);
  console.log();

  console.log(`  ── Per Category ──`);
  console.log(`  ${'Category'.padEnd(18)} ${'Total'.padEnd(6)} ${'Detected'.padEnd(8)} ${'Recall'.padEnd(8)} ${'Precision'}`);
  console.log(`  ${'─'.repeat(54)}`);
  for (const [cat, stats] of Object.entries(result.byCategory)) {
    console.log(`  ${cat.padEnd(18)} ${String(stats.total).padEnd(6)} ${String(stats.detected).padEnd(8)} ${(stats.recall*100).toFixed(0).padStart(3)}%    ${(stats.precision*100).toFixed(0)}%`);
  }

  console.log();
  console.log(`  ── Bottleneck Analysis ──`);
  const recallGap = result.lifecycleCount > 0
    ? 1.0 - (result.detected / result.lifecycleCount)
    : 0;
  console.log(`  Detector-only gap:       ${(recallGap * 100).toFixed(0)}% (missed despite perfect sequences)`);
  console.log(`  (Compare with P9.2b:     recall drops further due to parser noise)`);
  console.log();
}
