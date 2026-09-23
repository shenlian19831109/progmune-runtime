/**
 * FP 观测池扫描器 —— 与 batch-scan 同一套 detector，保证口径一致。
 *
 * 用途：证据池换标准之后（不再要求 CVE / 修复提交，只要求真实 + 有 HTTP 入口 + 有文件
 * 操作），本脚本负责把池里的每个切片扫一遍，产出**可人工判定的材料**。
 *
 * 与 batch-scan 的分工：
 *   - batch-scan（generated/）：人造语料，有精确期望 ⇒ 测「召回/精度」双向
 *   - 本脚本（fp-pool/）：真实代码，没有现成期望 ⇒ 测**误报率**，真值靠人工抽样判定
 *
 * 用法：
 *   npx tsx blind-benchmark/fp-pool-scan.ts                  # 扫全池
 *   npx tsx blind-benchmark/fp-pool-scan.ts <子目录名>        # 只扫一个（本机吃紧时用）
 *
 * 约定：跑之前设 PROGMUNE_HUB=off PROGMUNE_MAX_LLM_CALLS=0（缺 LLM_API_KEY 时网络调用会挂死）。
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes, FunctionInfo } from "../src/extract-ir";
import {
  detectProtocolViolations,
  detectSafeguardViolations,
  ProtocolViolation,
  SafeguardViolation,
} from "../src/protocol-detector";
import { detectResourceViolations } from "../src/resource-detector";

const POOL_DIR = path.resolve(__dirname, "fp-pool");
const OUT = path.resolve(__dirname, "reports/fp-pool-results.json");

interface PoolScanResult {
  repo: string;
  files: number;
  functions: number;
  totalLines: number;
  protocol: number;
  safeguard: number;
  resource: number;
  /** 提取到零个调用的函数数 —— 这些函数对状态机是不可见的（只能靠函数名猜） */
  emptyCallFns: number;
  /** 其中「类方法」的数量（名字形如 Class.method） */
  emptyClassMethods: number;
  perFunction: Array<{
    repo: string;
    name: string;
    file: string;
    line?: number;
    calls: string[];
    protocolViolations: ProtocolViolation[];
    safeguardViolations: SafeguardViolation[];
  }>;
}

function countLines(dir: string): number {
  let lines = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!e.name.startsWith(".")) walk(path.join(d, e.name));
      } else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) {
        try {
          lines += fs.readFileSync(path.join(d, e.name), "utf-8").split("\n").length;
        } catch {}
      }
    }
  };
  walk(dir);
  return lines;
}

function countFiles(dir: string): number {
  let n = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!e.name.startsWith(".")) walk(path.join(d, e.name));
      } else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) n++;
    }
  };
  walk(dir);
  return n;
}

/** 与 batch-scan 同口径：被 web-handler 调到的函数算「暴露面」 */
const WEB_HANDLER = /\b(handle_request|handleRequest|request_handler|requestHandler)\b/i;
function computeExposed(funcs: Array<{ name: string; calls?: string[] }>): Set<string> {
  const exposed = new Set<string>();
  for (const f of funcs) {
    if (WEB_HANDLER.test(f.name)) for (const c of f.calls || []) exposed.add(c);
  }
  return exposed;
}
function isExposed(name: string, exposed: Set<string>): boolean {
  return exposed.has(name) || exposed.has(name.split(".").pop() || name);
}

const only = process.argv[2];
const repos = fs
  .readdirSync(POOL_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && (!only || e.name === only))
  .map((e) => e.name)
  .sort();

const results: PoolScanResult[] = [];

for (const repo of repos) {
  const dir = path.join(POOL_DIR, repo);
  const t0 = Date.now();
  let funcs: FunctionInfo[] = [];
  try {
    const ir = extractIRWithTypes(dir);
    funcs = ir.functions.filter((f) => !f.external);
  } catch (e: any) {
    console.log(`FAIL ${repo}: ${String(e?.message || e).slice(0, 120)}`);
    continue;
  }
  const exposed = computeExposed(funcs);
  const allCalls: string[] = [...new Set(funcs.flatMap((f) => f.calls || []))];
  const perFunction: PoolScanResult["perFunction"] = [];
  for (const f of funcs.filter((f) => f.exported)) {
    const calls = f.calls || [];
    // language 必须传 "typescript"（2026-09-22）：此前传 undefined ⇒
    // `activeRules` 退化为「全部规则」，Python 专属规则（Context Manager Usage /
    // Unsafe Deserialization (Pickle) / Command Injection …）与 C 专属规则会
    // 一并套在 TS 代码上。实测：8 切片池里这类纯噪声 5 条（全为 Context Manager
    // Usage，落在 TS 的 WebSocket gateway 与 OIDC controller 上）。
    // 对照：batch-scan-python.ts 一直传 "python"，只有 TS 侧漏了。
    const sv = detectSafeguardViolations(
      calls,
      f.name,
      "typescript",
      (f.params || []).map((p) => p.name),
      isExposed(f.name, exposed)
    );
    const pv = detectProtocolViolations(calls);
    if (sv.length || pv.length) {
      perFunction.push({
        repo,
        name: f.name,
        file: f.file || "",
        line: (f as any).line,
        calls,
        protocolViolations: pv,
        safeguardViolations: sv,
      });
    }
  }
  const r: PoolScanResult = {
    repo,
    files: countFiles(dir),
    functions: funcs.length,
    totalLines: countLines(dir),
    protocol: detectProtocolViolations(allCalls).length,
    safeguard: detectSafeguardViolations(allCalls, undefined, "typescript").length,
    resource: detectResourceViolations(allCalls).length,
    emptyCallFns: funcs.filter((f) => !f.calls || f.calls.length === 0).length,
    emptyClassMethods: funcs.filter(
      (f) => (!f.calls || f.calls.length === 0) && /\./.test(f.name)
    ).length,
    perFunction,
  };
  results.push(r);
  console.log(
    `${repo.padEnd(46)} files=${String(r.files).padStart(4)} fns=${String(r.functions).padStart(4)} ` +
      `行=${String(r.totalLines).padStart(6)} | protocol=${r.protocol} safeguard=${r.safeguard} resource=${r.resource} ` +
      `| 命中函数=${String(r.perFunction.length).padStart(3)} | 空calls=${String(r.emptyCallFns).padStart(3)}` +
      `(其中类方法 ${String(r.emptyClassMethods).padStart(3)}) | ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
}

// 写盘前的两道保险（2026-09-21，都是踩出来的）：
// ① .prev 备份 —— 一次单切片扫描失败会把整份结果覆盖成空，历史判定就丢了；
// ② --merge：只扫一片时，把新结果并回旧文件，其余切片原样保留。
fs.mkdirSync(path.dirname(OUT), { recursive: true });
let out = results;
if (only && fs.existsSync(OUT)) {
  try {
    const prev: PoolScanResult[] = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const names = new Set(results.map((r) => r.repo));
    out = [...prev.filter((r) => !names.has(r.repo)), ...results].sort((a, b) =>
      a.repo.localeCompare(b.repo)
    );
    console.log(`\n[merge] 已并入既有结果（保留 ${prev.filter((r) => !names.has(r.repo)).length} 个切片）`);
  } catch {
    console.log("\n[merge] 既有结果解析失败，按新结果写盘");
  }
}
if (fs.existsSync(OUT)) {
  try {
    fs.copyFileSync(OUT, OUT.replace(/\.json$/, ".prev.json"));
  } catch {
    /* 备份失败不阻断 */
  }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
// 用 out（含并入的旧切片）统计，否则单切片扫描会打出「池合计 1 个切片」的假总数
const tp = out.reduce((a, r) => a + r.protocol, 0);
const ts = out.reduce((a, r) => a + r.safeguard, 0);
const tr = out.reduce((a, r) => a + r.resource, 0);
const tf = out.reduce((a, r) => a + r.files, 0);
console.log(
  `\n池合计：${out.length} 个切片 / ${tf} 文件 / protocol=${tp} safeguard=${ts} resource=${tr}`
);
console.log(`明细已写入 ${path.relative(process.cwd(), OUT)}（供人工逐条判定 TP/FP）`);
