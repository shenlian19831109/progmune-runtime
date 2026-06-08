/**
 * P0: Corpus Quality Dashboard
 *
 * Reads all FailureRecordV2 files from .progmune_corpus/trajectories/
 * and outputs quality metrics as terminal table + JSON report.
 *
 * Usage:
 *   npx ts-node src/corpus-stats.ts
 *   npx ts-node src/corpus-stats.ts --json
 */

import * as fs from "fs";
import * as path from "path";
import type { TrajectoryRecord } from "./runtime-types";
import { loadTrajectories, corpusTrajectoryStats } from "./failure-corpus";

// ═══════════════════════════════════════════════════════════════
// Data loading
// ═══════════════════════════════════════════════════════════════

function loadAllTrajectories(): TrajectoryRecord[] {
  return loadTrajectories();
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

function computeStats(trajectories: TrajectoryRecord[]): CorpusStats {
  const violations = trajectories.filter(t => t.result === "violation");

  // Duplication: fraction of pairs with trajectory similarity > 0.9
  let duplicatePairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < violations.length; i++) {
    for (let j = i + 1; j < violations.length; j++) {
      totalPairs++;
      if (jaccardSimilarity(violations[i].trajectory, violations[j].trajectory) > 0.9) {
        duplicatePairs++;
      }
    }
  }

  // Repair stats: count repair trajectories
  const repairs = trajectories.filter(t => t.result === "repair");
  const totalAttempts = repairs.length;
  const acceptedAttempts = repairs.filter(t => t.successRate > 0.5).length;
  const successfulRepairs = repairs.filter(t => t.successRate > 0.8).length;

  // Violation type counts
  const byViolationType: Record<string, number> = {};
  for (const t of violations) {
    const vt = t.violation?.type || "other";
    byViolationType[vt] = (byViolationType[vt] || 0) + 1;
  }

  // Protocol counts
  const byProtocol: Record<string, number> = {};
  for (const t of trajectories) {
    byProtocol[t.protocol] = (byProtocol[t.protocol] || 0) + 1;
  }

  // Context feature combinations
  const byContextFeature: Record<string, number> = {};
  for (const t of trajectories) {
    const key = [
      `depth=${t.context.nestingDepth}`,
      t.context.exceptionHandled ? "try" : "no-try",
      t.context.insideLoop ? "loop" : "no-loop",
    ].join(" ");
    byContextFeature[key] = (byContextFeature[key] || 0) + 1;
  }

  // Top violation × context patterns
  const patternCounts: Record<string, number> = {};
  for (const t of violations) {
    const vt = t.violation?.type || "other";
    const ctx = t.context;
    const key = `${vt} | depth=${ctx.nestingDepth} ${ctx.exceptionHandled ? "try" : "no-try"} ${ctx.insideLoop ? "loop" : "no-loop"}`;
    patternCounts[key] = (patternCounts[key] || 0) + 1;
  }
  const topPatterns = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p, c]) => {
      const [violationType, ...rest] = p.split(" | ");
      return { violationType, context: rest.join(" | "), count: c };
    });

  const timestamps = trajectories.map(f => f.timestamp).sort();

  return {
    totalFailures: trajectories.length,
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
    avgPatternSuccessRate: trajectories.length > 0
      ? trajectories.reduce((s, t) => s + t.successRate, 0) / trajectories.length
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

function printTable(stats: CorpusStats, breakdown: { total: number; success: number; violation: number; repair: number; optimal: number }): void {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   Trajectory Corpus Dashboard (Schema v1)    ║");
  console.log("╚══════════════════════════════════════════════╝");

  console.log(`\n📊 Total trajectories: ${breakdown.total}`);
  console.log(`   ✅ Success: ${breakdown.success}  ❌ Violation: ${breakdown.violation}  🔧 Repair: ${breakdown.repair}  ⭐ Optimal: ${breakdown.optimal}`);
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

  const trajectories = loadAllTrajectories();
  const breakdown = corpusTrajectoryStats();

  if (trajectories.length === 0) {
    console.error("✅ Trajectory corpus is empty — run validation to start collecting.");
    process.exit(0);
  }

  const stats = computeStats(trajectories);

  if (useJson) {
    console.log(JSON.stringify({ stats, breakdown }, null, 2));
  } else {
    printTable(stats, breakdown);
  }
}

main();
