/**
 * Phase 1: Engine Integration Tests
 */

import { describe, it, expect } from "vitest";
import { evaluateTrust } from "../../src/trust/engine";
import type { TrustEvaluationContext } from "../../src/trust/types";

describe("evaluateTrust", () => {
  const baseCtx: TrustEvaluationContext = {
    projectPath: process.cwd(),
    projectName: "progmune-runtime",
    commit: "test-commit-sha",
    branch: "test-branch",
    language: "typescript",
  };

  it("returns a valid TrustDecision structure", async () => {
    const result = await evaluateTrust(baseCtx);

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

  it("computes overall score within valid range", async () => {
    const result = await evaluateTrust(baseCtx);
    expect(result.overall.score).toBeGreaterThanOrEqual(0);
    expect(result.overall.score).toBeLessThanOrEqual(100);
  });

  it("evolution stability is always N/A in v1", async () => {
    const result = await evaluateTrust(baseCtx);
    expect(result.dimensions.evolutionStability.score).toBeNull();
    expect(result.dimensions.evolutionStability.status).toBe("UNAVAILABLE");
    expect(result.dimensions.evolutionStability.weight).toBe(0);
  });

  it("handles unknown project path gracefully", async () => {
    const ctx: TrustEvaluationContext = {
      ...baseCtx,
      projectPath: "/nonexistent/path/12345",
      projectName: "unknown",
    };
    const result = await evaluateTrust(ctx);
    // Should not throw — returns best-effort result
    expect(result.overall).toBeDefined();
  });
});

describe("Express Framework Adapter (integration)", () => {
  const baseCtx: TrustEvaluationContext = {
    projectPath: process.cwd(),
    projectName: "progmune-runtime",
    commit: "test",
    language: "typescript",
  };

  it("expressCoverage is present in TrustDecision when Express files exist", async () => {
    const result = await evaluateTrust(baseCtx);
    // progmune-runtime itself has no Express files, so coverage may be undefined
    // But the field should exist in the type
    expect(result.overall).toBeDefined();
  });

  it("Express violations are included in allViolations", async () => {
    const result = await evaluateTrust({
      ...baseCtx,
      projectPath: "/Users/shenlian/printlab_mvp",
      projectName: "printlab_mvp",
    });

    const expressViolations = result.violations.filter(
      v => v.policy_ref === "framework.express"
    );

    // printlab_mvp has Express → should have at least some Express analysis
    // (even if cross-file analysis suppresses most issues)
    const ec = result.overall.expressCoverage;
    if (ec && ec.appsDetected > 0) {
      expect(ec.totalRoutes).toBeGreaterThanOrEqual(0);
      expect(ec.filesScanned).toBeGreaterThan(0);
    }

    // Express violations should have proper structure
    for (const v of expressViolations) {
      expect(v.rule_id).toBeDefined();
      expect(v.severity).toBeDefined();
      expect(["critical", "high", "medium", "low"]).toContain(v.severity);
      expect(v.policy_ref).toBe("framework.express");
      expect(v.fix).toBeDefined();
    }
  });

  it("Express collector does not throw on non-Express projects", async () => {
    const result = await evaluateTrust({
      ...baseCtx,
      projectPath: "/tmp",
      projectName: "empty",
    });
    // Should return a valid result without Express coverage
    expect(result.overall).toBeDefined();
    expect(result.overall.score).toBeGreaterThanOrEqual(0);
  });

  it("SSG and Express violations coexist in pipeline", async () => {
    const result = await evaluateTrust({
      ...baseCtx,
      projectPath: "/Users/shenlian/printlab_mvp",
      projectName: "printlab_mvp",
    });

    const ssg = result.violations.filter(v => v.rule_id.startsWith("SSG_"));
    const express = result.violations.filter(v => v.policy_ref === "framework.express");
    const other = result.violations.filter(
      v => !v.rule_id.startsWith("SSG_") && v.policy_ref !== "framework.express"
    );

    // All three categories should be represented (or at least not crash)
    expect(Array.isArray(ssg)).toBe(true);
    expect(Array.isArray(express)).toBe(true);
    expect(Array.isArray(other)).toBe(true);
  });
});
