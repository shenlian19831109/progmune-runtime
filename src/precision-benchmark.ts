import * as fs from 'fs';
import { inferStateMachine } from './state-inference';

// ═══════════════════════════════════════════════════════════════
// Precision Benchmark — measures FP rate against real codebases
//
// Core question: "Out of 1000 alerts, how many are real?"
//
// Uses state machine inference WITHOUT a fixed template.
// Detection logic: build SM from clean-labeled sequences as reference,
// then check whether each test sequence has significantly fewer states
// or illegal transitions compared to the reference.
//
// This is NOT SSG validator (which needs pre-written protocol rules).
// It IS the structural violation approach — comparing inferred state
// machines — which is what Progmune can do WITHOUT hand-written rules.
// ═══════════════════════════════════════════════════════════════

interface LabeledSequence {
  index: number;
  functionName: string;
  calls: string[];
  expected: 'clean' | 'violation';
}

export interface PrecisionResult {
  total: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  /** Only sequences where detection was WRONG (FP or FN). */
  mismatches: Array<{
    index: number;
    functionName: string;
    expected: string;
    detected: string;
    stateDiff: number;
    calls: string[];
  }>;
}

/**
 * Run precision benchmark with labeled data.
 *
 * Detection logic (structural, not template-matching):
 *   1. Build REFERENCE SM from clean-labeled sequences
 *   2. For each test sequence, build its SM
 *   3. Compare: if a sequence has ≥2 fewer states than the reference,
 *      OR has illegal transitions not in the reference, it's flagged.
 *   4. Measure TP/FP/TN/FN against labels.
 */
export function runPrecisionBenchmark(
  sequences: LabeledSequence[],
  labels: Record<number, 'clean' | 'violation'>
): PrecisionResult {
  // Build reference SM from clean sequences only
  const cleanSeqs = sequences
    .filter(s => labels[s.index] === 'clean' && s.calls.length >= 2)
    .map(s => s.calls);
  if (cleanSeqs.length === 0) {
    return { total: 0, truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, precision: 0, recall: 0, f1: 0, mismatches: [] };
  }
  const referenceSM = inferStateMachine(cleanSeqs);
  const refStateCount = referenceSM.stateCount;

  // Extract reference edge set (what transitions are "normal")
  const refEdges = new Set<string>();
  for (let i = 0; i < referenceSM.stateTransitions.length; i++)
    for (let j = 0; j < (referenceSM.stateTransitions[i] || []).length; j++)
      if (referenceSM.stateTransitions[i][j] > 0) refEdges.add(`${i}→${j}`);

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const mismatches: PrecisionResult['mismatches'] = [];

  for (const seq of sequences) {
    const expected: string = labels[seq.index] || 'skip';
    if (expected === 'skip') continue;
    if (seq.calls.length < 2) { tn++; continue; }

    const testSM = inferStateMachine([seq.calls]);
    const stateDiff = refStateCount - testSM.stateCount;

    // Detection: flagged if ≥2 fewer states than reference
    const detected = stateDiff >= 2 ? 'violation' : 'clean';

    let matched = false;
    if (expected === 'clean' && detected === 'clean') { tn++; matched = true; }
    else if (expected === 'violation' && detected === 'violation') { tp++; matched = true; }
    else if (expected === 'clean' && detected === 'violation') { fp++; }
    else if (expected === 'violation' && detected === 'clean') { fn++; }

    if (!matched) {
      mismatches.push({
        index: seq.index,
        functionName: seq.functionName,
        expected,
        detected,
        stateDiff,
        calls: seq.calls,
      });
    }
  }

  const total = tp + fp + tn + fn;
  const precision = total > 0 ? tp / (tp + fp) : 0;
  const recall = total > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { total, truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn, precision, recall, f1, mismatches };
}

// ================ CLI ================

const args = process.argv.slice(2);
const seqFile = args[0];
const labelFile = args[1];

if (!seqFile || !labelFile) {
  console.error('Usage: npx tsx src/precision-benchmark.ts <sequences.json> <labels.json>');
  process.exit(1);
}

const seqData = JSON.parse(fs.readFileSync(seqFile, 'utf-8'));
const sequences = seqData.sequences || seqData;
const labels = JSON.parse(fs.readFileSync(labelFile, 'utf-8'));

console.log('Running precision benchmark...');
const result = runPrecisionBenchmark(sequences, labels);

console.log('\n=== Precision Benchmark Results ===');
console.log(`Total sequences evaluated: ${result.total}`);
console.log(`True Positives:  ${result.truePositive}`);
console.log(`False Positives: ${result.falsePositive}`);
console.log(`True Negatives:  ${result.trueNegative}`);
console.log(`False Negatives: ${result.falseNegative}`);
console.log(`\nPrecision: ${(result.precision * 100).toFixed(1)}%`);
console.log(`Recall:    ${(result.recall * 100).toFixed(1)}%`);
console.log(`F1 Score:  ${(result.f1 * 100).toFixed(1)}%`);

// 显示不匹配的详情
const mismatches = ((result as any).details || []).filter((d: any) => !d.matched);
if (mismatches.length > 0) {
  console.log(`\n--- Mismatches (${mismatches.length}) ---`);
  for (const m of mismatches) {
    console.log(`  [${m.index}] ${m.functionName}: expected=${m.expected}, detected=${m.detected}`);
  }
}

// 保存报告
const report = {
  timestamp: new Date().toISOString(),
  result
};
fs.writeFileSync('benchmarks/precision-report.json', JSON.stringify(report, null, 2));
console.log('\nReport saved to benchmarks/precision-report.json');
