/**
 * Progmune Check — 一键代码库免疫状态巡检
 *
 * Usage: npm run check
 *
 * 检查项目：
 *  1. IR 重新提取（确保与当前代码同步）
 *  2. TypeScript 编译（零类型错误）
 *  3. SSG dev_pipeline 协议验证
 *  4. 各命名空间状态快照
 *  5. 失败基因组概要
 *  6. 抗体效能统计
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  StateMachineValidator,
  FunctionProtocol,
  parseProtocolsFromJSON,
  StateMachineValidator as SSV,
} from "./ssg-validator";
import { getFailureGenome, getAntibodyStats } from "./failure-corpus";

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};
const G = (s: string) => `${C.green}${s}${C.reset}`;
const R = (s: string) => `${C.red}${s}${C.reset}`;
const Y = (s: string) => `${C.yellow}${s}${C.reset}`;
const C_ = (s: string) => `${C.cyan}${s}${C.reset}`;
const D = (s: string) => `${C.gray}${s}${C.reset}`;
const B = (s: string) => `${C.bold}${s}${C.reset}`;

let failures = 0;
let warnings = 0;

function step(label: string): void {
  console.log(`\n${B("━━━")} ${B(label)} ${"━".repeat(Math.max(2, 60 - label.length))}`);
}

function pass(msg: string): void {
  console.log(`  ${G("✔")}  ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ${R("✖")}  ${msg}`);
  failures++;
}

function warn(msg: string): void {
  console.log(`  ${Y("!")}  ${msg}`);
  warnings++;
}

// ── 1. IR 提取 ──
step("1/5 IR 提取");
try {
  execSync("npx ts-node src/extract-ir.ts .", { stdio: "pipe", cwd: path.resolve(__dirname, "..") });
  const ir = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../ir.json"), "utf-8"));
  const externalCount = ir.filter((f: any) => f.external).length;
  pass(`IR 提取完成: ${ir.length} 个函数 (${externalCount} 外部)`);
} catch (e: any) {
  fail(`IR 提取失败: ${e.message}`);
}

// ── 2. TypeScript 编译 ──
step("2/5 TypeScript 类型检查");
try {
  execSync("npx tsc --noEmit", { stdio: "pipe", cwd: path.resolve(__dirname, "..") });
  pass("零类型错误");
} catch (e: any) {
  const stderr = e.stderr?.toString() || e.stdout?.toString() || "";
  const lines = stderr.split("\n").filter((l: string) => l.includes("error TS"));
  if (lines.length > 0) {
    fail(`${lines.length} 个类型错误`);
    lines.slice(0, 5).forEach((l: string) => console.log(`    ${D(l.trim())}`));
    if (lines.length > 5) console.log(`    ${D(`... 及其他 ${lines.length - 5} 个错误`)}`);
  } else {
    fail(`编译失败`);
  }
}

// ── 3. SSG 协议验证 ──
step("3/5 SSG 协议验证");
const protoPath = path.resolve(__dirname, "../protocols.json");
if (!fs.existsSync(protoPath)) {
  fail("protocols.json 不存在");
} else {
  const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
  const protocols = parseProtocolsFromJSON(protoDef);
  pass(`已加载 ${protocols.length} 条协议规则`);

  // 检查命名空间
  const namespaces = new Set(protocols.map((p) => p.protocol.namespace || "_global"));
  console.log(`     ${D("命名空间:")} ${[...namespaces].map(n => C_(n)).join(", ")}`);

  // dev_pipeline 验证
  const nsStates = new Map<string, string>();
  nsStates.set("_global", "UNAUTHENTICATED");
  if (protoDef.namespaceInitialStates) {
    for (const [ns, s] of Object.entries(protoDef.namespaceInitialStates)) {
      nsStates.set(ns, s as string);
    }
  }

  const ssv = new StateMachineValidator(protocols, nsStates.get("_global") || "INIT", nsStates);
  const devSeq = [
    { fn: "extractIR", name: "IR 提取" },
    { fn: "validateAction", name: "动作校验" },
    { fn: "validateActionSequence", name: "序列校验" },
    { fn: "emitCode", name: "代码生成" },
    { fn: "recordSession", name: "会话记录" },
  ];

  let pipelineOk = true;
  for (const { fn, name } of devSeq) {
    const result = ssv.apply(fn);
    if (result.valid) {
      const gained = result.acquired.length ? G("+" + result.acquired.join(",+")) : "";
      const lost = result.invalidated.length ? R("-" + result.invalidated.join(",-")) : "";
      console.log(`  ${G("✅")} ${fn.padEnd(25)} ${[gained, lost].filter(Boolean).join(" ") || D("(no delta)")}`);
    } else {
      const missing = result.rejection?.missingFunctions.join(" → ") || "?";
      console.log(`  ${R("🚫")} ${fn.padEnd(25)} ${R("需 " + missing)}`);
      pipelineOk = false;
    }
  }

  if (pipelineOk) {
    pass("dev_pipeline 协议全部通过");
  } else {
    fail("dev_pipeline 协议存在违规");
  }

  // Per-namespace 状态
  const snap = ssv.snapshotNamespaceStates();
  console.log(`\n  ${B("命名空间状态快照:")}`);
  for (const [ns, states] of Object.entries(snap).sort()) {
    const statesStr = states.length > 0 ? states.map(s => C_(s)).join(", ") : D("(empty)");
    console.log(`    ${C_(ns.padEnd(20))} ${statesStr}`);
  }
}

// ── 4. 失败基因组 ──
step("4/5 失败基因组");
const genome = getFailureGenome();
if (genome.totalFailures === 0) {
  pass("零失败记录");
} else {
  warn(`${genome.totalFailures} 次违规记录`);
  console.log(`     SVL-1: ${genome.bySVL["SVL-1"]}  |  SVL-2: ${genome.bySVL["SVL-2"]}  |  SVL-3: ${genome.bySVL["SVL-3"]}  |  SVL-4: ${genome.bySVL["SVL-4"]}`);
  console.log(`     ${D("平均重试:")} ${genome.averageRetriesToSuccess}`);

  if (genome.commonFixPaths.length > 0) {
    const top = genome.commonFixPaths[0];
    console.log(`     ${D("最常用修复:")} ${Y(top.fixPath.join(" → "))} (${top.count}x)`);
  }
}

// ── 5. 抗体效能 ──
step("5/5 抗体效能");
const abStats = getAntibodyStats();
if (abStats.totalHits === 0) {
  pass("暂无抗体命中（需要更多会话积累）");
} else {
  const pct = Math.round((abStats.fastPathHits / abStats.totalHits) * 100);
  pass(`${abStats.totalHits} 次命中 | ${abStats.fastPathHits} 快速通道 | ${abStats.totalLLMCallsSaved} 次 LLM 节省 | ${abStats.totalTokensSaved} tokens 节省`);
  console.log(`     ${D("免疫效率:")} ${G(pct + "%")} ${D("绕过 LLM")}`);
}

// ── 总结 ──
console.log(`\n${"═".repeat(66)}`);
if (failures === 0 && warnings === 0) {
  console.log(`  ${G("✦")}  ${B("免疫状态: 健康")}  — 所有检查通过，SSG 协议正常，零类型错误。`);
} else if (failures === 0) {
  console.log(`  ${Y("◇")}  ${B("免疫状态: 正常")}  — ${warnings} 个提示，无阻塞性问题。`);
} else {
  console.log(`  ${R("✖")}  ${B("免疫状态: 需要关注")}  — ${failures} 个失败, ${warnings} 个警告。`);
}
console.log(`${"═".repeat(66)}\n`);

process.exit(failures > 0 ? 1 : 0);
