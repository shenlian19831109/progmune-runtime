/**
 * Phase 1: Engine Integration Tests
 */

import { describe, it, expect } from "vitest";
import { evaluateTrust } from "../../src/trust/engine";
import type { TrustEvaluationContext } from "../../src/trust/engine";

describe("evaluateTrust", () => {
  const baseCtx: TrustEvaluationContext = {
    projectPath: process.cwd(),
    projectName: "progmune-runtime",
    commit: "test-commit-sha",
    branch: "test-branch",
    language: "typescript",
  };

  it("returns a valid TrustDecision structure", () => {
    const result = evaluateTrust(baseCtx);

    // Overall
    expect(result.overall).toBeDefined();
    expect(typeof result.overall.score).toBe("number");
    expect(result.overall.score).toBeGreaterThanOrEqual(0);
    expect(result.overall.score).toBeLessThanOrEqual(100);
    expect(["APPROVED", "NEEDS_REVIEW", "BLOCKED"]).toContain(result.overall.decision);
    expect(["HIGH", "MEDIUM", "LOW", "UNCERTAIN"]).toContain(result.overall.confidence);

    // Dimensions
    expect(result.dimensions.policyCompliance).toBeDefined();
    expect(result.dimensions.protocolSafety).toBeDefined();
    expect(result.dimensions.verificationCoverage).toBeDefined();
    expect(result.dimensions.governanceIntegrity).toBeDefined();
    expect(result.dimensions.explainability).toBeDefined();
    expect(result.dimensions.evolutionStability).toBeDefined();
    expect(result.dimensions.evolutionStability.status).toBe("UNAVAILABLE");

    // Violations
    expect(Array.isArray(result.violations)).toBe(true);

    // Summary
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.total).toBe("number");

    // Audit trail
    expect(result.auditTrail).toBeDefined();
    expect(result.auditTrail.commit).toBe(baseCtx.commit);
    expect(result.auditTrail.reproducible).toBe(true);
    expect(result.auditTrail.checkId).toBeDefined();

    // Metadata
    expect(result.project).toBe(baseCtx.projectName);
    expect(result.commit).toBe(baseCtx.commit);
    expect(result.engineVersion).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  it("computes overall score within valid range", () => {
    const result = evaluateTrust(baseCtx);
    expect(result.overall.score).toBeGreaterThanOrEqual(0);
    expect(result.overall.score).toBeLessThanOrEqual(100);
  });

  it("evolution stability is always N/A in v1", () => {
    const result = evaluateTrust(baseCtx);
    expect(result.dimensions.evolutionStability.score).toBeNull();
    expect(result.dimensions.evolutionStability.status).toBe("UNAVAILABLE");
    expect(result.dimensions.evolutionStability.weight).toBe(0);
  });

  it("handles unknown project path gracefully", () => {
    const ctx: TrustEvaluationContext = {
      ...baseCtx,
      projectPath: "/nonexistent/path/12345",
      projectName: "unknown",
    };
    const result = evaluateTrust(ctx);
    // Should not throw — returns best-effort result
    expect(result.overall).toBeDefined();
  });
});
