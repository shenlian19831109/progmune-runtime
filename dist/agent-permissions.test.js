"use strict";
/**
 * Phase 12: 操作级安全层测试 (P5 v1)
 *
 * 预设判定 / FsSandbox 白名单 / 审批门 / deny 默认——全部纯函数，不触真实 FS。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const agent_permissions_1 = require("./agent-permissions");
(0, vitest_1.describe)("agent-permissions", () => {
    (0, vitest_1.it)("auto 操作直接允许（读、agent 写）", () => {
        const read = (0, agent_permissions_1.decidePermission)("patrol", { level: "read", target: "src/auth.ts", projectPath: "/p" });
        (0, vitest_1.expect)(read.allowed).toBe(true);
        (0, vitest_1.expect)(read.audit.event).toBe("permission:auto");
        // agent 预设：写 = auto（安全由 execute 验证门保证）
        const write = (0, agent_permissions_1.decidePermission)("agent", { level: "write", target: "out.ts", projectPath: "/p" });
        (0, vitest_1.expect)(write.allowed).toBe(true);
    });
    (0, vitest_1.it)("sandbox 写：白名单内项目文件允许，越界或非白名单拒绝", () => {
        const ok = (0, agent_permissions_1.checkSandboxWrite)({
            level: "write",
            target: "/p/.progmune_patrol_report.md",
            projectPath: "/p",
        });
        (0, vitest_1.expect)(ok.allowed).toBe(true);
        const outside = (0, agent_permissions_1.checkSandboxWrite)({
            level: "write",
            target: "/etc/passwd",
            projectPath: "/p",
        });
        (0, vitest_1.expect)(outside.allowed).toBe(false);
        (0, vitest_1.expect)(outside.detail).toContain("拒绝");
        const notWhitelisted = (0, agent_permissions_1.checkSandboxWrite)({
            level: "write",
            target: "/p/src/auth.ts",
            projectPath: "/p",
        });
        (0, vitest_1.expect)(notWhitelisted.allowed).toBe(false);
    });
    (0, vitest_1.it)("审批门：preApproved 或 confirmFn 同意才放行", () => {
        const denied = (0, agent_permissions_1.decidePermission)("agent", { level: "exec", target: "npm test", projectPath: "/p" });
        (0, vitest_1.expect)(denied.allowed).toBe(false);
        (0, vitest_1.expect)(denied.audit.event).toBe("permission:approve");
        const approved = (0, agent_permissions_1.decidePermission)("agent", {
            level: "exec", target: "npm test", projectPath: "/p", preApproved: true,
        });
        (0, vitest_1.expect)(approved.allowed).toBe(true);
        const confirmed = (0, agent_permissions_1.decidePermission)("agent", { level: "exec", target: "npm test", projectPath: "/p" }, () => true);
        (0, vitest_1.expect)(confirmed.allowed).toBe(true);
        const rejected = (0, agent_permissions_1.decidePermission)("agent", { level: "exec", target: "npm test", projectPath: "/p" }, () => false);
        (0, vitest_1.expect)(rejected.allowed).toBe(false);
    });
    (0, vitest_1.it)("deny 默认：巡逻 exec/commit 与 agent commit 一律拒绝（修复信任悖论）", () => {
        (0, vitest_1.expect)((0, agent_permissions_1.decidePermission)("patrol", { level: "exec", target: "tsc", projectPath: "/p" }).allowed).toBe(false);
        (0, vitest_1.expect)((0, agent_permissions_1.decidePermission)("patrol", { level: "commit", target: "git commit", projectPath: "/p" }).allowed).toBe(false);
        (0, vitest_1.expect)((0, agent_permissions_1.decidePermission)("agent", { level: "commit", target: "git commit", projectPath: "/p" }).allowed).toBe(false);
        // 即使 --yes 也不能绕过 deny
        (0, vitest_1.expect)((0, agent_permissions_1.decidePermission)("agent", {
            level: "commit", target: "git commit", projectPath: "/p", preApproved: true,
        }).allowed).toBe(false);
    });
    (0, vitest_1.it)("预设表结构完整（四种级别齐全）", () => {
        const levels = ["read", "write", "exec", "commit"];
        for (const l of levels) {
            (0, vitest_1.expect)(agent_permissions_1.PRESET_PATROL[l]).toBeDefined();
            (0, vitest_1.expect)(agent_permissions_1.PRESET_AGENT[l]).toBeDefined();
        }
        // 修复信任悖论：两个预设的 commit 都不可自动放行
        (0, vitest_1.expect)(agent_permissions_1.PRESET_PATROL.commit).toBe("deny");
        (0, vitest_1.expect)(agent_permissions_1.PRESET_AGENT.commit).toBe("deny");
    });
    (0, vitest_1.it)("审批未通过时审计事件带 denied 标记", () => {
        const d = (0, agent_permissions_1.decidePermission)("agent", { level: "exec", target: "pytest", projectPath: "/p" });
        (0, vitest_1.expect)(d.audit.detail).toContain("denied");
    });
});
