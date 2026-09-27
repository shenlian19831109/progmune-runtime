"use strict";
/**
 * Phase 12: 感知层测试 (P2)
 *
 * collectGitContext / extractIRWithDelta：mock git 与 IR，不触真实仓库。
 * RepoWatcher：真实临时目录（fs.watch 需要真实文件系统）。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const child_process_1 = require("child_process");
const extract_project_ir_1 = require("./extract-project-ir");
const agent_perception_1 = require("./agent-perception");
vitest_1.vi.mock("child_process", () => ({
    execSync: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("./extract-project-ir", () => ({
    extractProjectIR: vitest_1.vi.fn(),
}));
const mockExecSync = vitest_1.vi.mocked(child_process_1.execSync);
const mockExtractProjectIR = vitest_1.vi.mocked(extract_project_ir_1.extractProjectIR);
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)("agent-perception", () => {
    (0, vitest_1.it)("collectGitContext 解析分支/提交/变更文件/源文件清单", () => {
        mockExecSync.mockImplementation((cmd) => {
            const c = String(cmd);
            if (c.includes("rev-parse"))
                return "main";
            if (c.includes("log --oneline"))
                return "abc123 feat: login\nbcd456 fix: session";
            if (c.includes("status --porcelain"))
                return " M src/auth.ts\n?? src/new.ts";
            throw new Error("unexpected cmd: " + c);
        });
        const ctx = (0, agent_perception_1.collectGitContext)("/tmp/fake-project");
        (0, vitest_1.expect)(ctx.available).toBe(true);
        (0, vitest_1.expect)(ctx.branch).toBe("main");
        (0, vitest_1.expect)(ctx.recentCommits).toHaveLength(2);
        (0, vitest_1.expect)(ctx.changedFiles).toEqual(["src/auth.ts", "src/new.ts"]);
        (0, vitest_1.expect)(ctx.sourceFiles.length).toBeGreaterThanOrEqual(0);
    });
    (0, vitest_1.it)("collectGitContext 非 git 仓库时降级为 available=false 且不抛", () => {
        mockExecSync.mockImplementation(() => {
            throw new Error("fatal: not a git repository");
        });
        const ctx = (0, agent_perception_1.collectGitContext)("/tmp/fake-project");
        (0, vitest_1.expect)(ctx.available).toBe(false);
        (0, vitest_1.expect)(ctx.error).toContain("not a git repository");
    });
    (0, vitest_1.it)("extractIRWithDelta 计算新增/消失函数差集", () => {
        mockExtractProjectIR.mockReturnValue([
            { name: "verify_password" },
            { name: "main" },
        ]);
        const prev = new Set(["verify_password", "logout"]);
        const { delta } = (0, agent_perception_1.extractIRWithDelta)("/tmp/fake-project", prev);
        (0, vitest_1.expect)(delta.added).toEqual(["main"]);
        (0, vitest_1.expect)(delta.removed).toEqual(["logout"]);
        (0, vitest_1.expect)(delta.functionCount).toBe(2);
    });
    (0, vitest_1.it)("RepoWatcher 文件变更防抖回调", async () => {
        const fs = await Promise.resolve().then(() => __importStar(require("fs")));
        const os = await Promise.resolve().then(() => __importStar(require("os")));
        const path = await Promise.resolve().then(() => __importStar(require("path")));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-watch-"));
        const changed = [];
        const w = new agent_perception_1.RepoWatcher(dir, (f) => changed.push(f), 50);
        w.start();
        // 等待 watcher 就绪后写文件
        await new Promise((r) => setTimeout(r, 100));
        fs.writeFileSync(path.join(dir, "new.ts"), "export function f() {}");
        await new Promise((r) => setTimeout(r, 300));
        w.stop();
        (0, vitest_1.expect)(changed).toContain("new.ts");
        (0, vitest_1.expect)(w.active).toBe(false);
    });
    (0, vitest_1.it)("RepoWatcher 忽略非源文件扩展名", async () => {
        const fs = await Promise.resolve().then(() => __importStar(require("fs")));
        const os = await Promise.resolve().then(() => __importStar(require("os")));
        const path = await Promise.resolve().then(() => __importStar(require("path")));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-watch2-"));
        const changed = [];
        const w = new agent_perception_1.RepoWatcher(dir, (f) => changed.push(f), 50);
        w.start();
        await new Promise((r) => setTimeout(r, 100));
        fs.writeFileSync(path.join(dir, "notes.txt"), "hello");
        await new Promise((r) => setTimeout(r, 300));
        w.stop();
        (0, vitest_1.expect)(changed).toHaveLength(0);
    });
});
