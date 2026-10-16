/**
 * 修冤枉第九刀预研探针：调用方混合并集豁免的量化（只读，import 真实实现）
 *
 * 判据（computeMixedSurfacePropagatedSet）：函数 F 的每个直接调用方都
 * ∈ {已守卫传播集} ∪ {作业面传播集} ⇒ 豁免（R1-R5 见 src 实现）。
 *
 * 本探针做三件事：
 *   1. 复现 3.7.67 引擎的 safeguard 告警流（与 trust-docmost-68ab-pre.json
 *      逐条对账——对不上说明探针与引擎口径漂移，量化数字不可信）
 *   2. 量化混合并集判据在授权族上的覆盖（maxRounds=1 默认 + =2 对照）
 *   3. 输出候选清单（fn + 调用方 + 每个调用方的归类）供 FN 风险复核
 *
 * 用法：
 *   npx ts-node blind-benchmark/knife9-mixed-surface-probe.ts [--show 40]
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectSafeguardViolations,
  computeGuardPropagatedSet,
  computeJobSurfacePropagatedSet,
  computeMixedSurfacePropagatedSet,
  computeResolvedCallerMap,
} from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const IR_PATH = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server", "ir.json");
const BASELINE = path.join(ROOT, "blind-benchmark", "reports", "heldout", "trust-docmost-68ab-pre.json");

const LANG = "typescript";

// ── 1. 读 IR（engine 同源：ir.json 是 3.7.67 时代注入开的提取结果）──
const functions: Array<{ name: string; file?: string; calls?: string[]; params?: Array<{ name: string; type?: string }>; exported?: boolean }> =
  JSON.parse(fs.readFileSync(IR_PATH, "utf8"));
console.log(`IR functions: ${functions.length}`);

// ── 2. 复现引擎告警流（与 engine.ts 消费段同构）──
const guardPropagated = computeGuardPropagatedSet(functions);
const jobSurfacePropagated = computeJobSurfacePropagatedSet(functions);
console.log(`guardPropagated: ${guardPropagated.size} | jobSurfacePropagated: ${jobSurfacePropagated.size}`);

type Row = { rule: string; fn: string; file?: string; category: string };
const raw: Row[] = [];
const suppressed: Row[] = [];
for (const f of functions) {
  const fCalls = f.calls || [];
  let svs;
  try {
    svs = detectSafeguardViolations(
      fCalls,
      f.name,
      LANG,
      (f.params || []).map((p: any) => p.name),
      !!f.exported,
      (f.params || []).map((p: any) => p.type || "")
    );
  } catch {
    continue;
  }
  if (!svs || svs.length === 0) continue;
  const directlyMarked = fCalls.includes("__progmune_auth_machinery__");
  const directlyJobMarked = fCalls.includes("__progmune_no_request_surface__");
  const guardExempt = !directlyMarked && guardPropagated.has(f.name);
  const jobExempt = !directlyJobMarked && jobSurfacePropagated.has(f.name);
  for (const v of svs as Array<{ rule: string; category: string }>) {
    const row = { rule: v.rule, fn: f.name, file: f.file, category: v.category };
    if (v.category === "authorization" && (guardExempt || jobExempt)) suppressed.push(row);
    else raw.push(row);
  }
}
console.log(`复现告警流: raw ${raw.length} | suppressed ${suppressed.length}`);

// ── 2.5 与基线报告对账 ──
const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const baseGroups: Array<{ rule: string; n: number }> = base.overall.safeguardAlerts.groups.map((g: any) => ({ rule: g.rule, n: (g.alerts || []).length }));
const reproGroups = new Map<string, number>();
for (const r of raw) reproGroups.set(r.rule, (reproGroups.get(r.rule) ?? 0) + 1);
let drift = 0;
for (const g of baseGroups) {
  const repro = reproGroups.get(g.rule) ?? 0;
  if (repro !== g.n) {
    console.log(`  ⚠️ 口径漂移 ${g.rule}: 基线 ${g.n} vs 复现 ${repro}`);
    drift += Math.abs(repro - g.n);
  }
}
const baseSup = base.overall.safeguardAlerts.suppressed.length;
if (baseSup !== suppressed.length) {
  console.log(`  ⚠️ 口径漂移 suppressed: 基线 ${baseSup} vs 复现 ${suppressed.length}`);
  drift += Math.abs(baseSup - suppressed.length);
}
if (drift === 0) console.log("  ✓ 告警流与 68ab-pre 基线逐条一致（无漂移）");
else console.log(`  ✗ 漂移总量 ${drift}——以下数字不可信，先查口径`);

// ── 3. 混合并集量化（授权族）──
const authRaw = raw.filter((r) => r.category === "authorization");
console.log(`授权族 raw 告警: ${authRaw.length}`);

for (const rounds of [1, 2]) {
  const mixed = computeMixedSurfacePropagatedSet(functions, guardPropagated, jobSurfacePropagated, { maxRounds: rounds });
  const hits = authRaw.filter((r) => mixed.has(r.fn));
  console.log(`\n=== maxRounds=${rounds}：混合并集豁免候选 ${hits.length} 条 ===`);
  const byRule = new Map<string, number>();
  for (const h of hits) byRule.set(h.rule, (byRule.get(h.rule) ?? 0) + 1);
  console.log(`按规则: ${JSON.stringify(Object.fromEntries(byRule))}`);
  if (rounds === 1) {
    // 候选清单 + 调用方归类（供 FN 复核）——调用方用真实边解析
    const resolved = computeResolvedCallerMap(functions);
    const show = process.argv.includes("--show") ? parseInt(process.argv[process.argv.indexOf("--show") + 1] ?? "40") : 40;
    console.log(`\n=== 候选清单（前 ${show}）[g]=已守卫集 [j]=作业面集 ===`);
    for (const h of hits.slice(0, show)) {
      const callers = resolved.get(h.fn) || [];
      const tags = callers.map((c) => (guardPropagated.has(c.caller) ? "[g]" : "") + (jobSurfacePropagated.has(c.caller) ? "[j]" : "") + (c.resolved ? "" : "[歧义]"));
      console.log(`  ${h.fn.padEnd(56)} ← ${callers.map((c, i) => `${c.caller}${tags[i]}`).join(", ") || "∅"}`);
    }
  }
}

// ── 4. 写候选清单（默认 maxRounds=1）供 A/B 后逐条核对 ──
const mixed1 = computeMixedSurfacePropagatedSet(functions, guardPropagated, jobSurfacePropagated, { maxRounds: 1 });
const out = authRaw.filter((r) => mixed1.has(r.fn));
fs.writeFileSync(
  path.join(ROOT, "blind-benchmark", "reports", "knife9-mixed-candidates.json"),
  JSON.stringify(out, null, 2)
);
console.log(`\nwrote knife9-mixed-candidates.json (${out.length} rows)`);

// ── 5. C4/C5 主力类的调用方形态分类（为什么混合并集够不着）──
// C4 = repo 层 update* 真名；C5 = getter 类 get* 名（knife8-word-collision 口径）
const resolvedAll = computeResolvedCallerMap(functions);
const C4 = authRaw.filter((r) => /^(update|set|add|create|insert)/i.test(r.fn.split(".").pop() || ""));
const C5 = authRaw.filter((r) => /^get[A-Z]|\.get[A-Z]/.test(r.fn));
console.log(`\n=== C4 repo-update 类 ${C4.length} | C5 getter 类 ${C5.length} ===`);
for (const [label, cls] of [["C4", C4], ["C5", C5]] as const) {
  let allInUnion = 0, hasOutside = 0, hasUnresolved = 0, noCallers = 0;
  const outsideSamples = new Set<string>();
  for (const r of cls) {
    const callers = resolvedAll.get(r.fn) || [];
    if (callers.length === 0) { noCallers++; continue; }
    const ok = callers.every((c) => c.resolved && (guardPropagated.has(c.caller) || jobSurfacePropagated.has(c.caller)));
    const un = callers.filter((c) => !c.resolved);
    if (ok) allInUnion++;
    else {
      if (un.length > 0) hasUnresolved++;
      else {
        hasOutside++;
        for (const c of callers.slice(0, 2)) outsideSamples.add(c.caller);
      }
    }
  }
  console.log(`  ${label}: 并集内 ${allInUnion} | 并集外调用方 ${hasOutside} | 歧义边 ${hasUnresolved} | 无调用方 ${noCallers}`);
  console.log(`    并集外调用方样例: ${[...outsideSamples].slice(0, 8).join(", ")}`);
}

// ── 6. 守卫传播深度敏感性（C4/C5 是否卡在 3 跳边界）──
console.log("\n=== 守卫深度敏感性（授权族 raw 告警中，各深度 guard 集能罩住的条数）===");
for (const depth of [3, 4, 5, 6]) {
  const g = computeGuardPropagatedSet(functions, { maxDepth: depth });
  const covered = authRaw.filter((r) => g.has(r.fn)).length;
  console.log(`  maxDepth=${depth}: guard 集 ${g.size} | 授权族 raw 罩住 ${covered}`);
}
