"use strict";
/**
 * Phase 12: 免疫巡逻测试 (P4)
 *
 * evaluateTrust / extractIR / git 全部 mock —— 验证：
 *   - 违规 → 报告映射（fixPath 来自 violationTraces）
 *   - autoApplied 恒为 false（修复信任悖论）
 *   - Markdown 报告含建议补丁 + 证据链
 *   - 报告落盘
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const engine_1 = require("./trust/engine");
const extract_ir_1 = require("./extract-ir");
const child_process_1 = require("child_process");
const agent_patrol_1 = require("./agent-patrol");
vitest_1.vi.mock("./trust/engine", () => ({
    evaluateTrust: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("./extract-ir", () => ({
    extractIR: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("child_process", () => ({
    execSync: vitest_1.vi.fn(),
}));
const mockEvaluateTrust = vitest_1.vi.mocked(engine_1.evaluateTrust);
const mockExtractIR = vitest_1.vi.mocked(extract_ir_1.extractIR);
const mockExecSync = vitest_1.vi.mocked(child_process_1.execSync);
/** 构造受控的 TrustDecision */
function trustDecision(overrides = {}) {
    return {
        project: "demo-patrol",
        commit: "abc123",
        timestamp: "2026-08-21T08:00:00.000Z",
        engineVersion: "trust-runtime-v1.0.0",
        overall: { score: 41, decision: "BLOCKED", confidence: "HIGH" },
        dimensions: {},
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
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    mockExtractIR.mockReturnValue([]);
    mockExecSync.mockImplementation((cmd) => {
        const c = String(cmd);
        if (c.includes("rev-parse"))
            return "main";
        if (c.includes("log --oneline"))
            return "abc123 feat: demo";
        if (c.includes("status --porcelain"))
            return " M bad_flow.ts";
        throw new Error("unexpected cmd: " + c);
    });
});
(0, vitest_1.describe)("agent-patrol", () => {
    (0, vitest_1.it)("违规映射到报告：fixPath 来自 violationTraces，autoApplied 恒为 false", async () => {
        mockEvaluateTrust.mockResolvedValue(trustDecision());
        const r = await (0, agent_patrol_1.runPatrol)("/tmp/fake-project");
        (0, vitest_1.expect)(r.decision).toBe("BLOCKED");
        (0, vitest_1.expect)(r.score).toBe(41);
        (0, vitest_1.expect)(r.summary).toEqual({ critical: 0, high: 1, medium: 0, low: 0, total: 1 });
        (0, vitest_1.expect)(r.findings).toHaveLength(1);
        (0, vitest_1.expect)(r.findings[0].fixPath).toEqual(["verify_password"]);
        (0, vitest_1.expect)(r.findings[0].reasoningSteps.length).toBe(1);
        (0, vitest_1.expect)(r.autoApplied).toBe(false); // 铁律：永不自动合并
        (0, vitest_1.expect)(r.auditTrail.map((e) => e.event)).toContain("patrol:scan");
    });
    (0, vitest_1.it)("无违规时 APPROVED 报告不含明细", async () => {
        mockEvaluateTrust.mockResolvedValue(trustDecision({
            overall: { score: 95, decision: "APPROVED", confidence: "HIGH" },
            violations: [],
            violationTraces: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
        }));
        const r = await (0, agent_patrol_1.runPatrol)("/tmp/fake-project");
        (0, vitest_1.expect)(r.decision).toBe("APPROVED");
        (0, vitest_1.expect)(r.findings).toHaveLength(0);
        const md = (0, agent_patrol_1.formatPatrolMarkdown)(r);
        (0, vitest_1.expect)(md).toContain("未发现违规");
        (0, vitest_1.expect)(md).toContain("自动合并: 永不");
    });
    (0, vitest_1.it)("Markdown 报告含建议补丁路径与证据链回放", async () => {
        mockEvaluateTrust.mockResolvedValue(trustDecision());
        const r = await (0, agent_patrol_1.runPatrol)("/tmp/fake-project");
        const md = (0, agent_patrol_1.formatPatrolMarkdown)(r);
        (0, vitest_1.expect)(md).toContain("免疫巡逻报告");
        (0, vitest_1.expect)(md).toContain("SSG_PROTOCOL");
        (0, vitest_1.expect)(md).toContain("建议补丁路径");
        (0, vitest_1.expect)(md).toContain("verify_password");
        (0, vitest_1.expect)(md).toContain("推理回放");
        (0, vitest_1.expect)(md).toContain("证据链（可回放）");
        (0, vitest_1.expect)(md).toContain("checkId: check_abc");
    });
    (0, vitest_1.it)("writePatrolReport 落盘到项目目录", async () => {
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-patrol-"));
        mockEvaluateTrust.mockResolvedValue(trustDecision());
        const r = await (0, agent_patrol_1.runPatrol)(dir);
        const reportPath = (0, agent_patrol_1.writePatrolReport)(r, dir);
        (0, vitest_1.expect)(fs.existsSync(reportPath)).toBe(true);
        const content = fs.readFileSync(reportPath, "utf-8");
        (0, vitest_1.expect)(content).toContain("免疫巡逻报告");
    });
});
