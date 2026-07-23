/**
 * Phase 1: Decision Rules Integration Tests
 */

import { describe, it, expect } from "vitest";
import { determineDecision, determineConfidence } from "../../src/trust/score-calculator";

describe("Decision Rules — Full Matrix", () => {
  // Test all combinations
  const testCases = [
    // [score, hasCritical, explainStatus, expectedDecision]
    { score: 95, critical: false, explain: "EXPLAINABLE" as const, expected: "APPROVED" },
    { score: 85, critical: false, explain: "EXPLAINABLE" as const, expected: "APPROVED" },
    { score: 80, critical: false, explain: "EXPLAINABLE" as const, expected: "APPROVED" },
    { score: 79, critical: false, explain: "EXPLAINABLE" as const, expected: "NEEDS_REVIEW" },
    { score: 65, critical: false, explain: "EXPLAINABLE" as const, expected: "NEEDS_REVIEW" },
    { score: 60, critical: false, explain: "EXPLAINABLE" as const, expected: "NEEDS_REVIEW" },
    { score: 59, critical: false, explain: "EXPLAINABLE" as const, expected: "BLOCKED" },
    { score: 30, critical: false, explain: "EXPLAINABLE" as const, expected: "BLOCKED" },
    { score: 0, critical: false, explain: "EXPLAINABLE" as const, expected: "BLOCKED" },

    // Critical always BLOCKS
    { score: 100, critical: true, explain: "EXPLAINABLE" as const, expected: "BLOCKED" },
    { score: 80, critical: true, explain: "EXPLAINABLE" as const, expected: "BLOCKED" },
    { score: 50, critical: true, explain: "EXPLAINABLE" as const, expected: "BLOCKED" },

    // UNCERTAIN explainability degrades
    { score: 95, critical: false, explain: "UNCERTAIN" as const, expected: "NEEDS_REVIEW" },
    { score: 75, critical: false, explain: "UNCERTAIN" as const, expected: "BLOCKED" },
    { score: 50, critical: false, explain: "UNCERTAIN" as const, expected: "BLOCKED" },

    // Critical + UNCERTAIN = BLOCKED
    { score: 100, critical: true, explain: "UNCERTAIN" as const, expected: "BLOCKED" },
  ];

  for (const tc of testCases) {
    it(`score=${tc.score} critical=${tc.critical} explain=${tc.explain} → ${tc.expected}`, () => {
      expect(determineDecision(tc.score, tc.critical, tc.explain)).toBe(tc.expected);
    });
  }
});

describe("Confidence Rules — Full Matrix", () => {
  it("UNCERTAIN explainability always returns UNCERTAIN confidence", () => {
    expect(determineConfidence(["HIGH", "HIGH", "HIGH", "HIGH"], "UNCERTAIN")).toBe("UNCERTAIN");
    expect(determineConfidence(["LOW", "LOW", "LOW", "LOW"], "UNCERTAIN")).toBe("UNCERTAIN");
  });

  it("all HIGH → HIGH", () => {
    expect(determineConfidence(["HIGH", "HIGH", "HIGH", "HIGH"], "EXPLAINABLE")).toBe("HIGH");
  });

  it("any MEDIUM → MEDIUM", () => {
    expect(determineConfidence(["HIGH", "HIGH", "MEDIUM", "HIGH"], "EXPLAINABLE")).toBe("MEDIUM");
    expect(determineConfidence(["MEDIUM", "MEDIUM", "HIGH", "HIGH"], "EXPLAINABLE")).toBe("MEDIUM");
  });

  it("any LOW → LOW", () => {
    expect(determineConfidence(["HIGH", "LOW", "HIGH", "HIGH"], "EXPLAINABLE")).toBe("LOW");
    expect(determineConfidence(["LOW", "MEDIUM", "HIGH", "MEDIUM"], "EXPLAINABLE")).toBe("LOW");
  });
});
