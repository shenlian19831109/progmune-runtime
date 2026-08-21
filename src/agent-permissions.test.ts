/**
 * Phase 12: 操作级安全层测试 (P5 v1)
 *
 * 预设判定 / FsSandbox 白名单 / 审批门 / deny 默认——全部纯函数，不触真实 FS。
 */

import { describe, it, expect, vi } from "vitest";
import {
  decidePermission,
  checkSandboxWrite,
  PRESET_PATROL,
  PRESET_AGENT,
} from "./agent-permissions";

describe("agent-permissions", () => {
  it("auto 操作直接允许（读、agent 写）", () => {
    const read = decidePermission("patrol", { level: "read", target: "src/auth.ts", projectPath: "/p" });
    expect(read.allowed).toBe(true);
    expect(read.audit.event).toBe("permission:auto");

    // agent 预设：写 = auto（安全由 execute 验证门保证）
    const write = decidePermission("agent", { level: "write", target: "out.ts", projectPath: "/p" });
    expect(write.allowed).toBe(true);
  });

  it("sandbox 写：白名单内项目文件允许，越界或非白名单拒绝", () => {
    const ok = checkSandboxWrite({
      level: "write",
      target: "/p/.progmune_patrol_report.md",
      projectPath: "/p",
    });
    expect(ok.allowed).toBe(true);

    const outside = checkSandboxWrite({
      level: "write",
      target: "/etc/passwd",
      projectPath: "/p",
    });
    expect(outside.allowed).toBe(false);
    expect(outside.detail).toContain("拒绝");

    const notWhitelisted = checkSandboxWrite({
      level: "write",
      target: "/p/src/auth.ts",
      projectPath: "/p",
    });
    expect(notWhitelisted.allowed).toBe(false);
  });

  it("审批门：preApproved 或 confirmFn 同意才放行", () => {
    const denied = decidePermission("agent", { level: "exec", target: "npm test", projectPath: "/p" });
    expect(denied.allowed).toBe(false);
    expect(denied.audit.event).toBe("permission:approve");

    const approved = decidePermission("agent", {
      level: "exec", target: "npm test", projectPath: "/p", preApproved: true,
    });
    expect(approved.allowed).toBe(true);

    const confirmed = decidePermission(
      "agent",
      { level: "exec", target: "npm test", projectPath: "/p" },
      () => true,
    );
    expect(confirmed.allowed).toBe(true);

    const rejected = decidePermission(
      "agent",
      { level: "exec", target: "npm test", projectPath: "/p" },
      () => false,
    );
    expect(rejected.allowed).toBe(false);
  });

  it("deny 默认：巡逻 exec/commit 与 agent commit 一律拒绝（修复信任悖论）", () => {
    expect(decidePermission("patrol", { level: "exec", target: "tsc", projectPath: "/p" }).allowed).toBe(false);
    expect(decidePermission("patrol", { level: "commit", target: "git commit", projectPath: "/p" }).allowed).toBe(false);
    expect(decidePermission("agent", { level: "commit", target: "git commit", projectPath: "/p" }).allowed).toBe(false);
    // 即使 --yes 也不能绕过 deny
    expect(decidePermission("agent", {
      level: "commit", target: "git commit", projectPath: "/p", preApproved: true,
    }).allowed).toBe(false);
  });

  it("预设表结构完整（四种级别齐全）", () => {
    const levels = ["read", "write", "exec", "commit"];
    for (const l of levels) {
      expect(PRESET_PATROL[l as keyof typeof PRESET_PATROL]).toBeDefined();
      expect(PRESET_AGENT[l as keyof typeof PRESET_AGENT]).toBeDefined();
    }
    // 修复信任悖论：两个预设的 commit 都不可自动放行
    expect(PRESET_PATROL.commit).toBe("deny");
    expect(PRESET_AGENT.commit).toBe("deny");
  });

  it("审批未通过时审计事件带 denied 标记", () => {
    const d = decidePermission("agent", { level: "exec", target: "pytest", projectPath: "/p" });
    expect(d.audit.detail).toContain("denied");
  });
});
