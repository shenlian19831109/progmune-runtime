/**
 * P6: Trust Calibration Tests
 */

import { describe, it, expect } from "vitest";
import { TrustCalibrator, formatConfidenceTree } from "../src/trust-calibration";

describe("Trust Calibration", () => {

  const calibrator = new TrustCalibrator();

  it("high-confidence rule > 60%", () => {
    const tree = calibrator.explainConfidence({
      ruleName: "tls_handshake",
      protocol: "TLS",
      rfcRefs: ["8446"],
      validatedRepos: ["curl", "nginx", "openssl"],
      fpCount: 1,
      tpCount: 19,
      rulePreStates: ["A", "B"],
      rulePostStates: ["C", "D"],
      repairVerified: true,
      deploymentObservations: 50,
      humanReviewed: true,
    });

    expect(tree.totalConfidence).toBeGreaterThan(0.6);
  });

  it("low-confidence rule < 25%", () => {
    const tree = calibrator.explainConfidence({
      ruleName: "unknown",
      protocol: "Test",
      rfcRefs: [],
      validatedRepos: [],
      fpCount: 10,
      tpCount: 0,
      rulePreStates: [],
      rulePostStates: ["X"],
      repairVerified: false,
      deploymentObservations: 0,
      humanReviewed: false,
    });

    expect(tree.totalConfidence).toBeLessThan(0.25);
  });

  it("all 7 evidence components present", () => {
    const tree = calibrator.explainConfidence({
      ruleName: "test_rule",
      protocol: "Test",
      rfcRefs: ["1234"],
      validatedRepos: ["a", "b"],
      fpCount: 2,
      tpCount: 8,
      rulePreStates: ["INIT"],
      rulePostStates: ["DONE"],
      repairVerified: true,
      deploymentObservations: 20,
      humanReviewed: true,
    });

    expect(tree.components.length).toBe(7);

    const sources = tree.components.map(c => c.source);
    expect(sources).toContain("RFC_ALIGNMENT");
    expect(sources).toContain("REPO_VALIDATION");
    expect(sources).toContain("FP_HISTORY");
    expect(sources).toContain("RULE_SPECIFICITY");
    expect(sources).toContain("REPAIR_VERIFIED");
    expect(sources).toContain("DEPLOYMENT_OBS");
    expect(sources).toContain("HUMAN_REVIEWED");
  });

  it("explanation contains RFC reference", () => {
    const tree = calibrator.explainConfidence({
      ruleName: "rfc_rule",
      protocol: "TLS",
      rfcRefs: ["8446"],
      validatedRepos: ["curl"],
      fpCount: 0,
      tpCount: 5,
      rulePreStates: ["A"],
      rulePostStates: ["B"],
    });

    const hasRfc = tree.explanation.some(e => e.includes("8446"));
    expect(hasRfc).toBe(true);
  });

  it("improvement suggestions for weak rule", () => {
    const tree = calibrator.explainConfidence({
      ruleName: "weak",
      protocol: "Test",
      rfcRefs: [],
      validatedRepos: [],
      fpCount: 5,
      tpCount: 1,
      rulePreStates: [],
      rulePostStates: [],
      repairVerified: false,
      deploymentObservations: 0,
      humanReviewed: false,
    });

    expect(tree.improvementSuggestions.length).toBeGreaterThan(3);
  });

  it("no improvement suggestions for perfect rule", () => {
    const tree = calibrator.explainConfidence({
      ruleName: "perfect",
      protocol: "Test",
      rfcRefs: ["9999"],
      validatedRepos: ["a", "b", "c", "d", "e"],
      fpCount: 0,
      tpCount: 100,
      rulePreStates: ["A", "B", "C"],
      rulePostStates: ["D", "E"],
      repairVerified: true,
      deploymentObservations: 200,
      humanReviewed: true,
    });

    expect(tree.improvementSuggestions.length).toBe(0);
    expect(tree.totalConfidence).toBeGreaterThan(0.85); // Theoretical max is 0.875 with weights
  });

  it("formatConfidenceTree produces readable output", () => {
    const tree = calibrator.explainConfidence({
      ruleName: "fmt_test",
      protocol: "Test",
      rfcRefs: ["8080"],
      validatedRepos: ["repo1"],
      fpCount: 1,
      tpCount: 4,
      rulePreStates: ["S1"],
      rulePostStates: ["S2"],
    });

    const formatted = formatConfidenceTree(tree);
    expect(formatted).toContain("Trust Calibration");
    expect(formatted).toContain("fmt_test");
    expect(formatted).toContain("8080");
  });

  it("neutral confidence when no data available", () => {
    const tree = calibrator.explainConfidence({
      ruleName: "new_rule",
      protocol: "New",
      rfcRefs: [],
      validatedRepos: [],
      fpCount: 0,
      tpCount: 0,
      rulePreStates: [],
      rulePostStates: [],
    });

    // No data = moderate confidence, not zero
    expect(tree.totalConfidence).toBeGreaterThan(0);
    expect(tree.totalConfidence).toBeLessThan(0.5);
  });
});
