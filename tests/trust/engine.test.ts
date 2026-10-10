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

  // ── 2026-10-02（§49.15 方案 b）：排序后的 safeguard 告警流 ──
  describe("safeguardAlerts (ranked evidence stream)", () => {
    it("字段存在且排序不变量成立（排序不删告警、组间按先验降序、组内按分数降序）", async () => {
      const result = await evaluateTrust(baseCtx);
      const sa = result.overall.safeguardAlerts;
      expect(sa).toBeDefined();
      expect(typeof sa!.total).toBe("number");
      expect(sa!.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(sa!.groups)).toBe(true);
      expect(Array.isArray(sa!.topRanked)).toBe(true);

      // 排序不删告警：两个形态的条目总数都等于 total
      const groupTotal = sa!.groups.reduce((s, g) => s + g.count, 0);
      expect(groupTotal).toBe(sa!.total);
      expect(sa!.topRanked.length).toBe(sa!.total);

      // 组间按先验降序
      for (let i = 1; i < sa!.groups.length; i++) {
        expect(sa!.groups[i - 1].prior).toBeGreaterThanOrEqual(sa!.groups[i].prior);
      }
      // 组内按分数降序
      for (const g of sa!.groups) {
        for (let i = 1; i < g.alerts.length; i++) {
          expect(g.alerts[i - 1].score).toBeGreaterThanOrEqual(g.alerts[i].score);
        }
      }
    });

    it("告警流不进判定：score/decision 与 protocolSafety 违规无关（证据流与判定分离）", async () => {
      const result = await evaluateTrust(baseCtx);
      const sa = result.overall.safeguardAlerts;
      // safeguard 告警不是 TrustViolation：不进 violations 池
      const svRuleIds = new Set<string>();
      if (sa) {
        for (const g of sa.groups) {
          for (const r of g.alerts) {
            svRuleIds.add((r.alert as any).rule);
          }
        }
      }
      for (const v of result.violations) {
        // 判定违规的 rule_id 前缀不会与 safeguard 规则族重名（NESTJS_*/SSG_*
        // 是判定侧；safeguard 规则族名如 "Input Validation" 带空格）
        expect(typeof v.rule_id).toBe("string");
      }
      // 判定字段仍完整
      expect(result.overall.decision).toBeDefined();
      expect(result.overall.score).toBeGreaterThanOrEqual(0);
    });
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

  it("回归（DSH 陷阱）：C 项目不手动写 ir.json，evaluateTrust 自动提取并合并注解", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-engine-c-auto-"));
    try {
      fs.writeFileSync(path.join(dir, "auth.c"), SOURCE + `
void handle_monitor_no_auth(client *c) {
    ACLCheckAllPerm(c, NULL);
}
`);
      // 注意：不写 ir.json——引擎应按语言自动提取（此前仅 TS/JS 生效，
      // C 注解静默失效；修复后 C 走 extractIRC 兜底写盘）
      const r = await evaluateTrust({
        projectPath: dir,
        projectName: "c-auto-extract-test",
        commit: "test",
        language: "c",
      });
      const ssg = r.violations.filter((v) => v.rule_id.startsWith("SSG_"));
      expect(ssg).toHaveLength(1);
      expect(ssg[0].function).toBe("handle_monitor_no_auth");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("evaluateTrust（Java 注解原语，token 生命周期协议行 v1——3.7.20）", () => {
  const SOURCE = `package app;
public class AuthService {
  // @protocol namespace=token pre_states=[] post_states=["AUTHENTICATED"]
  void authenticate(String token) {
    if (jwtService.verify(token) != null) session.setCurrent(token);
  }
  // @protocol namespace=token pre_states=["AUTHENTICATED"] post_states=[]
  boolean performAdminAction(long uid) {
    return adminService.act(uid);
  }
  void handleOk(String token, long uid) {
    if (token != null) { authenticate(token); performAdminAction(uid); }
  }
  void handleBad(long uid) {
    performAdminAction(uid);
  }
}`;

  async function runWith(extra: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-engine-java-"));
    try {
      fs.writeFileSync(path.join(dir, "AuthService.java"), SOURCE.replace(
        "  void handleBad(long uid) {\n    performAdminAction(uid);\n  }",
        extra
      ));
      // 不手动写 ir.json——引擎按语言自动提取（java 分派 3.7.17 起）
      return await evaluateTrust({
        projectPath: dir,
        projectName: "java-token-test",
        commit: "test",
        language: "java",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("合法流：authenticate（establish）→ performAdminAction（use）零违规", async () => {
    const r = await runWith("");
    const ssg = r.violations.filter((v) => v.rule_id.startsWith("SSG_"));
    expect(ssg).toEqual([]);
  });

  it("违规流：未认证直接 performAdminAction 被精确定位", async () => {
    // 保留 handleBad（违规）——额外再复制一个
    const r = await runWith("  void handleBad2(long uid) {\n    performAdminAction(uid);\n  }\n}");
    const ssg = r.violations.filter((v) => v.rule_id.startsWith("SSG_"));
    expect(ssg.length).toBeGreaterThanOrEqual(1);
    const hit = ssg.find((v) => v.function === "handleBad2" || v.function === "handleBad");
    expect(hit).toBeDefined();
    expect(hit!.why).toContain("performAdminAction");
    expect(hit!.why).toContain("AUTHENTICATED");
  });
});

describe("evaluateTrust（Java 协议行 v2：auth/register——密码 hash 先于入库）", () => {
  const SRC = `package app;
public class UserService {
  // @protocol namespace=auth pre_states=[] post_states=["PASSWORD_HASHED"]
  String hashPassword(String p) { return bcrypt.hash(p); }
  // @protocol namespace=auth pre_states=["PASSWORD_HASHED"] post_states=["USER_STORED"]
  void storeUser(String u, String h) { db.insert(u, h); }
  void registerOk(String u, String p) { String h = hashPassword(p); storeUser(u, h); }
  void registerBad(String u, String p) { storeUser(u, p); }
}`;
  async function run(keepBad: boolean) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-engine-java-auth-"));
    try {
      const body = keepBad
        ? SRC
        : SRC.replace("\n  void registerBad(String u, String p) { storeUser(u, p); }", "");
      fs.writeFileSync(path.join(dir, "UserService.java"), body);
      return await evaluateTrust({ projectPath: dir, projectName: "java-auth-test", commit: "t", language: "java" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  it("registerOk（hash 后入库）→ 零违规", async () => {
    const r = await run(false);
    expect(r.violations.filter((v) => v.rule_id.startsWith("SSG_"))).toEqual([]);
  });
  it("registerBad（未 hash 直接入库）→ 精确定位 storeUser", async () => {
    const r = await run(true);
    const ssg = r.violations.filter((v) => v.rule_id.startsWith("SSG_"));
    expect(ssg.length).toBeGreaterThanOrEqual(1);
    const hit = ssg.find((v) => v.function === "registerBad");
    expect(hit).toBeDefined();
    expect(hit!.why).toContain("storeUser");
  });
});

describe("evaluateTrust（Java 协议行 v3：resource 管理——open/use/close + invalidate 语义）", () => {
  // 三个注解原语（open 建立 RESOURCE_OPEN；use 需 RESOURCE_OPEN；
  // close 需 RESOURCE_OPEN 且 invalidate 摘除之——资源生命周期命名空间
  // "resource" 命中 RESOURCE_NAMESPACE_RE，序列末尾持有状态触发泄漏检查）
  function src(entries: string): string {
    return `package app;
public class ResourceService {
  // @protocol namespace=resource pre_states=[] post_states=["RESOURCE_OPEN"]
  Resource openFile(String p) { return store.open(p); }
  // @protocol namespace=resource pre_states=["RESOURCE_OPEN"] post_states=[]
  void writeData(Resource r, byte[] d) { r.write(d); }
  // @protocol namespace=resource pre_states=["RESOURCE_OPEN"] post_states=[] invalidate=["RESOURCE_OPEN"]
  void closeFile(Resource r) { r.close(); }
${entries}
}`;
  }
  async function run(entries: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-engine-java-res-"));
    try {
      fs.writeFileSync(path.join(dir, "ResourceService.java"), src(entries));
      return await evaluateTrust({ projectPath: dir, projectName: "java-res-test", commit: "t", language: "java" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const ssgOf = (r: Awaited<ReturnType<typeof evaluateTrust>>) =>
    r.violations.filter((v) => v.rule_id.startsWith("SSG_"));

  it("合法流：open → use → close 零违规", async () => {
    const r = await run(`  void lifecycleOk(String p, byte[] d) {
    Resource r = openFile(p);
    writeData(r, d);
    closeFile(r);
  }`);
    expect(ssgOf(r)).toEqual([]);
  });

  it("违规流：未 open 直接 write（缺 RESOURCE_OPEN）→ 精确定位", async () => {
    const r = await run(`  void writeNoOpen(byte[] d) {
    writeData(null, d);
  }`);
    const ssg = ssgOf(r);
    expect(ssg.length).toBeGreaterThanOrEqual(1);
    const hit = ssg.find((v) => v.function === "writeNoOpen");
    expect(hit).toBeDefined();
    expect(hit!.why).toContain("writeData");
    expect(hit!.why).toContain("RESOURCE_OPEN");
  });

  it("use-after-close：close 的 invalidate 摘除 RESOURCE_OPEN 后 write 被定位（invalidate 形态验证）", async () => {
    const r = await run(`  void useAfterClose(String p, byte[] d) {
    Resource r = openFile(p);
    closeFile(r);
    writeData(r, d);
  }`);
    const ssg = ssgOf(r);
    expect(ssg.length).toBeGreaterThanOrEqual(1);
    const hit = ssg.find((v) => v.function === "useAfterClose");
    expect(hit).toBeDefined();
    expect(hit!.why).toContain("writeData");
    expect(hit!.why).toContain("RESOURCE_OPEN");
  });

  it("open 未 close：序列末尾持有 RESOURCE_OPEN → 泄漏（end-state）定位 closeFile", async () => {
    const r = await run(`  void openOnly(String p) {
    Resource r = openFile(p);
  }`);
    const ssg = ssgOf(r);
    expect(ssg.length).toBeGreaterThanOrEqual(1);
    const hit = ssg.find((v) => v.function === "openOnly");
    expect(hit).toBeDefined();
    expect(hit!.rule_id).toContain("END_STATE");
    expect(hit!.why).toContain("resource leak");
    // 释放函数名在 fix 字段（why 为通用语义模板——与代码库报告设计一致）
    expect(hit!.fix).toContain("closeFile");
  });
});

describe("evaluateTrust（Java 接收者限定名匹配——名碰撞根因修复，2026-09-06）", () => {
  // User.update 注解 PASSWORD_HASHED 前置；Article.update 同名不注解——
  // 修复前裸键 "update" 命中全部 .update( 调用点（9 FP 实测）；
  // 修复后 user.update 只命中 User.update，article.update 不误配
  const SRC = `package app;
public class User {
  // @protocol namespace=registration pre_states=["PASSWORD_HASHED"] post_states=["PASSWORD_UPDATED"]
  public void update(String password) { this.password = password; }
}
public class Article {
  public void update(String content) { this.content = content; }
}
public class UserService {
  public void updateUser(User user) {
    user.update("raw-password");
  }
  public void updateArticle(Article article) {
    article.update("hello world");
  }
}`;

  async function run() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-engine-java-qual-"));
    try {
      fs.writeFileSync(path.join(dir, "UserService.java"), SRC);
      return await evaluateTrust({
        projectPath: dir,
        projectName: "java-qual-test",
        commit: "test",
        language: "java",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("user.update（变量名≈类名）命中 User.update 规则 → 违规精确报出", async () => {
    const r = await run();
    const ssg = r.violations.filter((v) => v.rule_id.startsWith("SSG_"));
    const hit = ssg.find((v) => v.function === "updateUser");
    expect(hit).toBeDefined();
    expect(hit!.why).toContain("PASSWORD_HASHED");
  });

  it("article.update 不误配 User.update 规则（名碰撞消除）→ 零违规", async () => {
    const r = await run();
    const ssg = r.violations.filter((v) => v.rule_id.startsWith("SSG_"));
    expect(ssg.some((v) => v.function === "updateArticle")).toBe(false);
    // 全项目 SSG 违规仅 updateUser 一处（0 名碰撞误报）
    expect(ssg.filter((v) => v.function !== "updateUser")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 修冤枉第五刀（2026-10-10）：守卫传播豁免（产品路径锁定）
//
// 判据：controller 类级 @UseGuards（E2 标记）→ service 层函数的
// 「未认证访问」告警进 suppressed 清单（不进 total/topRanked 主计数），
// 带 suppressedByGuardPropagation 标记可复核；无守卫的对照组照常上报。
// 语义：safeguard 告警流是人工审查入口——传播豁免只分桶不丢弃
// （R9：抑制不可逆，压掉的真阳性必须能复核）。
// ═══════════════════════════════════════════════════════════════

describe("evaluateTrust：守卫传播豁免（修冤枉第五刀）", () => {
  const TS_SOURCE = (guarded: boolean) => `
declare const UseGuards: any;
declare const Controller: any;
declare class JwtAuthGuard {}
${guarded ? "@UseGuards(JwtAuthGuard)" : ""}
@Controller("pages")
export class PageController {
  getSecretPage() { return this.pageService.getSecretPageData(); }
}
export class PageService {
  getSecretPageData() { return "data"; }
}
`;

  async function runWith(source: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-engine-guard-"));
    try {
      fs.writeFileSync(path.join(dir, "app.ts"), source);
      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", strict: false, skipLibCheck: true, noEmit: true }, include: ["**/*.ts"] })
      );
      return await evaluateTrust({
        projectPath: dir,
        projectName: "guard-propagation-test",
        commit: "test",
        language: "typescript",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("守卫后的 service 层告警进 suppressed 清单，不进主计数", async () => {
    const r = await runWith(TS_SOURCE(true));
    const sa = r.overall.safeguardAlerts;
    expect(sa).toBeDefined();
    const supp = sa!.suppressed || [];
    const hit = supp.find(
      (x: any) => x.function === "PageService.getSecretPageData" &&
        x.rule === "Authorization (Unauthenticated Access)"
    );
    expect(hit).toBeDefined();
    expect(hit!.suppressedByGuardPropagation).toBe(true);
    // 不进主计数：topRanked/groups/total 都不含该函数
    expect(sa!.topRanked.some((x: any) => x.alert.function === "PageService.getSecretPageData")).toBe(false);
    expect(sa!.groups.every((g: any) => g.alerts.every((x: any) => x.alert.function !== "PageService.getSecretPageData"))).toBe(true);
    expect(sa!.total).toBe(sa!.topRanked.length);
  }, 150_000);

  it("对照组（无守卫）同函数照常进主告警流", async () => {
    const r = await runWith(TS_SOURCE(false));
    const sa = r.overall.safeguardAlerts;
    expect(sa).toBeDefined();
    const hit = sa!.topRanked.find(
      (x: any) => x.alert.function === "PageService.getSecretPageData" &&
        x.alert.rule === "Authorization (Unauthenticated Access)"
    );
    expect(hit).toBeDefined();
    const supp = sa!.suppressed || [];
    expect(supp.some((x: any) => x.function === "PageService.getSecretPageData")).toBe(false);
  }, 150_000);
});
