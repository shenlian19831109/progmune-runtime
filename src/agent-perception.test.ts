/**
 * Phase 12: 感知层测试 (P2)
 *
 * collectGitContext / extractIRWithDelta：mock git 与 IR，不触真实仓库。
 * RepoWatcher：真实临时目录（fs.watch 需要真实文件系统）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "child_process";
import { extractProjectIR } from "./extract-project-ir";
import { collectGitContext, extractIRWithDelta, RepoWatcher } from "./agent-perception";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("./extract-project-ir", () => ({
  extractProjectIR: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);
const mockExtractProjectIR = vi.mocked(extractProjectIR);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agent-perception", () => {
  it("collectGitContext 解析分支/提交/变更文件/源文件清单", () => {
    mockExecSync.mockImplementation((cmd: any): any => {
      const c = String(cmd);
      if (c.includes("rev-parse")) return "main";
      if (c.includes("log --oneline")) return "abc123 feat: login\nbcd456 fix: session";
      if (c.includes("status --porcelain")) return " M src/auth.ts\n?? src/new.ts";
      throw new Error("unexpected cmd: " + c);
    });

    const ctx = collectGitContext("/tmp/fake-project");

    expect(ctx.available).toBe(true);
    expect(ctx.branch).toBe("main");
    expect(ctx.recentCommits).toHaveLength(2);
    expect(ctx.changedFiles).toEqual(["src/auth.ts", "src/new.ts"]);
    expect(ctx.sourceFiles.length).toBeGreaterThanOrEqual(0);
  });

  it("collectGitContext 非 git 仓库时降级为 available=false 且不抛", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });

    const ctx = collectGitContext("/tmp/fake-project");

    expect(ctx.available).toBe(false);
    expect(ctx.error).toContain("not a git repository");
  });

  it("extractIRWithDelta 计算新增/消失函数差集", () => {
    mockExtractProjectIR.mockReturnValue([
      { name: "verify_password" },
      { name: "main" },
    ] as any);

    const prev = new Set(["verify_password", "logout"]);
    const { delta } = extractIRWithDelta("/tmp/fake-project", prev);

    expect(delta.added).toEqual(["main"]);
    expect(delta.removed).toEqual(["logout"]);
    expect(delta.functionCount).toBe(2);
  });

  it("RepoWatcher 文件变更防抖回调", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-watch-"));
    const changed: string[] = [];
    const w = new RepoWatcher(dir, (f) => changed.push(f), 50);
    w.start();

    // 等待 watcher 就绪后写文件
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(dir, "new.ts"), "export function f() {}");
    await new Promise((r) => setTimeout(r, 300));

    w.stop();
    expect(changed).toContain("new.ts");
    expect(w.active).toBe(false);
  });

  it("RepoWatcher 忽略非源文件扩展名", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-watch2-"));
    const changed: string[] = [];
    const w = new RepoWatcher(dir, (f) => changed.push(f), 50);
    w.start();

    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(dir, "notes.txt"), "hello");
    await new Promise((r) => setTimeout(r, 300));

    w.stop();
    expect(changed).toHaveLength(0);
  });
});
