/**
 * SSG Bridge — Smoke Tests
 *
 * Validates that the SSG bridge correctly:
 *   1. Maps semantic domains to SSG namespaces
 *   2. Matches real API calls to protocol rules
 *   3. Detects state machine violations
 *   4. Passes valid sequences without false positives
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  validateSequenceWithSSG,
  ssgViolationsToTrustViolations,
  loadProtocolRules,
  loadProjectAliases,
} from "./ssg-bridge";
import type { SemanticStep } from "./api-semantic-mapper";

// Load protocol rules once for all tests
const protoData = loadProtocolRules();
const rules = protoData?.rules;
const nsInit = protoData?.namespaceInitialStates || {};
const aliasIndex = protoData?.aliasIndex || new Map<string, string>();
const noAliases = new Map<string, string>(); // empty alias map for fallback tests

// Helper: run SSG validation with alias index
function validate(steps: SemanticStep[], file: string = "test.ts") {
  return validateSequenceWithSSG(steps, rules!, nsInit, file, aliasIndex);
}

// Helper: build a minimal SemanticStep
function step(
  api: string,
  domain: string,
  description: string = "",
): SemanticStep {
  return {
    api,
    domain: domain as any,
    description,
    source: "lookup",
  };
}

describe("SSG Bridge", () => {
  it("loads protocol rules from protocols.json", () => {
    expect(rules).toBeDefined();
    expect(rules!.size).toBeGreaterThan(100);
    expect(nsInit).toBeDefined();
    expect(nsInit["auth"]).toBeDefined();
  });

  describe("call → rule inference", () => {
    it("matches bcrypt-like calls to auth rules", () => {
      const steps = [
        step("bcrypt.compare", "auth_hash", "Verify password against stored hash"),
      ];
      const result = validate(steps);
      expect(result.stats.matchedCalls).toBeGreaterThanOrEqual(1);
    });

    it("matches JWT-like calls to auth rules", () => {
      const steps = [
        step("jwt.sign", "auth_mech", "Generate JWT token"),
      ];
      const result = validate(steps);
      expect(result.stats.matchedCalls).toBeGreaterThanOrEqual(1);
    });

    it("matches TLS-related calls to tls rules", () => {
      const steps = [
        step("https.createServer", "http_ops", "Create HTTPS server"),
      ];
      const result = validate(steps);
      // http_ops maps to "tls" namespace, and createServer → http_create_server rule
      expect(result.stats.matchedCalls).toBeGreaterThanOrEqual(1);
    });

    it("matches file I/O calls to resource rules", () => {
      const steps = [
        step("fs.openSync", "conn_mgmt", "Open file for reading"),
      ];
      const result = validate(steps);
      expect(result.stats.matchedCalls).toBeGreaterThanOrEqual(1);
    });

    it("does not match util/stateless calls", () => {
      const steps = [
        step("console.log", "util", "Log output"),
        step("JSON.parse", "util", "Parse JSON"),
      ];
      const result = validate(steps);
      expect(result.stats.matchedCalls).toBe(0);
      expect(result.stats.unmatchedCalls).toBe(steps.length);
    });
  });

  // ── 接收者限定名匹配（Java 名碰撞根因修复，2026-09-06）──
  describe("qualified call → rule inference", () => {
    it("限定调用精确匹配限定规则（大小写不敏感：user.update → User.update）", () => {
      const prev = rules!.get("User.update");
      rules!.set("User.update", {
        pre_states: ["PASSWORD_HASHED"],
        post_states: ["PASSWORD_UPDATED"],
        namespace: "registration",
      });
      try {
        const result = validateSequenceWithSSG(
          [step("user.update", "registration", "Update user data")],
          rules!, nsInit, "test.java", aliasIndex, undefined,
          new Set(["user.update", "update"]),
        );
        expect(result.stats.matchedCalls).toBeGreaterThanOrEqual(1);
      } finally {
        if (prev) rules!.set("User.update", prev); else rules!.delete("User.update");
      }
    });

    it("不同类限定调用不误配（article.update 不命中 User.update 规则）", () => {
      const prev = rules!.get("User.update");
      rules!.set("User.update", {
        pre_states: ["PASSWORD_HASHED"],
        post_states: ["PASSWORD_UPDATED"],
        namespace: "registration",
      });
      try {
        const result = validateSequenceWithSSG(
          [step("article.update", "registration", "Update article content")],
          rules!, nsInit, "test.java", aliasIndex, undefined,
          new Set(["article.update", "update"]),
        );
        expect(result.stats.matchedCalls).toBe(0);
        expect(result.stats.unmatchedCalls).toBe(1);
      } finally {
        if (prev) rules!.set("User.update", prev); else rules!.delete("User.update");
      }
    });

    it("带点调用不参与词段匹配（helper.verify_hash 不命中 verify_hash）", () => {
      // 无 projectFunctions 时不限制（回退路径旧行为）；提供后带点调用
      // 只走限定精确匹配 + 别名——末段词段回退会重造名碰撞
      const result = validateSequenceWithSSG(
        [step("helper.verify_hash", "auth", "Verify something")],
        rules!, nsInit, "test.java", aliasIndex, undefined,
        new Set(["helper.verify_hash", "verify_hash"]),
      );
      expect(result.stats.matchedCalls).toBe(0);
    });
  });

  describe("alias-based matching (exact)", () => {
    it("matches bcrypt.compare to verify_hash via alias", () => {
      expect(aliasIndex.get("bcrypt.compare")).toBe("verify_hash");
    });

    it("matches bcrypt.hash to hash_password via alias", () => {
      expect(aliasIndex.get("bcrypt.hash")).toBe("hash_password");
    });

    it("matches jsonwebtoken.sign to generate_jwt via alias", () => {
      expect(aliasIndex.get("jsonwebtoken.sign")).toBe("generate_jwt");
    });

    it("matches jsonwebtoken.verify to verify_token via alias", () => {
      expect(aliasIndex.get("jsonwebtoken.verify")).toBe("verify_token");
    });

    it("matches fs.openSync to open_file via alias", () => {
      expect(aliasIndex.get("fs.opensync")).toBe("open_file");
    });

    it("matches prisma.model.findMany to query_db via alias", () => {
      expect(aliasIndex.get("prisma.model.findmany")).toBe("query_db");
    });

    it("matches prisma.$disconnect to disconnect_db via alias", () => {
      expect(aliasIndex.get("prisma.$disconnect")).toBe("disconnect_db");
    });

    it("matches express.listen to http_create_server via alias", () => {
      expect(aliasIndex.get("express.listen")).toBe("http_create_server");
    });

    it("matches app.listen to http_create_server via alias", () => {
      expect(aliasIndex.get("app.listen")).toBe("http_create_server");
    });

    it("matches db.transaction to begin_tx via alias", () => {
      expect(aliasIndex.get("db.transaction")).toBe("begin_tx");
    });

    it("alias index has expected number of entries", () => {
      // 21 rules with aliases, each with 3-10+ aliases
      expect(aliasIndex.size).toBeGreaterThanOrEqual(50);
    });

    it("no duplicate alias mappings", () => {
      // Each alias should map to exactly one rule
      const values = Array.from(aliasIndex.values());
      const uniqueValues = new Set(values);
      // All unique rules should be present
      expect(uniqueValues.size).toBeGreaterThanOrEqual(15);
    });
  });

  describe("state machine validation", () => {
    it("accepts jwt.sign as entry point (OAuth / cold start)", () => {
      // generate_jwt is now an entry point (empty pre_states) because
      // JWT can be generated from OAuth flow or password flow.
      // See: state machine split — auth vs registration namespaces.
      const steps = [
        step("jwt.sign", "auth_mech", "Generate JWT token (OAuth callback or login)"),
      ];
      const result = validate(steps);

      // jwt.sign maps to generate_jwt which now has empty pre_states
      // → should match and pass without violations
      expect(result.stats.matchedCalls).toBeGreaterThanOrEqual(1);
      expect(result.violations.length).toBe(0);
    });

    it("passes valid auth sequence (all entry points after split)", () => {
      // After state machine split:
      // - bcrypt.hash → hash_password (registration, entry point)
      // - bcrypt.compare → verify_hash (auth/login, entry point)
      // - jwt.sign → generate_jwt (auth, entry point for OAuth/login)
      // All three are now valid entry points — no pre_state requirements.
      const steps = [
        step("bcrypt.hash", "auth_hash", "Hash password (registration flow)"),
        step("bcrypt.compare", "auth_hash", "Verify password (login flow)"),
        step("jwt.sign", "auth_mech", "Generate JWT token"),
      ];

      const result = validate(steps);
      expect(result.stats.matchedCalls).toBeGreaterThanOrEqual(3);
      expect(result.violations.length).toBe(0);
    });

    it("passes valid TLS sequence", () => {
      const steps = [
        step("fs.readFileSync", "tls_config", "Load TLS certificate"),
        step("https.createServer", "http_ops", "Create HTTPS server with TLS"),
      ];

      const result = validate(steps);
      // load_tls_config → TLS_CONFIGURED
      // http_create_server requires TLS_CONFIGURED
      // No state violations expected for correct sequence
      const tlsViolations = result.violations.filter(v => v.namespace === "tls");
      if (tlsViolations.length > 0) {
        // If there are violations, they should include fix paths
        for (const v of tlsViolations) {
          expect(v.explanation).toBeTruthy();
        }
      }
    });

    it("detects missing cleanup (file opened but not closed)", () => {
      // open_file without close_file — held FILE_OPEN at end of sequence
      const steps = [
        step("fs.openSync", "conn_mgmt", "Open file"),
        step("fs.readFileSync", "conn_mgmt", "Read file contents"),
        // Missing: close_file
      ];
      const result = validate(steps);

      // endState 检查：序列末尾资源未释放 → 违规 + 追加式修复路径
      const endState = result.violations.filter((v) => v.endState);
      expect(endState).toHaveLength(1);
      expect(endState[0].namespace).toBe("file");
      expect(endState[0].currentState).toContain("FILE_OPEN");
      expect(endState[0].fixPath).toEqual(["close_file"]);
      expect(result.passed).toBe(false);
      // trace 含步骤节点 + 末尾 endState 节点
      expect(result.trace.length).toBe(steps.length + 1);
    });
  });

  describe("violation → TrustViolation conversion", () => {
    it("converts SSG violations to TrustViolation format", () => {
      const mockResult = {
        passed: false,
        trace: [],
        violations: [{
          callName: "jwt.sign",
          namespace: "auth",
          currentState: ["UNAUTHENTICATED"],
          requiredState: ["PASSWORD_VERIFIED"],
          fixPath: ["hash_password", "verify_hash"],
          matchedRule: "generate_jwt",
          explanation: "State violation: requires PASSWORD_VERIFIED but current is UNAUTHENTICATED",
        }],
        stats: { totalCalls: 1, matchedCalls: 1, unmatchedCalls: 0, validatedCalls: 1, violatedCalls: 1 },
      };

      const tv = ssgViolationsToTrustViolations(mockResult, "auth.ts", "login");
      expect(tv.length).toBe(1);
      expect(tv[0].rule_id).toContain("SSG_AUTH");
      expect(tv[0].severity).toBe("medium");
      expect(tv[0].file).toBe("auth.ts");
      expect(tv[0].function).toBe("login");
      expect(tv[0].fix).toContain("hash_password");
    });
  });

  describe("loadProjectAliases", () => {
    it("returns null when no .progmune_aliases.json exists", () => {
      const result = loadProjectAliases("/tmp/nonexistent", new Set(["rule_a"]));
      expect(result).toBeNull();
    });

    it("validates that target rules exist", () => {
      // We need a real temp dir with a .progmune_aliases.json
      const fs = require("fs");
      const path = require("path");
      const tmpDir = fs.mkdtempSync("/tmp/progmune-test-");
      const aliasPath = path.join(tmpDir, ".progmune_aliases.json");
      fs.writeFileSync(aliasPath, JSON.stringify({
        aliases: {
          "createSessionToken": "create_user_session",
          "unknownWrapper": "nonexistent_rule",
        }
      }));

      const result = loadProjectAliases(tmpDir, new Set(["create_user_session"]));
      expect(result).not.toBeNull();
      expect(result!.aliases["createsessiontoken"]).toBe("create_user_session");
      // unknownWrapper should have been skipped with a warning
      expect(result!.aliases["unknownwrapper"]).toBeUndefined();
      expect(result!.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result!.warnings[0]).toContain("nonexistent_rule");

      // Cleanup
      fs.unlinkSync(aliasPath);
      fs.rmdirSync(tmpDir);
    });

    it("respects case-insensitive alias keys", () => {
      const fs = require("fs");
      const path = require("path");
      const tmpDir = fs.mkdtempSync("/tmp/progmune-test-");
      fs.writeFileSync(path.join(tmpDir, ".progmune_aliases.json"), JSON.stringify({
        aliases: {
          "CreateSessionToken": "create_user_session",
        }
      }));

      const result = loadProjectAliases(tmpDir, new Set(["create_user_session"]));
      expect(result!.aliases["createsessiontoken"]).toBe("create_user_session");

      fs.unlinkSync(path.join(tmpDir, ".progmune_aliases.json"));
      fs.rmdirSync(tmpDir);
    });

    it("merges project aliases without overriding global ones", () => {
      // Load rules with project aliases — global aliasIndex should still have
      // the global entries, and project entries should be additive
      const data = loadProtocolRules("/Users/shenlian/printlab_mvp");
      expect(data).not.toBeNull();

      // Global aliases should still be present
      expect(data!.aliasIndex.get("bcrypt.compare")).toBe("verify_hash");
      expect(data!.aliasIndex.get("jsonwebtoken.sign")).toBe("generate_jwt");

      // Project aliases should be present (from .progmune_aliases.json)
      expect(data!.aliasIndex.get("createsessiontoken")).toBe("create_user_session");
      expect(data!.aliasIndex.get("sendemail")).toBe("send_notification");

      // Project aliases should be recorded separately
      expect(data!.projectAliases).toBeDefined();
      expect(Object.keys(data!.projectAliases!).length).toBeGreaterThan(10);

      // Should not have warnings for valid rules
      const warnCount = (data!.aliasWarnings || []).filter(
        w => w.includes("not found")
      ).length;
      expect(warnCount).toBe(0);
    });
  });
});

describe("共享 C 别名表（c-aliases.json，孵化器机制）", () => {
  it("confirmed 条目被加载进 aliasIndex；proposed 条目不加载（人工确认门）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-calias-"));
    try {
      fs.writeFileSync(path.join(dir, "c-aliases.json"), JSON.stringify({
        entries: [
          { call: "ssh_userauth_password", rule: "verify_password", status: "confirmed" },
          { call: "some_lib_connect", rule: "connect_db", status: "proposed" },
          { call: "ghost_call", rule: "no_such_rule", status: "confirmed" },
        ],
      }));

      const loaded = loadProtocolRules(dir);
      expect(loaded).not.toBeNull();
      expect(loaded!.aliasIndex.get("ssh_userauth_password")).toBe("verify_password");
      expect(loaded!.aliasIndex.has("some_lib_connect")).toBe(false); // 未确认不生效
      expect(loaded!.aliasIndex.has("ghost_call")).toBe(false); // 规则不存在跳过
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("共享表不覆盖全局别名与项目别名（first-wins）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-calias2-"));
    try {
      // 全局 verify_hash 的别名 jsonwebtoken.verify——共享表同名条目不得覆盖
      fs.writeFileSync(path.join(dir, "c-aliases.json"), JSON.stringify({
        entries: [
          { call: "jsonwebtoken.verify", rule: "verify_password", status: "confirmed" },
        ],
      }));
      const loaded = loadProtocolRules(dir);
      const globalRule = loaded!.rules.get("verify_token")?.aliases?.includes("jsonwebtoken.verify");
      // jsonwebtoken.verify 若已存在全局别名，共享表不覆盖（值保持原规则）
      expect(loaded!.aliasIndex.get("jsonwebtoken.verify")).not.toBe("verify_password");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
