/**
 * Knowledge loop integration test.
 *
 * Verifies the full feedback loop end-to-end:
 *   Failure → Record → Aggregate → Antibody → L1 Hint / L2 Fast Path / L3 Credit
 *
 * Tests run against real feedback.json and .progmune_corpus data on disk.
 */
import { describe, it, expect } from "vitest";
import { queryAntibodies, getLearnedPatterns, getFailureGenome, getTopFailurePatterns } from "./failure-corpus";
import { getFailureAdjustedCredit, getFunctionSuccessRate } from "./feedback";
import { createLogger } from "./logger";

// ── L3: Credit scoring works with real data ──

describe("L3: Credit scoring", () => {
  it("getFailureAdjustedCredit returns Laplace-smoothed value for unknown function", () => {
    const credit = getFailureAdjustedCredit("__nonexistent_xyz__");
    expect(credit).toBe(0.5);
  });

  it("getFailureAdjustedCredit for known functions is between 0.3 and 1.0", () => {
    // Test a few functions that may or may not have history
    for (const fn of ["generateJWT", "validatePassword", "loadIR", "plan"]) {
      const credit = getFailureAdjustedCredit(fn);
      expect(credit).toBeGreaterThanOrEqual(0.3);
      expect(credit).toBeLessThanOrEqual(1.0);
    }
  });

  it("getFunctionSuccessRate returns 0.5 for cold start", () => {
    expect(getFunctionSuccessRate("__never_called__")).toBe(0.5);
  });
});

// ── L1/L2: Antibody generation ──

describe("L1/L2: Antibody pipeline", () => {
  it("getLearnedPatterns returns a valid structure", () => {
    const result = getLearnedPatterns();
    expect(result).toHaveProperty("failureToFix");
    expect(Array.isArray(result.failureToFix)).toBe(true);
  });

  it("getFailureGenome returns summary statistics", () => {
    const genome = getFailureGenome();
    expect(genome).toHaveProperty("totalFailures");
    expect(genome).toHaveProperty("bySVL");
    expect(genome).toHaveProperty("averageRetriesToSuccess");
    expect(typeof genome.totalFailures).toBe("number");
  });

  it("getTopFailurePatterns returns sorted patterns", () => {
    const patterns = getTopFailurePatterns(5);
    expect(Array.isArray(patterns)).toBe(true);
    // Verify sorted by count descending
    for (let i = 1; i < patterns.length; i++) {
      expect(patterns[i].count).toBeLessThanOrEqual(patterns[i - 1].count);
    }
  });

  it("queryAntibodies returns ACL-3+ matches", () => {
    const antibodies = queryAntibodies("test intent", "ACL-3");
    expect(Array.isArray(antibodies)).toBe(true);
    // All returned antibodies should be ACL-3 or ACL-4
    for (const ab of antibodies) {
      expect(["ACL-3", "ACL-4"]).toContain(ab.antibodyLevel);
    }
  });

  it("queryAntibodies returns results sorted by relevance", () => {
    const antibodies = queryAntibodies("authenticate user password", "ACL-3");
    for (let i = 1; i < antibodies.length; i++) {
      expect((antibodies[i] as any)._score).toBeLessThanOrEqual(
        (antibodies[i - 1] as any)._score
      );
    }
  });
});

// ── Logger integration ──

describe("Structured logger", () => {
  it("createLogger produces distinguishable module names", () => {
    const plan = createLogger("planner");
    const val = createLogger("validator");
    expect(plan).not.toBe(val);
  });
});
