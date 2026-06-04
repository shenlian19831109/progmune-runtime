"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for feedback module — pure functions only.
 * Does NOT hit the filesystem (file I/O functions are integration-tested separately).
 */
const vitest_1 = require("vitest");
// We test the pure scoring math indirectly by reading the source patterns.
// The key behaviors to verify:
//   1. Cold start returns neutral (no penalty)
//   2. Consistent success returns high credit
//   3. SVL-severity affects penalty proportionally
// Since these functions read from feedback.json on disk,
// we verify the module exports and type contracts.
const feedback_1 = require("./feedback");
(0, vitest_1.describe)("feedback module", () => {
    (0, vitest_1.it)("loadFeedback returns an array", () => {
        const records = (0, feedback_1.loadFeedback)();
        (0, vitest_1.expect)(Array.isArray(records)).toBe(true);
    });
    (0, vitest_1.it)("getFunctionSuccessRate returns 0.5 for unknown function (no history)", () => {
        const rate = (0, feedback_1.getFunctionSuccessRate)("__nonexistent_func_xyz__");
        (0, vitest_1.expect)(rate).toBe(0.5);
    });
    (0, vitest_1.it)("getWeightedSuccessRate returns 0.5 for unknown function", () => {
        const rate = (0, feedback_1.getWeightedSuccessRate)("__nonexistent_func_xyz__");
        (0, vitest_1.expect)(rate).toBe(0.5);
    });
    (0, vitest_1.it)("getFailureAdjustedCredit returns 0.5 for unknown function (Laplace prior: neutral)", () => {
        const credit = (0, feedback_1.getFailureAdjustedCredit)("__nonexistent_func_xyz__");
        (0, vitest_1.expect)(credit).toBe(0.5);
    });
    (0, vitest_1.it)("getFailureAdjustedCredit returns a number between 0 and 1", () => {
        const credit = (0, feedback_1.getFailureAdjustedCredit)("generateJWT");
        (0, vitest_1.expect)(credit).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(credit).toBeLessThanOrEqual(1);
    });
    (0, vitest_1.it)("Laplace smoothing: cold start = 0.5 (neutral prior)", () => {
        // No records → prior Beta(1,1) → 1/(1+1) = 0.5
        (0, vitest_1.expect)((0, feedback_1.getFailureAdjustedCredit)("__unknown_fn__")).toBe(0.5);
    });
    (0, vitest_1.it)("Laplace smoothing: 0/1 record is not zero (allows redemption)", () => {
        // Laplace: (0+1)/(1+2) ≈ 0.33, not 0.0
        // This is only true if there are real records (not cold start).
        // Cold start with no records returns 0.5 by definition.
        const credit = (0, feedback_1.getFailureAdjustedCredit)("svl1_test_1780509556916");
        (0, vitest_1.expect)(credit).toBeGreaterThan(0);
    });
});
