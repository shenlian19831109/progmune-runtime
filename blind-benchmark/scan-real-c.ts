/**
 * Blind Benchmark — Real C Application Scan v1
 *
 * 用生产管线（extractIRC → buildCallSequences → validateSequenceWithSSG，
 * 词段门控开，无 LLM）扫描真实 C 仓库（libssh / redis / nginx——应用级
 * 协议密集的 vendored 语料），逐条人工标注 TP/FP，测量真实项目误报率。
 *
 * 目标（用户复盘既定原则）：先观察真实项目的误报率，特别是词段匹配
 * （Strategy 2）触发占比，再决定是否引入引擎级改动。
 *
 * 每条 flag 按匹配策略分类：
 *   exact        — 调用名与规则名完全一致
 *   word-segment — 规则词全部出现在调用名词段中（Strategy 2，门控后仅项目函数）
 *   keyword      — domain 关键词桥接（Strategy 3）
 *   endState     — 序列末尾资源未释放
 *
 * Usage: npx ts-node blind-benchmark/scan-real-c.ts [repoDir...]
 * 默认: benchmarks/libssh benchmarks/redis benchmarks/nginx
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRC } from "../src/extract-ir-c";
import { validateSequenceWithSSG } from "../src/trust/ssg-bridge";
import { buildCallSequences, collectProjectFunctionNames } from "../src/call-sequence";
import type { StateAnnotation } from "../src/ssg-validator";

export const REAL_C_REPORT_PATH = path.resolve(__dirname, "reports", "scan-real-c-results.json");
const BUILTIN_PROTOCOLS = path.resolve(__dirname, "..", "protocols.json");
const DEFAULT_REPOS = ["libssh", "redis", "nginx", "openssl"];

// ═══════════════════════════════════════════════════════════════
// 规则装载（内置 protocols.json；基准仓库无项目注解）
// ═══════════════════════════════════════════════════════════════

function loadBuiltinRules(): { rules: Map<string, StateAnnotation>; nsInit: Record<string, string> } {
  const def = JSON.parse(fs.readFileSync(BUILTIN_PROTOCOLS, "utf-8"));
  const rules = new Map<string, StateAnnotation>();
  for (const [name, r] of Object.entries(def.rules as Record<string, any>)) {
    rules.set(name, {
      pre_states: r.pre_states || [],
      post_states: r.post_states || [],
      invalidate: r.invalidate,
      namespace: r.namespace,
      aliases: r.aliases,
    });
  }
  const nsInit: Record<string, string> = { ...(def.namespaceInitialStates || {}) };
  nsInit._global = nsInit._global || "INIT";
  nsInit.stateless = nsInit.stateless || "IDLE";
  return { rules, nsInit };
}

// ═══════════════════════════════════════════════════════════════
// 扫描
// ═══════════════════════════════════════════════════════════════

export interface RealCFlag {
  file: string;
  function: string;
  callName: string;
  matchedRule?: string;
  strategy: "exact" | "word-segment" | "keyword" | "endState";
  currentState: string[];
  requiredState: string[];
  reason: string;
  /** 人工标注（默认为 null，标注后写入报告） */
  verdict?: "TP" | "FP" | "borderline";
  note?: string;
}

/** 匹配策略分类：exact → word-segment（词段全含）→ keyword（其余） */
function classifyStrategy(callName: string, matchedRule?: string): RealCFlag["strategy"] {
  if (!matchedRule || callName === "(end-of-sequence)") return "endState";
  if (callName.toLowerCase() === matchedRule) return "exact";
  const ruleWords = matchedRule.split("_");
  const callWords = callName.toLowerCase().split("_");
  if (ruleWords.length >= 2 && ruleWords.every((w) => callWords.includes(w))) return "word-segment";
  return "keyword";
}

export function scanRealRepo(repoDir: string): { repo: string; flags: RealCFlag[]; sequences: number; functions: number } {
  const { rules, nsInit } = loadBuiltinRules();
  const ir = extractIRC(repoDir);
  const sequences = buildCallSequences(ir, new Set(rules.keys()));
  const projectFunctions = collectProjectFunctionNames(ir);
  const flags: RealCFlag[] = [];

  for (const seq of sequences) {
    const steps = seq.calls.map((c) => ({ api: c, description: "" })) as any[];
    const result = validateSequenceWithSSG(steps, rules, nsInit, seq.file, undefined, undefined, projectFunctions);
    for (const v of result.violations) {
      flags.push({
        file: seq.file,
        function: seq.function ?? "unknown",
        callName: v.callName,
        matchedRule: v.matchedRule,
        strategy: classifyStrategy(v.callName, v.matchedRule),
        currentState: v.currentState,
        requiredState: v.requiredState,
        reason: v.explanation,
      });
    }
  }
  return { repo: path.basename(repoDir), flags, sequences: sequences.length, functions: ir.length };
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

function main(): void {
  const benchDir = path.resolve(__dirname, "..", "benchmarks");
  const repoNames = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_REPOS;
  const results: ReturnType<typeof scanRealRepo>[] = [];

  for (const name of repoNames) {
    const repoDir = path.join(benchDir, name);
    if (!fs.existsSync(repoDir)) { console.log(`${name}: 目录不存在，跳过`); continue; }
    const t0 = Date.now();
    const r = scanRealRepo(repoDir);
    results.push(r);
    console.log(`\n=== ${r.repo} === 函数 ${r.functions} / 入口序列 ${r.sequences} / flags ${r.flags.length}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    const byStrategy = new Map<string, number>();
    for (const f of r.flags) byStrategy.set(f.strategy, (byStrategy.get(f.strategy) ?? 0) + 1);
    for (const [s, n] of [...byStrategy.entries()].sort()) console.log(`  ${s}: ${n}`);
    for (const f of r.flags) {
      console.log(`  [${f.strategy}] ${f.file}::${f.function} — ${f.callName} → ${f.matchedRule ?? "-"}`);
      console.log(`      ${f.reason.slice(0, 130)}`);
    }
  }

  const report = {
    generated: new Date().toISOString(),
    method: "extractIRC + buildCallSequences + validateSequenceWithSSG（生产管线，词段门控开，无 LLM）",
    repos: results,
  };
  fs.mkdirSync(path.dirname(REAL_C_REPORT_PATH), { recursive: true });
  fs.writeFileSync(REAL_C_REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n报告 → ${path.relative(process.cwd(), REAL_C_REPORT_PATH)}`);
}

main();
