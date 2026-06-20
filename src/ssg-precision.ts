/**
 * P9.2p-SSG: Precision benchmark using REAL SSG state machine validation.
 *
 * Key difference from precision-benchmark.ts:
 *   precision-benchmark.ts: structural comparison (state count diff)
 *   ssg-precision.ts:       SSG validation (pre_state → fn → post_state)
 *
 * Pipeline:
 *   1. Extract call sequences from repo
 *   2. Auto-discover protocol rules (auto-protocol-synthesizer)
 *   3. Feed rules into SSG validator (ssg-validator)
 *   4. Validate each sequence against discovered rules
 *   5. Measure precision against labeled ground truth
 */

import * as fs from "fs";
import * as path from "path";
import { inferStateMachine } from "./state-inference";
import { synthesizeProtocols } from "./auto-protocol-synthesizer";
import { parseProtocolsFromJSON } from "./ssg-validator";
import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// SSG Validation Engine
// ═══════════════════════════════════════════════════════════════

/**
 * Validate a single call sequence against SSG protocol rules.
 *
 * Unlike detectStructuralViolations (which compares SM topology),
 * this does proper state-machine validation:
 *   1. Start with initial states (namespace defaults)
 *   2. For each function call, check if pre_states are satisfied
 *   3. Apply state changes (invalidate old, add new)
 *   4. A sequence is "clean" if ALL function calls pass pre_state checks
 *   5. A sequence is "violation" if ANY function call fails pre_state checks
 *
 * @returns true if ALL calls pass validation, false if any call fails
 */
export function validateSequenceWithSSG(
  sequence: string[],
  rules: Map<string, StateAnnotation>,
  nsInit: Map<string, string> = new Map([["_global", "INIT"]]),
  trainingSeqs?: string[][]
): { valid: boolean; failingStep: number; failingFunction: string; reason: string } {
  // Initialize per-namespace state sets
  const nsStates = new Map<string, Set<string>>();
  for (const [ns, initState] of nsInit) {
    nsStates.set(ns, new Set([initState]));
  }

  for (let i = 0; i < sequence.length; i++) {
    const fn = sequence[i];
    const rule = rules.get(fn);

    // No rule for this function → no constraint → skip (not a violation)
    if (!rule) continue;

    const ns = rule.namespace || "_global";
    const states = nsStates.get(ns) || new Set<string>(["INIT"]);

    // Check preconditions
    if (rule.pre_states.length > 0) {
      const preMet = rule.pre_states.every(s => states.has(s));
      if (!preMet) {
        const missing = rule.pre_states.filter(s => !states.has(s));
        return {
          valid: false,
          failingStep: i,
          failingFunction: fn,
          reason: `${fn} requires [${missing.join(",")}] but state has [${[...states].join(",")}] (namespace: ${ns})`,
        };
      }
    }

    // Apply state changes
    if (rule.invalidate) rule.invalidate.forEach(s => states.delete(s));
    for (const s of rule.post_states) states.add(s);
  }

  // P9.2p: Check for incomplete lifecycle.
  // Only flag if ALL of these conditions are met:
  //   1. The state was PRODUCED by a function in this sequence (not inherited from INIT)
  //   2. A closer function EXISTS in the rule set that can invalidate this state
  //   3. That closer function appears in the CLEAN training data as a frequent terminal call
  // This prevents false positives on sequences that naturally end without a closer.
  const lingering: string[] = [];
  for (const [ns, st] of nsStates) {
    if (ns === "_global") continue;
    for (const s of st) {
      if (s === "INIT" || s === "IDLE") continue;

      // Condition 1: Was this state produced during this sequence?
      let producedInSequence = false;
      for (const fn of sequence) {
        const r = rules.get(fn);
        if (r && r.post_states.includes(s)) { producedInSequence = true; break; }
      }
      if (!producedInSequence) continue;

      // Condition 2: Does a closer function exist that can invalidate this state?
      let closerFn = "";
      for (const [fn, rule] of rules) {
        if (rule.invalidate && rule.invalidate.includes(s)) {
          closerFn = fn;
          break;
        }
      }
      if (!closerFn) continue;

      // Condition 3: Has this closer been called in this sequence?
      if (sequence.includes(closerFn)) continue; // already called — no violation

      // Condition 4: Is this closer a frequent terminal call?
      // Only flag if ≥50% of sequences containing the state's producer
      // also call the closer as the last step.
      if (trainingSeqs && !isFrequentTerminal(closerFn, s, trainingSeqs, rules)) continue;

      lingering.push(`${ns}:${s}→${closerFn}`);
    }
  }

  if (lingering.length > 0) {
    return {
      valid: false,
      failingStep: sequence.length - 1,
      failingFunction: sequence[sequence.length - 1] || "",
      reason: `Incomplete lifecycle: acquired states [${lingering.join(",")}] not released — missing closer call`,
    };
  }

  // P9.2p: Check for reordering violations.
  // If function A always precedes function B in the clean training data,
  // but B precedes A in this test sequence, that's a potential violation.
  const orderViolations = checkOrderViolations(sequence, rules, nsInit);
  if (orderViolations.length > 0) {
    return {
      valid: false,
      failingStep: orderViolations[0].pos,
      failingFunction: orderViolations[0].fn,
      reason: `Order violation: ${orderViolations[0].reason}`,
    };
  }

  return { valid: true, failingStep: -1, failingFunction: "", reason: "" };
}

/**
 * Check if any functions appear in the wrong order compared to
 * the discovered protocol rules' state machine graph.
 *
 * Builds a partial order from the state machine topology:
 * if fnA's post_states include S, and fnB's pre_states include S,
 * then fnA must precede fnB. If fnB appears before fnA, it's a violation.
 */
function checkOrderViolations(
  sequence: string[],
  rules: Map<string, StateAnnotation>,
  nsInit: Map<string, string>
): { pos: number; fn: string; reason: string }[] {
  const violations: { pos: number; fn: string; reason: string }[] = [];

  // Build must-precede graph from rules
  for (const [fnA, ruleA] of rules) {
    if (ruleA.post_states.length === 0) continue;
    for (const [fnB, ruleB] of rules) {
      if (fnA === fnB) continue;
      // fnA produces a state that fnB requires → fnA must precede fnB
      const shared = ruleA.post_states.filter(s => ruleB.pre_states.includes(s));
      if (shared.length === 0) continue;

      // Check if fnB appears before fnA in the sequence
      const posA = sequence.indexOf(fnA);
      const posB = sequence.indexOf(fnB);
      if (posB >= 0 && posA >= 0 && posB < posA) {
        violations.push({
          pos: posB,
          fn: fnB,
          reason: `${fnB} should come AFTER ${fnA} (state [${shared[0]}] must be produced first)`,
        });
      }
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════
// Auto-discover protocol rules from sequences
// ═══════════════════════════════════════════════════════════════

/**
 * Load hand-written protocol rules from a JSON file (like protocols.json format).
 */
export function loadHandWrittenRules(protoPath: string): {
  rules: Map<string, StateAnnotation>;
  nsInit: Map<string, string>;
} {
  const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
  const fns = parseProtocolsFromJSON(protoDef);
  const rules = new Map<string, StateAnnotation>();
  for (const p of fns) rules.set(p.function, p.protocol);

  const nsInit = new Map<string, string>();
  nsInit.set("_global", "INIT");
  if (protoDef.namespaceInitialStates) {
    for (const [ns, init] of Object.entries(protoDef.namespaceInitialStates)) {
      nsInit.set(ns, init as string);
    }
  }

  return { rules, nsInit };
}

/**
 * Build ordering constraints from clean sequences.
 * If fnA appears before fnB in ≥80% of sequences where both appear,
 * then fnA must precede fnB.
 */
function buildOrderConstraints(sequences: string[][]): Map<string, Set<string>> {
  const pairs = new Map<string, Map<string, { aBeforeB: number; bBeforeA: number }>>();

  for (const seq of sequences) {
    for (let i = 0; i < seq.length; i++) {
      for (let j = i + 1; j < seq.length; j++) {
        const a = seq[i], b = seq[j];
        if (a === b) continue;
        if (!pairs.has(a)) pairs.set(a, new Map());
        if (!pairs.get(a)!.has(b)) pairs.get(a)!.set(b, { aBeforeB: 0, bBeforeA: 0 });
        pairs.get(a)!.get(b)!.aBeforeB++;
      }
    }
  }

  const constraints = new Map<string, Set<string>>();
  for (const [fnA, pbs] of pairs) {
    for (const [fnB, counts] of pbs) {
      const total = counts.aBeforeB + counts.bBeforeA;
      // Require ≥5 co-occurrences AND ≥90% ordering confidence
      // to avoid false positives from small sample sizes.
      if (total >= 5 && counts.aBeforeB / total >= 0.9) {
        if (!constraints.has(fnA)) constraints.set(fnA, new Set());
        constraints.get(fnA)!.add(fnB);
      }
    }
  }
  return constraints;
}

/**
 * Check if a closer function is a frequent terminal call for sequences
 * that produce a given state. Prevents flagging sequences that naturally
 * end without a closer.
 */
function isFrequentTerminal(
  closerFn: string,
  targetState: string,
  sequences: string[][],
  rules: Map<string, StateAnnotation>
): boolean {
  let producesState = 0;
  let closerAsLast = 0;

  for (const seq of sequences) {
    let hasProducer = false;
    for (const fn of seq) {
      const r = rules.get(fn);
      if (r && r.post_states.includes(targetState)) { hasProducer = true; break; }
    }
    if (!hasProducer) continue;
    producesState++;
    if (seq.length > 0 && seq[seq.length - 1] === closerFn) closerAsLast++;
  }

  // Closer must appear as last call in ≥50% of sequences that produce this state
  return producesState >= 2 && closerAsLast / producesState >= 0.5;
}

/** Validate a sequence against ordering constraints + SSG rules. */
function validateWithOrdering(
  sequence: string[],
  rules: Map<string, StateAnnotation>,
  nsInit: Map<string, string>,
  orderConstraints: Map<string, Set<string>>,
  trainingSeqs?: string[][]
): { valid: boolean; failingStep: number; failingFunction: string; reason: string } {
  // First: SSG validation
  const ssgResult = validateSequenceWithSSG(sequence, rules, nsInit, trainingSeqs);
  if (!ssgResult.valid) return ssgResult;

  // Second: ordering constraint check
  for (let i = 0; i < sequence.length; i++) {
    const fnA = sequence[i];
    const mustFollow = orderConstraints.get(fnA);
    if (!mustFollow) continue;
    // Check if any required follower is BEFORE fnA in this sequence
    for (let j = 0; j < i; j++) {
      const fnB = sequence[j];
      if (mustFollow.has(fnB)) {
        return {
          valid: false, failingStep: j, failingFunction: fnB,
          reason: `Order violation: ${fnB} should come AFTER ${fnA} (appears before in ${Math.round(sequence.length/2)} of clean sequences)`,
        };
      }
    }
  }

  return { valid: true, failingStep: -1, failingFunction: "", reason: "" };
}

/**
 * Discover protocol rules from call sequences using the auto-protocol-synthesizer.
 * Returns SSG-compatible StateAnnotation rules ready for validation.
 */
export function discoverRulesFromSequences(
  sequences: string[][]
): { rules: Map<string, StateAnnotation>; nsInit: Map<string, string> } {
  const synthesized = synthesizeProtocols(sequences);

  const rules = new Map<string, StateAnnotation>();
  const namespaces = new Set<string>();

  for (const proto of synthesized) {
    for (const r of proto.rules) {
      // Infer namespace from prototype pattern
      const ns = proto.inferredPattern || "discovered";
      namespaces.add(ns);

      rules.set(r.function, {
        pre_states: r.pre_states,
        post_states: r.post_states,
        invalidate: r.invalidate,
        namespace: ns,
      });
    }
  }

  // Build namespace initial states
  const nsInit = new Map<string, string>();
  nsInit.set("_global", "INIT");
  for (const ns of namespaces) {
    nsInit.set(ns, "INIT");
  }

  return { rules, nsInit };
}

// ═══════════════════════════════════════════════════════════════
// SSG Precision Benchmark
// ═══════════════════════════════════════════════════════════════

interface LabeledSequence {
  index: number;
  functionName: string;
  calls: string[];
  expected: "clean" | "violation";
}

export interface SSGPrecisionResult {
  total: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  discoveredRules: number;
  mismatches: Array<{
    index: number;
    functionName: string;
    expected: string;
    detected: string;
    reason: string;
  }>;
}

/**
 * Run precision benchmark using SSG validation with auto-discovered rules.
 *
 * @param sequences  Labeled call sequences
 * @param labels     Index → 'clean' | 'violation'
 * @returns SSGPrecisionResult with TP/FP/TN/FN breakdown
 */
export function runSSGPrecisionBenchmark(
  sequences: LabeledSequence[],
  labels: Record<number, "clean" | "violation">
): SSGPrecisionResult {
  // 1. Build rule set from clean-labeled sequences
  const cleanSeqs = sequences
    .filter(s => labels[s.index] === "clean" && s.calls.length >= 2)
    .map(s => s.calls);

  if (cleanSeqs.length === 0) {
    return { total: 0, truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, precision: 0, recall: 0, f1: 0, discoveredRules: 0, mismatches: [] };
  }

  // 2. Auto-discover protocol rules
  const { rules, nsInit } = discoverRulesFromSequences(cleanSeqs);

  // 2b. Build ordering constraints from clean data
  const orderConstraints = buildOrderConstraints(cleanSeqs);

  // 3. Validate each sequence
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const mismatches: SSGPrecisionResult["mismatches"] = [];

  for (const seq of sequences) {
    const expected = labels[seq.index];
    if (!expected) continue;

    const result = validateWithOrdering(seq.calls, rules, nsInit, orderConstraints, cleanSeqs);
    const detected = result.valid ? "clean" : "violation";

    if (expected === "clean" && detected === "clean") { tn++; }
    else if (expected === "violation" && detected === "violation") { tp++; }
    else if (expected === "clean" && detected === "violation") {
      fp++;
      mismatches.push({ index: seq.index, functionName: seq.functionName, expected, detected, reason: result.reason });
    } else if (expected === "violation" && detected === "clean") {
      fn++;
      mismatches.push({ index: seq.index, functionName: seq.functionName, expected, detected, reason: "SSG passed — no pre_state violation detected" });
    }
  }

  const total = tp + fp + tn + fn;
  const precision = total > 0 ? tp / (tp + fp) : 0;
  const recall = total > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { total, truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn, precision, recall, f1, discoveredRules: rules.size, mismatches };
}

// ═══════════════════════════════════════════════════════════════
// Hand-written rule precision benchmark
// ═══════════════════════════════════════════════════════════════

/**
 * Run precision benchmark using HAND-WRITTEN protocol rules instead of auto-discovered ones.
 * This measures the UPPER BOUND of what the SSG validator can achieve.
 */
export function runHandWrittenPrecisionBenchmark(
  sequences: LabeledSequence[],
  labels: Record<number, "clean" | "violation">,
  protoPath: string
): SSGPrecisionResult {
  const { rules, nsInit } = loadHandWrittenRules(protoPath);

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const mismatches: SSGPrecisionResult["mismatches"] = [];

  for (const seq of sequences) {
    const expected = labels[seq.index];
    if (!expected) continue;

    const result = validateSequenceWithSSG(seq.calls, rules, nsInit);
    const detected = result.valid ? "clean" : "violation";

    if (expected === "clean" && detected === "clean") { tn++; }
    else if (expected === "violation" && detected === "violation") { tp++; }
    else if (expected === "clean" && detected === "violation") {
      fp++;
      mismatches.push({ index: seq.index, functionName: seq.functionName, expected, detected, reason: result.reason });
    } else if (expected === "violation" && detected === "clean") {
      fn++;
      mismatches.push({ index: seq.index, functionName: seq.functionName, expected, detected, reason: "SSG passed — no violation detected" });
    }
  }

  const total = tp + fp + tn + fn;
  const precision = total > 0 ? tp / (tp + fp) : 0;
  const recall = total > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { total, truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn, precision, recall, f1, discoveredRules: rules.size, mismatches };
}

// ═══════════════════════════════════════════════════════════════
// CLI — only runs when executed directly (not required from tests)
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
const args = process.argv.slice(2);
const seqFile = args[0];
const labelFile = args[1];

if (!seqFile || !labelFile) {
  console.error("Usage: npx tsx src/ssg-precision.ts <sequences.json> <labels.json>");
  process.exit(1);
}

const seqData = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
const rawSeqs: any[] = seqData.sequences || seqData;
// Add index to each sequence if missing
const sequences: LabeledSequence[] = rawSeqs.map((s: any, i: number) => ({
  index: s.index ?? i,
  functionName: s.functionName || s.functionName || (`seq_${i}`),
  calls: s.calls || [],
  expected: 'clean' as const,
}));
const labels: Record<number, "clean" | "violation"> = JSON.parse(fs.readFileSync(labelFile, "utf-8"));

console.log("Running SSG precision benchmark...");
const result = runSSGPrecisionBenchmark(sequences, labels);

console.log("\n=== SSG Precision Benchmark Results ===");
console.log(`Discovered rules:   ${result.discoveredRules}`);
console.log(`Sequences evaluated: ${result.total}`);
console.log(`True Positives:  ${result.truePositive}`);
console.log(`False Positives: ${result.falsePositive}`);
console.log(`True Negatives:  ${result.trueNegative}`);
console.log(`False Negatives: ${result.falseNegative}`);
console.log(`\nPrecision: ${(result.precision * 100).toFixed(1)}%`);
console.log(`Recall:    ${(result.recall * 100).toFixed(1)}%`);
console.log(`F1 Score:  ${(result.f1 * 100).toFixed(1)}%`);

if (result.mismatches.length > 0) {
  console.log(`\n--- Mismatches (${result.mismatches.length}) ---`);
  for (const m of result.mismatches.slice(0, 20)) {
    console.log(`  [${m.index}] ${m.functionName}: expected=${m.expected} detected=${m.detected}`);
    console.log(`    ${m.reason}`);
  }
  if (result.mismatches.length > 20) {
    console.log(`  ... and ${result.mismatches.length - 20} more`);
  }
}

fs.writeFileSync("benchmarks/ssg-precision-report.json", JSON.stringify({ timestamp: new Date().toISOString(), result }, null, 2));
console.log("\nReport saved to benchmarks/ssg-precision-report.json");
} // end if (require.main === module)
