/**
 * 修冤枉第十一刀预研探针：歧义边族级兜底的量化（只读，import 真实实现）
 *
 * 背景：computeResolvedCallerMap 分层消歧（后缀唯一→同文件→同目录→
 * 类根）失败时挂未解析边 fail-safe ⇒ 豁免被阻断。第九刀探针实测
 * C4/C5 残部里「歧义边」占 50/70 条。
 *
 * 候选判据（第七刀 B 判据的族级保守镜像，作用于全并集 base）：
 *   函数 F 的裸名族 = 项目中所有裸名相同的函数；
 *   该族所有调用方（按裸名并集）都 ∈ base（公开∪守卫∪作业）⇒
 *   族内每个成员的真实调用方都 ⊆ 并集 ⇒ 全部豁免。
 * 正确性：裸化只增候选（R75 正向证据）——真实调用方必在并集中，
 *   并集全豁免蕴含真实调用方全豁免。**不需要边解析**：即使最坏
 *   归因（每个族成员都被每个调用方调用）也落在并集内。
 *
 * 本探针：
 *   1. 识别 3.7.69 授权族告警里「有未解析边且未被第十刀豁免」的函数
 *   2. 量化族级兜底能豁免多少（族调用方并集全 ⊆ base）
 *   3. 输出候选清单（族成员 + 调用方并集归类）供 FN 复核
 *
 * 用法：npx ts-node blind-benchmark/knife11-family-fallback-probe.ts [--show 40]
 */

import * as fs from "fs";
import * as path from "path";
import {
  computeGuardPropagatedSet,
  computeJobSurfacePropagatedSet,
  computePublicSurfacePropagatedSet,
  computeBareFamilyPropagatedSet,
  computeResolvedCallerMap,
} from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const IR_PATH = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server", "ir.json");
const BASELINE = path.join(ROOT, "blind-benchmark", "reports", "heldout", "trust-docmost-610ab-pre.json");

const functions: Array<{ name: string; file?: string; calls?: string[] }> =
  JSON.parse(fs.readFileSync(IR_PATH, "utf8"));
console.log(`IR functions: ${functions.length}`);

const guardPropagated = computeGuardPropagatedSet(functions);
const jobSurfacePropagated = computeJobSurfacePropagatedSet(functions);
const publicMarked = new Set<string>();
for (const f of functions) {
  if ((f.calls || []).includes("__progmune_public_surface__")) publicMarked.add(f.name);
}
const publicSurfacePropagated = computePublicSurfacePropagatedSet(functions, publicMarked, guardPropagated, jobSurfacePropagated);
const base = new Set<string>([...publicMarked, ...guardPropagated, ...jobSurfacePropagated, ...publicSurfacePropagated]);
console.log(`base(公开∪守卫∪作业∪已传播): ${base.size}`);

// ── 告警（3.7.69 pre 的 raw 授权族）──
const report = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const authRaw: Array<{ rule: string; fn: string; file?: string }> = [];
for (const g of report.overall.safeguardAlerts.groups) {
  if (!/Authorization/.test(g.rule)) continue;
  for (const e of g.alerts ?? []) authRaw.push({ rule: g.rule, fn: e.alert.function, file: e.alert.file });
}
console.log(`授权族 raw 告警（3.7.69）: ${authRaw.length}`);

// ── 裸名族索引 + 族调用方并集（B 判据同款：裸化只增候选）──
const bySuffix = new Map<string, string[]>();
for (const f of functions) {
  const bare = f.name.split(".").pop() || f.name;
  if (!bySuffix.has(bare)) bySuffix.set(bare, []);
  bySuffix.get(bare)!.push(f.name);
}
const callersByBare = new Map<string, Set<string>>();
for (const f of functions) {
  for (const c of f.calls || []) {
    const bareC = c.split(".").pop() || c;
    if (!bySuffix.has(bareC)) continue; // 非项目函数名
    if (!callersByBare.has(bareC)) callersByBare.set(bareC, new Set());
    callersByBare.get(bareC)!.add(f.name);
  }
}

// ── 1. 有未解析边且未被第十刀豁免的告警 ──
const resolved = computeResolvedCallerMap(functions);
const ambiguous = authRaw.filter((r) => {
  if (base.has(r.fn)) return false; // 已被豁免
  const callers = resolved.get(r.fn) || [];
  return callers.some((c) => !c.resolved);
});
console.log(`歧义边告警（未豁免）: ${ambiguous.length}`);

// ── 2. 族级兜底候选：族调用方并集全 ⊆ base（import 真实实现，R59）──
// base 与引擎接线一致 = 公开∪守卫∪作业∪公开传播（混合集成员 ⊆ 公开
// 传播集——其调用方 ⊆ 守卫∪作业 ⊂ 公开∪守卫∪作业 ⇒ 必被公开传播覆盖，
// 引擎里的 ∪混合 冗余但无害）
type Cand = { rule: string; fn: string; bare: string; family: string[]; callers: string[] };
const familyPropagated = computeBareFamilyPropagatedSet(functions, base, { maxRounds: 1 });
const candidates: Cand[] = [];
for (const r of ambiguous) {
  if (!familyPropagated.has(r.fn)) continue;
  const bare = r.fn.split(".").pop() || r.fn;
  const family = bySuffix.get(bare) || [];
  const callers = [...(callersByBare.get(bare) || [])];
  candidates.push({ rule: r.rule, fn: r.fn, bare, family, callers });
}
// 去重（同函数多规则）
const seen = new Set<string>();
const dedup = candidates.filter((c) => (seen.has(c.fn) ? false : (seen.add(c.fn), true)));
console.log(`\n=== 族级兜底候选: ${candidates.length} 条告警 / ${dedup.length} 个函数 ===`);
const byRule = new Map<string, number>();
for (const c of candidates) byRule.set(c.rule, (byRule.get(c.rule) ?? 0) + 1);
console.log(`按规则: ${JSON.stringify(Object.fromEntries(byRule))}`);

const show = process.argv.includes("--show") ? parseInt(process.argv[process.argv.indexOf("--show") + 1] ?? "40") : 40;
console.log(`\n=== 候选清单（前 ${show}）族成员数/调用方并集 ===`);
for (const c of dedup.slice(0, show)) {
  console.log(`  ${c.fn.padEnd(52)} 族=${c.family.length} 调用方=[${c.callers.map((x) => x.split(".").pop()).slice(0, 8).join(", ")}]`);
}

// ── 3. 对照：族调用方并集含并集外调用方（不豁免，量化剩余空间）──
const notEligible = ambiguous.filter((r) => {
  const bare = r.fn.split(".").pop() || r.fn;
  const callers = [...(callersByBare.get(bare) || [])];
  return callers.length > 0 && !callers.every((c) => base.has(c));
});
console.log(`\n族并集含并集外调用方（不豁免）: ${notEligible.length} 条`);

fs.writeFileSync(
  path.join(ROOT, "blind-benchmark", "reports", "knife11-family-candidates.json"),
  JSON.stringify(candidates, null, 2)
);
console.log(`wrote knife11-family-candidates.json (${candidates.length} rows)`);
