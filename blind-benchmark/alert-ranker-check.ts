/**
 * §49.13 端到端验证：让 alert-ranker.ts **自己**跑一遍 §49.12 的评估（2026-09-28）
 *
 * 为什么必须有这个脚本：评估（rank-signals.py）和实现（alert-ranker.ts）是两份代码。
 * 只要存在两份，就会出现「评估说 0.895、实现跑出来 0.6」而没人发现的情况——
 * 这正是本项目反复出现的失败模式（R59：不许有两套口径）。
 * 所以这里用**实现**重算指标，与评估器的数字对表；对不上就是回归。
 *
 * 口径与 rank-signals.py 完全一致：留一仓（先验只从别的仓学）、同分随机打散 2000 次。
 *
 * 用法：
 *   NODE_OPTIONS="--max-old-space-size=2048" npx tsx blind-benchmark/alert-ranker-check.ts
 */
import * as fs from "fs";
import * as path from "path";
import { RankableAlert, rankAlerts, groupAlerts, learnPrior } from "../src/trust/alert-ranker";

const SIG = path.resolve(__dirname, "reports/xfn-49-signals.jsonl");
const GOLD = path.resolve(__dirname, "fp-gold.jsonl");
const N_MC = 2000;

const sig: RankableAlert[] = fs
  .readFileSync(SIG, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const gold: Array<{ repo: string; fn: string; file: string; rule: string; gold: string }> = fs
  .readFileSync(GOLD, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const gk = new Map<string, string>();
for (const g of gold) {
  gk.set(`${g.repo}|${g.fn}|${g.file}|${g.rule}`, g.gold);
  const bare = String(g.fn).split(".").pop() ?? g.fn;
  if (!gk.has(`${g.repo}|${bare}|${g.file}|${g.rule}`)) {
    gk.set(`${g.repo}|${bare}|${g.file}|${g.rule}`, g.gold);
  }
}
type Row = RankableAlert & { __gold: string };
const rows: Row[] = [];
for (const s of sig) {
  const k1 = `${s.repo}|${s.fn}|${s.file}|${s.rule}`;
  const k2 = `${s.repo}|${(s as any).bare}|${s.file}|${s.rule}`;
  const g = gk.get(k1) ?? gk.get(k2);
  if (g === "TP" || g === "FP") rows.push({ ...s, __gold: g });
}

const repos = [...new Set(rows.map((r) => r.repo))].sort();
const base = rows.filter((r) => r.__gold === "TP").length / rows.length;

/** Mann-Whitney U */
function auc(scored: Array<{ score: number; gold: string }>): number {
  const tp = scored.filter((s) => s.gold === "TP").map((s) => s.score);
  const fp = scored.filter((s) => s.gold === "FP").map((s) => s.score);
  if (!tp.length || !fp.length) return NaN;
  let w = 0, t = 0;
  for (const a of tp) for (const b of fp) { a > b ? w++ : a === b ? t += 0.5 : 0; }
  return (w + t) / (tp.length * fp.length);
}

/** 同分随机打散的 precision@k —— 与 python 端同一做法 */
function precisionAt(scored: Array<{ score: number; gold: string }>, frac: number): { mean: number; lo: number; hi: number } {
  const k = Math.max(1, Math.floor(scored.length * frac));
  const vals: number[] = [];
  for (let i = 0; i < N_MC; i++) {
    const perm = scored
      .map((s) => ({ s, r: Math.random() }))
      .sort((x, y) => y.s.score - x.s.score || y.r - x.r)
      .slice(0, k);
    vals.push(perm.filter((x) => x.s.gold === "TP").length / k);
  }
  vals.sort((a, b) => a - b);
  return {
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    lo: vals[Math.floor(0.05 * vals.length)],
    hi: vals[Math.floor(0.95 * vals.length) - 1],
  };
}

/** 留一仓：先验只从别的仓学 */
function loro(mode: "global" | "grouped" | "semantic-only" | "prior-only") {
  const out: Array<{ score: number; gold: string }> = [];
  for (const held of repos) {
    const train = rows.filter((r) => r.repo !== held);
    const test = rows.filter((r) => r.repo === held);
    if (!train.length || !test.length) continue;
    const { prior, base: bTrain } = learnPrior(
      train.map((r) => ({ rule: r.rule, gold: r.__gold as "TP" | "FP" }))
    );
    const opts: any = { prior, base: bTrain, minPerRule: 0 };
    if (mode === "semantic-only") opts.usePrior = false;
    let ranked: Array<{ alert: RankableAlert; score: number }>;
    if (mode === "grouped") {
      const gs = groupAlerts(test, opts);
      ranked = gs.flatMap((g) => g.alerts);
    } else {
      ranked = rankAlerts(test, opts);
    }
    if (mode === "prior-only") {
      // 只留先验分量：把语义分减掉
      for (const r of ranked) r.score = (r as any).prior * 3;
    }
    for (const r of ranked) out.push({ score: r.score, gold: (r.alert as Row).__gold });
  }
  return out;
}

console.log(`\n══ §49.13 端到端验证：用 alert-ranker.ts 重算 §49.12 的指标 ══`);
console.log(`样本 ${rows.length}（TP ${rows.filter((r) => r.__gold === "TP").length}）  基线 ${(base * 100).toFixed(1)}%  仓库 ${repos.length}`);

const MODES: Array<[string, "global" | "grouped" | "semantic-only" | "prior-only"]> = [
  ["① 只用语义信号", "semantic-only"],
  ["② 只用族先验", "prior-only"],
  ["③ 族先验 + 语义（全局平铺）", "global"],
  ["④ 族先验 + 语义（分组·推荐）", "grouped"],
];
console.log(`\n模式 | AUC | 前10%[90%区间] | 前20%[90%区间] | 前30%[90%区间]`);
const got: Record<string, number> = {};
for (const [label, mode] of MODES) {
  const scored = loro(mode);
  const a = auc(scored);
  const p10 = precisionAt(scored, 0.1), p20 = precisionAt(scored, 0.2), p30 = precisionAt(scored, 0.3);
  got[mode] = a;
  const cell = (p: { mean: number; lo: number; hi: number }) =>
    `${(p.mean * 100).toFixed(1)}%[${(p.lo * 100).toFixed(0)},${(p.hi * 100).toFixed(0)}]`;
  console.log(`  ${label} | ${a.toFixed(3)} | ${cell(p10)} | ${cell(p20)} | ${cell(p30)}`);
}

console.log(`\n── 与 python 评估器对表（rank-signals.py 的数字）──`);
const EXPECT: Array<[string, number, string]> = [
  ["语义信号 AUC", 0.744, "semantic-only"],
  ["族先验 AUC", 0.891, "prior-only"],
  ["先验+语义 AUC", 0.895, "global"],
];
let ok = true;
for (const [name, exp, key] of EXPECT) {
  const diff = Math.abs((got[key] ?? NaN) - exp);
  const pass = diff <= 0.02;
  if (!pass) ok = false;
  console.log(
    `  ${name.padEnd(22)} python ${exp.toFixed(3)}  vs  实现 ${(got[key] ?? NaN).toFixed(3)}  ` +
      `差 ${diff.toFixed(3)}  ${pass ? "✓" : "✗ 不一致，两份代码已分叉"}`
  );
}
console.log(
  `\n${ok ? "✓ 实现与评估同源：alert-ranker.ts 复现了评估数字" : "✗ 对表失败：先修到一致再说"}\n` +
    `  （注：分组模式 ④ 是新增形态，python 侧无对应数字；它牺牲一点 AUC 换取「不整族沉底」）`
);
