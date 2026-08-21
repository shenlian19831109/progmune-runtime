/**
 * Phase 12: Progmune Agent CLI — `progmune agent "意图"`
 *
 * P1 最小 agent loop 的命令行入口。免疫门在环内：意图 → 目标分解 →
 * execute()（plan→8门验证→SSG修复→emit→写盘+指纹）→ 编译/指纹验证门 →
 * 失败反馈重试 → 带指纹 diff 输出。
 *
 * Usage:
 *   npx ts-node src/agent-cli.ts "实现 XX" [options]
 *   npm run agent -- "实现 XX" [options]     (构建后)
 *
 * Options:
 *   --file <path>       输出文件（相对 project 目录）
 *   --project <dir>     目标项目目录（默认 CWD）
 *   --iterations <n>    最大迭代轮数（默认 5）
 *   --retries <n>       每轮最大重试（默认 3）
 *   --timeout <ms>      单次执行超时毫秒（默认 120000）
 *   --context           注入 git 仓库上下文（默认开启）
 *   --no-context        关闭 git 上下文注入
 *   --test              编译/指纹通过后追加项目测试门（shell 执行需审批）
 *   --yes               预批准审批门（配合 --test；无此参数时交互确认）
 *   --json              JSON 输出
 *   --help, -h          显示帮助
 */

import * as path from "path";
import { runAgentLoop } from "./agent-loop";
import type { AgentLoopResult } from "./agent-loop";

const args = process.argv.slice(2);

// ── Help ──

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Progmune Agent — 免疫门在环内的自主实现循环 (P1)

Usage:
  npx ts-node src/agent-cli.ts "实现 XX" [options]
  npm run agent -- "实现 XX" [options]

Options:
  --file <path>       输出文件（相对 project 目录）
  --project <dir>     目标项目目录（默认当前目录）
  --iterations <n>    最大迭代轮数（默认 5）
  --retries <n>       每轮最大重试（默认 3）
  --timeout <ms>      单次执行超时毫秒（默认 120000）
  --context           注入 git 仓库上下文（默认开启）
  --no-context        关闭 git 上下文注入
  --test              编译/指纹通过后追加项目测试门
  --json              JSON 输出
  --help, -h          显示帮助

Example:
  npm run agent -- "实现会话刷新函数" --project demo-project --file refresh_session.ts
`);
  process.exit(0);
}

// ── Arg parsing ──

function parseArgs(argv: string[]): {
  intent: string;
  file?: string;
  project: string;
  iterations: number;
  retries: number;
  timeout: number;
  context: boolean;
  test: boolean;
  yes: boolean;
  json: boolean;
} {
  const intentParts: string[] = [];
  let file: string | undefined;
  let project = process.cwd();
  let iterations = 5;
  let retries = 3;
  let timeout = 120_000;
  let context = true;
  let test = false;
  let yes = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") { file = argv[++i]; }
    else if (a === "--project") { project = argv[++i]; }
    else if (a === "--iterations") { iterations = parseInt(argv[++i], 10) || 5; }
    else if (a === "--retries") { retries = parseInt(argv[++i], 10) || 3; }
    else if (a === "--timeout") { timeout = parseInt(argv[++i], 10) || 120_000; }
    else if (a === "--context") { context = true; }
    else if (a === "--no-context") { context = false; }
    else if (a === "--test") { test = true; }
    else if (a === "--yes") { yes = true; }
    else if (a === "--json") { json = true; }
    else { intentParts.push(a); }
  }

  const intent = intentParts.join(" ").trim();
  if (!intent) {
    console.error("❌ 缺少意图参数。用法: progmune agent \"实现 XX\" [--file path] [--project dir]");
    process.exit(2);
  }
  return { intent, file, project, iterations, retries, timeout, context, test, yes, json };
}

// ── Formatting ──

function printAttempt(i: number, r: AgentLoopResult): void {
  const a = r.attempts[i];
  const mark = a.success ? "✅" : "❌";
  const testGate = a.testRan ? ` test=${a.testPass ? "pass" : "FAIL"}` : "";
  const gates = a.success
    ? `compile=${a.compilePass} marker=${a.markerPass}${testGate}`
    : `compile=${a.compilePass} marker=${a.markerPass}${testGate}${a.error ? ` err=${a.error.slice(0, 80)}` : ""}`;
  console.log(
    `[#${a.attempt}] iter ${a.iteration} retry ${a.attempt - 1 - (a.iteration - 1) * 3} ${mark} ` +
    `session=${a.sessionId || "-"} fp=${a.fingerprint || "-"} repair=${a.repairCount} ${gates}`,
  );
}

function printResult(r: AgentLoopResult, opts: { intent: string; file?: string }): void {
  console.log("");
  if (r.success) {
    console.log(`✅ 完成: intent="${opts.intent}"`);
    if (r.filePath) console.log(`   文件: ${r.filePath}`);
    console.log(`   指纹: ${r.fingerprint}`);
    console.log(`   迭代: ${r.iterations} 轮 / 重试: ${r.retries} 次${r.degraded ? " / ⚠️ 降级（LLM 回退）" : ""}`);
    if (r.irDelta) {
      console.log(`   IR 增量: +${r.irDelta.added.length} -${r.irDelta.removed.length}` +
        (r.irDelta.added.length > 0 ? ` 新增: ${r.irDelta.added.join(", ")}` : ""));
    }
    console.log(`   审计事件: ${r.auditTrail.length} 条（含 ${r.attempts.length} 次尝试记录）`);
    console.log("");
    console.log("── diff ──");
    console.log(r.diff.slice(0, 2000) || "(空)");
  } else {
    console.log(`❌ 失败: intent="${opts.intent}" 共 ${r.attempts.length} 次尝试`);
    console.log(`   最后错误: ${r.attempts[r.attempts.length - 1]?.error || "迭代耗尽"}`);
    console.log(`   审计轨迹 ${r.auditTrail.length} 条事件（可回放）`);
  }
}

// ── Main ──

async function main(): Promise<void> {
  const opts = parseArgs(args);
  const projectPath = path.resolve(opts.project);

  // 切到项目目录：execute 写 ir.json 到 CWD，verifyCompiles 跑项目 tsconfig，
  // git diff 也相对项目。dotenv/.env 在模块加载时已按启动 CWD 读取。
  process.chdir(projectPath);

  console.log(`⚙️  Progmune Agent (P2+P3) — 免疫门在环内`);
  console.log(`   意图: ${opts.intent}`);
  console.log(`   项目: ${projectPath}`);
  console.log(`   输出: ${opts.file ? path.resolve(opts.file) : "(未指定)"}`);
  console.log(`   感知: git上下文=${opts.context ? "开" : "关"} 测试门=${opts.test ? "开" : "关"}`);
  console.log("");

  const result = await runAgentLoop({
    projectPath,
    intent: opts.intent,
    filePath: opts.file,
    maxIterations: opts.iterations,
    maxRetries: opts.retries,
    timeoutMs: opts.timeout,
    includeContext: opts.context,
    runTests: opts.test,
    approveExec: opts.yes,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`   目标分解: ${result.subgoals.length > 0 ? result.subgoals.join(" → ") : "无模板命中"}`);
    result.attempts.forEach((_, i) => printAttempt(i, result));
    printResult(result, { intent: opts.intent, file: opts.file });
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((e) => {
  console.error(`❌ Agent CLI 异常: ${e?.message || e}`);
  process.exit(1);
});
