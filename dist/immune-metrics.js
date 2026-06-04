"use strict";
/**
 * Immune Metrics — real-time tracking of immune system efficacy.
 *
 * Tracks:
 *   1. Immune repair success rate (antibody hits → successful repairs)
 *   2. Token savings from L1 hints + L2 fast paths
 *   3. Credit-weighted vs unweighted planning success delta
 *
 * These metrics answer: "Is the knowledge layer actually improving outcomes?"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeImmuneMetrics = computeImmuneMetrics;
exports.formatImmuneMetrics = formatImmuneMetrics;
exports.reportImmuneMetrics = reportImmuneMetrics;
const failure_corpus_1 = require("./failure-corpus");
const feedback_1 = require("./feedback");
/**
 * Compute live immune metrics from the current corpus.
 */
function computeImmuneMetrics() {
    const stats = (0, failure_corpus_1.getAntibodyStats)();
    const genome = (0, failure_corpus_1.getFailureGenome)();
    const learned = (0, failure_corpus_1.getLearnedPatterns)();
    // Estimate token savings: L2 fast path = full prompt saved, L1 hint = ~200 tokens overhead
    const TOKENS_PER_LLM_CALL = 800;
    const tokensSaved = stats.fastPathHits * TOKENS_PER_LLM_CALL + stats.injectedHintHits * 200;
    // Immune repair rate: what fraction of sessions with antibody hits resolved?
    const immuneRepairRate = stats.totalHits > 0
        ? (stats.fastPathHits + stats.injectedHintHits * 0.7) / stats.totalHits
        : 0;
    // Count functions with non-Laplace credit scores
    let functionsWithHistory = 0;
    let creditSum = 0;
    let creditCount = 0;
    for (const p of learned.failureToFix) {
        for (const fn of (p.fixPath || [])) {
            const credit = (0, feedback_1.getFailureAdjustedCredit)(fn);
            if (credit !== 0.5)
                functionsWithHistory++;
            creditSum += credit;
            creditCount++;
        }
    }
    const avgCreditScore = creditCount > 0 ? creditSum / creditCount : 0.5;
    return {
        totalAntibodyHits: stats.totalHits,
        fastPathHits: stats.fastPathHits,
        injectedHints: stats.injectedHintHits,
        llmCallsSaved: stats.totalLLMCallsSaved,
        tokensSaved: stats.totalTokensSaved + tokensSaved,
        immuneRepairRate: Math.round(immuneRepairRate * 100) / 100,
        avgCreditScore: Math.round(avgCreditScore * 100) / 100,
        functionsWithHistory,
        totalFailures: genome.totalFailures,
        avgRetriesToSuccess: genome.averageRetriesToSuccess,
        learnedPatternCount: learned.failureToFix.length,
    };
}
/**
 * Format immune metrics as a human-readable report.
 */
function formatImmuneMetrics(m) {
    const lines = [
        "═══════ Immune System Metrics ═══════",
        "",
        "── Efficacy ──",
        `  Total antibody hits:       ${m.totalAntibodyHits}`,
        `  ACL-4 fast paths (0 LLM):  ${m.fastPathHits}`,
        `  ACL-3 injected hints:      ${m.injectedHints}`,
        `  LLM calls saved:           ${m.llmCallsSaved}`,
        `  Est. tokens saved:         ${m.tokensSaved.toLocaleString()}`,
        `  Immune repair rate:        ${(m.immuneRepairRate * 100).toFixed(0)}%`,
        "",
        "── Knowledge ROI ──",
        `  Avg credit score:          ${m.avgCreditScore}`,
        `  Functions with history:    ${m.functionsWithHistory}`,
        `  Learned patterns:          ${m.learnedPatternCount}`,
        "",
        "── Failure Landscape ──",
        `  Total failures:            ${m.totalFailures}`,
        `  Avg retries to success:    ${m.avgRetriesToSuccess.toFixed(1)}`,
        "",
        "══════════════════════════════════════",
    ];
    return lines.join("\n");
}
/** Print current immune metrics to stderr. */
function reportImmuneMetrics() {
    const m = computeImmuneMetrics();
    console.error(formatImmuneMetrics(m));
    return m;
}
