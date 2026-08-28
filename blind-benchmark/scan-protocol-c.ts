/**
 * Blind Benchmark — C Protocol Scanner v1（新路线金标重评）
 *
 * 对 benchmarks/{curl,libssh,nginx,openssl,nghttp2,redis} 的黄金序列
 * （*-sequences.json + *-labels.json，P0-P3 时代人工标注）做确定性协议
 * 校验（无 LLM），对比旧正则检测器基线 F1=16.5%（P=15.2% / R=50.0%）。
 *
 * 管线（与生产 trust 引擎路径对齐，mirror scan-protocol-python.ts）：
 *   1. extractIRC → 仓库 IR（3.7.4 新路线 C 提取器）
 *   2. 规则 = 内置 protocols.json（C 基准仓库无项目注解）
 *   3. projectFunctions = collectProjectFunctionNames(ir)——词段匹配门控
 *   4. 直接模式：对每条黄金序列直构 steps → validateSequenceWithSSG
 *      （与旧检测器同输入，受控对比）
 *   5. 生产模式：buildCallSequences(ir) 入口展开 → 按 (function,file)
 *      与黄金函数对齐（真实端到端路径能覆盖多少黄金函数）
 *   6. 比对 labels → Precision / Recall / F1
 *
 * 已知边界（如实记录）：
 *   - 黄金标签是 TLS/SSH/HTTP2/资源级误用（P0-P3 正则检测器口径）；
 *     SSG 规则面是应用级协议（auth/db/file/payment 等）——两者口径
 *     不同，本基准回答的是「新路线在旧任务上表现如何」+「生产路径
 *     覆盖率」，不假装口径一致。
 *   - LLM 语义桥接层（任意 API 名 → 协议名）不参与测量。
 *
 * Usage: npx ts-node blind-benchmark/scan-protocol-c.ts
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRC } from "../src/extract-ir-c";
import { validateSequenceWithSSG } from "../src/trust/ssg-bridge";
import { buildCallSequences, collectProjectFunctionNames } from "../src/call-sequence";
import type { StateAnnotation } from "../src/ssg-validator";

export const C_PROTO_REPORT_PATH = path.resolve(__dirname, "reports", "scan-protocol-c-results.json");
const BUILTIN_PROTOCOLS = path.resolve(__dirname, "..", "protocols.json");
const BENCH_DIR = path.resolve(__dirname, "..", "benchmarks");

const REPOS = ["curl", "libssh", "nginx", "openssl", "nghttp2", "redis"] as const;

// ═══════════════════════════════════════════════════════════════
// 规则装载（内置 protocols.json；基准仓库无项目注解，不做 P4.5 合并）
// ═══════════════════════════════════════════════════════════════

interface ProtocolRuleSet {
  rules: Map<string, StateAnnotation>;
  nsInit: Record<string, string>;
}

function loadBuiltinRules(): ProtocolRuleSet {
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
// 数据装载
// ═══════════════════════════════════════════════════════════════

interface GoldSequence {
  function: string;
  file: string;
  calls: string[];
}

interface RepoData {
  sequences: GoldSequence[];
  /** 与 sequences 下标对齐的标签（"violation" | "clean"） */
  labels: string[];
}

function loadRepoData(repo: string): RepoData {
  const seqPath = path.join(BENCH_DIR, `${repo}-sequences.json`);
  const labPath = path.join(BENCH_DIR, `${repo}-labels.json`);
  if (!fs.existsSync(seqPath) || !fs.existsSync(labPath)) return { sequences: [], labels: [] };
  const seqRaw = JSON.parse(fs.readFileSync(seqPath, "utf-8"));
  const labRaw = JSON.parse(fs.readFileSync(labPath, "utf-8"));
  const sequences: GoldSequence[] = Array.isArray(seqRaw) ? seqRaw : Object.values(seqRaw);
  let labels: string[] = Array.isArray(labRaw.labels) ? labRaw.labels : Object.values(labRaw.labels || {});
  // 只统计已标注的条目（curl 85/100、libssh 47/100 有标注，其余全标注）
  return { sequences, labels };
}

// ═══════════════════════════════════════════════════════════════
// 分类：直接模式（黄金序列直构 steps → SSG，与旧检测器同输入）
// ═══════════════════════════════════════════════════════════════

interface DirectFlag {
  index: number;
  function: string;
  file: string;
  failingFunction: string;
  reason: string;
  label: string;
}

function classifyDirect(repo: string, data: RepoData, rules: ProtocolRuleSet, projectFunctions: Set<string>): DirectFlag[] {
  const flags: DirectFlag[] = [];
  // 与 scan-protocol-python 对齐：别名索引走 undefined（基准仓库无 .progmune_aliases.json，
  // 规则内建 alias 由 validateSequenceWithSSG 内部按 allRuleNames 处理不到——生产引擎
  // 的 aliasIndex 由 loadProtocolRules 构造，此处不参与，保持「规范名直构」口径）
  data.sequences.forEach((seq, i) => {
    const label = data.labels[i];
    if (label !== "violation" && label !== "clean") return;
    const steps = seq.calls.map((c) => ({ api: c, description: "" })) as any[];
    const result = validateSequenceWithSSG(steps, rules.rules, rules.nsInit, seq.file, undefined, undefined, projectFunctions, seq.directCalls ? new Set(seq.directCalls) : undefined);
    for (const v of result.violations) {
      flags.push({
        index: i,
        function: seq.function,
        file: seq.file,
        failingFunction: v.callName,
        reason: v.explanation,
        label,
      });
    }
  });
  return flags;
}

// ═══════════════════════════════════════════════════════════════
// 分类：生产模式（buildCallSequences 入口展开 + P4.6 内联）
// ═══════════════════════════════════════════════════════════════

interface ProductionResult {
  sequenceCount: number;
  /** 生产路径上被标违规的黄金函数（按 function+file 对齐） */
  flaggedGold: { function: string; file: string; failingFunction: string; reason: string; label: string }[];
}

function classifyProduction(data: RepoData, ir: any[], rules: ProtocolRuleSet, projectFunctions: Set<string>): ProductionResult {
  const sequences = buildCallSequences(ir, new Set(rules.rules.keys()));
  const goldByKey = new Map<string, string>(); // "file::function" → label
  data.sequences.forEach((seq, i) => {
    const label = data.labels[i];
    if (label === "violation" || label === "clean") goldByKey.set(`${seq.file}::${seq.function}`, label);
  });

  const flaggedGold: ProductionResult["flaggedGold"] = [];
  for (const seq of sequences) {
    const steps = seq.calls.map((c) => ({ api: c, description: "" })) as any[];
    const result = validateSequenceWithSSG(steps, rules.rules, rules.nsInit, seq.file, undefined, undefined, projectFunctions, seq.directCalls ? new Set(seq.directCalls) : undefined);
    if (result.violations.length === 0) continue;
    const label = goldByKey.get(`${seq.file}::${seq.function}`);
    if (label) {
      for (const v of result.violations) {
        flaggedGold.push({ function: seq.function ?? "unknown", file: seq.file, failingFunction: v.callName, reason: v.explanation, label });
      }
    }
  }
  return { sequenceCount: sequences.length, flaggedGold };
}

// ═══════════════════════════════════════════════════════════════
// 指标
// ═══════════════════════════════════════════════════════════════

function computeMetrics(repo: string, data: RepoData, flags: DirectFlag[]) {
  const labeled = data.labels.filter((l) => l === "violation" || l === "clean").length;
  const positives = data.labels.filter((l) => l === "violation").length;
  const flaggedSet = new Set(flags.map((f) => f.index));
  const tp = [...flaggedSet].filter((i) => data.labels[i] === "violation").length;
  const fp = flaggedSet.size - tp;
  const fn = positives - tp;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = positives > 0 ? tp / positives : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { labeled, positives, flagged: flaggedSet.size, tp, fp, fn, precision, recall, f1 };
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

function main(): void {
  const { rules, nsInit } = loadBuiltinRules();
  const repoReports: any[] = [];
  let allTp = 0, allFp = 0, allFn = 0;

  for (const repo of REPOS) {
    const repoDir = path.join(BENCH_DIR, repo);
    if (!fs.existsSync(repoDir)) {
      console.log(`${repo}: vendored 源码缺失，跳过`);
      continue;
    }
    console.log(`\n=== ${repo} ===`);
    const data = loadRepoData(repo);
    if (data.sequences.length === 0) { console.log("  无序列/标签数据"); continue; }

    const t0 = Date.now();
    const ir = extractIRC(repoDir);
    const extractMs = Date.now() - t0;
    console.log(`  extractIRC: ${ir.length} 函数（${(extractMs / 1000).toFixed(1)}s），有调用 ${ir.filter((f) => (f.calls || []).length > 0).length}`);

    const projectFunctions = collectProjectFunctionNames(ir);
    const goldNames = new Set(data.sequences.map((s) => `${s.file}::${s.function}`));
    const recovered = ir.filter((f) => goldNames.has(`${f.file}::${f.name}`)).length;
    console.log(`  黄金函数恢复: ${recovered}/${data.sequences.length}（file::function 对齐）`);

    const flags = classifyDirect(repo, data, { rules, nsInit }, projectFunctions);
    const m = computeMetrics(repo, data, flags);
    const prod = classifyProduction(data, ir, { rules, nsInit }, projectFunctions);
    allTp += m.tp; allFp += m.fp; allFn += m.fn;

    console.log(`  直接模式: 标注 ${m.labeled}（违规 ${m.positives}）→ 标记 ${m.flagged}（TP ${m.tp} / FP ${m.fp} / FN ${m.fn}）P=${(m.precision * 100).toFixed(1)}% R=${(m.recall * 100).toFixed(1)}% F1=${(m.f1 * 100).toFixed(1)}%`);
    console.log(`  生产模式: 入口序列 ${prod.sequenceCount}，黄金函数被标 ${prod.flaggedGold.length}`);
    for (const f of flags) {
      console.log(`    ${f.label === "violation" ? "✓TP" : "✗FP"} [${f.label}] ${f.file}::${f.function} — ${f.failingFunction}: ${f.reason.slice(0, 90)}`);
    }

    repoReports.push({
      repo,
      irFunctions: ir.length,
      irWithCalls: ir.filter((f) => (f.calls || []).length > 0).length,
      goldFunctions: data.sequences.length,
      recovered,
      extractMs,
      direct: m,
      directFlags: flags,
      production: prod,
    });
  }

  const overallP = allTp + allFp > 0 ? allTp / (allTp + allFp) : 0;
  const overallR = allTp + allFn > 0 ? allTp / (allTp + allFn) : 0;
  const overallF1 = overallP + overallR > 0 ? (2 * overallP * overallR) / (overallP + overallR) : 0;

  const report = {
    generated: new Date().toISOString(),
    method: "extractIRC + buildCallSequences + validateSequenceWithSSG（IR-first 确定性，无 LLM）",
    baseline: { f1: 16.5, precision: 15.2, recall: 50.0, source: "docs/c-language-status.md（旧正则检测器口径）" },
    overall: { tp: allTp, fp: allFp, fn: allFn, precision: overallP, recall: overallR, f1: overallF1 },
    repos: repoReports,
  };
  fs.mkdirSync(path.dirname(C_PROTO_REPORT_PATH), { recursive: true });
  fs.writeFileSync(C_PROTO_REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  console.log(`\n════════════════════════════════════════════`);
  console.log(`总体（直接模式，同输入对比）: P=${(overallP * 100).toFixed(1)}% R=${(overallR * 100).toFixed(1)}% F1=${(overallF1 * 100).toFixed(1)}%`);
  console.log(`旧基线（正则检测器）: P=15.2% R=50.0% F1=16.5%`);
  console.log(`报告 → ${path.relative(process.cwd(), C_PROTO_REPORT_PATH)}`);
}

main();
