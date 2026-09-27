"use strict";
/**
 * Phase 2: Python Detection Benchmark Runner
 *
 * Runs protocol detection + safeguard detection on Python projects,
 * compares against labeled data, reports Precision/Recall/F1.
 *
 * Usage: npx ts-node src/python-benchmark.ts [projectPath]
 */
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
exports.runPythonBenchmark = runPythonBenchmark;
exports.loadLabels = loadLabels;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sequence_extractor_1 = require("./sequence-extractor");
const protocol_detector_1 = require("./protocol-detector");
const protocol_detector_2 = require("./protocol-detector");
const resource_detector_1 = require("./resource-detector");
function loadLabels(labelsPath) {
    if (!fs.existsSync(labelsPath))
        return [];
    return JSON.parse(fs.readFileSync(labelsPath, "utf-8"));
}
function runPythonBenchmark(projectPath, labelsPath) {
    const sequences = (0, sequence_extractor_1.extractSequences)(projectPath, { maxBodyLines: 200 });
    const labels = loadLabels(labelsPath);
    // Build label lookup
    const labelMap = new Map();
    for (const l of labels) {
        labelMap.set(`${l.filePath}:${l.functionName}`, l);
    }
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const seq of sequences) {
        const key = `${seq.filePath}:${seq.functionName}`;
        const label = labelMap.get(key);
        const hasLabelViolation = label?.hasViolation ?? false;
        // Run detection
        const protoViolations = (0, protocol_detector_1.detectProtocolViolations)(seq.calls);
        const safeViolations = (0, protocol_detector_2.detectSafeguardViolations)(seq.calls, seq.functionName, "python");
        const resResult = (0, resource_detector_1.validateResourceLifecycle)(seq.calls);
        const resViolations = resResult.violations || [];
        const totalViolations = protoViolations.length + safeViolations.length + resViolations.length;
        const detected = totalViolations > 0;
        if (detected && hasLabelViolation)
            tp++;
        else if (detected && !hasLabelViolation)
            fp++;
        else if (!detected && hasLabelViolation)
            fn++;
        else
            tn++;
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
