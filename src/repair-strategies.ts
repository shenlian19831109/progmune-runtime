/**
 * P2: Repair Search Strategies — Candidate Producers
 *
 * Each strategy searches a different knowledge source for repair candidates.
 * Strategies MUST NOT score candidates — they find, the Ranker ranks.
 *
 * Three knowledge sources:
 *   1. Corpus   — historical trajectory data (empirical)
 *   2. Protocol — SSG state graph BFS (logical)
 *   3. Antibody — learned immune rules (heuristic)
 */

import * as fs from "fs";
import * as path from "path";
import { loadTrajectories } from "./failure-corpus";
import { findFixPathStatic } from "./ssg-validator";
import type { StateAnnotation } from "./ssg-validator";
import type { RepairCandidate, CandidateSearchStrategy, SearchContext } from "./repair-types";
import { getGoalPlanner } from "./goal-planner";
import { searchFrontier, exploreFrontier, expandCrossProtocolCandidates } from "./protocol-frontier";

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/** Convert a string function name to a call Action for the candidate. */
function fnToAction(name: string): { kind: "call"; function: string; args: never[] } {
  return { kind: "call" as const, function: name, args: [] };
}

/** Generate a stable ID from source + action sequence. */
function candidateId(source: string, actions: { kind: string; function?: string }[]): string {
  const sig = actions.map(a => a.kind === "call" ? (a.function || "?") : a.kind).join("-");
  return `${source}-${sig.slice(0, 80)}`;
}

/** Find functions that invalidate current states (resource cleanup). */
function findCleanupFunctions(ctx: SearchContext): RepairCandidate[] {
  const candidates: RepairCandidate[] = [];

  // Pass 1: exact match — function invalidates a current state AND all pre-states are satisfied
  for (const [funcName, rule] of ctx.rules) {
    const invalidates = rule.invalidate || [];
    const matchesCurrent = invalidates.some(s => ctx.currentState.includes(s));
    if (matchesCurrent && rule.pre_states.every(p => ctx.currentState.includes(p))) {
      const actions = [fnToAction(funcName)];
      candidates.push({
        id: candidateId("protocol", actions),
        source: "protocol",
        actions,
        explanation: `资源清理: 调用 ${funcName} 以释放 ${invalidates.filter(s => ctx.currentState.includes(s)).join(", ")}`,
        evidence: 0,
        metadata: { pathLength: 1, cleanupTargets: invalidates, source: "cleanup" },
      });
    }
  }

  // Pass 2 (P0): relaxed match — function invalidates a current state even if not all
  // pre-states are satisfied. This catches cases where the current state snapshot
  // is incomplete (e.g., namespace mismatch).
  // But we still require at least one pre-state to be present — completely unrelated
  // cleanup functions should not be suggested.
  if (candidates.length === 0) {
    for (const [funcName, rule] of ctx.rules) {
      const invalidates = rule.invalidate || [];
      const matchesCurrent = invalidates.some(s => ctx.currentState.includes(s));
      const hasAnyPreState = rule.pre_states.length === 0 ||
        rule.pre_states.some(p => ctx.currentState.includes(p));
      if (matchesCurrent && hasAnyPreState) {
        const actions = [fnToAction(funcName)];
        candidates.push({
          id: candidateId("protocol", actions),
          source: "protocol",
          actions,
          explanation: `资源清理(fuzzy): 调用 ${funcName} 以释放 ${invalidates.filter(s => ctx.currentState.includes(s)).join(", ")}`,
          evidence: 0,
          metadata: { pathLength: 1, cleanupTargets: invalidates, source: "cleanup-fuzzy" },
        });
      }
    }
  }

  // Pass 3 (P0): last-resort — ANY function that invalidates ANY resource-like state
  // that looks like it could be leaked (contains OPEN, CONNECTED, ACTIVE, LOCKED).
  if (candidates.length === 0) {
    const leakableStates = ctx.currentState.filter(s =>
      /OPEN|CONNECTED|ACTIVE|LOCKED|ALLOCATED|ACQUIRED|HELD/i.test(s)
    );
    if (leakableStates.length > 0) {
      for (const [funcName, rule] of ctx.rules) {
        const invalidates = rule.invalidate || [];
        if (invalidates.some(s => leakableStates.includes(s))) {
          const actions = [fnToAction(funcName)];
          candidates.push({
            id: candidateId("protocol", actions),
            source: "protocol",
            actions,
            explanation: `推测性资源清理: 调用 ${funcName} 以释放疑似泄漏状态 ${leakableStates.join(", ")}`,
            evidence: 0,
            metadata: { pathLength: 1, cleanupTargets: invalidates, source: "cleanup-heuristic" },
          });
        }
      }
    }
  }

  return candidates;
}

// ═══════════════════════════════════════════════════════════════
// P3.10: Goal-expanded candidate generation
// ═══════════════════════════════════════════════════════════════

/** Expand a goal into protocol candidates using Goal Templates. */
function expandGoalAsCandidates(goal: string, ctx: SearchContext): RepairCandidate[] {
  const planner = getGoalPlanner();
  const actionSets = planner.getCandidateActions(goal);
  if (actionSets.length === 0) return [];

  return actionSets.map(actions => ({
    id: candidateId("protocol", actions.map(fnToAction)),
    source: "protocol" as const,
    actions: actions.map(fnToAction),
    explanation: `目标展开: "${goal}" → ${actions.join(" → ")}`,
    evidence: 0,
    metadata: { pathLength: actions.length, source: "goal-template" },
  }));
}


// ═══════════════════════════════════════════════════════════════
// P0: Protocol rules loader — fallback for empty rules Maps
// ═══════════════════════════════════════════════════════════════

let _cachedProtocolRules: Map<string, StateAnnotation> | null = null;

/** Load protocol rules from protocols.json as a fallback. */
function loadProtocolRules(): Map<string, StateAnnotation> {
  if (_cachedProtocolRules) return _cachedProtocolRules;
  try {
    const protocolsPath = path.resolve(
      process.env.PROGMUNE_PROJECT_DIR || process.cwd(),
      "protocols.json"
    );
    if (fs.existsSync(protocolsPath)) {
      const raw = JSON.parse(fs.readFileSync(protocolsPath, "utf-8"));
      _cachedProtocolRules = new Map<string, StateAnnotation>();
      if (raw.rules) {
        for (const [fn, rule] of Object.entries(raw.rules)) {
          const r = rule as any;
          _cachedProtocolRules.set(fn, {
            pre_states: r.pre_states || [],
            post_states: r.post_states || [],
            invalidate: r.invalidate,
            namespace: r.namespace,
          });
        }
      }
    }
  } catch { /* use whatever rules are available */ }
  return _cachedProtocolRules || new Map();
}

/** Ensure rules Map has entries — fall back to protocols.json if empty. */
function ensureRules(ctx: SearchContext): Map<string, StateAnnotation> {
  if (ctx.rules.size > 0) return ctx.rules;
  return loadProtocolRules();
}

// ═══════════════════════════════════════════════════════════════
// Strategy 1: Corpus Search — historical trajectory data
// ═══════════════════════════════════════════════════════════════

export class CorpusSearchStrategy implements CandidateSearchStrategy {
  readonly name = "corpus";

  search(ctx: SearchContext): RepairCandidate[] {
    const all = loadTrajectories().filter(
      t => t.result === "violation" || t.result === "repair"
    );
    if (all.length === 0) return [];

    // Filter: same violation type OR same protocol
    const relevant = all.filter(
      t => (t.violation?.type === ctx.violationType) || t.protocol === ctx.protocol
    );
    if (relevant.length === 0) return [];

    // Group by fix path (deduplicate)
    const pathGroups = new Map<string, typeof relevant>();
    for (const t of relevant) {
      const fixPath = t.violation?.fixPath;
      if (!fixPath || fixPath.length === 0) continue;
      const key = fixPath.join("→");
      if (!pathGroups.has(key)) pathGroups.set(key, []);
      pathGroups.get(key)!.push(t);
    }

    const candidates: RepairCandidate[] = [];
    for (const [pathKey, records] of pathGroups) {
      const fixPath = pathKey.split("→");
      const successRate =
        records.reduce((s, t) => s + t.successRate, 0) / records.length;

      candidates.push({
        id: candidateId("corpus", fixPath.map(fnToAction)),
        source: "corpus",
        actions: fixPath.map(fnToAction),
        explanation: `根据 ${records.length} 个历史案例，补全路径: ${fixPath.join(" → ")}`,
        evidence: records.length,
        metadata: {
          historicalSuccessRate: successRate,
          corpusEvidenceCount: records.length,
        },
      });
    }

    return candidates;
  }
}

// ═══════════════════════════════════════════════════════════════
// Strategy 2: Protocol Search — SSG state graph BFS
// ═══════════════════════════════════════════════════════════════

export class ProtocolSearchStrategy implements CandidateSearchStrategy {
  readonly name = "protocol";

  search(ctx: SearchContext): RepairCandidate[] {
    // P0: Ensure we have rules to work with
    const rules = ensureRules(ctx);
    const effectiveCtx: SearchContext = { ...ctx, rules };

    // Short-circuit: fall back to generic fix path search
    if (effectiveCtx.currentState.length === 0 || effectiveCtx.targetState.length === 0) {
      // Resource cleanup case: no target state means we need to invalidate current states
      if (effectiveCtx.targetState.length === 0 && effectiveCtx.currentState.length > 0) {
        const cleanupCandidates = findCleanupFunctions(effectiveCtx);

        // P3.10: Goal expansion — add prerequisite chains from goal templates
        const goalCandidates = effectiveCtx.goal ? expandGoalAsCandidates(effectiveCtx.goal, effectiveCtx) : [];
        const all = [...cleanupCandidates, ...goalCandidates];
        if (all.length > 0) return all;
      }

      // P3.10: Try goal expansion before giving up
      if (effectiveCtx.goal) {
        const goalCandidates = expandGoalAsCandidates(effectiveCtx.goal, effectiveCtx);
        if (goalCandidates.length > 0) return goalCandidates;
      }

      // P3.14: Frontier exploration — BFS from current state for any path
      const frontierPaths = exploreFrontier(effectiveCtx.rules, effectiveCtx.currentState, 10, 6);
      if (frontierPaths.length > 0) {
        return frontierPaths.map(actions => ({
          id: candidateId("protocol", actions.map(fnToAction)),
          source: "protocol" as const,
          actions: actions.map(fnToAction),
          explanation: `协议前沿探索: ${actions.join(" → ")}`,
          evidence: 0,
          metadata: { pathLength: actions.length, source: "frontier-bfs" },
        }));
      }

      // P3.15: Cross-protocol candidates — expanded to all 9 protocol groups (P7.3)
      const xProtoPaths = expandCrossProtocolCandidates(
        effectiveCtx.goal || "repair",
        [
          "AuthProtocol", "FileProtocol", "DBProtocol", "IRProtocol",
          "TransactionProtocol", "ConditionalProtocol", "LoopProtocol",
          "CrossProtocol", "StatelessProtocol",
        ]
      );
      if (xProtoPaths.length > 0) {
        return xProtoPaths.map(actions => ({
          id: candidateId("protocol", actions.map(fnToAction)),
          source: "protocol" as const,
          actions: actions.map(fnToAction),
          explanation: `跨协议规划: ${actions.join(" → ")}`,
          evidence: 0,
          metadata: { pathLength: actions.length, source: "cross-protocol" },
        }));
      }

      const fixPath = findFixPathStatic(
        effectiveCtx.rules, effectiveCtx.protocol, effectiveCtx.currentState, effectiveCtx.targetState
      );
      if (fixPath.length === 0) return [];

      return [{
        id: candidateId("protocol", fixPath.map(fnToAction)),
        source: "protocol",
        actions: fixPath.map(fnToAction),
        explanation: `按 SSG 协议，需先经过: ${fixPath.join(" → ")}`,
        evidence: 0,
        metadata: { pathLength: fixPath.length },
      }];
    }

    // Full BFS: find multiple distinct paths from currentState to targetState
    const allPaths: string[][] = [];
    const queue: { state: string[]; path: string[]; depth: number }[] = [
      { state: [...effectiveCtx.currentState], path: [], depth: 0 },
    ];
    const visited = new Set<string>();
    visited.add(effectiveCtx.currentState.join(","));
    const MAX_PATHS = 10;
    const MAX_DEPTH = 8;

    while (queue.length > 0 && allPaths.length < MAX_PATHS) {
      const { state, path, depth } = queue.shift()!;
      if (depth >= MAX_DEPTH) continue;

      // Check if target states are a subset of current state
      if (effectiveCtx.targetState.every(t => state.includes(t)) && path.length > 0) {
        allPaths.push([...path]);
        continue;
      }

      // Find all functions that can be called from current state
      for (const [funcName, rule] of effectiveCtx.rules) {
        if (rule.pre_states.every((pre: string) => state.includes(pre))) {
          const newState = [...state];
          if (rule.invalidate) rule.invalidate.forEach(s => {
            const idx = newState.indexOf(s);
            if (idx >= 0) newState.splice(idx, 1);
          });
          for (const post of rule.post_states) {
            if (!newState.includes(post)) newState.push(post);
          }

          const stateKey = newState.sort().join(",");
          if (!visited.has(stateKey)) {
            visited.add(stateKey);
            queue.push({
              state: newState,
              path: [...path, funcName],
              depth: depth + 1,
            });
          }
        }
      }
    }

    const candidates: RepairCandidate[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const fp = allPaths[i];
      candidates.push({
        id: candidateId("protocol", fp.map(fnToAction)),
        source: "protocol",
        actions: fp.map(fnToAction),
        explanation: `协议路径 ${i + 1}: ${fp.join(" → ")} (${fp.length} 步)`,
        evidence: 0,
        metadata: { pathLength: fp.length, pathIndex: i },
      });
    }

    return candidates;
  }
}

// ═══════════════════════════════════════════════════════════════
// Strategy 3: Antibody Search — learned immune rules
// ═══════════════════════════════════════════════════════════════

export class AntibodySearchStrategy implements CandidateSearchStrategy {
  readonly name = "antibody";

  search(ctx: SearchContext): RepairCandidate[] {
    const antibodiesDir = path.resolve(
      process.env.PROGMUNE_PROJECT_DIR || process.cwd(),
      ".progmune_corpus", "antibodies"
    );
    if (!fs.existsSync(antibodiesDir)) return [];

    const candidates: RepairCandidate[] = [];
    const files = fs.readdirSync(antibodiesDir).filter(f => f.startsWith("candidates_"));

    for (const file of files) {
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(antibodiesDir, file), "utf-8")
        );
        if (!Array.isArray(raw)) continue;

        for (const ab of raw) {
          if (ab.pattern?.violationType !== ctx.violationType) continue;
          if (
            ctx.protocol !== "default" &&
            ab.pattern?.protocol &&
            ab.pattern.protocol !== ctx.protocol
          ) continue;

          const fixPath: string[] = ab.suggestedFix?.fixPath || [];
          if (fixPath.length === 0) continue;

          candidates.push({
            id: candidateId("antibody", fixPath.map(fnToAction)),
            source: "antibody",
            actions: fixPath.map(fnToAction),
            explanation:
              ab.suggestedFix?.description || `Antibody rule: ${ab.id}`,
            evidence: ab.evidence?.occurrenceCount || 0,
            metadata: {
              avgSuccessRate: ab.evidence?.avgSuccessRate || 0,
              occurrenceCount: ab.evidence?.occurrenceCount || 0,
            },
          });
        }
      } catch {
        /* skip corrupted files */
      }
    }

    return candidates;
  }
}

// ═══════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════

/** Return the three default search strategies. */
export function createDefaultStrategies(): CandidateSearchStrategy[] {
  return [
    new CorpusSearchStrategy(),
    new ProtocolSearchStrategy(),
    new AntibodySearchStrategy(),
  ];
}
