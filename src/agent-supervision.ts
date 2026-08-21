/**
 * Phase 12: Agent 自监督层 (P3)
 *
 * 运行项目测试并提取失败信息 —— 失败注入下一次尝试的 prompt（失败→prompt 回路）。
 * 设计文档 P3：编译/测试失败反馈注入重试。
 *
 * 自动探测顺序：
 *   1. package.json 有 "test" script → npm test --silent
 *   2. 存在 .py 文件 → python3 -m pytest -q
 *   3. 都没有 → { ran: false }（调用方跳过该门）
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── Types ──

export interface TestRunResult {
  /** 是否真正运行了测试（无测试脚本时为 false，调用方应跳过而非判失败） */
  ran: boolean;
  pass: boolean;
  /** 失败摘要行（截断到前 10 条，注入 prompt 用） */
  failures: string[];
  /** 实际执行的命令 */
  command: string;
  error?: string;
}

// ── Helpers ──

const FAILURE_PATTERN = /(FAIL|✕|×|failed|Error:|error TS|AssertionError|FAILED)/i;

function extractFailures(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && FAILURE_PATTERN.test(l))
    .slice(0, 10);
}

function runCommand(cwd: string, command: string, timeoutMs: number): { pass: boolean; output: string; error?: string } {
  try {
    const output = execSync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { pass: true, output };
  } catch (e: any) {
    // 非零退出或超时 → 捕获输出
    const output = `${e.stdout || ""}\n${e.stderr || ""}`;
    return { pass: false, output, error: e?.message || String(e) };
  }
}

// ── Main ──

/**
 * 自动探测并运行项目测试。
 *
 * @requires PROJECT_PATH @produces TEST_RESULT
 */
export function runProjectTests(projectPath: string, timeoutMs: number = 60_000): TestRunResult {
  // 1) npm test
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.test) {
        const command = "npm test --silent";
        const r = runCommand(projectPath, command, timeoutMs);
        return {
          ran: true,
          pass: r.pass,
          failures: extractFailures(r.output),
          command,
          error: r.error,
        };
      }
    } catch { /* package.json 解析失败 → 继续探测 */ }
  }

  // 2) pytest
  const hasPy = listQuickly(projectPath, (e) => e.endsWith(".py"));
  if (hasPy) {
    const command = "python3 -m pytest -q";
    const r = runCommand(projectPath, command, timeoutMs);
    if (r.error && /no module named pytest/i.test(r.error + r.output)) {
      return { ran: false, pass: true, failures: [], command, error: "pytest 未安装" };
    }
    return {
      ran: true,
      pass: r.pass,
      failures: extractFailures(r.output),
      command,
      error: r.error,
    };
  }

  return { ran: false, pass: true, failures: [], command: "(无测试脚本)" };
}

/** 浅层探测是否存在匹配文件（不递归依赖目录）。 */
function listQuickly(projectPath: string, match: (name: string) => boolean): boolean {
  const SKIP = new Set(["node_modules", "dist", "build", ".git", "__pycache__", "venv", ".venv"]);
  const stack = [projectPath];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const dir = stack.pop()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && match(e.name)) return true;
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")) stack.push(path.join(dir, e.name));
    }
  }
  return false;
}
