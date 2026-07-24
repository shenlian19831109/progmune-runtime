/**
 * Phase 2: Python Detection Benchmark Runner
 *
 * Runs protocol detection + safeguard detection on Python projects,
 * compares against labeled data, reports Precision/Recall/F1.
 *
 * Usage: npx ts-node src/python-benchmark.ts [projectPath]
 */

import * as fs from "fs";
import * as path from "path";
import { extractSequences, CallSequence } from "./sequence-extractor";
import { detectProtocolViolations } from "./protocol-detector";
import { detectSafeguardViolations } from "./protocol-detector";
import { validateResourceLifecycle } from "./resource-detector";

interface LabeledFunction {
  functionName: string;
  filePath: string;
  hasViolation: boolean;
  violationTypes: string[];
}

function loadLabels(labelsPath: string): LabeledFunction[] {
  if (!fs.existsSync(labelsPath)) return [];
  return JSON.parse(fs.readFileSync(labelsPath, "utf-8"));
}

function runPythonBenchmark(projectPath: string, labelsPath: string): {
  precision: number; recall: number; f1: number;
  tp: number; fp: number; fn: number;
  totalFunctions: number; totalViolations: number;
} {
  const sequences = extractSequences(projectPath, { maxBodyLines: 200 });
  const labels = loadLabels(labelsPath);

  // Build label lookup
  const labelMap = new Map<string, LabeledFunction>();
  for (const l of labels) {
    labelMap.set(`${l.filePath}:${l.functionName}`, l);
  }

  let tp = 0, fp = 0, fn = 0, tn = 0;

  for (const seq of sequences) {
    const key = `${seq.filePath}:${seq.functionName}`;
    const label = labelMap.get(key);
    const hasLabelViolation = label?.hasViolation ?? false;

    // Run detection
    const protoViolations = detectProtocolViolations(seq.calls);
    const safeViolations = detectSafeguardViolations(seq.calls, seq.functionName, "python");
    const resResult = validateResourceLifecycle(seq.calls);
    const resViolations = resResult.violations || [];

    const totalViolations = protoViolations.length + safeViolations.length + resViolations.length;
    const detected = totalViolations > 0;

    if (detected && hasLabelViolation) tp++;
    else if (detected && !hasLabelViolation) fp++;
    else if (!detected && hasLabelViolation) fn++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  // Check for unlabeled functions → treat as true negatives
  const unlabeledCount = sequences.length - labels.length;

  return {
    precision: Math.round(precision * 1000) / 10,
    recall: Math.round(recall * 1000) / 10,
    f1: Math.round(f1 * 1000) / 10,
    tp, fp, fn,
    totalFunctions: sequences.length,
    totalViolations: tp + fp,
  };
}

// ── Main ──

if (require.main === module) {
  const projectPath = process.argv[2] || path.join(__dirname, "..", "test-python-protocol");
  const labelsPath = process.argv[3] || path.join(__dirname, "..", "benchmarks", "python-labels.json");

  console.log(`Python Benchmark Runner`);
  console.log(`Project: ${projectPath}`);
  console.log(`Labels:  ${labelsPath}`);
  console.log("");

  if (!fs.existsSync(projectPath)) {
    console.error(`Project path not found: ${projectPath}`);
    process.exit(1);
  }

  const result = runPythonBenchmark(projectPath, labelsPath);
  console.log(`Functions:       ${result.totalFunctions}`);
  console.log(`Detected:        ${result.totalViolations}`);
  console.log(`TP: ${result.tp}  FP: ${result.fp}  FN: ${result.fn}`);
  console.log(`Precision:       ${result.precision}%`);
  console.log(`Recall:          ${result.recall}%`);
  console.log(`F1:              ${result.f1}%`);

  process.exit(0);
}

export { runPythonBenchmark, loadLabels };
