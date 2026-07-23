/**
 * Phase 1: Explainability Gate Tests
 */

import { describe, it, expect } from "vitest";
import { checkExplainability, isViolationComplete } from "../../src/trust/explainability";
import type { TrustViolation } from "../../src/trust/types";

function makeViolation(overrides: Partial<TrustViolation> = {}): TrustViolation {
  return {
    severity: "high",
    rule_id: "AUTH_001",
    file: "src/auth/login.ts",
    function: "doLogin",
    message: "Missing rate limit check",
    evidence: "line 42: authenticate() without rate limiter",
    why: "Vulnerable to brute force attacks",
    fix: "Add express-rate-limit middleware",
    policy_ref: "enterprise-default.auth.rate-limit",
    ...overrides,
  };
}

describe("Explainability Gate", () => {
  it("returns EXPLAINABLE when all 7 fields are present", () => {
    const v = makeViolation();
    const result = checkExplainability([v]);
    expect(result.status).toBe("EXPLAINABLE");
    expect(result.violationsChecked).toBe(1);
    expect(result.violationsComplete).toBe(1);
  });

  it("returns EXPLAINABLE for empty violations array (vacuous truth)", () => {
    const result = checkExplainability([]);
    expect(result.status).toBe("EXPLAINABLE");
    expect(result.violationsChecked).toBe(0);
  });

  it("returns UNCERTAIN when rule_id is missing", () => {
    const v = makeViolation({ rule_id: "" }) as TrustViolation;
    const result = checkExplainability([v]);
    expect(result.status).toBe("UNCERTAIN");
    expect(result.missingFields).toBeDefined();
    expect(result.missingFields![0].missing).toContain("rule_id");
  });

  it("returns UNCERTAIN when file is empty", () => {
    const v = makeViolation({ file: "" }) as TrustViolation;
    const result = checkExplainability([v]);
    expect(result.status).toBe("UNCERTAIN");
  });

  it("returns UNCERTAIN when function is missing", () => {
    const v = { severity: "low", rule_id: "TEST" } as unknown as TrustViolation;
    const result = checkExplainability([v]);
    expect(result.status).toBe("UNCERTAIN");
  });

  it("returns UNCERTAIN when multiple fields are missing", () => {
    const v = { severity: "high" } as unknown as TrustViolation;
    const result = checkExplainability([v]);
    expect(result.status).toBe("UNCERTAIN");
    expect(result.missingFields![0].missing.length).toBeGreaterThanOrEqual(3);
  });

  it("correctly reports mixed complete/incomplete violations", () => {
    const complete = makeViolation();
    const incomplete = makeViolation({ rule_id: "" }) as TrustViolation;
    const result = checkExplainability([complete, incomplete]);
    expect(result.status).toBe("UNCERTAIN");
    expect(result.violationsChecked).toBe(2);
    expect(result.violationsComplete).toBe(1);
  });

  it("all violations must be complete for EXPLAINABLE", () => {
    const v1 = makeViolation();
    const v2 = makeViolation();
    const result = checkExplainability([v1, v2]);
    expect(result.status).toBe("EXPLAINABLE");
  });
});

describe("isViolationComplete", () => {
  it("returns true for a complete violation", () => {
    expect(isViolationComplete(makeViolation())).toBe(true);
  });

  it("returns false for an incomplete violation", () => {
    const v = makeViolation({ evidence: "" }) as TrustViolation;
    expect(isViolationComplete(v)).toBe(false);
  });
});
