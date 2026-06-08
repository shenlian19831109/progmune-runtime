/**
 * P0: Corpus Quality Dashboard
 *
 * Reads all FailureRecordV2 files from .progmune_corpus/failures/
 * and outputs quality metrics as terminal table + JSON report.
 *
 * Usage:
 *   npx ts-node src/corpus-stats.ts
 *   npx ts-node src/corpus-stats.ts --json
 */

import * as fs from "fs";
import * as path from "path";
import type { FailureRecordV2 } from "./runtime-types";

const CORPUS_DIR = process.env.PROGMUNE_CORPUS_DIR
  || path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus");
const V2_DIR = path.join(CORPUS_DIR, "failures");

// ═══════════════════════════════════════════════════════════════
// Data loading
// ═══════════════════════════════════════════════════════════════

function loadAllFailures(): FailureRecordV2[] {
  const results: FailureRecordV2[] = [];
  if (!fs.existsSync(V2_DIR)) return results;

  const entries = fs.readdirSync(V2_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dateDir = path.join(V2_DIR, entry.name);
    const files = fs.readdirSync(dateDir).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dateDir, file), "utf-8");
        results.push(JSON.parse(raw) as FailureRecordV2);
      } catch { /* skip corrupted files */ }
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// Metrics computation
// ═══════════════════════════════════════════════════════════════

function jaccardSimilarity(a: string[], b: string[]): number {
  const sa = new Set(a), sb = new Set(b);
  const intersection = [...sa].filter(x => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : intersection / union;
}

interface CorpusStats {
  totalFailures: number;
  dateRange: { earliest: string; latest: string };
  byViolationType: Record<string, number>;
  byProtocol: Record<string, number>;
  byContextFeature: Record<string, number>;
  /** Failure pairs with similarity > 0.9 */
  duplicationRate: number;
  /** repairAttempts stats */
  repairAcceptanceRate: number;
  repairSuccessRate: number;
  totalRepairAttempts: number;
  /** Average success rate of repair patterns */
  avgPatternSuccessRate: number;
  /** Top violation + context combinations */
  topPatterns: { violationType: string; context: string; count: number }[];
}

function computeStats(failures: FailureRecordV2[]): CorpusStats {
  // Duplication: fraction of pairs with action sequence similarity > 0.9
  let duplicatePairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < failures.length; i++) {
    for (let j = i + 1; j < failures.length; j++) {
      totalPairs++;
      if (jaccardSimilarity(failures[i].actionSequence, failures[j].actionSequence) > 0.9) {
        duplicatePairs++;
      }
    }
  }

  // Repair stats
  const withRepairs = failures.filter(f => f.repairAttempts.length > 0);
  const totalAttempts = withRepairs.reduce((s, f) => s + f.repairAttempts.length, 0);
  const acceptedAttempts = withRepairs.reduce(
    (s, f) => s + f.repairAttempts.filter(a => a.accepted).length, 0
  );
  const successfulRepairs = withRepairs.reduce(
    (s, f) => s + f.repairAttempts.filter(a => a.success).length, 0
  );

  // Violation type counts
  const byViolationType: Record<string, number> = {};
  for (const f of failures) {
    byViolationType[f.violationType] = (byViolationType[f.violationType] || 0) + 1;
  }

  // Protocol counts
  const byProtocol: Record<string, number> = {};
  for (const f of failures) {
    byProtocol[f.protocol] = (byProtocol[f.protocol] || 0) + 1;
  }

  // Context feature combinations
  const byContextFeature: Record<string, number> = {};
  for (const f of failures) {
    const key = [
      `depth=${f.contextFeatures.nestingDepth}`,
      f.contextFeatures.exceptionHandled ? "try" : "no-try",
      f.contextFeatures.insideLoop ? "loop" : "no-loop",
    ].join(" ");
    byContextFeature[key] = (byContextFeature[key] || 0) + 1;
  }

  // Top violation × context patterns
  const patternCounts: Record<string, number> = {};
  for (const f of failures) {
    const ctx = f.contextFeatures;
    const key = `${f.violationType} | depth=${ctx.nestingDepth} ${ctx.exceptionHandled ? "try" : "no-try"} ${ctx.insideLoop ? "loop" : "no-loop"}`;
    patternCounts[key] = (patternCounts[key] || 0) + 1;
  }
  const topPatterns = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p, c]) => {
      const [violationType, ...rest] = p.split(" | ");
      return { violationType, context: rest.join(" | "), count: c };
    });

  const timestamps = failures.map(f => f.timestamp).sort();

  return {
    totalFailures: failures.length,
    dateRange: {
      earliest: timestamps[0] || "N/A",
      latest: timestamps[timestamps.length - 1] || "N/A",
    },
    byViolationType,
    byProtocol,
    byContextFeature,
    duplicationRate: totalPairs > 0 ? duplicatePairs / totalPairs : 0,
    repairAcceptanceRate: totalAttempts > 0 ? acceptedAttempts / totalAttempts : 0,
    repairSuccessRate: totalAttempts > 0 ? successfulRepairs / totalAttempts : 0,
    totalRepairAttempts: totalAttempts,
    avgPatternSuccessRate: failures.length > 0
      ? failures.reduce((s, f) => s + f.successRate, 0) / failures.length
      : 0,
    topPatterns,
  };
}

// ═══════════════════════════════════════════════════════════════
// Output
// ═══════════════════════════════════════════════════════════════

function formatPercent(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function printTable(stats: CorpusStats): void {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║    Corpus Quality Dashboard (Schema v2)      ║");
  console.log("╚══════════════════════════════════════════════╝");

  console.log(`\n📊 Total failures: ${stats.totalFailures}`);
  console.log(`📅 Date range: ${stats.dateRange.earliest} → ${stats.dateRange.latest}`);

  // Violation distribution
  console.log("\n── Violation Types ──");
  const vtEntries = Object.entries(stats.byViolationType).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of vtEntries) {
    const bar = "█".repeat(Math.round(count / Math.max(...vtEntries.map(e => e[1])) * 30));
    console.log(`  ${type.padEnd(24)} ${String(count).padStart(4)} ${bar}`);
  }

  // Protocol distribution
  console.log("\n── Protocols ──");
  for (const [proto, count] of Object.entries(stats.byProtocol).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${proto.padEnd(20)} ${count}`);
  }

  // Quality metrics
  console.log("\n── Quality Metrics ──");
  const rows: [string, string, string][] = [
    ["Duplication rate", formatPercent(stats.duplicationRate), stats.duplicationRate < 0.2 ? "✅" : "⚠️ >20%"],
    ["Repair acceptance", formatPercent(stats.repairAcceptanceRate), stats.repairAcceptanceRate > 0.4 ? "✅" : "⚠️ <40%"],
    ["Repair success", formatPercent(stats.repairSuccessRate), stats.repairSuccessRate > 0.8 ? "✅" : "⚠️ <80%"],
    ["Total repair attempts", String(stats.totalRepairAttempts), ""],
    ["Avg pattern success rate", formatPercent(stats.avgPatternSuccessRate), ""],
  ];
  for (const [metric, value, flag] of rows) {
    console.log(`  ${(metric + ":").padEnd(26)} ${value.padEnd(8)} ${flag}`);
  }

  // Top patterns
  if (stats.topPatterns.length > 0) {
    console.log("\n── Top Violation × Context Patterns ──");
    for (const p of stats.topPatterns) {
      console.log(`  ${p.violationType.padEnd(24)} ${p.context.padEnd(30)} x${p.count}`);
    }
  }

  // Context features
  console.log("\n── Context Features ──");
  for (const [feat, count] of Object.entries(stats.byContextFeature).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${feat.padEnd(30)} ${count}`);
  }

  console.log();
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const useJson = process.argv.includes("--json");

  if (!fs.existsSync(V2_DIR)) {
    console.error("⚠️  No Schema v2 corpus found. Run validation first to auto-collect failures.");
    process.exit(0);
  }

  const failures = loadAllFailures();

  if (failures.length === 0) {
    console.error("✅ Corpus is empty — no failures recorded yet.");
    process.exit(0);
  }

  const stats = computeStats(failures);

  if (useJson) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    printTable(stats);
  }
}

main();
