/**
 * P6.4: Auto Protocol Synthesizer
 *
 * Converts unsupervised protocol clusters into executable Protocol VM rules.
 * Zero human intervention: trajectories → clusters → state machines → patches.
 *
 * Pipeline:
 *   1. Take DiscoveredClusters from P6.3
 *   2. Extract prototype sequence per cluster (centroid by edit distance)
 *   3. Generate state machine: S0→a1→S1→a2→S2...→Sn→∅
 *   4. Infer pre/post/invalidation from state transitions
 *   5. Output as KnowledgePatch (compatible with KnowledgePatchStore)
 *   6. Conflict detection with existing protocol rules
 *
 * This is the bridge from "pattern discovery" to "self-extending knowledge."
 */

import { clusterByStructure, DiscoveredCluster, CROSS_REPO_SEQUENCES } from "./unsupervised-physics";
import { KnowledgePatchStore, KnowledgePatch } from "./knowledge-governance";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import { compareRules } from "./repo-evaluator";
import { inferStateName } from "./protocol-foundation";
import { normalizeFunctionName } from "./function-synonyms";
import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Prototype Selection
// ═══════════════════════════════════════════════════════════════

/** Levenshtein edit distance between two string arrays. */
function editDistance(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find the prototype (centroid) sequence in a cluster.
 * The prototype is the sequence with minimum average edit distance to all others.
 */
export function findPrototype(sequences: string[][]): string[] {
  if (sequences.length <= 1) return sequences[0] || [];

  let bestSeq = sequences[0];
  let bestDist = Infinity;

  for (const seq of sequences) {
    const totalDist = sequences.reduce((s, other) => s + editDistance(seq, other), 0);
    const avgDist = totalDist / sequences.length;
    if (avgDist < bestDist) {
      bestDist = avgDist;
      bestSeq = seq;
    }
  }

  return bestSeq;
}

// ═══════════════════════════════════════════════════════════════
// State Machine Generation
// ═══════════════════════════════════════════════════════════════

export interface SynthesizedRule {
  function: string;
  pre_states: string[];
  post_states: string[];
  invalidate?: string[];
}

export interface SynthesizedProtocol {
  clusterId: string;
  prototype: string[];
  rules: SynthesizedRule[];
  stateCount: number;
  inferredPattern: string;
  confidence: number;
}

/**
 * Generate a state machine from a prototype action sequence.
 *
 * For a sequence [A, B, C]:
 *   S0 → A → S1 → B → S2 → C → S3
 *
 * Rules:
 *   A: pre=[S0], post=[S1]
 *   B: pre=[S1], post=[S2]
 *   C: pre=[S2], post=[S3], invalidate=[S0,S1,S2,S3] (cleanup)
 */
function generateStateMachine(
  prototype: string[],
  clusterId: string
): SynthesizedRule[] {
  if (prototype.length === 0) return [];

  const rules: SynthesizedRule[] = [];
  const statePrefix = clusterId.replace(/[^a-zA-Z0-9]/g, "_");

  // Generate semantic state names from action functions
  const stateNames: string[] = [];
  for (let i = 0; i < prototype.length; i++) {
    const fn = prototype[i];
    // Use domain-aware naming: "open"→FILE_OPEN, "close"→FILE_CLOSED
    const role = i === 0 ? "post" : i === prototype.length - 1 ? "invalidate" : "post";
    const semanticName = inferStateName(fn, role);
    // Deduplicate: if same semantic name appears, add index
    let finalName = semanticName;
    let suffix = 1;
    while (stateNames.includes(finalName)) {
      finalName = `${semanticName}_${suffix++}`;
    }
    stateNames.push(finalName);
  }

  for (let i = 0; i < prototype.length; i++) {
    const fn = prototype[i];
    const preState = i === 0 ? "INIT" : stateNames[i - 1];
    const postState = i < prototype.length - 1 ? stateNames[i] : `${statePrefix}_DONE`;

    const rule: SynthesizedRule = {
      function: fn,
      pre_states: [preState],
      post_states: [postState],
    };

    // Last action: invalidate all intermediate states (cleanup / release)
    if (i === prototype.length - 1) {
      rule.invalidate = [...stateNames, postState];
    }

    rules.push(rule);
  }

  return rules;
}

// ═══════════════════════════════════════════════════════════════
// Protocol Synthesis
// ═══════════════════════════════════════════════════════════════

/**
 * Synthesize protocol rules from unsupervised clusters.
 *
 * For each cluster with inferred pattern, generates a state machine
 * and exportable rule set.
 */
export function synthesizeProtocols(
  sequences: string[][]
): SynthesizedProtocol[] {
  // P6.9: Normalize function names before clustering (DB_Open→open, createClient→create_client)
  const normalized = sequences.map(seq => seq.map(normalizeFunctionName));
  const clusters = clusterByStructure(normalized);
  const results: SynthesizedProtocol[] = [];

  for (const c of clusters) {
    if (!c.inferredPattern || c.sequences.length < 2) continue;

    const prototype = findPrototype(c.sequences);
    const rules = generateStateMachine(prototype, c.id);

    results.push({
      clusterId: c.id,
      prototype,
      rules,
      stateCount: prototype.length + 1,
      inferredPattern: c.inferredPattern,
      confidence: c.closedLoopRate,
    });
  }

  return results;
}

/**
 * Synthesize protocols from all known cross-repo sequences.
 */
export function synthesizeAllKnownProtocols(): SynthesizedProtocol[] {
  const allSeqs: string[][] = [];
  for (const seqs of Object.values(CROSS_REPO_SEQUENCES)) {
    allSeqs.push(...seqs);
  }
  return synthesizeProtocols(allSeqs);
}

// ═══════════════════════════════════════════════════════════════
// Conflict Detection
// ═══════════════════════════════════════════════════════════════

export interface ConflictReport {
  synthesized: SynthesizedProtocol;
  conflicts: { fn: string; existingRule?: StateAnnotation; synthesizedRule: SynthesizedRule }[];
  hasConflicts: boolean;
}

/**
 * Detect conflicts between synthesized rules and existing protocol rules.
 *
 * A conflict = same function name but different pre/post states.
 */
export function detectConflicts(
  synthesized: SynthesizedProtocol[],
  existingRules: Map<string, StateAnnotation>
): ConflictReport[] {
  const reports: ConflictReport[] = [];

  for (const sp of synthesized) {
    const conflicts: ConflictReport["conflicts"] = [];

    for (const sr of sp.rules) {
      const existing = existingRules.get(sr.function);
      if (existing) {
        // Check if rules are consistent
        const preMatch = sr.pre_states.length === existing.pre_states.length &&
          sr.pre_states.every(s => existing.pre_states.includes(s));
        const postMatch = sr.post_states.length === existing.post_states.length &&
          sr.post_states.every(s => existing.post_states.includes(s));

        if (!preMatch || !postMatch) {
          conflicts.push({ fn: sr.function, existingRule: existing, synthesizedRule: sr });
        }
      }
    }

    reports.push({
      synthesized: sp,
      conflicts,
      hasConflicts: conflicts.length > 0,
    });
  }

  return reports;
}

// ═══════════════════════════════════════════════════════════════
// Full Pipeline
// ═══════════════════════════════════════════════════════════════

export interface SynthesisReport {
  protocols: SynthesizedProtocol[];
  conflicts: ConflictReport[];
  totalRules: number;
  newFunctions: number;
  conflictCount: number;
  readyForGovernance: boolean;
}

/**
 * Full auto-synthesis pipeline:
 *   Sequences → Clusters → State Machines → Conflict Detection → Governance-ready
 */
export function runAutoSynthesis(
  existingRules?: Map<string, StateAnnotation>
): SynthesisReport {
  const protocols = synthesizeAllKnownProtocols();

  const defs = loadDefaultProtocolDefinitions();
  const rules = existingRules || new Map<string, StateAnnotation>();
  for (const p of defs) for (const [fn, rule] of p.rules) rules.set(fn, rule);

  const conflicts = detectConflicts(protocols, rules);

  const totalRules = protocols.reduce((s, p) => s + p.rules.length, 0);
  const newFunctions = protocols.reduce((s, p) => {
    const newFns = p.rules.filter(r => !rules.has(r.function));
    return s + newFns.length;
  }, 0);

  const conflictCount = conflicts.filter(c => c.hasConflicts).length;

  return {
    protocols,
    conflicts,
    totalRules,
    newFunctions,
    conflictCount,
    readyForGovernance: conflictCount === 0 && newFunctions > 0,
  };
}

export function printSynthesisReport(report: SynthesisReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P6.4 Auto Protocol Synthesizer                   ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Protocols Synthesized: ${report.protocols.length}`);
  console.log(`Total Rules:           ${report.totalRules}`);
  console.log(`New Functions:         ${report.newFunctions}`);
  console.log(`Conflicts:             ${report.conflictCount}`);
  console.log(`Ready for Governance:  ${report.readyForGovernance ? "✅ YES" : "❌ NO"}`);
  console.log();

  for (const p of report.protocols) {
    console.log(`  ${p.clusterId}: ${p.prototype.join(" → ")}`);
    console.log(`    Pattern: ${p.inferredPattern}, States: ${p.stateCount}, Rules: ${p.rules.length}`);
    for (const r of p.rules) {
      const inv = r.invalidate ? ` [inv: ${r.invalidate.join(",")}]` : "";
      console.log(`    ${r.function}: [${r.pre_states.join(",")}] → [${r.post_states.join(",")}]${inv}`);
    }
  }
  console.log();

  if (report.conflictCount > 0) {
    console.log("─── Conflicts ───");
    for (const c of report.conflicts.filter(c => c.hasConflicts)) {
      console.log(`  ${c.synthesized.clusterId}:`);
      for (const cf of c.conflicts) {
        console.log(`    ${cf.fn}: existing≠synthesized — needs governance review`);
      }
    }
    console.log();
  }
}
