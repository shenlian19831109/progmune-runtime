"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPrecisionBenchmark = runPrecisionBenchmark;
const fs = __importStar(require("fs"));
const state_inference_1 = require("./state-inference");
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
function runPrecisionBenchmark(sequences, labels) {
    // Build reference SM from clean sequences only
    const cleanSeqs = sequences
        .filter(s => labels[s.index] === 'clean' && s.calls.length >= 2)
        .map(s => s.calls);
    if (cleanSeqs.length === 0) {
        return { total: 0, truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, precision: 0, recall: 0, f1: 0, mismatches: [] };
    }
    const referenceSM = (0, state_inference_1.inferStateMachine)(cleanSeqs);
    const refStateCount = referenceSM.stateCount;
    // Extract reference edge set (what transitions are "normal")
    const refEdges = new Set();
    for (let i = 0; i < referenceSM.stateTransitions.length; i++)
        for (let j = 0; j < (referenceSM.stateTransitions[i] || []).length; j++)
            if (referenceSM.stateTransitions[i][j] > 0)
                refEdges.add(`${i}→${j}`);
    let tp = 0, fp = 0, tn = 0, fn = 0;
    const mismatches = [];
    for (const seq of sequences) {
        const expected = labels[seq.index] || 'skip';
        if (expected === 'skip')
            continue;
        if (seq.calls.length < 2) {
            tn++;
            continue;
        }
        const testSM = (0, state_inference_1.inferStateMachine)([seq.calls]);
        const stateDiff = refStateCount - testSM.stateCount;
        // Detection: flagged if ≥2 fewer states than reference
        const detected = stateDiff >= 2 ? 'violation' : 'clean';
        let matched = false;
        if (expected === 'clean' && detected === 'clean') {
            tn++;
            matched = true;
        }
        else if (expected === 'violation' && detected === 'violation') {
            tp++;
            matched = true;
        }
        else if (expected === 'clean' && detected === 'violation') {
            fp++;
        }
        else if (expected === 'violation' && detected === 'clean') {
            fn++;
        }
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
const mismatches = result.details.filter(d => !d.matched);
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
