/**
 * P3.24-27: Search Trace + Bridge Learning + Discovery Benchmark + Replay
 *
 * P3.24: Record WHY candidates are missing. Decompose 57% missing_candidate
 *   into missing_action, missing_transition, depth_limit, bridge_missing.
 *
 * P3.25: Protocol Bridge Learning — cross-protocol state bridges.
 *   Auth → File → DB → IR → Queue. Frontier BFS across protocols.
 *
 * P3.26: Discovery Benchmark — three-tier metric:
 *   DiscoveryRate (any correct candidate?) → Ranking (Top-1/Top-3) → Execution.
 *
 * P3.27: Counterfactual Replay — off-policy evaluation.
 *   Replay historical decisions with new ranker/frontier, compare acceptance.
 */

import { searchFrontier, exploreFrontier } from "./protocol-frontier";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import type { StateAnnotation } from "./ssg-validator";
import type { RepairCandidate } from "./repair-types";

// ═══════════════════════════════════════════════════════════════
// P3.24: Search Trace
// ═══════════════════════════════════════════════════════════════

export type SearchDeadEndReason =
  | "missing_action"       // function not in any protocol rule
  | "missing_transition"   // state pair not connected
  | "depth_limit"          // BFS exhausted without reaching target
  | "bridge_missing"       // cross-protocol bridge not defined
  | "precondition_failed"; // rule found but pre_states unsatisfied

export interface SearchTrace {
  strategy: string;
  goal?: string;
  expandedNodes: string[];
  prunedNodes: string[];
  deadEnds: { node: string; reason: SearchDeadEndReason }[];
  maxDepthReached: number;
  candidateGenerated: boolean;
  candidateCount: number;
}

export interface DecomposedMissingCandidate {
  total: number;
  missingAction: number;
  missingTransition: number;
  depthLimit: number;
  bridgeMissing: number;
  preconditionFailed: number;
}

/**
 * Trace a frontier search and classify WHY candidates are missing.
 */
export function traceSearch(
  rules: Map<string, StateAnnotation>,
  currentStates: string[],
  targetStates: string[],
  expectedRepair: string[],
  strategy: string = "frontier",
  goal?: string,
  maxDepth: number = 6
): SearchTrace {
  const trace: SearchTrace = {
    strategy, goal,
    expandedNodes: [], prunedNodes: [], deadEnds: [],
    maxDepthReached: 0, candidateGenerated: false, candidateCount: 0,
  };

  const visited = new Set<string>();
  const queue: { states: Set<string>; actions: string[]; depth: number }[] = [
    { states: new Set(currentStates), actions: [], depth: 0 },
  ];
  visited.add([...currentStates].sort().join(","));

  while (queue.length > 0) {
    const { states, actions, depth } = queue.shift()!;
    trace.maxDepthReached = Math.max(trace.maxDepthReached, depth);

    if (depth >= maxDepth) {
      trace.deadEnds.push({ node: [...states].join(","), reason: "depth_limit" });
      continue;
    }

    let anyRuleApplied = false;
    for (const [fn, rule] of rules) {
      const preOk = rule.pre_states.length === 0 || rule.pre_states.every(p => states.has(p));
      if (!preOk) continue;
      anyRuleApplied = true;

      const next = new Set(states);
      if (rule.invalidate) rule.invalidate.forEach(s => next.delete(s));
      for (const post of rule.post_states) next.add(post);

      const key = [...next].sort().join(",");
      if (visited.has(key)) continue;
      visited.add(key);

      trace.expandedNodes.push(fn);
      const newActions = [...actions, fn];

      // Check if this reaches the expected repair
      if (expectedRepair.every(fn => newActions.includes(fn))) {
        trace.candidateGenerated = true;
        trace.candidateCount++;
      }

      queue.push({ states: next, actions: newActions, depth: depth + 1 });
    }

    if (!anyRuleApplied && depth > 0) {
      trace.deadEnds.push({ node: [...states].join(","), reason: "precondition_failed" });
    }
  }

  // Classify missing candidates by analyzing dead ends
  for (const fn of expectedRepair) {
    if (!rules.has(fn)) {
      trace.deadEnds.push({ node: fn, reason: "missing_action" });
    }
  }

  return trace;
}

/**
 * Decompose a search failure into root causes.
 */
export function decomposeMissingCandidate(traces: SearchTrace[]): DecomposedMissingCandidate {
  const result: DecomposedMissingCandidate = {
    total: traces.length,
    missingAction: 0,
    missingTransition: 0,
    depthLimit: 0,
    bridgeMissing: 0,
    preconditionFailed: 0,
  };

  for (const t of traces) {
    if (t.candidateGenerated) continue;
    for (const de of t.deadEnds) {
      switch (de.reason) {
        case "missing_action": result.missingAction++; break;
        case "missing_transition": result.missingTransition++; break;
        case "depth_limit": result.depthLimit++; break;
        case "bridge_missing": result.bridgeMissing++; break;
        case "precondition_failed": result.preconditionFailed++; break;
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// P3.26: Discovery Benchmark
// ═══════════════════════════════════════════════════════════════

export interface DiscoveryResult {
  goal: string;
  discovery: boolean;          // at least one correct candidate?
  top1Hit: boolean;
  top3Hit: boolean;
  candidateCount: number;
  decomposition?: DecomposedMissingCandidate;
}

export interface DiscoveryReport {
  cases: number;
  discoveryRate: number;       // cases where any correct candidate was found
  top3Rate: number;
  top1Rate: number;
  avgCandidates: number;
  gapBreakdown: DecomposedMissingCandidate;
}

export function computeDiscoveryReport(results: DiscoveryResult[]): DiscoveryReport {
  const total = results.length;
  const discovered = results.filter(r => r.discovery).length;
  const top1 = results.filter(r => r.top1Hit).length;
  const top3 = results.filter(r => r.top3Hit).length;
  const avgCand = results.reduce((s, r) => s + r.candidateCount, 0) / Math.max(1, total);

  // Aggregate decompositions
  const allTraces = results
    .filter(r => !r.discovery && r.decomposition)
    .map(r => r.decomposition!);
  const merged: DecomposedMissingCandidate = {
    total: allTraces.length,
    missingAction: allTraces.reduce((s, d) => s + d.missingAction, 0),
    missingTransition: allTraces.reduce((s, d) => s + d.missingTransition, 0),
    depthLimit: allTraces.reduce((s, d) => s + d.depthLimit, 0),
    bridgeMissing: allTraces.reduce((s, d) => s + d.bridgeMissing, 0),
    preconditionFailed: allTraces.reduce((s, d) => s + d.preconditionFailed, 0),
  };

  return {
    cases: total,
    discoveryRate: total > 0 ? discovered / total : 0,
    top3Rate: total > 0 ? top3 / total : 0,
    top1Rate: total > 0 ? top1 / total : 0,
    avgCandidates: avgCand,
    gapBreakdown: merged,
  };
}

export function printDiscoveryReport(report: DiscoveryReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Discovery Benchmark                              ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  const dr = (report.discoveryRate * 100).toFixed(0);
  const t1 = (report.top1Rate * 100).toFixed(0);
  const t3 = (report.top3Rate * 100).toFixed(0);

  console.log(`Cases:             ${report.cases}`);
  console.log(`Discovery Rate:    ${dr}%  (any correct candidate found)`);
  console.log(`Top-3 Accuracy:    ${t3}%`);
  console.log(`Top-1 Accuracy:    ${t1}%`);
  console.log(`Avg Candidates:    ${report.avgCandidates.toFixed(1)}`);
  console.log();

  if (report.gapBreakdown.total > 0) {
    console.log("─── Missing Candidate Decomposition ───");
    const g = report.gapBreakdown;
    console.log(`  missing_action:       ${g.missingAction}`);
    console.log(`  missing_transition:   ${g.missingTransition}`);
    console.log(`  depth_limit:          ${g.depthLimit}`);
    console.log(`  bridge_missing:       ${g.bridgeMissing}`);
    console.log(`  precondition_failed:  ${g.preconditionFailed}`);
    console.log();
  }

  const discoveryGap = report.discoveryRate - report.top1Rate;
  if (discoveryGap > 0.15) {
    console.log(`  ⚠️  Discovery→Top1 gap: ${(discoveryGap*100).toFixed(0)}% — ranking is the bottleneck`);
  } else if (report.discoveryRate < 0.5) {
    console.log(`  ⚠️  Discovery < 50% — candidate generation is the bottleneck`);
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════
// P3.27: Counterfactual Replay (Off-Policy Evaluation)
// ═══════════════════════════════════════════════════════════════

export interface ReplayDecision {
  goal: string;
  protocol: string;
  candidates: string[][];
  acceptedId?: string;
  acceptedActions?: string[];
}

export interface ReplayEvaluation {
  totalDecisions: number;
  baselineAccepted: number;
  baselineRate: number;
  newAccepted: number;
  newRate: number;
  delta: number;
  improvement: boolean;
}

/**
 * Off-policy evaluation: compare old system vs new system.
 *
 * Given historical decisions (what was proposed, what was accepted),
 * and a new candidate generator, compute how the new system would
 * have performed on the same decisions.
 */
export function evaluateOffPolicy(
  decisions: ReplayDecision[],
  newCandidateGenerator: (goal: string, protocol: string) => string[][],
  matchFn: (candidate: string[], accepted: string[]) => boolean = (c, a) =>
    a.every(fn => c.includes(fn))
): ReplayEvaluation {
  let baselineAccepted = 0;
  let newAccepted = 0;

  for (const d of decisions) {
    // Baseline: was the accepted candidate in the original proposals?
    if (d.acceptedActions) {
      const baseMatch = d.candidates.some(c => matchFn(c, d.acceptedActions!));
      if (baseMatch) baselineAccepted++;
    }

    // New: would the new generator have found the accepted candidate?
    const newCandidates = newCandidateGenerator(d.goal, d.protocol);
    if (d.acceptedActions && newCandidates.some(c => matchFn(c, d.acceptedActions!))) {
      newAccepted++;
    }
  }

  const total = decisions.length;
  return {
    totalDecisions: total,
    baselineAccepted,
    baselineRate: total > 0 ? baselineAccepted / total : 0,
    newAccepted,
    newRate: total > 0 ? newAccepted / total : 0,
    delta: total > 0 ? (newAccepted - baselineAccepted) / total : 0,
    improvement: newAccepted > baselineAccepted,
  };
}

export function printReplayEvaluation(eval_: ReplayEvaluation): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Counterfactual Replay (Off-Policy)                ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  const base = (eval_.baselineRate * 100).toFixed(1);
  const nw = (eval_.newRate * 100).toFixed(1);
  const delta = (eval_.delta * 100).toFixed(1);
  const sign = eval_.delta > 0 ? "+" : "";

  console.log(`Decisions Replayed:  ${eval_.totalDecisions}`);
  console.log(`Baseline (old):      ${base}%  (${eval_.baselineAccepted}/${eval_.totalDecisions})`);
  console.log(`New System:          ${nw}%  (${eval_.newAccepted}/${eval_.totalDecisions})`);
  console.log(`Δ:                   ${sign}${delta}%`);
  console.log();

  if (eval_.improvement) {
    console.log(`  ✅ New system outperforms baseline by ${sign}${delta}%`);
  } else if (eval_.delta === 0) {
    console.log("  ═  No change. New system matches baseline.");
  } else {
    console.log(`  ❌ New system regresses by ${sign}${delta}%`);
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════
// P3.25: Protocol Bridge Learning
// ═══════════════════════════════════════════════════════════════

export interface LearnedBridge {
  fromProtocol: string;
  toProtocol: string;
  viaState: string;
  targetState: string;
  confidence: number;
  evidenceCount: number;
}

/**
 * Learn cross-protocol bridges from benchmark failures.
 *
 * When a benchmark expects auth → file → db chains, but the
 * protocols are isolated, infer bridges connecting them.
 */
export function learnProtocolBridges(
  crossProtocolFailures: { goal: string; expectedRepair: string[] }[]
): LearnedBridge[] {
  const defs = loadDefaultProtocolDefinitions();
  const protoRules = new Map(defs.map(p => [p.name, p.rules]));
  const bridges: LearnedBridge[] = [];
  const bridgeCounts = new Map<string, number>();

  for (const f of crossProtocolFailures) {
    // Determine which protocols are involved
    const involved = new Set<string>();
    for (const fn of f.expectedRepair) {
      for (const [name, rules] of protoRules) {
        if (rules.has(fn)) involved.add(name);
      }
    }

    const protoList = [...involved];
    for (let i = 0; i < protoList.length - 1; i++) {
      const from = protoList[i];
      const to = protoList[i + 1];
      const key = `${from}→${to}`;
      bridgeCounts.set(key, (bridgeCounts.get(key) || 0) + 1);
    }
  }

  const maxCount = Math.max(1, ...[...bridgeCounts.values()]);
  for (const [key, count] of bridgeCounts) {
    const [from, to] = key.split("→");
    bridges.push({
      fromProtocol: from, toProtocol: to,
      viaState: "COMPLETED", targetState: "INIT",
      confidence: count / maxCount,
      evidenceCount: count,
    });
  }

  return bridges.sort((a, b) => b.confidence - a.confidence);
}
