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
import { inferStateMachine } from "./state-inference";
import { synthesizeProtocols } from "./auto-protocol-synthesizer";
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
  nsInit: Map<string, string> = new Map([["_global", "INIT"]])
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

  return { valid: true, failingStep: -1, failingFunction: "", reason: "" };
}

// ═══════════════════════════════════════════════════════════════
// Auto-discover protocol rules from sequences
// ═══════════════════════════════════════════════════════════════

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

  // 3. Validate each sequence
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
// CLI
// ═══════════════════════════════════════════════════════════════

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
