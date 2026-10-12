/**
 * 修冤枉第七刀预研探针二：离线重放预测（R29，只读，不改 src）
 *
 * 判据（复用第五刀 computeGuardPropagatedSet，marker 换成 no_request_surface）：
 *   函数的全部调用方都是无请求面函数（__progmune_no_request_surface__ 种子，
 *   第六刀已注入）⇒ 该函数视为无请求面，授权族提问不适用。
 *   保守性（R1-R4/R75）：全部调用方已守卫才豁免、≤3 跳、歧义 fail-safe、
 *   调用方自身排除、0 调用方不豁免、函数自身直接带标记不重复豁免（R5/R6）。
 *
 * 用法：
 *   npx ts-node blind-benchmark/job-surface-probe.ts [--show 40]
 *
 * 输入：docmost server IR（现场提取，注入开）+ 65ab-pre 告警流快照。
 * 输出：预测豁免集合 × 600 条授权族的交叉 → 预测压掉清单与计数。
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes } from "../src/extract-ir";
import { computeGuardPropagatedSet, computeJobSurfacePropagatedSet } from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server");
const ALERTS = path.join(ROOT, "blind-benchmark", "reports", "heldout", "trust-docmost-65ab-pre.json");

const JOB_MARK = "__progmune_no_request_surface__";
const AUTH_MARK = "__progmune_auth_machinery__";

// ── 1. IR（注入开） ──
console.log("extracting IR...");
const functions = extractIRWithTypes(SERVER_DIR).functions;
console.log(`IR functions: ${functions.length}`);

// ── 1b. 告警行（提前读取，2a/3 共用） ──
const report = JSON.parse(fs.readFileSync(ALERTS, "utf8"));
type Row = { rule: string; fn: string; file: string };
const rows: Row[] = [];
for (const g of report.overall.safeguardAlerts.groups) {
  if (!/Authorization|Payment Refund/.test(g.rule)) continue;
  for (const e of g.alerts ?? []) rows.push({ rule: g.rule, fn: e.alert.function, file: e.alert.file });
}

// ── 2a. B 判据（裸名并集传播）迭代量化 ──
// 判据：调用方集合（裸名并集，=真实调用方的超集，因 IR 调用名=裸名）
// 非空且全部已豁免（种子=带 no_request_surface 标记）⇒ 豁免。
// 与 computeGuardPropagatedSet 的差别：歧义不阻断——并集本身含全部
// 候选调用方，全作业检查在并集层面完成（比逐边消歧更保守族级）。
const directlyJobMarked = new Set(functions.filter((f) => (f.calls ?? []).includes(JOB_MARK)).map((f) => f.name));
const seedSet = directlyJobMarked;
const bySuffix = new Map<string, string[]>();
for (const f of functions) {
  const bare = f.name.split(".").pop() || f.name;
  if (!bySuffix.has(bare)) bySuffix.set(bare, []);
  bySuffix.get(bare)!.push(f.name);
}
const callersByBare = new Map<string, Set<string>>();
for (const f of functions) {
  for (const c of f.calls ?? []) {
    if (!bySuffix.has(c)) continue;
    if (!callersByBare.has(c)) callersByBare.set(c, new Set());
    callersByBare.get(c)!.add(f.name);
  }
}
// 迭代轮次（快照语义）
let hopExempt = new Set(seedSet);
for (let round = 0; round < 3; round++) {
  const toAdd: string[] = [];
  for (const f of functions) {
    if (hopExempt.has(f.name)) continue;
    const bare = f.name.split(".").pop() || f.name;
    const callers = callersByBare.get(bare) || new Set<string>();
    if (callers.size === 0) continue;
    if ([...callers].every((c) => hopExempt.has(c))) toAdd.push(f.name);
  }
  if (toAdd.length === 0) { console.log(`B 判据迭代在轮 ${round + 1} 收敛（新增 0）`); break; }
  for (const n of toAdd) hopExempt.add(n);
  const hit = rows.filter((r) => !directlyJobMarked.has(r.fn) && hopExempt.has(r.fn)).length;
  console.log(`B 判据轮 ${round + 1} 新增 ${toAdd.length}，累计豁免 ${hopExempt.size}，告警交叉命中 ${hit}`);
}

// ── 2. 第七刀传播（真实实现，R59） ──
// B 判据（裸名并集传播）已入 src：computeJobSurfacePropagatedSet。
// 旧框架（computeGuardPropagatedSet 换 marker）已证只有同文件层 4 条——保留对照行。
const jobPropagated = computeJobSurfacePropagatedSet(functions);
const jobPropagatedOld = computeGuardPropagatedSet(functions, { marker: JOB_MARK });
const guardPropagated = computeGuardPropagatedSet(functions, { marker: AUTH_MARK });

console.log(`第五刀（auth_machinery 传播）豁免集: ${guardPropagated.size}`);
console.log(`第七刀 B 判据（真实实现）豁免集: ${jobPropagated.size}`);
console.log(`第七刀旧框架（逐边消歧换 marker，对照）豁免集: ${jobPropagatedOld.size}`);
console.log(`第七刀种子（直接带标记）: ${directlyJobMarked.size}`);
console.log(`B 判据与第五刀交集: ${[...jobPropagated].filter((n) => guardPropagated.has(n)).length}`);

// ── 3. 与 600 条授权族交叉 ──
const predicted = rows.filter((r) => {
  if (directlyJobMarked.has(r.fn)) return false; // R5/R6：直接标记不重复豁免
  if (!jobPropagated.has(r.fn)) return false;
  return true;
});
console.log(`\n预测压掉: ${predicted.length} / ${rows.length}`);
const byRule = new Map<string, number>();
for (const p of predicted) byRule.set(p.rule, (byRule.get(p.rule) ?? 0) + 1);
console.log("按规则:", JSON.stringify(Object.fromEntries(byRule)));

// 与第五刀已豁免的重叠（已在 suppressed 的不会重复出现）
const alreadySuppressed = new Set(report.overall.safeguardAlerts.suppressed.map((s: any) => s.function + "|" + s.rule));
const overlap5 = predicted.filter((p) => alreadySuppressed.has(p.fn + "|" + p.rule));
console.log(`与第五刀 suppressed 重叠（不会新增压降）: ${overlap5.length}`);

// ── 4. 对照：caller-surface-probe 的 A 类 23 条为何只有 4 条进预测 ──
// 逐条检查 A 类函数在严格判据下的阻断原因（裸名候选数 / 调用方形态）
const cls: Array<{ fn: string; rule: string; classA: boolean; callers: string[]; bareCount: number }> =
  JSON.parse(fs.readFileSync(path.join(ROOT, "blind-benchmark", "reports", "caller-surface-classification.json"), "utf8"));
const aList = cls.filter((c) => c.classA);
console.log(`\n=== A 类 23 条逐条阻断分析 ===`);
for (const a of aList) {
  const bare = a.fn.split(".").pop() || a.fn;
  const candCount = functions.filter((f) => (f.name.split(".").pop() || f.name) === bare).length;
  const exempt = jobPropagated.has(a.fn);
  const callersJob = a.callers.filter((n) => {
    const f = functions.find((x) => x.name === n);
    return f && (f.calls ?? []).includes(JOB_MARK);
  });
  const callersNonJob = a.callers.filter((n) => !callersJob.includes(n));
  console.log(`  ${exempt ? "HIT " : "MISS"} bareCandidates=${candCount} callers=[${a.callers.map((n) => n.split(".").pop()).join(",")}] nonJobCallers=[${callersNonJob.map((n) => n.split(".").pop()).join(",")}]  ${a.fn}`);
}

const show = process.argv.includes("--show") ? parseInt(process.argv[process.argv.indexOf("--show") + 1] ?? "40") : 40;
console.log(`\n=== 预测压掉清单（前 ${show}）===`);
for (const p of predicted.slice(0, show)) {
  console.log(`  ${p.rule.slice(0, 42).padEnd(42)} ${p.fn}`);
}
