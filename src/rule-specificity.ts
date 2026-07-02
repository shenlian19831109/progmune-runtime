/**
 * Sprint 13: Rule Specificity Analyzer — attack RULE_TOO_BROAD.
 *
 * Not "optimize VI." Not "add features."
 * Identify the weakest rules and fix them. One sprint, one root cause.
 *
 * Target: RULE_TOO_BROAD 61% → 45%
 *
 * How it works:
 *   1. Load SSG rules from benchmark data
 *   2. Score each rule by discriminative power (specificity, cross-repo, FP rate)
 *   3. Rank weakest rules → these are the FP factories
 *   4. Suggest concrete fixes (add pre_states, add post_states, add invalidate)
 *   5. Output Sprint 13 backlog
 *
 * Usage:
 *   npx ts-node --transpile-only src/rule-specificity.ts
 *   npx ts-node --transpile-only src/rule-specificity.ts --repo curl
 */

import * as fs from "fs";
import * as path from "path";
import { synthesizeProtocols } from "./auto-protocol-synthesizer";
import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Rule Quality Scoring
// ═══════════════════════════════════════════════════════════════

interface RuleQuality {
  function: string;
  specificityScore: number;    // 0-100: pre + post + invalidate specificity
  crossRepoScore: number;      // 0-100: observed in multiple repos?
  fpContribution: number;      // estimated FP count caused by this rule
  weakness: string;            // why is this rule weak?
  suggestedFix: string;        // what to do about it
  priority: "P0" | "P1" | "P2"; // sprint priority
}
/**
 * Score a single rule's discriminative power.
 *
 * Weak rules have:
 *   - Empty pre_states (matches ANY state)
 *   - Single or no post_states (no meaningful state transition)
 *   - No invalidate (no resource management)
 */
function scoreRule(fn: string, rule: StateAnnotation, fnFrequency: Map<string, number>): RuleQuality {
  const preCount = rule.pre_states.length;
  const postCount = rule.post_states.length;
  const hasInvalidate = (rule.invalidate || []).length > 0;

  // Specificity: more pre/post states = more specific = fewer FPs
  // 0 states = 0 points, 1-2 = 30, 3-4 = 60, 5+ = 100
  const totalStates = preCount + postCount + (hasInvalidate ? 1 : 0);
  const specificityScore = Math.min(100, totalStates * 20);

  // Cross-repo: not applicable at rule level — use frequency as proxy
  const freq = fnFrequency.get(fn) || 1;
  const crossRepoScore = Math.min(100, freq * 5); // 20+ occurrences = full score

  // FP contribution estimate: lower specificity → more FPs
  const fpContribution = Math.max(1, Math.round((100 - specificityScore) / 10));

  // Diagnose weakness
  let weakness = "";
  let suggestedFix = "";

  if (preCount === 0 && postCount === 0) {
    weakness = "No states — matches everything";
    suggestedFix = "Add at least 1 pre_state and 1 post_state";
  } else if (preCount === 0) {
    weakness = "Empty pre_states — matches any initial state";
    suggestedFix = "Add pre_state from call context (what must be true before this call?)";
  } else if (postCount === 0 && !hasInvalidate) {
    weakness = "No post_states or invalidate — no state transition";
    suggestedFix = "Add post_state (what changes after this call?) or invalidate (what does it release?)";
  } else if (totalStates <= 2) {
    weakness = `Only ${totalStates} state${totalStates > 1 ? 's' : ''} — too broad`;
    suggestedFix = `Add ${3 - totalStates} more pre/post/invalidate states`;
  } else {
    weakness = "Adequate specificity but still producing FPs";
    suggestedFix = "Add negative evidence (forbidden transitions) or context filter";
  }

  // Priority
  let priority: RuleQuality["priority"] = "P2";
  if (specificityScore <= 20) priority = "P0";
  else if (specificityScore <= 40) priority = "P1";

  return {
    function: fn,
    specificityScore,
    crossRepoScore,
    fpContribution,
    weakness,
    suggestedFix,
    priority,
  };
}

// ═══════════════════════════════════════════════════════════════
// Sprint 13 Backlog Generator
// ═══════════════════════════════════════════════════════════════

export function generateSprint13Backlog(repoName: string = "curl"): {
  repo: string;
  totalRules: number;
  weakRules: number;
  estimatedFPImpact: number;
  backlog: RuleQuality[];
  sprintGoal: string;
} {
  const labelFile = path.join(process.cwd(), "benchmarks", `${repoName}-labels.json`);
  if (!fs.existsSync(labelFile)) {
    throw new Error(`Labels not found: ${labelFile}`);
  }

  const data = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  const labels: Record<string, string> = data.labels || {};
  const sequences: Record<string, string[]> = data.sequences || {};
  const labeledIndices = Object.keys(labels).map(Number);

  // Get clean sequences
  const cleanSeqs: string[][] = [];
  for (const idx of labeledIndices) {
    if (labels[idx] === "clean" && sequences[idx]) {
      cleanSeqs.push(sequences[idx]);
    }
  }

  // Generate rules
  const protocols = synthesizeProtocols(cleanSeqs);

  // Build rules map
  const rules = new Map<string, StateAnnotation>();
  for (const proto of protocols) {
    for (const r of proto.rules) {
      rules.set(r.function, {
        pre_states: r.pre_states,
        post_states: r.post_states,
        invalidate: r.invalidate,
        namespace: proto.inferredPattern || "discovered",
      });
    }
  }

  // Count function frequency across sequences
  const fnFrequency = new Map<string, number>();
  for (const seq of cleanSeqs) {
    const seen = new Set<string>();
    for (const fn of seq) {
      if (!seen.has(fn)) { fnFrequency.set(fn, (fnFrequency.get(fn) || 0) + 1); seen.add(fn); }
    }
  }

  // Score all rules
  const scored: RuleQuality[] = [];
  for (const [fn, rule] of rules) {
    scored.push(scoreRule(fn, rule, fnFrequency));
  }

  // Sort: weakest (lowest specificity) first
  scored.sort((a, b) => a.specificityScore - b.specificityScore);

  // Count weak rules (specificity < 40)
  const weakRules = scored.filter(r => r.specificityScore < 40).length;
  const estimatedFPImpact = scored
    .filter(r => r.specificityScore < 40)
    .reduce((s, r) => s + r.fpContribution, 0);

  return {
    repo: repoName,
    totalRules: rules.size,
    weakRules,
    estimatedFPImpact,
    backlog: scored,
    sprintGoal: `Reduce RULE_TOO_BROAD FPs from 61% to 45% by fixing the ${weakRules} weakest rules (est. ${estimatedFPImpact} FP impact)`,
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatter
// ═══════════════════════════════════════════════════════════════

function bar(value: number, max: number, width: number = 15): string {
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatSprint13Backlog(b: ReturnType<typeof generateSprint13Backlog>): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║     Sprint 13: Attack RULE_TOO_BROAD                         ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Repo: ${b.repo}`.padEnd(63) + "║");
  lines.push(`║  Total rules: ${b.totalRules}  |  Weak rules: ${b.weakRules}  |  Est. FP impact: ${b.estimatedFPImpact}`.padEnd(63) + "║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Goal: ${b.sprintGoal.slice(0, 55)}`.padEnd(63) + "║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // P0 — Critical (specificity ≤ 20)
  const p0 = b.backlog.filter(r => r.priority === "P0");
  if (p0.length > 0) {
    lines.push("── P0: Critical (specificity ≤ 20) — Fix these first ──");
    lines.push("");
    for (const r of p0.slice(0, 15)) {
      const specBar = bar(r.specificityScore, 100);
      lines.push(`  ${r.function.padEnd(35)} spec:${String(r.specificityScore).padStart(3)} ${specBar}  est.${r.fpContribution} FP`);
      lines.push(`    Weakness: ${r.weakness}`);
      lines.push(`    Fix:      ${r.suggestedFix}`);
      lines.push("");
    }
    if (p0.length > 15) {
      lines.push(`  ... and ${p0.length - 15} more P0 rules`);
      lines.push("");
    }
  }

  // P1 — High (specificity 21-40)
  const p1 = b.backlog.filter(r => r.priority === "P1");
  if (p1.length > 0) {
    lines.push("── P1: High (specificity 21-40) — Fix in Sprint 13-14 ──");
    lines.push("");
    for (const r of p1.slice(0, 10)) {
      lines.push(`  ${r.function.padEnd(35)} spec:${String(r.specificityScore).padStart(3)}  ${bar(r.specificityScore, 100)}  est.${r.fpContribution} FP`);
      lines.push(`    → ${r.suggestedFix}`);
    }
    if (p1.length > 10) {
      lines.push(`  ... and ${p1.length - 10} more P1 rules`);
    }
    lines.push("");
  }

  // Summary
  const totalFPImpact = b.backlog.reduce((s, r) => s + r.fpContribution, 0);
  lines.push("── Sprint 13 Completion Criteria ──");
  lines.push(`  Fix P0 rules (${p0.length} rules, est. ${p0.reduce((s, r) => s + r.fpContribution, 0)} FP impact)`);
  lines.push(`  Fix P1 rules (${p1.length} rules, est. ${p1.reduce((s, r) => s + r.fpContribution, 0)} FP impact)`);
  lines.push(`  Total estimated FP reduction: ${p0.reduce((s, r) => s + r.fpContribution, 0) + p1.reduce((s, r) => s + r.fpContribution, 0)}/${b.totalRules} rules`);
  lines.push(`  Dashboard K5: RULE_TOO_BROAD 61% → target 45%`);
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const repoIdx = args.findIndex(a => a === "--repo");
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : "curl";

  const backlog = generateSprint13Backlog(repo);
  console.log(formatSprint13Backlog(backlog));
}
