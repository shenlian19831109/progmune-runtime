/**
 * Phase 12: 自监督层测试 (P3)
 *
 * runProjectTests 的探测逻辑与失败提取。全部 mock，不跑真实测试。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "child_process";
import { runProjectTests } from "./agent-supervision";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agent-supervision", () => {
  it("package.json 有 test script → npm test，失败时提取失败行", () => {
    mockExecSync.mockImplementation(() => {
      const err: any = new Error("Command failed");
      err.stdout = "FAIL src/auth.test.ts\nAssertionError: token 无效\n  12 passing\n  1 failing\n";
      err.stderr = "";
      throw err;
    });

    // 真实 npm 项目路径下才能探测到 package.json —— 用临时脚本验证探测逻辑
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-test-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));

    const r = runProjectTests(dir, 5000);

    expect(r.ran).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures.join(" ")).toContain("token 无效");
    expect(r.command).toBe("npm test --silent");
  });

  it("测试通过时 pass=true 且 failures 为空", () => {
    mockExecSync.mockReturnValue(" 12 passing (3s)");

    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-test2-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));

    const r = runProjectTests(dir, 5000);

    expect(r.ran).toBe(true);
    expect(r.pass).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("无测试脚本且无 python 文件 → ran=false（调用方跳过该门）", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-test3-"));

    const r = runProjectTests(dir, 5000);

    expect(r.ran).toBe(false);
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
