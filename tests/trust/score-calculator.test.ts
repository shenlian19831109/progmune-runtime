/**
 * Phase 1: Score Calculator Tests
 */

import { describe, it, expect } from "vitest";
import {
  scorePolicyCompliance,
  scoreProtocolSafety,
  scoreVerificationCoverage,
  scoreGovernanceIntegrity,
  calculateOverallScore,
  determineDecision,
  determineConfidence,
  countViolationsBySeverity,
} from "../../src/trust/score-calculator";
import type { TrustViolation } from "../../src/trust/types";

function makeViolation(overrides: Partial<TrustViolation> = {}): TrustViolation {
  return {
    severity: "high",
    rule_id: "AUTH_001",
    file: "src/auth/login.ts",
    function: "doLogin",
    message: "Test violation",
    evidence: "test evidence",
    why: "test reason",
    fix: "test fix",
    policy_ref: "default",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════
//  Policy Compliance
// ═══════════════════════════════════════════════

describe("scorePolicyCompliance", () => {
  it("returns 100 with no violations", () => {
    const result = scorePolicyCompliance([]);
    expect(result.score).toBe(100);
    expect(result.hasCritical).toBe(false);
  });

  it("deducts correctly for mixed severities", () => {
    const violations = [
      makeViolation({ severity: "critical" }),  // -40
      makeViolation({ severity: "high" }),      // -20
      makeViolation({ severity: "medium" }),     // -8
      makeViolation({ severity: "low" }),        // -2
    ];
    const result = scorePolicyCompliance(violations);
    expect(result.score).toBe(30);  // 100 - 40 - 20 - 8 - 2
    expect(result.hasCritical).toBe(true);
  });

  it("locks score at 59 when critical violation exists", () => {
    // Even without other deductions, critical forces ≤59
    const violations = [makeViolation({ severity: "critical" })];
    const result = scorePolicyCompliance(violations);
    expect(result.score).toBe(59); // min(100-40=60, 59) = 59
    expect(result.hasCritical).toBe(true);
  });

  it("does not go below 0", () => {
    const violations = [
      makeViolation({ severity: "critical" }),
      makeViolation({ severity: "critical" }),
      makeViolation({ severity: "critical" }),
    ];
    const result = scorePolicyCompliance(violations);
    expect(result.score).toBe(0);
  });

  it("handles empty violations", () => {
    const result = scorePolicyCompliance([]);
    expect(result.score).toBe(100);
  });
});

// ═══════════════════════════════════════════════
//  Protocol Safety
// ═══════════════════════════════════════════════

describe("scoreProtocolSafety", () => {
  it("returns 100 with no violations", () => {
    const result = scoreProtocolSafety([]);
    expect(result.score).toBe(100);
  });

  it("scores per-protocol and computes weighted average", () => {
    const violations = [
      makeViolation({ rule_id: "AUTH_001", severity: "high" }),
      makeViolation({ rule_id: "PAY_001", severity: "critical" }),
    ];
    const result = scoreProtocolSafety(violations);
    // auth: 100 - 20 = 80, payment: min(100-40=60, 59) = 59
    // weighted: (80*0.25 + 59*0.20 + 100*0.20 + 100*0.20 + 100*0.15) / 1.0
    // = (20 + 11.8 + 20 + 20 + 15) / 1.0 = 86.8 → 87
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.score).toBeLessThanOrEqual(95);
    expect(result.details.authentication.violations).toBe(1);
    expect(result.details.payment.violations).toBe(1);
  });

  it("includes protocol details", () => {
    const result = scoreProtocolSafety([]);
    expect(result.details.authentication).toBeDefined();
    expect(result.details.authorization).toBeDefined();
    expect(result.details.payment).toBeDefined();
    expect(result.details.data_integrity).toBeDefined();
    expect(result.details.ledger).toBeDefined();
  });
});

// ═══════════════════════════════════════════════
//  Verification Coverage
// ═══════════════════════════════════════════════

describe("scoreVerificationCoverage", () => {
  it("returns full score with all data present", () => {
    const data = {
      typescriptTypeCheck: 25,
      ssgRules: 30,
      ledgerInvariant: 20,
      coverage: 15,
      failureGenome: 10,
    };
    const result = scoreVerificationCoverage(data);
    expect(result.score).toBe(100);
  });

  it("returns 0 when no data is provided", () => {
    const result = scoreVerificationCoverage({});
    expect(result.score).toBe(0);
  });

  it("caps sub-scores at their max values", () => {
    const data = { typescriptTypeCheck: 50 }; // max is 25
    const result = scoreVerificationCoverage(data);
    expect(result.details.typescriptTypeCheck.score).toBe(25);
  });

  it("returns partial score for mixed data", () => {
    const data = { typescriptTypeCheck: 25, ssgRules: 15 };
    const result = scoreVerificationCoverage(data);
    expect(result.score).toBe(40); // 25 + 15
  });
});

// ═══════════════════════════════════════════════
//  Governance Integrity
// ═══════════════════════════════════════════════

describe("scoreGovernanceIntegrity", () => {
  it("returns 100 with no defects", () => {
    const result = scoreGovernanceIntegrity([]);
    expect(result.score).toBe(100);
  });

  it("deducts for hash mismatch", () => {
    const result = scoreGovernanceIntegrity([{ type: "hashMismatch" }]);
    expect(result.score).toBe(50); // 100 - 50
  });

  it("deducts for multiple defects", () => {
    const result = scoreGovernanceIntegrity([
      { type: "hashMismatch" },
      { type: "ledgerMissing" },
    ]);
    expect(result.score).toBe(20); // 100 - 50 - 30
  });

  it("does not go below 0", () => {
    const result = scoreGovernanceIntegrity([
      { type: "hashMismatch" },
      { type: "hashMismatch" },
      { type: "hashMismatch" },
    ]);
    expect(result.score).toBe(0);
  });
});

// ═══════════════════════════════════════════════
//  Overall Score
// ═══════════════════════════════════════════════

describe("calculateOverallScore", () => {
  it("computes weighted average correctly", () => {
    const result = calculateOverallScore([
      { score: 95, weight: 0.35 },
      { score: 88, weight: 0.30 },
      { score: 92, weight: 0.20 },
      { score: 100, weight: 0.15 },
    ]);
    // (95*0.35 + 88*0.30 + 92*0.20 + 100*0.15) / 1.0
    // = 33.25 + 26.4 + 18.4 + 15 = 93.05 → 93
    expect(result).toBe(93);
  });

  it("returns 0 for all-zero dimensions", () => {
    const result = calculateOverallScore([
      { score: 0, weight: 0.35 },
      { score: 0, weight: 0.30 },
    ]);
    expect(result).toBe(0);
  });

  it("returns 0 when total weight is 0", () => {
    const result = calculateOverallScore([]);
    expect(result).toBe(0);
  });
});

// ═══════════════════════════════════════════════
//  Decision Mapping
// ═══════════════════════════════════════════════

describe("determineDecision", () => {
  it("returns APPROVED for high score with no critical", () => {
    expect(determineDecision(87, false, "EXPLAINABLE")).toBe("APPROVED");
  });

  it("returns NEEDS_REVIEW for medium score", () => {
    expect(determineDecision(72, false, "EXPLAINABLE")).toBe("NEEDS_REVIEW");
  });

  it("returns BLOCKED for low score", () => {
    expect(determineDecision(45, false, "EXPLAINABLE")).toBe("BLOCKED");
  });

  it("returns BLOCKED when critical violation exists regardless of score", () => {
    expect(determineDecision(95, true, "EXPLAINABLE")).toBe("BLOCKED");
  });

  it("degrades APPROVED to NEEDS_REVIEW when explainability is UNCERTAIN", () => {
    expect(determineDecision(87, false, "UNCERTAIN")).toBe("NEEDS_REVIEW");
  });

  it("degrades NEEDS_REVIEW to BLOCKED when explainability is UNCERTAIN", () => {
    expect(determineDecision(72, false, "UNCERTAIN")).toBe("BLOCKED");
  });

  it("BLOCKED stays BLOCKED even with UNCERTAIN explainability", () => {
    expect(determineDecision(45, false, "UNCERTAIN")).toBe("BLOCKED");
  });
});

// ═══════════════════════════════════════════════
//  Confidence
// ═══════════════════════════════════════════════

describe("determineConfidence", () => {
  it("returns UNCERTAIN when explainability gate fails", () => {
    expect(determineConfidence(["HIGH", "HIGH", "HIGH", "HIGH"], "UNCERTAIN")).toBe("UNCERTAIN");
  });

  it("returns HIGH when all dimensions are HIGH", () => {
    expect(determineConfidence(["HIGH", "HIGH", "HIGH", "HIGH"], "EXPLAINABLE")).toBe("HIGH");
  });

  it("returns MEDIUM when one dimension is MEDIUM", () => {
    expect(determineConfidence(["HIGH", "MEDIUM", "HIGH", "HIGH"], "EXPLAINABLE")).toBe("MEDIUM");
  });

  it("returns LOW when any dimension is LOW", () => {
    expect(determineConfidence(["HIGH", "LOW", "HIGH", "HIGH"], "EXPLAINABLE")).toBe("LOW");
  });
});

// ═══════════════════════════════════════════════
//  Violation Counting
// ═══════════════════════════════════════════════

describe("countViolationsBySeverity", () => {
  it("counts correctly", () => {
    const violations = [
      makeViolation({ severity: "critical" }),
      makeViolation({ severity: "high" }),
      makeViolation({ severity: "high" }),
      makeViolation({ severity: "medium" }),
      makeViolation({ severity: "low" }),
      makeViolation({ severity: "low" }),
      makeViolation({ severity: "low" }),
    ];
    const result = countViolationsBySeverity(violations);
    expect(result.critical).toBe(1);
    expect(result.high).toBe(2);
    expect(result.medium).toBe(1);
    expect(result.low).toBe(3);
    expect(result.total).toBe(7);
  });

  it("returns all zeros for empty array", () => {
    const result = countViolationsBySeverity([]);
    expect(result.total).toBe(0);
  });
});
