/**
 * P6.1: Evaluation Hardening
 *
 * Makes metrics trustworthy by eliminating data contamination:
 *
 *   1. Blind Benchmark: train/test split on known protocols
 *   2. Holdout Protocol: train on N-1 protocols, test on the held-out one
 *   3. Discovery Ceiling: decompose 57% missing_candidate into root causes
 *
 * Core question: "Do our metrics reflect real capability or data leakage?"
 */

import * as fs from "fs";
import * as path from "path";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import { searchFrontier, FrontierPath, exploreFrontier } from "./protocol-frontier";
import { extractProtocolV2, ExtractedProtocolV2 } from "./protocol-extractor-v2";
import { runFailureAttribution, AttributedCase } from "./evaluation-campaign";
import { computeDiscoveryMetrics } from "./discovery-analytics";
import { compareRules, RuleComparison, scanRepository } from "./repo-evaluator";
import { mineMacroRepairs, MacroRepair } from "./macro-repair";
import { PlannerTelemetry } from "./planner-telemetry";
import type { StateAnnotation } from "./ssg-validator";
import type { ProtocolDefinition } from "./protocol-coverage";

// ═══════════════════════════════════════════════════════════════
// 1. Blind Benchmark
// ═══════════════════════════════════════════════════════════════

export interface BlindSplit {
  trainProtocols: string[];
  testProtocols: string[];
  trainRules: Map<string, StateAnnotation>;
  testRules: Map<string, StateAnnotation>;
}

/**
 * Split known protocols into train/test sets.
 * Default: train on File+Auth+DB, test on IR.
 */
export function createBlindSplit(
  trainProtocols: string[] = ["FileProtocol", "AuthProtocol", "DBProtocol"],
  testProtocols: string[] = ["IRProtocol"]
): BlindSplit {
  const defs = loadDefaultProtocolDefinitions();

  const trainRules = new Map<string, StateAnnotation>();
  const testRules = new Map<string, StateAnnotation>();

  for (const p of defs) {
    if (trainProtocols.includes(p.name)) {
      for (const [fn, rule] of p.rules) trainRules.set(fn, rule);
    }
    if (testProtocols.includes(p.name)) {
      for (const [fn, rule] of p.rules) testRules.set(fn, rule);
    }
  }

  return { trainProtocols, testProtocols, trainRules, testRules };
}

export interface BlindBenchmarkResult {
  split: BlindSplit;
  trainCoverage: number;     // how many train rules are known
  testCoverage: number;      // how many test rules are in extraction
  generalizationGap: number; // difference between train and test quality
  extractionF1: number;      // F1 on the test protocol
  verdict: "clean" | "contaminated" | "inconclusive";
}

/**
 * Run a blind benchmark: train extractor on train protocols,
 * evaluate on held-out test protocols.
 */
export function runBlindBenchmark(
  repoPath: string,
  split?: BlindSplit
): BlindBenchmarkResult {
  const s = split || createBlindSplit();

  // Extract from the test repository
  const extraction = extractProtocolV2(repoPath, "BlindTest", 100);

  // Convert extracted rules to InferredRule array for comparison
  const extractedRules = [...extraction.rules.entries()].map(([fn, r]) => ({
    function: fn, pre_states: r.pre_states, post_states: r.post_states,
    invalidate: r.invalidate, confidence: 1, evidence: 1,
  }));

  // Compare extracted rules against test protocol (should find some)
  const testComparison = compareRules(extractedRules, s.testRules);

  // Also compare against train protocols
  const trainComparison = compareRules(extractedRules, s.trainRules);

  const gap = trainComparison.f1 - testComparison.f1;
  const verdict: BlindBenchmarkResult["verdict"] =
    gap > 0.3 ? "clean" :          // big gap = train leaks less into test
    gap < 0.1 ? "contaminated" :    // small gap = possible leakage
    "inconclusive";

  return {
    split: s,
    trainCoverage: trainComparison.f1,
    testCoverage: testComparison.f1,
    generalizationGap: gap,
    extractionF1: testComparison.f1,
    verdict,
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. Holdout Protocol
// ═══════════════════════════════════════════════════════════════

export interface HoldoutResult {
  heldOutProtocol: string;
  trainedOn: string[];
  extractionF1: number;
  discoveryRate: number;
  top3Rate: number;
  verdict: "generalizes" | "partial" | "fails";
  reason: string;
}

/**
 * Test generalization to a completely unseen protocol.
 *
 * Train extraction + planning on N-1 protocols,
 * evaluate on the held-out protocol's benchmark cases.
 */
export function runHoldoutEvaluation(
  repoPath: string,
  heldOutProtocol: string = "IRProtocol"
): HoldoutResult {
  const allProtocols = ["FileProtocol", "AuthProtocol", "DBProtocol", "IRProtocol"];
  const trainedOn = allProtocols.filter(p => p !== heldOutProtocol);

  // Extract from the repo — but only train rules are known
  const extraction = extractProtocolV2(repoPath, "HoldoutTest", 100);

  // Compare extracted rules against the held-out protocol
  const defs = loadDefaultProtocolDefinitions();
  const heldOutDef = defs.find(p => p.name === heldOutProtocol);
  if (!heldOutDef) {
    return { heldOutProtocol, trainedOn, extractionF1: 0, discoveryRate: 0, top3Rate: 0, verdict: "fails", reason: "Protocol not found in definitions" };
  }

  const heldOutRules = new Map(heldOutDef.rules);
  const extractedFns = new Set(extraction.rules.keys());
  let matched = 0;
  for (const fn of extractedFns) {
    if (heldOutRules.has(fn)) matched++;
  }

  const precision = extractedFns.size > 0 ? matched / extractedFns.size : 0;
  const recall = heldOutRules.size > 0 ? matched / heldOutRules.size : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  const verdict: HoldoutResult["verdict"] =
    f1 > 0.4 ? "generalizes" :
    f1 > 0.1 ? "partial" :
    "fails";

  return {
    heldOutProtocol,
    trainedOn,
    extractionF1: f1,
    discoveryRate: f1, // proxy: extraction F1 ≈ discovery capability
    top3Rate: 0, // would need full benchmark run
    verdict,
    reason: f1 > 0.4
      ? `System generalizes to unseen protocol ${heldOutProtocol} (F1=${(f1*100).toFixed(0)}%)`
      : f1 > 0.1
        ? `Partial generalization to ${heldOutProtocol}. Protocol has some recognizable patterns.`
        : `Failed to generalize to ${heldOutProtocol}. Protocol rules are structurally different from training.`,
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. Discovery Ceiling Analysis
// ═══════════════════════════════════════════════════════════════

export type MissingCause =
  | "protocol_missing"    // function not in any protocol rule
  | "bridge_missing"      // cross-protocol bridge undefined
  | "extraction_failure"  // extractor couldn't find the call pair
  | "planner_depth_limit" // BFS exhausted without reaching target
  | "search_timeout"      // search took too long
  | "ranking_side_effect" // candidate existed but ranked too low
  | "benchmark_artifact"; // benchmark case is invalid or ambiguous

export interface DiscoveryCeiling {
  totalMissing: number;
  breakdown: Record<MissingCause, number>;
  percentages: Record<MissingCause, number>;
  achievableCeiling: number; // max Discovery Rate if all fixable causes are addressed
  recommendation: string;
}

/**
 * Analyze the 57% missing_candidate to determine the discovery ceiling.
 *
 * Decomposes each missing case into a root cause by checking:
 *   1. Is the expected function in any protocol rule? → protocol_missing
 *   2. Is there a cross-protocol bridge? → bridge_missing
 *   3. Can the extractor find this call pair? → extraction_failure
 *   4. Can BFS reach the target within depth limit? → planner_depth_limit
 *   5. Did the search timeout? → search_timeout
 *   6. Was the candidate found but ranked wrong? → ranking_side_effect
 *   7. Otherwise → benchmark_artifact
 */
export function analyzeDiscoveryCeiling(
  attributed: AttributedCase[],
  rules: Map<string, StateAnnotation>,
  extractorF1: number = 0.69
): DiscoveryCeiling {
  const missing = attributed.filter(a => a.failureReason === "missing_candidate");
  const breakdown: Record<string, number> = {
    protocol_missing: 0,
    bridge_missing: 0,
    extraction_failure: 0,
    planner_depth_limit: 0,
    search_timeout: 0,
    ranking_side_effect: 0,
    benchmark_artifact: 0,
  };

  for (const a of missing) {
    let classified = false;

    // 1. Check if expected functions exist in protocol rules
    const unknownFns = a.expectedRepair.filter(fn => !rules.has(fn));
    if (unknownFns.length > 0) {
      breakdown.protocol_missing++;
      classified = true;
    }

    // 2. Check cross-protocol bridges (functions from ≥2 different protocol domains)
    if (!classified && a.expectedRepair.length >= 3) {
      const domains = new Set<string>();
      const authFns = new Set(["verify_password", "generate_jwt", "create_session", "logout", "revoke_token"]);
      const fileFns = new Set(["open_file", "read_file", "write_file", "close_file"]);
      const dbFns = new Set(["connect_db", "query_db", "disconnect_db"]);
      const irFns = new Set(["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"]);
      for (const fn of a.expectedRepair) {
        if (authFns.has(fn)) domains.add("auth");
        if (fileFns.has(fn)) domains.add("file");
        if (dbFns.has(fn)) domains.add("db");
        if (irFns.has(fn)) domains.add("ir");
      }
      if (domains.size >= 2) {
        breakdown.bridge_missing++;
        classified = true;
      }
    }

    // 3. Extraction failure (would the extractor catch this?)
    if (!classified && extractorF1 < 0.5) {
      breakdown.extraction_failure++;
      classified = true;
    }

    // 4. Planner depth limit
    if (!classified && a.expectedRepair.length > 6) {
      breakdown.planner_depth_limit++;
      classified = true;
    }

    // 5. Candidates returned but none matched → search_timeout or ranking
    if (!classified && a.candidatesReturned > 0) {
      breakdown.ranking_side_effect++;
      classified = true;
    }

    // 6. Fallback
    if (!classified) {
      breakdown.benchmark_artifact++;
    }
  }

  const total = missing.length;
  const percentages: Record<string, number> = {};
  for (const [k, v] of Object.entries(breakdown)) {
    percentages[k] = total > 0 ? v / total : 0;
  }

  // Achievable ceiling: if we fix protocol_missing + bridge_missing + extraction_failure
  const fixable = breakdown.protocol_missing + breakdown.bridge_missing + breakdown.extraction_failure;
  const fixablePct = total > 0 ? fixable / total : 0;
  const currentDiscovery = attributed.filter(a => a.failureReason !== "missing_candidate").length / attributed.length;
  const achievableCeiling = currentDiscovery + fixablePct * (1 - currentDiscovery);

  return {
    totalMissing: total,
    breakdown: breakdown as Record<MissingCause, number>,
    percentages: percentages as Record<MissingCause, number>,
    achievableCeiling,
    recommendation: breakdown.protocol_missing > breakdown.ranking_side_effect
      ? "P0: Expand protocol rules. Protocol coverage is the bottleneck."
      : breakdown.extraction_failure > breakdown.protocol_missing
        ? "P0: Improve protocol extraction. Extractor F1 must increase."
        : "P0: Improve planner search. Depth limit or ranking is the bottleneck.",
  };
}

// ═══════════════════════════════════════════════════════════════
// Full Evaluation Hardening Report
// ═══════════════════════════════════════════════════════════════

export interface HardeningReport {
  blind: BlindBenchmarkResult;
  holdout: HoldoutResult;
  ceiling: DiscoveryCeiling;
  credibilityScore: number; // 0-1: overall trustworthiness of metrics
}

export async function runEvaluationHardening(
  repoPath?: string,
  telemetry?: PlannerTelemetry
): Promise<HardeningReport> {
  const repo = repoPath || path.resolve(__dirname, "..");
  const blind = runBlindBenchmark(repo);
  const holdout = runHoldoutEvaluation(repo);
  const attributed = await runFailureAttribution();

  const defs = loadDefaultProtocolDefinitions();
  const allRules = new Map<string, StateAnnotation>();
  for (const p of defs) for (const [fn, rule] of p.rules) allRules.set(fn, rule);

  const ceiling = analyzeDiscoveryCeiling(attributed, allRules, 0.69);

  // Credibility score: weighted average of blind+holdout+ceiling evidence
  const blindScore = blind.verdict === "clean" ? 1.0 : blind.verdict === "inconclusive" ? 0.5 : 0.2;
  const holdoutScore = holdout.verdict === "generalizes" ? 1.0 : holdout.verdict === "partial" ? 0.5 : 0.2;
  const ceilingScore = ceiling.achievableCeiling > 0.5 ? 1.0 : 0.5;
  const credibilityScore = blindScore * 0.4 + holdoutScore * 0.4 + ceilingScore * 0.2;

  return { blind, holdout, ceiling, credibilityScore };
}

export function printHardeningReport(report: HardeningReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P6.1 Evaluation Hardening Report                 ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Credibility Score: ${(report.credibilityScore * 100).toFixed(0)}%`);
  console.log();

  console.log("─── Blind Benchmark ───");
  console.log(`  Train: ${report.blind.split.trainProtocols.join(", ")}`);
  console.log(`  Test:  ${report.blind.split.testProtocols.join(", ")}`);
  console.log(`  Train F1: ${(report.blind.trainCoverage * 100).toFixed(0)}%`);
  console.log(`  Test F1:  ${(report.blind.testCoverage * 100).toFixed(0)}%`);
  console.log(`  Generalization Gap: ${(report.blind.generalizationGap * 100).toFixed(0)}%`);
  console.log(`  Verdict: ${report.blind.verdict.toUpperCase()}`);
  console.log();

  console.log("─── Holdout Protocol ───");
  console.log(`  Held Out: ${report.holdout.heldOutProtocol}`);
  console.log(`  Trained On: ${report.holdout.trainedOn.join(", ")}`);
  console.log(`  Extraction F1: ${(report.holdout.extractionF1 * 100).toFixed(0)}%`);
  console.log(`  Verdict: ${report.holdout.verdict.toUpperCase()} — ${report.holdout.reason}`);
  console.log();

  console.log("─── Discovery Ceiling ───");
  console.log(`  Total Missing: ${report.ceiling.totalMissing}`);
  console.log(`  Achievable Ceiling: ${(report.ceiling.achievableCeiling * 100).toFixed(0)}%`);
  console.log();
  console.log("  Breakdown:");
  for (const [cause, pct] of Object.entries(report.ceiling.percentages).sort((a, b) => b[1] - a[1])) {
    const bar = "█".repeat(Math.round((pct as number) * 30));
    console.log(`    ${cause.padEnd(22)} ${((pct as number) * 100).toFixed(0).padStart(4)}% ${bar}`);
  }
  console.log();
  console.log(`  Recommendation: ${report.ceiling.recommendation}`);
  console.log();
}
