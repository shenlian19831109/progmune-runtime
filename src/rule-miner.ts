/**
 * Rule Miner — generates actionable protocol rules from failure patterns.
 *
 * Upgrades the passive diagnostic to an active rule generator:
 *   1. Analyses the failure corpus for recurring SVL-4 violations
 *   2. Generates FunctionProtocol entries from fix paths
 *   3. Can merge rules into protocols.json (dry-run by default)
 */

import * as fs from "fs";
import * as path from "path";
import { getTopFailurePatterns, getFailureGenome } from "./failure-corpus";
import type { FunctionProtocol } from "./ssg-validator";

interface MinedRule {
  /** Function name the rule applies to */
  function: string;
  /** Required states before calling */
  pre_states: string[];
  /** States acquired after calling */
  post_states: string[];
  /** States invalidated */
  invalidate?: string[];
  /** Namespace */
  namespace: string;
  /** Why this rule was mined */
  reason: string;
  /** Confidence: how many times this pattern was observed */
  confidence: number;
}

/**
 * Mine protocol rules from failure patterns.
 *
 * Analyses SVL-4 protocol violations to infer state transitions
 * that should be encoded as permanent protocol rules.
 */
export function mineRules(): MinedRule[] {
  const genome = getFailureGenome();
  const patterns = getTopFailurePatterns(10);
  const mined: MinedRule[] = [];

  // Strategy 1: Convert common fix paths into protocol rules
  const ssgFixes = genome.commonFixPaths.filter(f => f.violation === "SVL-4");
  for (const fix of ssgFixes) {
    if (fix.fixPath.length < 2) continue;
    for (let i = 0; i < fix.fixPath.length - 1; i++) {
      const currentFn = fix.fixPath[i];
      const nextFn = fix.fixPath[i + 1];
      mined.push({
        function: currentFn,
        pre_states: [],
        post_states: [`READY_FOR_${nextFn.toUpperCase()}`],
        namespace: "_global",
        reason: `Fix path ${fix.fixPath.join(" → ")} observed ${fix.count} times`,
        confidence: fix.count,
      });
      mined.push({
        function: nextFn,
        pre_states: [`READY_FOR_${nextFn.toUpperCase()}`],
        post_states: ["COMPLETED"],
        namespace: "_global",
        reason: `Fix path continuation: ${currentFn} → ${nextFn}`,
        confidence: fix.count,
      });
    }
  }

  // Strategy 2: Extract ordering constraints from top SVL-4 patterns
  for (const p of patterns) {
    if (!p.pattern.includes("SVL-4")) continue;
    // Pattern format: "SVL-4:protocolViolation" → extract function sequence from context
    const funcMatch = p.pattern.match(/function=([^,\s]+)/);
    if (funcMatch) {
      mined.push({
        function: funcMatch[1],
        pre_states: ["INIT"],
        post_states: ["VALIDATED"],
        namespace: "mined",
        reason: `Pattern "${p.pattern}" occurred ${p.count} times`,
        confidence: p.count,
      });
    }
  }

  // Deduplicate by function name (keep highest confidence)
  const seen = new Map<string, MinedRule>();
  for (const rule of mined) {
    const key = `${rule.function}:${rule.namespace}`;
    if (!seen.has(key) || seen.get(key)!.confidence < rule.confidence) {
      seen.set(key, rule);
    }
  }

  return [...seen.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Convert mined rules to FunctionProtocol format compatible with protocols.json.
 */
export function toProtocolEntries(rules: MinedRule[]): Record<string, any> {
  const entries: Record<string, any> = {};
  for (const r of rules) {
    entries[r.function] = {
      pre_states: r.pre_states,
      post_states: r.post_states,
      ...(r.invalidate && r.invalidate.length > 0 ? { invalidate: r.invalidate } : {}),
      ...(r.namespace !== "_global" ? { namespace: r.namespace } : {}),
      _mined: { reason: r.reason, confidence: r.confidence },
    };
  }
  return entries;
}

/**
 * Merge mined rules into protocols.json.
 * Dry-run by default — set apply=true to write.
 */
export function applyMinedRules(apply: boolean = false): {
  rules: MinedRule[];
  merged: number;
  skipped: number;
  dryRun: boolean;
} {
  const mined = mineRules();
  const protocolsPath = path.resolve(__dirname, "..", "protocols.json");

  let existing: Record<string, any> = {};
  if (fs.existsSync(protocolsPath)) {
    existing = JSON.parse(fs.readFileSync(protocolsPath, "utf-8"));
  }

  const newEntries = toProtocolEntries(mined);
  let merged = 0;
  let skipped = 0;

  for (const [fn, rule] of Object.entries(newEntries)) {
    if (existing[fn]) {
      skipped++;
      continue; // Don't overwrite existing rules
    }
    existing[fn] = rule;
    merged++;
  }

  if (apply && merged > 0) {
    // Backup original
    const backup = protocolsPath + ".bak";
    if (fs.existsSync(protocolsPath)) {
      fs.copyFileSync(protocolsPath, backup);
    }
    fs.writeFileSync(protocolsPath, JSON.stringify(existing, null, 2));
    console.error(`[规则挖掘] 已将 ${merged} 条规则写入 ${protocolsPath}（备份: ${backup}）`);
  }

  return { rules: mined, merged, skipped, dryRun: !apply };
}

/** CLI entry point: print mined rules without applying. */
if (require.main === module) {
  const result = applyMinedRules(false);
  console.log(`\n挖掘到 ${result.rules.length} 条候选规则（dry-run）:`);
  for (const r of result.rules) {
    console.log(`  ${r.function}: [${r.pre_states.join(",")}] → [${r.post_states.join(",")}] (置信度: ${r.confidence})`);
    console.log(`    原因: ${r.reason}`);
  }
  if (result.rules.length > 0) {
    console.log(`\n应用规则: node -e "require('./dist/rule-miner').applyMinedRules(true)"`);
  }
}
