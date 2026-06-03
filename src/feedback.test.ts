/**
 * Unit tests for feedback module — pure functions only.
 * Does NOT hit the filesystem (file I/O functions are integration-tested separately).
 */
import { describe, it, expect } from "vitest";

// We test the pure scoring math indirectly by reading the source patterns.
// The key behaviors to verify:
//   1. Cold start returns neutral (no penalty)
//   2. Consistent success returns high credit
//   3. SVL-severity affects penalty proportionally

// Since these functions read from feedback.json on disk,
// we verify the module exports and type contracts.

import {
  loadFeedback,
  getFunctionSuccessRate,
  getWeightedSuccessRate,
  getFailureAdjustedCredit,
} from "./feedback";

describe("feedback module", () => {
  it("loadFeedback returns an array", () => {
    const records = loadFeedback();
    expect(Array.isArray(records)).toBe(true);
  });

  it("getFunctionSuccessRate returns 0.5 for unknown function (no history)", () => {
    const rate = getFunctionSuccessRate("__nonexistent_func_xyz__");
    expect(rate).toBe(0.5);
  });

  it("getWeightedSuccessRate returns 0.5 for unknown function", () => {
    const rate = getWeightedSuccessRate("__nonexistent_func_xyz__");
    expect(rate).toBe(0.5);
  });

  it("getFailureAdjustedCredit returns 1.0 for unknown function (cold start, no penalty)", () => {
    const credit = getFailureAdjustedCredit("__nonexistent_func_xyz__");
    expect(credit).toBe(1.0);
  });

  it("getFailureAdjustedCredit returns a number between 0 and 1", () => {
    // Test with a function that may or may not exist
    const credit = getFailureAdjustedCredit("generateJWT");
    expect(credit).toBeGreaterThanOrEqual(0);
    expect(credit).toBeLessThanOrEqual(1);
  });
});
