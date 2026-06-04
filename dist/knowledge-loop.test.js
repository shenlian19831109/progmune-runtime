"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Knowledge loop integration test.
 *
 * Verifies the full feedback loop end-to-end:
 *   Failure → Record → Aggregate → Antibody → L1 Hint / L2 Fast Path / L3 Credit
 *
 * Tests run against real feedback.json and .progmune_corpus data on disk.
 */
const vitest_1 = require("vitest");
const failure_corpus_1 = require("./failure-corpus");
const feedback_1 = require("./feedback");
const logger_1 = require("./logger");
// ── L3: Credit scoring works with real data ──
(0, vitest_1.describe)("L3: Credit scoring", () => {
    (0, vitest_1.it)("getFailureAdjustedCredit returns Laplace-smoothed value for unknown function", () => {
        const credit = (0, feedback_1.getFailureAdjustedCredit)("__nonexistent_xyz__");
        (0, vitest_1.expect)(credit).toBe(0.5);
    });
    (0, vitest_1.it)("getFailureAdjustedCredit for known functions is between 0.3 and 1.0", () => {
        // Test a few functions that may or may not have history
        for (const fn of ["generateJWT", "validatePassword", "loadIR", "plan"]) {
            const credit = (0, feedback_1.getFailureAdjustedCredit)(fn);
            (0, vitest_1.expect)(credit).toBeGreaterThanOrEqual(0.3);
            (0, vitest_1.expect)(credit).toBeLessThanOrEqual(1.0);
        }
    });
    (0, vitest_1.it)("getFunctionSuccessRate returns 0.5 for cold start", () => {
        (0, vitest_1.expect)((0, feedback_1.getFunctionSuccessRate)("__never_called__")).toBe(0.5);
    });
});
// ── L1/L2: Antibody generation ──
(0, vitest_1.describe)("L1/L2: Antibody pipeline", () => {
    (0, vitest_1.it)("getLearnedPatterns returns a valid structure", () => {
        const result = (0, failure_corpus_1.getLearnedPatterns)();
        (0, vitest_1.expect)(result).toHaveProperty("failureToFix");
        (0, vitest_1.expect)(Array.isArray(result.failureToFix)).toBe(true);
    });
    (0, vitest_1.it)("getFailureGenome returns summary statistics", () => {
        const genome = (0, failure_corpus_1.getFailureGenome)();
        (0, vitest_1.expect)(genome).toHaveProperty("totalFailures");
        (0, vitest_1.expect)(genome).toHaveProperty("bySVL");
        (0, vitest_1.expect)(genome).toHaveProperty("averageRetriesToSuccess");
        (0, vitest_1.expect)(typeof genome.totalFailures).toBe("number");
    });
    (0, vitest_1.it)("getTopFailurePatterns returns sorted patterns", () => {
        const patterns = (0, failure_corpus_1.getTopFailurePatterns)(5);
        (0, vitest_1.expect)(Array.isArray(patterns)).toBe(true);
        // Verify sorted by count descending
        for (let i = 1; i < patterns.length; i++) {
            (0, vitest_1.expect)(patterns[i].count).toBeLessThanOrEqual(patterns[i - 1].count);
        }
    });
    (0, vitest_1.it)("queryAntibodies returns ACL-3+ matches", () => {
        const antibodies = (0, failure_corpus_1.queryAntibodies)("test intent", "ACL-3");
        (0, vitest_1.expect)(Array.isArray(antibodies)).toBe(true);
        // All returned antibodies should be ACL-3 or ACL-4
        for (const ab of antibodies) {
            (0, vitest_1.expect)(["ACL-3", "ACL-4"]).toContain(ab.antibodyLevel);
        }
    });
    (0, vitest_1.it)("queryAntibodies returns results sorted by relevance", () => {
        const antibodies = (0, failure_corpus_1.queryAntibodies)("authenticate user password", "ACL-3");
        for (let i = 1; i < antibodies.length; i++) {
            (0, vitest_1.expect)(antibodies[i]._score).toBeLessThanOrEqual(antibodies[i - 1]._score);
        }
    });
});
// ── Logger integration ──
(0, vitest_1.describe)("Structured logger", () => {
    (0, vitest_1.it)("createLogger produces distinguishable module names", () => {
        const plan = (0, logger_1.createLogger)("planner");
        const val = (0, logger_1.createLogger)("validator");
        (0, vitest_1.expect)(plan).not.toBe(val);
    });
});
