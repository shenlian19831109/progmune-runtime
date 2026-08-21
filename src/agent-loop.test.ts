/**
 * Phase 12: Agent Loop Controller 测试
 *
 * 覆盖 M1 验收要点：
 *   - 首次尝试即过全部验证门 → 成功出口，retries=0
 *   - 执行失败 → 反馈注入 → 重试成功（验证 feedback 注入到下一次意图）
 *   - 写盘后验证门失败（编译不过）→ 触发重试而非误报成功
 *   - 全部重试耗尽 → 失败出口，attempts = iterations × retries，审计轨迹完整
 *
 * 不触碰真实文件系统 / LLM / git —— 全部依赖 mock（仓库测试惯例）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execute, verifyCompiles, verifyFileMarker } from "./execute";
import type { ExecuteResult } from "./execute";
import { expandGoalActions } from "./goal-planner";
import { execSync } from "child_process";
import { collectGitContext, extractIRWithDelta } from "./agent-perception";
import { runProjectTests } from "./agent-supervision";
import { runAgentLoop } from "./agent-loop";

vi.mock("./execute", () => ({
  execute: vi.fn(),
  verifyCompiles: vi.fn(),
  verifyFileMarker: vi.fn(),
}));

vi.mock("./goal-planner", () => ({
  expandGoalActions: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("./agent-perception", () => ({
  collectGitContext: vi.fn(),
  extractIRWithDelta: vi.fn(),
}));

vi.mock("./agent-supervision", () => ({
  runProjectTests: vi.fn(),
}));

const mockExecute = vi.mocked(execute);
const mockVerifyCompiles = vi.mocked(verifyCompiles);
const mockVerifyFileMarker = vi.mocked(verifyFileMarker);
const mockExpandGoals = vi.mocked(expandGoalActions);
const mockExecSync = vi.mocked(execSync);
const mockCollectGitContext = vi.mocked(collectGitContext);
const mockExtractIRWithDelta = vi.mocked(extractIRWithDelta);
const mockRunProjectTests = vi.mocked(runProjectTests);

/** 构造一个成功的 ExecuteResult */
function okResult(overrides: Partial<ExecuteResult> = {}): ExecuteResult {
  return {
    success: true,
    code: "/**\n * @progmune-generated session=sess_test timestamp=2026-08-21T00:00:00.000Z\n */\nexport function f() { return 1; }",
    sessionId: "sess_test",
    hash: "fp1234567890abcd",
    ruleHash: "rulehash123",
    irFunctionCount: 3,
    protocolRuleCount: 10,
    violations: 0,
    degraded: false,
    repairApplied: false,
    repairCount: 0,
    repairBranchIds: [],
    ...overrides,
  };
}

/** 构造一个失败的 ExecuteResult */
function failResult(error: string): ExecuteResult {
  return {
    success: false,
    code: "",
    sessionId: "",
    hash: "",
    ruleHash: "",
    irFunctionCount: 0,
    protocolRuleCount: 0,
    violations: 0,
    degraded: false,
    repairApplied: false,
    repairCount: 0,
    repairBranchIds: [],
    error,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExpandGoals.mockReturnValue([]);
  mockVerifyCompiles.mockReturnValue({ pass: true, errors: [] });
  mockVerifyFileMarker.mockReturnValue({ marked: true });
  mockExecSync.mockReturnValue("mock diff");
  mockExtractIRWithDelta.mockReturnValue({
    ir: [{ name: "verify_password" }, { name: "main" }],
    delta: { added: [], removed: [], functionCount: 2 },
  });
  mockRunProjectTests.mockReturnValue({ ran: false, pass: true, failures: [], command: "(无测试脚本)" });
  mockCollectGitContext.mockReturnValue({
    available: true,
    branch: "main",
    recentCommits: ["abc123 feat: login"],
    changedFiles: ["src/auth.ts"],
    sourceFiles: ["src/auth.ts"],
  });
});

describe("agent-loop", () => {
  it("首次尝试通过全部验证门 → 成功出口，retries=0，审计轨迹完整", async () => {
    mockExecute.mockResolvedValue(okResult());

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "实现验证函数",
      filePath: "out.ts",
    });

    expect(r.success).toBe(true);
    expect(r.retries).toBe(0);
    expect(r.iterations).toBe(1);
    expect(r.attempts).toHaveLength(1);
    expect(r.fingerprint).toBe("fp1234567890abcd");
    expect(r.filePath).toBe("out.ts");

    const events = r.auditTrail.map((e) => e.event);
    expect(events).toContain("loop:start");
    expect(events).toContain("attempt:start");
    expect(events).toContain("attempt:ok");
    expect(events).toContain("loop:success");
    expect(r.auditTrail.every((e) => !!e.timestamp)).toBe(true);
  });

  it("执行失败 → 反馈注入下一次意图 → 重试成功", async () => {
    mockExecute
      .mockResolvedValueOnce(failResult("Planning failed: LLM 超时"))
      .mockResolvedValueOnce(okResult());

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "实现支付函数",
      filePath: "pay.ts",
    });

    expect(r.success).toBe(true);
    expect(r.retries).toBe(1);
    expect(r.attempts).toHaveLength(2);
    // 第二次尝试的意图必须包含注入的失败反馈
    expect(r.attempts[1].intent).toContain("[上一次尝试失败");
    expect(r.attempts[1].intent).toContain("Planning failed: LLM 超时");
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("写盘后验证门失败（编译不过）→ 触发重试而非误报成功", async () => {
    mockExecute.mockResolvedValue(okResult());
    mockVerifyCompiles
      .mockReturnValueOnce({ pass: false, errors: ["out.ts:1 error TS1005"] })
      .mockReturnValue({ pass: true, errors: [] });

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "实现工具函数",
      filePath: "util.ts",
    });

    expect(r.success).toBe(true);
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0].success).toBe(false); // 编译门失败 → 该次尝试不算成功
    expect(r.attempts[0].compilePass).toBe(false);
    expect(r.attempts[1].intent).toContain("编译验证未通过");
  });

  it("全部重试耗尽 → 失败出口，attempts = iterations × retries，反馈不静默", async () => {
    mockExecute.mockResolvedValue(failResult("总是失败"));

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "实现不可能的函数",
      filePath: "x.ts",
      maxIterations: 2,
      maxRetries: 3,
    });

    expect(r.success).toBe(false);
    expect(r.attempts).toHaveLength(6);
    expect(r.iterations).toBe(2);
    expect(r.retries).toBe(6);
    // 每轮重试都注入反馈，耗尽后最后一轮结束事件在
    const events = r.auditTrail.map((e) => e.event);
    expect(events).toContain("loop:exhausted");
    expect(events.filter((e) => e === "retry")).toHaveLength(4); // 2 轮 × 每轮 2 次注入
    expect(events.filter((e) => e === "iteration:end")).toHaveLength(2);
  });

  it("execute 抛异常 → 兜底为失败结果并继续重试", async () => {
    mockExecute
      .mockRejectedValueOnce(new Error("crash"))
      .mockResolvedValue(okResult());

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "实现函数",
      filePath: "f.ts",
    });

    expect(r.success).toBe(true);
    expect(r.attempts[0].error).toContain("execute 抛出异常: crash");
    expect(r.attempts[1].intent).toContain("execute 抛出异常");
  });

  it("未指定 filePath 时成功出口 diff 为空占位", async () => {
    mockExecute.mockResolvedValue(okResult());

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "生成代码片段",
    });

    expect(r.success).toBe(true);
    expect(r.diff).toBe("(未指定输出文件，无 diff)");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("P3 测试门：项目测试失败 → 注入测试反馈重试，测试通过后成功", async () => {
    mockExecute.mockResolvedValue(okResult());
    mockRunProjectTests
      .mockReturnValueOnce({
        ran: true, pass: false, failures: ["FAIL login.test.ts", "AssertionError: token 无效"], command: "npm test",
      })
      .mockReturnValue({ ran: true, pass: true, failures: [], command: "npm test" });

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "实现登录流程",
      filePath: "login.ts",
      runTests: true,
      approveExec: true, // P5：测试门 shell 执行需审批（--yes）
    });

    expect(r.success).toBe(true);
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0].success).toBe(false);
    expect(r.attempts[0].testRan).toBe(true);
    expect(r.attempts[0].testPass).toBe(false);
    expect(r.attempts[1].intent).toContain("项目测试失败");
    expect(r.attempts[1].intent).toContain("token 无效");
    expect(r.attempts[1].testPass).toBe(true);
    expect(mockRunProjectTests).toHaveBeenCalledTimes(2);
  });

  it("P2 上下文：includeContext 时意图注入 git 上下文，审计含 perception 事件", async () => {
    mockExecute.mockResolvedValue(okResult());

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "实现登录流程",
      filePath: "login.ts",
      includeContext: true,
    });

    expect(r.success).toBe(true);
    expect(r.attempts[0].intent).toContain("[项目上下文");
    expect(r.attempts[0].intent).toContain("main");
    const events = r.auditTrail.map((e) => e.event);
    expect(events).toContain("perception:git");
    expect(events).toContain("perception:ir");
    expect(r.gitContext?.branch).toBe("main");
    expect(r.irDelta).toBeDefined();
  });

  it("P2 感知：IR 增量写入审计轨迹并返回", async () => {
    mockExecute.mockResolvedValue(okResult());
    mockExtractIRWithDelta
      .mockReturnValueOnce({ ir: [{ name: "verify_password" }], delta: { added: [], removed: [], functionCount: 1 } })
      .mockReturnValueOnce({
        ir: [{ name: "verify_password" }, { name: "main" }],
        delta: { added: ["main"], removed: [], functionCount: 2 },
      });

    const r = await runAgentLoop({
      projectPath: "/tmp/fake-project",
      intent: "实现登录流程",
      filePath: "login.ts",
    });

    expect(r.success).toBe(true);
    expect(r.irDelta?.added).toContain("main");
    const events = r.auditTrail.map((e) => e.event);
    expect(events.filter((e) => e === "perception:ir")).toHaveLength(2);
  });
});
