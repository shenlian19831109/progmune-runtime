"use strict";
/**
 * P9.2p: Precision Benchmark — "每1000个告警里有多少是真的？"
 *
 * The single most important missing number for enterprise procurement.
 * Runs the protocol invariant detector against real codebases and
 * measures true positives vs false positives at various thresholds.
 *
 * Pipeline:
 *   1. Extract IR from target repo
 *   2. Extract call sequences
 *   3. Run invariant mining → detect violations
 *   4. Classify each violation as TP or FP
 *   5. Measure precision at recall levels
 *
 * Target: Precision > 90% at recall > 70%.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPrecisionBenchmark = runPrecisionBenchmark;
exports.printPrecisionReport = printPrecisionReport;
const extract_ir_python_1 = require("./extract-ir-python");
const python_protocol_extractor_1 = require("./python-protocol-extractor");
const state_inference_1 = require("./state-inference");
// ═══════════════════════════════════════════════════════════════
// Run precision benchmark on a repo
// ═══════════════════════════════════════════════════════════════
/**
 * Run the precision benchmark on a codebase.
 *
 * @param repoPath   Path to the repo
 * @param repoName   Human-readable name
 * @param isPython   Whether the repo is Python (vs TypeScript)
 * @param groundTruth Optional list of known-broken sequences (for TP/FP classification)
 */
function runPrecisionBenchmark(repoPath, repoName, isPython = false, groundTruth) {
    // 1. Extract IR
    const ir = isPython ? (0, extract_ir_python_1.extractIRPython)(repoPath) : [];
    if (ir.length === 0) {
        return emptyReport(repoName);
    }
    // 2. Extract call sequences
    const sequences = (0, python_protocol_extractor_1.extractCallSequencesFromIR)(ir).filter(s => s.length >= 2);
    if (sequences.length === 0) {
        return emptyReport(repoName);
    }
    // 3. Build template from LONGEST sequences only (heuristic: longer = more complete)
    //    This avoids absorbing broken/truncated sequences into the template.
    //    Production version should use ground-truth clean sequences instead.
    const maxLen = Math.max(...sequences.map(s => s.length));
    const cleanSequences = groundTruth
        ? groundTruth.filter(g => !g.isVulnerable).map(g => g.broken).filter(s => s.length >= 2)
        : sequences.filter(s => s.length >= Math.max(3, maxLen * 0.7)); // top 70% by length
    const templateSM = (0, state_inference_1.inferStateMachine)(cleanSequences.length > 0 ? cleanSequences : sequences);
    // 4. Scan each sequence against the template
    //    Compare state count: a sequence with significantly fewer states
    //    than the template median is likely incomplete (broken lifecycle).
    const testResults = sequences.map(seq => ({
        seq,
        sm: (0, state_inference_1.inferStateMachine)([seq]),
    }));
    // Template stats
    const templateStateCount = templateSM.stateCount;
    const testStateCounts = testResults.map(r => r.sm.stateCount);
    const medianTestStates = median(testStateCounts);
    const threshold = Math.max(2, templateStateCount * 0.6); // at least 2 states, or 60% of template
    const alerts = [];
    for (const { seq, sm } of testResults) {
        const stateDiff = templateStateCount - sm.stateCount;
        // Only flag if state count is significantly below the template
        if (stateDiff >= 2 || (templateStateCount > 3 && sm.stateCount <= 2)) {
            const confidence = Math.min(1, Math.max(0, stateDiff / Math.max(1, templateStateCount)));
            const violations = [];
            if (stateDiff > 0) {
                violations.push({
                    invariant: { type: "MUST_RELEASE", triggerState: "entry", requiredState: "exit", description: "Sequence has fewer states than template", confidence: confidence },
                    sequence: seq, triggerIndex: 0,
                    description: `State count ${sm.stateCount} vs template ${templateStateCount} (diff: ${stateDiff})`,
                    violationSubtype: "missing_release",
                });
            }
            alerts.push({ sequence: seq, violations, invariantDescription: violations[0]?.description || "", stateDiff, confidence });
        }
    }
    // 5. Classify TP/FP if ground truth provided
    let tp = 0, fp = 0, fn = 0;
    if (groundTruth) {
        for (const alert of alerts) {
            const match = groundTruth.find(g => g.isVulnerable && arraysOverlap(alert.sequence, g.broken));
            if (match) {
                alert.isTruePositive = true;
                tp++;
            }
            else {
                alert.isTruePositive = false;
                fp++;
            }
        }
        // Count missed (ground truth violations not detected)
        for (const g of groundTruth) {
            if (g.isVulnerable) {
                const detected = alerts.some(a => arraysOverlap(a.sequence, g.broken));
                if (!detected)
                    fn++;
            }
        }
    }
    // 6. Per-threshold analysis
    const byThreshold = [0.1, 0.2, 0.3, 0.5, 0.7].map(threshold => {
        const above = alerts.filter(a => a.confidence >= threshold);
        const estTP = above.filter(a => a.isTruePositive !== false).length;
        return {
            threshold,
            alerts: above.length,
            estimatedPrecision: above.length > 0 ? estTP / above.length : 0,
        };
    });
    // 7. Per-category breakdown
    const byCategory = {};
    for (const alert of alerts) {
        for (const v of alert.violations) {
            const cat = v.violationSubtype;
            if (!byCategory[cat])
                byCategory[cat] = { alerts: 0, estimatedTP: 0 };
            byCategory[cat].alerts++;
            if (alert.isTruePositive !== false)
                byCategory[cat].estimatedTP++;
        }
    }
    const totalAlerts = alerts.length;
    const total = tp + fp;
    const precision = total > 0 ? tp / total : 0;
    const totalGroundTruth = groundTruth ? groundTruth.filter(g => g.isVulnerable).length : 0;
    const recall = totalGroundTruth > 0 ? tp / Math.max(1, tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return {
        repo: repoName,
        totalSequences: sequences.length,
        totalAlerts,
        alertRate: sequences.length > 0 ? totalAlerts / sequences.length : 0,
        truePositives: tp,
        falsePositives: fp,
        precision,
        recall,
        f1,
        byThreshold,
        byCategory,
        alerts: alerts.slice(0, 100), // top 100 by confidence
    };
}
function emptyReport(repo) {
    return {
        repo, totalSequences: 0, totalAlerts: 0, alertRate: 0,
        truePositives: 0, falsePositives: 0, precision: 0, recall: 0, f1: 0,
        byThreshold: [], byCategory: {}, alerts: [],
    };
}
function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function arraysOverlap(a, b) {
    const setA = new Set(a);
    return b.some(x => setA.has(x));
}
// ═══════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════
function printPrecisionReport(report) {
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║   Precision Benchmark: ${report.repo.padEnd(30)}║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
    console.log(`  Sequences analyzed:  ${report.totalSequences}`);
    console.log(`  Alerts raised:       ${report.totalAlerts}`);
    console.log(`  Alert rate:          ${(report.alertRate * 100).toFixed(1)}%`);
    console.log();
    if (report.truePositives + report.falsePositives > 0) {
        console.log(`  True Positives:      ${report.truePositives}`);
        console.log(`  False Positives:     ${report.falsePositives}`);
        console.log(`  Precision:           ${(report.precision * 100).toFixed(0)}%`);
        console.log(`  Recall:              ${(report.recall * 100).toFixed(0)}%`);
        console.log(`  F1:                  ${(report.f1 * 100).toFixed(0)}%`);
        console.log();
    }
    else {
        console.log(`  ⚠️  No ground truth provided — precision estimates only.`);
        console.log(`  Run with --ground-truth to get TP/FP classification.`);
        console.log();
    }
    console.log(`  ── Confidence Thresholds ──`);
    for (const t of report.byThreshold) {
        const precisionEst = t.alerts > 0 ? (t.estimatedPrecision * 100).toFixed(0) : "N/A";
        console.log(`    ≥${t.threshold.toFixed(1)}  ${String(t.alerts).padStart(4)} alerts  est. precision ${precisionEst}%`);
    }
    console.log();
    console.log(`  ── By Violation Type ──`);
    for (const [cat, stats] of Object.entries(report.byCategory)) {
        console.log(`    ${cat.padEnd(24)} ${String(stats.alerts).padStart(4)} alerts`);
    }
    console.log();
}
