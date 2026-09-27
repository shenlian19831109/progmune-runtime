/**
 * §40 探针：落地两轮之后，「剩余池」长什么样（只读，不改 src）
 *
 * 背景：§38（组合式授权谓语）与 §39（鉴权机制自指排除）已落地进 src。
 * 两轮各自报过"压掉 14 条"，但**两轮叠加后还剩什么、剩余条目是什么形态**
 * 从来没有人量过 —— 继续往下切之前必须先看清靶子的形状（R41：缺信息先补信息）。
 *
 * 本脚本在**冻结母本** `reports/fp-pool-results.json`（9 片真实扫描，不可重跑覆盖）
 * 上重放两轮判据，输出：
 *   ① 压掉矩阵：§38 单独 / §39 单独 / 两者交集 / 剩余
 *   ② 剩余条目按 repo × rule 汇总
 *   ③ 剩余条目全清单（带 gold 人工 verdict，区分 FP / TP / UNKNOWN）
 *   ④ 剩余条目的形态词频（容器后缀 / 方法首动词 / 文件路径段）—— 用于挑下一刀
 *
 * 用法：
 *   npx tsx blind-benchmark/residual-probe.ts [--show 200] [--rule Ownership]
 */

import * as fs from "fs";
import * as path from "path";
import { containerOf } from "./selfref-probe";
import {
  isAuthFunctionName,
  AUTHZ_PREDICATE_RE,
  AUTHZ_CAN_HELPER_RE,
  AUTHZ_ACCESS_CHECK_RE,
  AUTHZ_BARE_CAN_RE,
} from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(ROOT, "blind-benchmark", "reports", "fp-pool-results.json");
const GOLD = path.join(ROOT, "blind-benchmark", "fp-gold.jsonl");
const OUT = path.join(ROOT, "blind-benchmark", "reports", "residual-pool.json");

type Viol = {
  repo: string;
  fn: string;
  file: string;
  rule: string;
  category: string;
  calls: string[];
  gold?: string;
  gold_confidence?: string;
};

const goldIndex = new Map<string, { gold: string; confidence: string }>();
for (const line of fs.readFileSync(GOLD, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const g = JSON.parse(line);
    goldIndex.set(`${g.repo}/${g.fn}::${g.rule}`, { gold: g.gold, confidence: g.gold_confidence });
  } catch { /* skip */ }
}

const pool = JSON.parse(fs.readFileSync(POOL, "utf8")) as Array<{
  repo: string;
  perFunction: Array<{ name: string; file: string; calls?: string[]; safeguardViolations?: any[] }>;
}>;

const rows: Viol[] = [];
for (const slice of pool) {
  for (const f of slice.perFunction ?? []) {
    const calls = f.calls ?? [];
    for (const v of f.safeguardViolations ?? []) {
      if (v.category !== "authorization") continue;
      const g = goldIndex.get(`${slice.repo}/${f.name}::${v.rule}`);
      rows.push({
        repo: slice.repo,
        fn: f.name,
        file: f.file,
        rule: v.rule,
        category: v.category,
        calls,
        gold: g?.gold,
        gold_confidence: g?.confidence,
      });
    }
  }
}

/**
 * §38：函数体内出现组合式授权谓语 ⇒ 该条会被抑制。
 * ⚠ 判据一律 import src 的**落地正则**（R59：探针自带词表会漂移出"假缺口"）。
 *   §40 C1 的裸 can 只能匹配**原始调用名**（callsOnly 语义），所以这里用 r.calls
 *   而不是 identifierParse 拆出来的词。
 */
const byAuthz = (r: Viol) =>
  (r.calls ?? []).some(
    (c) =>
      AUTHZ_PREDICATE_RE.test(c) ||
      AUTHZ_CAN_HELPER_RE.test(c) ||
      AUTHZ_ACCESS_CHECK_RE.test(c) ||
      AUTHZ_BARE_CAN_RE.test(c)
  );
/** §39 + §40 C2/C4：函数本身是鉴权机制/鉴权入口/授权谓语 ⇒ 自指排除 */
const bySelfRef = (r: Viol) => isAuthFunctionName(r.fn);

const s38 = rows.filter(byAuthz);
const s39 = rows.filter(bySelfRef);
const s38set = new Set(s38.map((r) => key(r)));
const s39set = new Set(s39.map((r) => key(r)));
const residual = rows.filter((r) => !s38set.has(key(r)) && !s39set.has(key(r)));

function key(r: Viol): string {
  return `${r.repo}/${r.fn}::${r.rule}`;
}

const show = Number(process.argv.includes("--show") ? process.argv[process.argv.indexOf("--show") + 1] : 120);
const ruleFilter = process.argv.includes("--rule") ? process.argv[process.argv.indexOf("--rule") + 1] : null;
const shown = ruleFilter ? residual.filter((r) => r.rule.includes(ruleFilter)) : residual;

console.log(`\n=== §40 剩余池（Authorization 族，母本 9 片）===`);
console.log(`总条目            : ${rows.length}`);
console.log(`§38 压掉          : ${s38.length}`);
console.log(`§39 压掉          : ${s39.length}`);
console.log(`两者交集          : ${rows.filter((r) => s38set.has(key(r)) && s39set.has(key(r))).length}`);
console.log(`压掉合计(去重)    : ${rows.length - residual.length}`);
console.log(`**剩余**          : ${residual.length}`);

console.log(`\n--- 剩余按 repo ---`);
const byRepo = new Map<string, number>();
for (const r of residual) byRepo.set(r.repo, (byRepo.get(r.repo) ?? 0) + 1);
[...byRepo.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

console.log(`\n--- 剩余按 rule ---`);
const byRule = new Map<string, number>();
for (const r of residual) byRule.set(r.rule, (byRule.get(r.rule) ?? 0) + 1);
[...byRule.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

console.log(`\n--- 剩余按 gold 人工 verdict ---`);
const byGold = new Map<string, number>();
for (const r of residual) byGold.set(r.gold ?? "(未标注)", (byGold.get(r.gold ?? "(未标注)") ?? 0) + 1);
[...byGold.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

/* ---- 形态词频：容器后缀 / 方法首动词 / 路径段 ---- */
function firstVerb(name: string): string {
  const m = name.slice(name.lastIndexOf(".") + 1);
  const mm = /^([a-z]+)/.exec(m);
  return mm ? mm[1] : "(none)";
}
function containerSuffix(name: string): string {
  const c = containerOf(name);
  if (!c) return "(无容器)";
  const m = /(Controller|Service|Guard|Strategy|Factory|Middleware|Resolver|Repository|Module|Util|Helper|Handler|Auth|Ability|Provider)$/.exec(c);
  return m ? m[1] : "(其他)";
}
function pathSeg(file: string): string {
  const segs = file.split("/");
  return segs.length > 2 ? segs.slice(0, 3).join("/") : file;
}

for (const [title, fn] of [
  ["容器后缀", containerSuffix],
  ["方法首动词", firstVerb],
] as const) {
  console.log(`\n--- 剩余形态：${title} ---`);
  const m = new Map<string, number>();
  for (const r of residual) m.set(fn(r.fn), (m.get(fn(r.fn)) ?? 0) + 1);
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));
}
console.log(`\n--- 剩余形态：文件路径前 3 段 ---`);
const mp = new Map<string, number>();
for (const r of residual) mp.set(pathSeg(r.file), (mp.get(pathSeg(r.file)) ?? 0) + 1);
[...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

console.log(`\n--- 剩余清单（前 ${Math.min(show, shown.length)} 条）---`);
for (const r of shown.slice(0, show)) {
  console.log(`  [${r.repo}] ${r.fn} :: ${r.rule}  <${r.gold ?? "-"}>  ${r.file}`);
}

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      total: rows.length,
      suppressedBy38: s38.length,
      suppressedBy39: s39.length,
      residual: residual.length,
      rows: residual.map((r) => ({ repo: r.repo, fn: r.fn, file: r.file, rule: r.rule, gold: r.gold, calls: r.calls })),
    },
    null,
    2
  )
);
console.log(`\n已写 ${OUT}`);
