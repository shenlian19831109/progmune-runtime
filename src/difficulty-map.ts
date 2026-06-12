/**
 * P3.7: Protocol Difficulty Map
 *
 * Answers: which transitions are hardest to learn?
 *
 * Uses Telemetry + Trajectory Corpus to compute per-transition statistics:
 *   - How often does this transition appear in trajectories?
 *   - When it fails, how often is it successfully repaired?
 *   - What's the acceptance rate for repairs involving this transition?
 *
 * The difficulty score feeds into:
 *   1. Active Learning (prioritize hard transitions for benchmark generation)
 *   2. Reward Model (weight training samples by difficulty)
 *   3. Coverage System (focus data acquisition on high-difficulty gaps)
 */

import type { TrajectoryRecord } from "./runtime-types";
import type { PlannerDecision } from "./planner-telemetry";
import { parseProtocolDefinition, loadDefaultProtocolDefinitions, ProtocolTransition } from "./protocol-coverage";
import type { ProtocolDefinition } from "./protocol-coverage";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface TransitionStats {
  protocol: string;
  transition: string;            // "from→to"
  rule: string;                  // function name
  type: "acquire" | "invalidate";

  attempts: number;              // times this transition appeared
  successes: number;             // times it executed without violation
  failures: number;              // times it caused a violation
  repairs: number;               // times a repair was attempted
  repairSuccesses: number;       // times the repair succeeded

  acceptanceRate: number;        // repairs accepted / repairs total
  repairRate: number;            // repairs / failures
  avgRepairSteps: number;        // average fix path length
  avgLatency: number;            // average execution latency

  /** 0-1: how hard is this transition to get right? */
  difficulty: number;
}

export interface ProtocolDifficulty {
  protocol: string;
  transitionCount: number;
  avgDifficulty: number;
  maxDifficulty: number;
  hardestTransition: string;
  risk: "critical" | "high" | "medium" | "low";
}

// ═══════════════════════════════════════════════════════════════
// Difficulty Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Compute difficulty for a single transition.
 *
 *   difficulty = (failureRate × 0.4) + (repairFailureRate × 0.4) + (rejectionRate × 0.2)
 *
 * Where:
 *   - failureRate = failures / attempts (how often does it go wrong?)
 *   - repairFailureRate = 1 - (repairSuccesses / repairs) (when fixed, how often does the fix fail?)
 *   - rejectionRate = 1 - acceptanceRate (how often do users reject the repair?)
 *
 * A transition that always fails AND repairs never work AND users always reject = difficulty 1.0.
 * A transition that never fails = difficulty 0.0.
 */
function computeDifficulty(stats: Omit<TransitionStats, "difficulty">): number {
  if (stats.attempts === 0) return 0;

  const failureRate = stats.failures / stats.attempts;
  const repairFailureRate = stats.repairs > 0
    ? 1 - (stats.repairSuccesses / stats.repairs)
    : 0;
  const rejectionRate = stats.repairs > 0
    ? 1 - stats.acceptanceRate
    : 0;

  return failureRate * 0.4 + repairFailureRate * 0.4 + rejectionRate * 0.2;
}

function emptyStats(protocol: string, t: ProtocolTransition): TransitionStats {
  return {
    protocol,
    transition: `${t.from}→${t.to}`,
    rule: t.rule,
    type: t.type,
    attempts: 0, successes: 0, failures: 0,
    repairs: 0, repairSuccesses: 0,
    acceptanceRate: 0, repairRate: 0, avgRepairSteps: 0, avgLatency: 0,
    difficulty: 0,
  };
}

/** Extract transition keys that appear in a trajectory. */
function transitionsInTrajectory(traj: string[], proto: ProtocolDefinition): string[] {
  const keys: string[] = [];
  let current = new Set<string>();
  if (proto.initialState) current.add(proto.initialState);

  for (const fn of traj) {
    const rule = proto.rules.get(fn);
    if (!rule) continue;

    for (const pre of (rule.pre_states.length > 0 ? rule.pre_states : ["INIT"])) {
      for (const post of rule.post_states) {
        keys.push(`${pre}→${post}`);
      }
    }
    if (rule.invalidate) {
      for (const inv of rule.invalidate) {
        keys.push(`${inv}→∅`);
      }
    }

    if (rule.invalidate) rule.invalidate.forEach(s => current.delete(s));
    for (const post of rule.post_states) current.add(post);
  }
  return keys;
}

/**
 * Build a difficulty map from trajectory data and telemetry decisions.
 */
export function buildDifficultyMap(
  trajectories: TrajectoryRecord[],
  decisions?: PlannerDecision[]
): Map<string, TransitionStats> {
  const protocols = loadDefaultProtocolDefinitions();
  const statsMap = new Map<string, TransitionStats>();

  // Initialize all transitions with empty stats
  for (const proto of protocols) {
    for (const t of proto.transitions) {
      const key = `${proto.name}:${t.from}→${t.to}`;
      statsMap.set(key, emptyStats(proto.name, t));
    }
  }

  // Count from trajectories
  for (const traj of trajectories) {
    // Find matching protocol
    for (const proto of protocols) {
      const tKeys = transitionsInTrajectory(traj.trajectory, proto);
      if (tKeys.length === 0) continue;

      const isViolation = traj.result === "violation";
      const isRepair = traj.result === "repair";
      const repairSuccess = isRepair && traj.successRate >= 0.5;

      for (const tKey of tKeys) {
        const key = `${proto.name}:${tKey}`;
        const stats = statsMap.get(key);
        if (!stats) continue;

        stats.attempts++;
        if (isViolation || (isRepair && !repairSuccess)) stats.failures++;
        else stats.successes++;

        if (isRepair) {
          stats.repairs++;
          if (repairSuccess) stats.repairSuccesses++;
          if (traj.violation?.fixPath) {
            const totalSteps = (stats.avgRepairSteps * (stats.repairs - 1) + traj.violation.fixPath.length) / stats.repairs;
            stats.avgRepairSteps = totalSteps;
          }
        }
        if (traj.cost?.latency) {
          const totalLat = (stats.avgLatency * (stats.attempts - 1) + traj.cost.latency) / stats.attempts;
          stats.avgLatency = totalLat;
        }
      }
    }
  }

  // Incorporate telemetry acceptance data if available
  if (decisions) {
    for (const d of decisions) {
      if (!d.feedback || !d.selectedCandidateId) continue;
      const sel = d.candidates.find(c => c.candidateId === d.selectedCandidateId);
      if (!sel) continue;

      // Map candidate actions to transitions
      for (const proto of protocols) {
        const tKeys = transitionsInTrajectory(sel.actions, proto);
        for (const tKey of tKeys) {
          const key = `${proto.name}:${tKey}`;
          const stats = statsMap.get(key);
          if (!stats) continue;

          if (stats.repairs > 0) {
            const accepted = d.feedback.decision === "accepted" ? 1 : 0;
            stats.acceptanceRate = (stats.acceptanceRate * (stats.repairs - 1) + accepted) / stats.repairs;
          }
        }
      }
    }
  }

  // Compute difficulty for each
  for (const [key, stats] of statsMap) {
    stats.difficulty = computeDifficulty(stats);
    if (stats.failures > 0 && stats.repairs > 0) {
      stats.repairRate = stats.repairSuccesses / stats.repairs;
    }
  }

  return statsMap;
}

// ═══════════════════════════════════════════════════════════════
// Protocol Aggregation
// ═══════════════════════════════════════════════════════════════

export function rankProtocolsByDifficulty(
  statsMap: Map<string, TransitionStats>
): ProtocolDifficulty[] {
  const protocols = loadDefaultProtocolDefinitions();
  const result: ProtocolDifficulty[] = [];

  for (const proto of protocols) {
    const entries: TransitionStats[] = [];
    for (const [key, stats] of statsMap) {
      if (stats.protocol === proto.name) entries.push(stats);
    }

    if (entries.length === 0) {
      result.push({
        protocol: proto.name, transitionCount: 0, avgDifficulty: 0,
        maxDifficulty: 0, hardestTransition: "N/A", risk: "low",
      });
      continue;
    }

    const difficulties = entries.map(e => e.difficulty);
    const avg = difficulties.reduce((s, d) => s + d, 0) / difficulties.length;
    const max = Math.max(...difficulties);
    const hardest = entries.find(e => e.difficulty === max)!;

    let risk: ProtocolDifficulty["risk"];
    if (max > 0.5) risk = "critical";
    else if (max > 0.3) risk = "high";
    else if (max > 0.1) risk = "medium";
    else risk = "low";

    result.push({
      protocol: proto.name,
      transitionCount: entries.length,
      avgDifficulty: avg,
      maxDifficulty: max,
      hardestTransition: hardest.transition,
      risk,
    });
  }

  return result.sort((a, b) => b.maxDifficulty - a.maxDifficulty);
}

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

export function printDifficultyDashboard(
  statsMap: Map<string, TransitionStats>,
  ranking: ProtocolDifficulty[]
): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Protocol Difficulty Map                          ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log("─── Protocol Difficulty Ranking ───");
  console.log("Protocol          AvgDiff  MaxDiff  HardestTransition");
  console.log("──────────────────────────────────────────────────────");

  for (const r of ranking) {
    const icon = r.risk === "critical" ? "🔴" : r.risk === "high" ? "🟠" : r.risk === "medium" ? "🟡" : "🟢";
    const avg = (r.avgDifficulty * 100).toFixed(0).padStart(3);
    const max = (r.maxDifficulty * 100).toFixed(0).padStart(3);
    console.log(`  ${r.protocol.padEnd(16)} ${avg}%   ${max}%   ${r.hardestTransition} ${icon}`);
  }
  console.log();

  // Detail: hardest transitions
  const hardTransitions = [...statsMap.values()]
    .filter(s => s.difficulty > 0.3 && s.attempts > 0)
    .sort((a, b) => b.difficulty - a.difficulty)
    .slice(0, 10);

  if (hardTransitions.length > 0) {
    console.log("─── Hardest Transitions (top 10) ───");
    for (const t of hardTransitions) {
      const d = (t.difficulty * 100).toFixed(0);
      console.log(`  ${t.protocol.padEnd(16)} ${t.transition.padEnd(30)} diff=${d}%  attempts=${t.attempts}  failures=${t.failures}  repairs=${t.repairs}`);
    }
    console.log();
  }
}
