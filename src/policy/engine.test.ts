/**
 * policy/engine.test.ts — 策略引擎 fail-closed 回归（审计修复 2026-09-06）
 *
 * 锁定 Kimi 审计的三条修复：
 * 1. risk 规则不再伪造 ["SSL_CTX_new","SSL_connect"] 输入——无真实调用
 *    数据时按 fail-closed 计违规
 * 2. 配置解析失败显式携带 configError（不再静默回退默认）
 * 3. execute 写盘策略门：项目 opt-in（.progmune-policy.json）时 BLOCK
 *    回滚写盘；未配置时无操作
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { evaluatePolicy, loadPolicyConfig } from "./engine";
import { applyPolicyGateAfterWrite } from "../execute";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-policy-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function baseCtx(file: string) {
  return {
    certificate: {
      validated: true,
      confidence: "high" as const,
      provenanceIntact: true,
      fingerprint: "test-fp",
      violations: 0,
      plsbCoverage: "10/13",
      plsbRecall: 1,
      degraded: false,
      sessionId: "test-session",
      file,
      timestamp: new Date().toISOString(),
    },
    accountability: {
      humanEvents: 1,
      aiEvents: 1,
      automatedEvents: 0,
      custodyGap: false,
    },
  };
}

describe("policy engine（fail-closed 回归）", () => {
  it("risk 规则：无可提取调用数据 → 显式违规（fail-closed，不再伪造输入）", () => {
    const f = path.join(dir, "empty.ts");
    fs.writeFileSync(f, "");
    const result = evaluatePolicy(baseCtx(f));
    const riskViolations = result.violations.filter((v) => v.rule.type === "risk");
    expect(riskViolations.length).toBeGreaterThanOrEqual(1);
    expect(riskViolations[0].detail).toContain("fail-closed");
  });

  it("risk 规则：真实调用提取后良性代码不产生风险违规", () => {
    const f = path.join(dir, "benign.ts");
    fs.writeFileSync(f, "function hello() { console.log('x'); return computeSum(a, b); }");
    const result = evaluatePolicy(baseCtx(f));
    const riskViolations = result.violations.filter((v) => v.rule.type === "risk");
    expect(riskViolations).toHaveLength(0);
  });

  it("loadPolicyConfig：JSON 解析失败显式携带 configError（不再静默回退）", () => {
    fs.writeFileSync(path.join(dir, ".progmune-policy.json"), "{ broken json !!!");
    const res = loadPolicyConfig(dir);
    expect(res.configError).toBeDefined();
    expect(res.configError).toContain("Failed to parse");
  });
});

describe("execute 写盘策略门（opt-in）", () => {
  const MARKED = `// @progmune-generated session=s1 timestamp=2026-09-06T00:00:00.000Z
function doThing() { return 1; }
`;

  it("未配置 .progmune-policy.json → 无操作（旧行为）", () => {
    const f = path.join(dir, "out.ts");
    fs.writeFileSync(f, MARKED);
    const gate = applyPolicyGateAfterWrite(dir, f);
    expect(gate.blocked).toBe(false);
    expect(fs.existsSync(f)).toBe(true);
  });

  it("配置阻断规则 → BLOCK 回滚（新文件删除）", () => {
    fs.writeFileSync(path.join(dir, ".progmune-policy.json"), JSON.stringify({
      inherit: false,
      rules: [{ type: "confidence", severity: "block", threshold: 2 }],
    }));
    const f = path.join(dir, "out.ts");
    fs.writeFileSync(f, MARKED);
    const gate = applyPolicyGateAfterWrite(dir, f);
    expect(gate.blocked).toBe(true);
    expect(gate.decision).toBe("BLOCK");
    expect(fs.existsSync(f)).toBe(false); // 回滚 = 删除新文件
  });

  it("配置阻断规则 → BLOCK 回滚（已有文件恢复原内容）", () => {
    fs.writeFileSync(path.join(dir, ".progmune-policy.json"), JSON.stringify({
      inherit: false,
      rules: [{ type: "confidence", severity: "block", threshold: 2 }],
    }));
    const f = path.join(dir, "out.ts");
    const prev = "// original content\n";
    const gate = applyPolicyGateAfterWrite(dir, f, prev);
    expect(gate.blocked).toBe(true);
    expect(fs.readFileSync(f, "utf-8")).toBe(prev); // 恢复原内容
  });
});
