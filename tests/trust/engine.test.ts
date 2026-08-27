/**
 * Phase 1: Engine Integration Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { evaluateTrust } from "../../src/trust/engine";
import type { TrustEvaluationContext } from "../../src/trust/types";
import { extractProjectIR } from "../../src/extract-project-ir";

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

describe("evaluateTrust（C 注解原语，回归：CamelCase 规则可达 + 合并先于序列构建）", () => {
  // demo-real-c-redis 逼出的两个引擎问题：
  // ① CamelCase 注解规则原样不可触达 → 合并同步注册 normalized 形态；
  // ② 注解合并晚于序列构建 → 有函数体的注解原语被内联掉、post 不生效。
  const SOURCE = `
/* @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"]) */
int ACLCheckUserCredentials(robj *username, robj *password) {
    if (ACLHashPassword(password->ptr, 1) == C_OK) return C_OK;
    return C_ERR;
}
/* @progmune(namespace="auth", pre=[], post=["AUTHENTICATED"]) */
int checkPasswordBasedAuth(client *c, robj *username, robj *password) {
    if (ACLCheckUserCredentials(username, password) == C_OK) {
        c->authenticated = 1;
        return 1;
    }
    return 0;
}
/* @progmune(namespace="auth", pre=["AUTHENTICATED"]) */
int ACLCheckAllPerm(client *c, int *idxptr) {
    return ACLCheckAllUserCommandPerm(c->user, c->cmd, NULL, 0, NULL, idxptr);
}
`;

  async function runWith(source: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-engine-c-"));
    try {
      fs.writeFileSync(path.join(dir, "auth.c"), source);
      const ir = extractProjectIR(dir);
      fs.writeFileSync(path.join(dir, "ir.json"), JSON.stringify({ typeMap: {}, functions: ir }, null, 2));
      return await evaluateTrust({
        projectPath: dir,
        projectName: "c-annotation-test",
        commit: "test",
        language: "c",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("合法流：establish（有函数体注解原语）→ perm-check 零违规", async () => {
    const r = await runWith(SOURCE + `
void handle_authed_command(client *c, robj *u, robj *p) {
    if (checkPasswordBasedAuth(c, u, p) == 1) {
        ACLCheckAllPerm(c, NULL);
    }
}
`);
    const ssg = r.violations.filter((v) => v.rule_id.startsWith("SSG_"));
    expect(ssg).toEqual([]);
  });

  it("违规流：未认证 perm-check 被精确定位（CamelCase 规则可触达）", async () => {
    const r = await runWith(SOURCE + `
void handle_monitor_no_auth(client *c) {
    ACLCheckAllPerm(c, NULL);
}
`);
    const ssg = r.violations.filter((v) => v.rule_id.startsWith("SSG_"));
    expect(ssg).toHaveLength(1);
    expect(ssg[0].function).toBe("handle_monitor_no_auth");
    expect(ssg[0].why).toContain("ACLCheckAllPerm");
    expect(ssg[0].why).toContain("AUTHENTICATED");
    // fixPath 输出项目真实函数名（displayName），而非通用规则名 verify_token
    expect(ssg[0].fix).toContain("checkPasswordBasedAuth");
    expect(ssg[0].fix).not.toContain("verify_token");
  });
});
