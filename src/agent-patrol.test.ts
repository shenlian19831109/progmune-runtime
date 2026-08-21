/**
 * Phase 12: 免疫巡逻测试 (P4)
 *
 * evaluateTrust / extractIR / git 全部 mock —— 验证：
 *   - 违规 → 报告映射（fixPath 来自 violationTraces）
 *   - autoApplied 恒为 false（修复信任悖论）
 *   - Markdown 报告含建议补丁 + 证据链
 *   - 报告落盘
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateTrust } from "./trust/engine";
import type { TrustDecision } from "./trust/types";
import { extractIR } from "./extract-ir";
import { execSync } from "child_process";
import { runPatrol, formatPatrolMarkdown, writePatrolReport } from "./agent-patrol";

vi.mock("./trust/engine", () => ({
  evaluateTrust: vi.fn(),
}));

vi.mock("./extract-ir", () => ({
  extractIR: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const mockEvaluateTrust = vi.mocked(evaluateTrust);
const mockExtractIR = vi.mocked(extractIR);
const mockExecSync = vi.mocked(execSync);

/** 构造受控的 TrustDecision */
function trustDecision(overrides: Partial<TrustDecision> = {}): TrustDecision {
  return {
    project: "demo-patrol",
    commit: "abc123",
    timestamp: "2026-08-21T08:00:00.000Z",
    engineVersion: "trust-runtime-v1.0.0",
    overall: { score: 41, decision: "BLOCKED", confidence: "HIGH" },
    dimensions: {} as any,
    violations: [
      {
        severity: "high",
        rule_id: "SSG_PROTOCOL",
        file: "bad_flow.ts",
        function: "bad_flow",
        message: 'SSG state violation: "generate_jwt" requires states [PASSWORD_VERIFIED]',
        evidence: "调用序列 [generate_jwt] 违反协议",
        why: "缺少密码验证前置",
        fix: "在 generate_jwt 前调用 verify_password",
        policy_ref: "REF-SSG-001",
      },
    ],
    violationTraces: [
      {
        rule_id: "SSG_PROTOCOL",
        file: "bad_flow.ts",
        function: "bad_flow",
        steps: [
          { step: 1, label: "状态", action: "generate_jwt", preState: "UNAUTHENTICATED", explanation: "前置 PASSWORD_VERIFIED 缺失" },
        ],
        fixPath: ["verify_password"],
        estimatedReadingTimeMinutes: 1,
      },
    ],
    summary: { critical: 0, high: 1, medium: 0, low: 0, total: 1 },
    auditTrail: {
      commit: "abc123",
      policy: "default",
      policyVersion: "v1.0.0",
      engineVersion: "trust-runtime-v1.0.0",
      generatedAt: "2026-08-21T08:00:00.000Z",
      reproducible: true,
      checkId: "check_abc",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExtractIR.mockReturnValue([] as any);
  mockExecSync.mockImplementation((cmd: any): any => {
    const c = String(cmd);
    if (c.includes("rev-parse")) return "main";
    if (c.includes("log --oneline")) return "abc123 feat: demo";
    if (c.includes("status --porcelain")) return " M bad_flow.ts";
    throw new Error("unexpected cmd: " + c);
  });
});

describe("agent-patrol", () => {
  it("违规映射到报告：fixPath 来自 violationTraces，autoApplied 恒为 false", async () => {
    mockEvaluateTrust.mockResolvedValue(trustDecision());

    const r = await runPatrol("/tmp/fake-project");

    expect(r.decision).toBe("BLOCKED");
    expect(r.score).toBe(41);
    expect(r.summary).toEqual({ critical: 0, high: 1, medium: 0, low: 0, total: 1 });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].fixPath).toEqual(["verify_password"]);
    expect(r.findings[0].reasoningSteps.length).toBe(1);
    expect(r.autoApplied).toBe(false); // 铁律：永不自动合并
    expect(r.auditTrail.map((e) => e.event)).toContain("patrol:scan");
  });

  it("无违规时 APPROVED 报告不含明细", async () => {
    mockEvaluateTrust.mockResolvedValue(trustDecision({
      overall: { score: 95, decision: "APPROVED", confidence: "HIGH" } as any,
      violations: [],
      violationTraces: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 } as any,
    }));

    const r = await runPatrol("/tmp/fake-project");

    expect(r.decision).toBe("APPROVED");
    expect(r.findings).toHaveLength(0);
    const md = formatPatrolMarkdown(r);
    expect(md).toContain("未发现违规");
    expect(md).toContain("自动合并: 永不");
  });

  it("Markdown 报告含建议补丁路径与证据链回放", async () => {
    mockEvaluateTrust.mockResolvedValue(trustDecision());

    const r = await runPatrol("/tmp/fake-project");
    const md = formatPatrolMarkdown(r);

    expect(md).toContain("免疫巡逻报告");
    expect(md).toContain("SSG_PROTOCOL");
    expect(md).toContain("建议补丁路径");
    expect(md).toContain("verify_password");
    expect(md).toContain("推理回放");
    expect(md).toContain("证据链（可回放）");
    expect(md).toContain("checkId: check_abc");
  });

  it("writePatrolReport 落盘到项目目录", async () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-patrol-"));
    mockEvaluateTrust.mockResolvedValue(trustDecision());

    const r = await runPatrol(dir);
    const reportPath = writePatrolReport(r, dir);

    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, "utf-8");
    expect(content).toContain("免疫巡逻报告");
  });
});
