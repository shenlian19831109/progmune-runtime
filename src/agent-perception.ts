/**
 * Phase 12: Agent 感知层 (P2)
 *
 * 为 agent loop 提供"看清世界"的能力（设计文档 P2）：
 *   - GitContext     — 仓库扫描 + git 上下文（分支/最近提交/变更文件/源文件清单）
 *   - extractIRWithDelta — IR 提取 + 前后函数名差集（IR 增量重提的观测面）
 *   - RepoWatcher    — 文件变更监听（fs.watch + 防抖）→ 触发 IR 重提回调
 *
 * 原则：感知失败不阻塞主循环（best-effort，明确记录 unavailable）。
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { extractProjectIR } from "./extract-project-ir";

// ── Types ──

export interface GitContext {
  available: boolean;
  branch: string;
  recentCommits: string[];
  changedFiles: string[];
  /** 项目源文件清单（.ts/.js/.py，跳过 node_modules/dist/.git/.progmune*） */
  sourceFiles: string[];
  error?: string;
}

export interface IRDelta {
  /** 相比上次提取新增的函数 */
  added: string[];
  /** 相比上次提取消失的函数 */
  removed: string[];
  functionCount: number;
}

// ── Git Context ──

function git(projectPath: string, args: string): string {
  return execSync(`git -C "${projectPath}" ${args}`, {
    encoding: "utf-8",
    timeout: 10000,
    stdio: "pipe",
  });
}

/** 收集仓库上下文（分支、最近提交、变更文件）与源文件清单。best-effort。 */
export function collectGitContext(projectPath: string): GitContext {
  try {
    const branch = git(projectPath, "rev-parse --abbrev-ref HEAD").trim();
    const recentCommits = git(projectPath, "log --oneline -5")
      .split("\n").filter(Boolean);
    // porcelain 输出首字符可能是空格（未暂存），必须整串不 trim 才能保住 3 字符状态列
    const changedFiles = git(projectPath, "status --porcelain")
      .split("\n").filter(Boolean).map((l) => l.slice(3).trim());
    const sourceFiles = listSourceFiles(projectPath);
    return { available: true, branch, recentCommits, changedFiles, sourceFiles };
  } catch (e: any) {
    // 非 git 仓库等 → 只给源文件清单
    try {
      return {
        available: false,
        branch: "",
        recentCommits: [],
        changedFiles: [],
        sourceFiles: listSourceFiles(projectPath),
        error: e?.message || String(e),
      };
    } catch {
      return { available: false, branch: "", recentCommits: [], changedFiles: [], sourceFiles: [], error: e?.message || String(e) };
    }
  }
}

/** 浅层扫描项目源文件（不递归进依赖目录）。 */
function listSourceFiles(projectPath: string): string[] {
  const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".progmune_corpus", "__pycache__", "venv", ".venv"]);
  const EXTS = new Set([".ts", ".js", ".py", ".tsx", ".jsx"]);
  const out: string[] = [];
  const stack = [projectPath];
  const seen = new Set<string>();
  while (stack.length > 0 && out.length < 500) {
    const dir = stack.pop()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(full);
      } else if (EXTS.has(path.extname(e.name))) {
        out.push(path.relative(projectPath, full));
      }
    }
  }
  return out.sort();
}

// ── IR 增量 ──

/**
 * 提取 IR 并计算与上次函数名集合的差集。
 * prevNames 缺省时只返回全量 IR（delta 为空）。
 */
export function extractIRWithDelta(
  projectPath: string,
  prevNames?: Set<string>,
): { ir: any[]; delta: IRDelta } {
  const ir = extractProjectIR(projectPath);
  const names = ir.map((f: any) => String(f.name || "")).filter(Boolean);
  if (!prevNames) {
    return { ir, delta: { added: [], removed: [], functionCount: names.length } };
  }
  const cur = new Set(names);
  const added = names.filter((n) => !prevNames.has(n));
  const removed = [...prevNames].filter((n) => !cur.has(n));
  return { ir, delta: { added, removed, functionCount: names.length } };
}

// ── Repo Watcher ──

const WATCH_EXTS = new Set([".ts", ".js", ".py", ".tsx", ".jsx"]);

/**
 * 文件变更监听器：fs.watch 递归监听项目目录，按文件防抖后回调。
 * 用途：agent 或用户修改文件后触发 IR 增量重提（IR_STALE 消费方）。
 */
export class RepoWatcher {
  private watcher: fs.FSWatcher | null = null;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly projectPath: string,
    private readonly onChange: (file: string) => void,
    private readonly debounceMs: number = 500,
  ) {}

  start(): void {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.projectPath, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const ext = path.extname(String(filename));
        if (!WATCH_EXTS.has(ext)) return;
        const rel = path.relative(this.projectPath, path.join(this.projectPath, String(filename)));
        // 防抖：同一文件的连续事件合并
        const prev = this.timers.get(rel);
        if (prev) clearTimeout(prev);
        this.timers.set(rel, setTimeout(() => {
          this.timers.delete(rel);
          try { this.onChange(rel); } catch { /* 回调异常不杀死 watcher */ }
        }, this.debounceMs));
      });
      this.watcher.on("error", () => { /* watcher 错误静默，best-effort */ });
    } catch {
      this.watcher = null; // recursive 不支持时降级为不可用
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.watcher) { try { this.watcher.close(); } catch { /* ignore */ } this.watcher = null; }
  }

  get active(): boolean {
    return this.watcher !== null;
  }
}
