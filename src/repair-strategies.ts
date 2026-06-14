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
        metadata: { pathLength: 1, cleanupTargets: invalidates },
      });
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
    // Short-circuit: fall back to generic fix path search
    if (ctx.currentState.length === 0 || ctx.targetState.length === 0) {
      // Resource cleanup case: no target state means we need to invalidate current states
      if (ctx.targetState.length === 0 && ctx.currentState.length > 0) {
        const cleanupCandidates = findCleanupFunctions(ctx);

        // P3.10: Goal expansion — add prerequisite chains from goal templates
        const goalCandidates = ctx.goal ? expandGoalAsCandidates(ctx.goal, ctx) : [];
        const all = [...cleanupCandidates, ...goalCandidates];
        if (all.length > 0) return all;
      }

      // P3.10: Try goal expansion before giving up
      if (ctx.goal) {
        const goalCandidates = expandGoalAsCandidates(ctx.goal, ctx);
        if (goalCandidates.length > 0) return goalCandidates;
      }

      // P3.14: Frontier exploration — BFS from current state for any path
      const frontierPaths = exploreFrontier(ctx.rules, ctx.currentState, 10, 6);
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
        ctx.goal || "repair",
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
        ctx.rules, ctx.protocol, ctx.currentState, ctx.targetState
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
      { state: [...ctx.currentState], path: [], depth: 0 },
    ];
    const visited = new Set<string>();
    visited.add(ctx.currentState.join(","));
    const MAX_PATHS = 10;
    const MAX_DEPTH = 8;

    while (queue.length > 0 && allPaths.length < MAX_PATHS) {
      const { state, path, depth } = queue.shift()!;
      if (depth >= MAX_DEPTH) continue;

      // Check if target states are a subset of current state
      if (ctx.targetState.every(t => state.includes(t)) && path.length > 0) {
        allPaths.push([...path]);
        continue;
      }

      // Find all functions that can be called from current state
      for (const [funcName, rule] of ctx.rules) {
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
