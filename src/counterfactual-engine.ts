/**
 * P2: Counterfactual Repair Engine (V3)
 *
 * When validation fails, this engine:
 *   1. Searches Failure Corpus v2 for similar violation patterns
 *   2. BFS-searches the SSG for alternative legal state transition paths
 *   3. Ranks alternatives by: historical success rate → path length → reward weights
 *   4. Returns top-3 with human-readable explanations
 *
 * This is V3's killer feature: "告诉你三条修法"
 *
 * @requires VALIDATION_FAILURE @produces REPAIR_ALTERNATIVES
 */

import * as fs from "fs";
import * as path from "path";
import { loadFailuresV2 } from "./failure-corpus";
import { findFixPathStatic } from "./ssg-validator";
import type { StateAnnotation } from "./ssg-validator";
import type { FailureRecordV2, ConstraintViolation, GoalConstraint } from "./runtime-types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface CounterfactualAlternative {
  /** Rank (1 = best). */
  rank: number;
  /** Human-readable description of the fix. */
  description: string;
  /** The sequence of functions/states to call. */
  fixPath: string[];
  /** The target state this path leads to. */
  targetState: string[];
  /** Composite score 0-1. */
  score: number;
  /** Where this alternative came from. */
  source: "corpus" | "ssg_bfs" | "antibody" | "llm";
  /** Historical success rate from Corpus (0 if no data). */
  historicalSuccessRate: number;
  /** How many corpus examples support this path. */
  corpusEvidenceCount: number;
  /** Relevant constraints this path satisfies. */
  satisfiedConstraints: string[];
}

interface SearchContext {
  protocol: string;
  currentState: string[];
  targetState: string[];
  violationType: string;
  constraints: GoalConstraint[];
  rules: Map<string, StateAnnotation>;
}

// ═══════════════════════════════════════════════════════════════
// Strategy 1: Search Failure Corpus for similar cases
// ═══════════════════════════════════════════════════════════════

function searchCorpus(ctx: SearchContext): CounterfactualAlternative[] {
  const all = loadFailuresV2();
  if (all.length === 0) return [];

  // Filter: same violation type, same protocol
  const relevant = all.filter(
    f => f.violationType === ctx.violationType || f.protocol === ctx.protocol
  );

  if (relevant.length === 0) return [];

  // Group by fix path (deduplicate)
  const pathGroups = new Map<string, FailureRecordV2[]>();
  for (const f of relevant) {
    if (!f.ssgFixPath || f.ssgFixPath.length === 0) continue;
    const key = f.ssgFixPath.join(" → ");
    if (!pathGroups.has(key)) pathGroups.set(key, []);
    pathGroups.get(key)!.push(f);
  }

  const alternatives: CounterfactualAlternative[] = [];

  for (const [pathKey, records] of pathGroups) {
    const fixPath = pathKey.split(" → ");
    const successCount = records.reduce(
      (s, f) => s + f.repairAttempts.filter(a => a.success).length, 0
    );
    const totalAttempts = records.reduce((s, f) => s + f.repairAttempts.length, 0);
    const successRate = totalAttempts > 0 ? successCount / totalAttempts : records.reduce((s, f) => s + f.successRate, 0) / records.length;
    const avgSuccessRate = records.reduce((s, f) => s + f.successRate, 0) / records.length;

    // Score: corpus evidence × success rate
    const score = Math.min(1, (Math.log(records.length + 1) / Math.log(10)) * 0.4 + successRate * 0.6);

    alternatives.push({
      rank: 0, // filled later
      description: `根据 ${records.length} 个历史案例，补全路径: ${pathKey}`,
      fixPath,
      targetState: ctx.targetState,
      score,
      source: "corpus",
      historicalSuccessRate: avgSuccessRate,
      corpusEvidenceCount: records.length,
      satisfiedConstraints: ctx.constraints
        .filter(c => (c.type === "safety" || c.type === "security") && fixPath.length <= 5)
        .map(c => c.description),
    });
  }

  return alternatives.sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════
// Strategy 2: BFS over SSG to find legal alternative paths
// ═══════════════════════════════════════════════════════════════

function searchSSGBFS(ctx: SearchContext): CounterfactualAlternative[] {
  if (ctx.currentState.length === 0 || ctx.targetState.length === 0) {
    // Try generic fix path search
    const fixPath = findFixPathStatic(ctx.rules, ctx.protocol, ctx.currentState, ctx.targetState);
    if (fixPath.length === 0) return [];

    return [{
      rank: 0,
      description: `按 SSG 协议，需先经过: ${fixPath.join(" → ")}`,
      fixPath,
      targetState: ctx.targetState,
      score: 0.7,
      source: "ssg_bfs",
      historicalSuccessRate: 0,
      corpusEvidenceCount: 0,
      satisfiedConstraints: [],
    }];
  }

  // BFS: find multiple distinct paths from currentState to targetState
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

  const alternatives: CounterfactualAlternative[] = [];
  for (let i = 0; i < allPaths.length; i++) {
    const fp = allPaths[i];
    // Shorter paths score higher
    const lengthScore = Math.max(0, 1 - fp.length / MAX_DEPTH);
    const score = 0.5 + lengthScore * 0.3;

    alternatives.push({
      rank: 0,
      description: `协议路径 ${i + 1}: ${fp.join(" → ")} (${fp.length} 步)`,
      fixPath: fp,
      targetState: ctx.targetState,
      score,
      source: "ssg_bfs",
      historicalSuccessRate: 0,
      corpusEvidenceCount: 0,
      satisfiedConstraints: ctx.constraints
        .filter(c => c.type === "latency" && fp.length <= 3)
        .map(c => c.description),
    });
  }

  return alternatives;
}

// ═══════════════════════════════════════════════════════════════
// Strategy 3: Antibody lookup
// ═══════════════════════════════════════════════════════════════

function searchAntibodies(ctx: SearchContext): CounterfactualAlternative[] {
  const antibodiesDir = path.resolve(
    process.env.PROGMUNE_PROJECT_DIR || process.cwd(),
    ".progmune_corpus", "antibodies"
  );
  if (!fs.existsSync(antibodiesDir)) return [];

  const alternatives: CounterfactualAlternative[] = [];
  const files = fs.readdirSync(antibodiesDir).filter(f => f.startsWith("candidates_"));

  for (const file of files) {
    try {
      const candidates = JSON.parse(fs.readFileSync(path.join(antibodiesDir, file), "utf-8"));
      if (!Array.isArray(candidates)) continue;

      for (const ab of candidates) {
        if (ab.pattern?.violationType !== ctx.violationType) continue;
        if (ctx.protocol !== "default" && ab.pattern?.protocol && ab.pattern.protocol !== ctx.protocol) continue;

        const fixPath = ab.suggestedFix?.fixPath || [];
        if (fixPath.length === 0) continue;

        alternatives.push({
          rank: 0,
          description: ab.suggestedFix?.description || `Antibody rule: ${ab.id}`,
          fixPath,
          targetState: ctx.targetState,
          score: (ab.evidence?.avgSuccessRate || 0.5) * 0.8,
          source: "antibody",
          historicalSuccessRate: ab.evidence?.avgSuccessRate || 0,
          corpusEvidenceCount: ab.evidence?.occurrenceCount || 0,
          satisfiedConstraints: [],
        });
      }
    } catch { /* skip corrupted files */ }
  }

  return alternatives;
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Generate the top-3 counterfactual repair alternatives for a violation.
 *
 * This is V3's killer feature: "告诉你三条修法"
 */
export async function suggestAlternatives(params: {
  violation: ConstraintViolation;
  protocol: string;
  currentState: string[];
  targetState: string[];
  constraints?: GoalConstraint[];
  rules?: Map<string, StateAnnotation>;
}): Promise<CounterfactualAlternative[]> {
  const ctx: SearchContext = {
    protocol: params.protocol || "default",
    currentState: params.currentState.length > 0 ? params.currentState : (params.violation.currentStates || []),
    targetState: params.targetState.length > 0 ? params.targetState : (params.violation.requiredStates || ["COMPLETED"]),
    violationType: params.violation.violatedConstraint || "protocol_violation",
    constraints: params.constraints || [],
    rules: params.rules || new Map(),
  };

  // Run all three strategies
  const corpusResults = searchCorpus(ctx);
  const ssgResults = searchSSGBFS(ctx);
  const antibodyResults = searchAntibodies(ctx);

  // Merge, deduplicate by fix path, sort by score
  const seen = new Set<string>();
  const all: CounterfactualAlternative[] = [];

  for (const alt of [...corpusResults, ...ssgResults, ...antibodyResults]) {
    const key = alt.fixPath.join(" → ");
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(alt);
  }

  // If we have constraints, boost alternatives that satisfy them
  if (ctx.constraints.length > 0) {
    for (const alt of all) {
      const matchCount = alt.satisfiedConstraints.length;
      alt.score += matchCount * 0.05; // small boost per constraint match
    }
  }

  // Sort by score descending
  all.sort((a, b) => b.score - a.score);

  // Assign ranks
  const top3 = all.slice(0, 3);
  for (let i = 0; i < top3.length; i++) {
    top3[i].rank = i + 1;
  }

  return top3;
}

/**
 * Format alternatives as human-readable text (for LLM prompts or CLI output).
 */
export function formatAlternatives(alternatives: CounterfactualAlternative[]): string {
  if (alternatives.length === 0) return "未找到修复方案。";

  const lines: string[] = [];
  for (const alt of alternatives) {
    const badge = alt.source === "corpus" ? "📊 历史数据" :
      alt.source === "ssg_bfs" ? "🔍 协议搜索" :
      alt.source === "antibody" ? "🛡️ 抗体规则" : "🤖 LLM";

    lines.push(`方案 ${alt.rank}: ${alt.description}`);
    lines.push(`  路径: ${alt.fixPath.join(" → ")}`);
    lines.push(`  置信度: ${(alt.score * 100).toFixed(0)}% | ${badge}`);
    if (alt.historicalSuccessRate > 0) {
      lines.push(`  历史成功率: ${(alt.historicalSuccessRate * 100).toFixed(0)}% (${alt.corpusEvidenceCount} 案例)`);
    }
    if (alt.satisfiedConstraints.length > 0) {
      lines.push(`  满足约束: ${alt.satisfiedConstraints.join(", ")}`);
    }
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const testViolation: ConstraintViolation = {
    svl: 4,
    violatedConstraint: "protocol_violation",
    actionIndex: 1,
    currentStates: ["Open"],
    requiredStates: ["Closed"],
    description: "文件未关闭",
  };

  suggestAlternatives({
    violation: testViolation,
    protocol: "FileProtocol",
    currentState: ["Open"],
    targetState: ["Closed"],
    constraints: [{ type: "safety", value: 0.8, description: "安全写入" }],
  }).then(alts => {
    console.log(formatAlternatives(alts));
  });
}
