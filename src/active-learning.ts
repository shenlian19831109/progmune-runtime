/**
 * P3.8: Active Learning Benchmark Generator
 *
 * Prioritizes data acquisition by importance, not just coverage.
 *
 * Coverage analysis tells you WHAT is missing.
 * Difficulty analysis tells you HOW HARD it is.
 * Active Learning tells you WHAT TO GENERATE FIRST.
 *
 * Importance score:
 *   importance = difficulty × protocolUsage × failureFrequency
 *
 * This ensures we generate benchmarks for the transitions that:
 *   1. Are hardest to get right (high difficulty)
 *   2. Appear most often in real usage (high protocol frequency)
 *   3. Cause the most failures (high failure count)
 *
 * Data flow:
 *   Coverage Gaps + Difficulty Map → Importance Ranking → Prioritized Generation
 */

import {
  generateMissingBenchmarks, GeneratedCase,
} from "./benchmark-generator";
import { buildDifficultyMap, TransitionStats } from "./difficulty-map";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import type { TrajectoryRecord } from "./runtime-types";
import type { PlannerDecision } from "./planner-telemetry";
import { loadTrajectories } from "./failure-corpus";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface PrioritizedCase extends GeneratedCase {
  importance: number;
  difficulty: number;
  protocolUsage: number;
  failureCount: number;
}

export interface ActiveLearningReport {
  totalGaps: number;
  prioritized: PrioritizedCase[];
  byProtocol: Record<string, PrioritizedCase[]>;
}

// ═══════════════════════════════════════════════════════════════
// Importance Scoring
// ═══════════════════════════════════════════════════════════════

/**
 * Compute protocol usage frequency from trajectory counts.
 */
function computeProtocolUsage(trajectories: TrajectoryRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of trajectories) {
    const proto = t.protocol === "_global" ? "FileProtocol" : t.protocol;
    counts[proto] = (counts[proto] || 0) + 1;
  }
  const total = Math.max(1, trajectories.length);
  for (const k of Object.keys(counts)) {
    counts[k] /= total;
  }
  return counts;
}

/**
 * Score a missing transition by importance.
 *
 *   importance = difficulty × protocolUsage × failureFrequency
 *
 * All three dimensions normalized to [0,1].
 */
function scoreImportance(
  transition: { from: string; to: string; rule: string },
  protocol: string,
  statsMap: Map<string, TransitionStats>,
  protocolUsage: Record<string, number>
): { importance: number; difficulty: number; protocolUsage: number; failureCount: number } {
  const key = `${protocol}:${transition.from}→${transition.to}`;
  const stats = statsMap.get(key);

  const difficulty = (stats && stats.attempts > 0) ? stats.difficulty : 0.5;  // unknown = medium difficulty
  const usage = protocolUsage[protocol] ?? 0.1;
  const failureCount = stats?.failures ?? 0;
  const failureNorm = Math.min(1, failureCount / 10); // cap at 10+

  const importance = difficulty * usage * (0.3 + 0.7 * failureNorm);

  return { importance, difficulty, protocolUsage: usage, failureCount };
}

// ═══════════════════════════════════════════════════════════════
// Prioritized Generation
// ═══════════════════════════════════════════════════════════════

/**
 * Generate benchmarks prioritized by importance.
 *
 * Instead of generating all uncovered transitions equally,
 * this ranks them by how valuable each data point would be
 * for future learning.
 */
export function generatePrioritizedBenchmarks(
  trajectories?: TrajectoryRecord[],
  decisions?: PlannerDecision[]
): ActiveLearningReport {
  const trajs = trajectories || loadTrajectories();
  const statsMap = buildDifficultyMap(trajs, decisions);
  const protocolUsage = computeProtocolUsage(trajs);

  // Get all uncovered transitions with their generated cases
  const allGenerated = generateMissingBenchmarks(trajs);

  const prioritized: PrioritizedCase[] = [];
  const byProtocol: Record<string, PrioritizedCase[]> = {};

  for (const [protocol, cases] of Object.entries(allGenerated)) {
    const protocolCases: PrioritizedCase[] = [];

    for (const c of cases) {
      const { importance, difficulty, protocolUsage: usage, failureCount } = scoreImportance(
        c.targetsTransition, protocol, statsMap, protocolUsage
      );

      const pc: PrioritizedCase = {
        ...c,
        importance,
        difficulty,
        protocolUsage: usage,
        failureCount,
      };

      protocolCases.push(pc);
    }

    protocolCases.sort((a, b) => b.importance - a.importance);
    byProtocol[protocol] = protocolCases;
    prioritized.push(...protocolCases);
  }

  prioritized.sort((a, b) => b.importance - a.importance);

  return {
    totalGaps: prioritized.length,
    prioritized,
    byProtocol,
  };
}

/**
 * Write only the top-K most important benchmarks.
 */
export function writeTopPriorityBenchmarks(
  report: ActiveLearningReport,
  topK: number = 10,
  outputDir?: string
): string[] {
  const outDir = outputDir || path.resolve(__dirname, "..", "benchmarks", "priority");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const top = report.prioritized.slice(0, topK);
  const written: string[] = [];

  // Group by protocol for organized output
  const grouped: Record<string, PrioritizedCase[]> = {};
  for (const c of top) {
    const proto = c.targetsTransition.rule.includes("file") ? "FileProtocol" :
      c.targetsTransition.rule.includes("auth") || c.targetsTransition.rule.includes("password") || c.targetsTransition.rule.includes("jwt") || c.targetsTransition.rule.includes("session") || c.targetsTransition.rule.includes("logout") ? "AuthProtocol" :
      c.targetsTransition.rule.includes("db") || c.targetsTransition.rule.includes("connect") || c.targetsTransition.rule.includes("query") ? "DBProtocol" :
      "IRProtocol";
    if (!grouped[proto]) grouped[proto] = [];
    grouped[proto].push(c);
  }

  for (const [protocol, cases] of Object.entries(grouped)) {
    const filename = `priority_${protocol.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.json`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      protocol,
      topK,
      source: "active-learning",
      cases: cases.map(({ importance, difficulty, protocolUsage, failureCount, ...rest }) => ({
        ...rest,
        importance, difficulty,
      })),
    }, null, 2));
    written.push(filepath);
  }

  return written;
}

// ═══════════════════════════════════════════════════════════════
// Report
// ═══════════════════════════════════════════════════════════════

export function printActiveLearningReport(report: ActiveLearningReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Active Learning: Prioritized Benchmarks          ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Total Gaps:            ${report.totalGaps}`);
  console.log(`Prioritized Generated: ${report.prioritized.length}\n`);

  if (report.prioritized.length === 0) {
    console.log("All transitions covered. No gaps to prioritize.\n");
    return;
  }

  console.log("─── Top 10 Priority Benchmarks ───");
  console.log("Import  Diff    Protocol       Transition");
  console.log("────────────────────────────────────────────────────");

  for (const c of report.prioritized.slice(0, 10)) {
    const imp = (c.importance * 100).toFixed(0).padStart(4);
    const diff = (c.difficulty * 100).toFixed(0).padStart(4);
    console.log(`  ${imp}%  ${diff}%   ${c.targetsTransition.rule.padEnd(16)} ${c.targetsTransition.from}→${c.targetsTransition.to}`);
  }
  console.log();

  // Per-protocol summary
  console.log("─── Per Protocol ───");
  for (const [proto, cases] of Object.entries(report.byProtocol)) {
    const top = cases.slice(0, 3);
    const totalImp = cases.reduce((s, c) => s + c.importance, 0);
    console.log(`  ${proto}: ${cases.length} gaps, top importance: ${(totalImp * 100).toFixed(0)}%`);
    for (const c of top) {
      console.log(`    ${c.targetsTransition.from}→${c.targetsTransition.to} (importance: ${(c.importance * 100).toFixed(0)}%)`);
    }
  }
  console.log();
}
