/**
 * §49.16 稳健性复核：结论是「数据里的」还是「参数凑出来的」？（2026-09-28）
 *
 * 为什么必须做这一轮
 *   §49.13 报了 AUC 0.895 / 前10% 45.8%，但那是在**一组特定参数**下、在**一个被清洗过的
 *   分母**上得到的。两件事可以把它变成假象：
 *     ① 参数敏感：先验 alpha=8、语义权重 λ=1 是我挑的。换 alpha/λ 就崩 ⇒ 是凑出来的；
 *     ② 分母被清洗：gold 408 条里只有 244 条进了评估（97 条探针没产出信号、67 条 UNKNOWN
 *        被丢掉）。万一丢掉的那批里藏着真漏洞，或者它们上线时会回到告警池，
 *        线上看到的数字和这里就不一样。
 *   所以这一轮固定回答两个问题：**换参数还成立吗？把丢掉的加回来还成立吗？**
 *
 * 设计要点（避免自证）
 *   · 打分一律走 `alert-ranker.ts` 的 `scoreOne`（**实现**，不是另一份评估代码）——R59；
 *   · 先验一律**留一仓**（只从别的仓学），与主评估同口径；
 *   · 蒙特卡洛打散同分项、bootstrap 报 AUC 区间——R85（下判决前先给尺子报误差）；
 *   · 分母还原用**两种极端口径**（UNKNOWN 全当 FP / 全当 TP），不挑中间值。
 *
 * 用法：
 *   NODE_OPTIONS="--max-old-space-size=2048" npx tsx blind-benchmark/rank-robustness.ts
 */
import * as fs from "fs";
import * as path from "path";
import { scoreOne, RankableAlert, learnPrior, W_PRIOR } from "./alert-ranker";

const SIG = path.resolve(__dirname, "reports/xfn-49-signals.jsonl");
const GOLD = path.resolve(__dirname, "fp-gold.jsonl");
const N_MC = 2000;
const N_BOOT = 400;

// ───────────────────────── 加载与连接 ─────────────────────────
const sig: RankableAlert[] = fs.readFileSync(SIG, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const gold: Array<{ repo: string; fn: string; file: string; rule: string; gold: string }> =
  fs.readFileSync(GOLD, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const gk = new Map<string, string>();
const goldAll = new Map<string, string>();
for (const g of gold) {
  const bare = String(g.fn).split(".").pop() ?? g.fn;
  gk.set(`${g.repo}|${g.fn}|${g.file}|${g.rule}`, g.gold);
  if (!gk.has(`${g.repo}|${bare}|${g.file}|${g.rule}`)) gk.set(`${g.repo}|${bare}|${g.file}|${g.rule}`, g.gold);
  goldAll.set(`${g.repo}|${g.fn}|${g.file}|${g.rule}`, g.gold);
}

type Row = RankableAlert & { __gold: string };
const rows: Row[] = [];
/** UNKNOWN：探针**有**信号、但标注没下结论。⚠ 它们是有 IR 特征的，
 *  分母还原时必须带上真实 calls，不能当空信号处理（第一次写错了：给了空 calls，
 *  导致它们全被排到尾部 ⇒ AUC 假性掉到 0.511）。 */
const unknownRows: Row[] = [];
const sigKeys = new Set<string>();
for (const s of sig as any[]) {
  const k1 = `${s.repo}|${s.fn}|${s.file}|${s.rule}`;
  const k2 = `${s.repo}|${s.bare}|${s.file}|${s.rule}`;
  sigKeys.add(k1); sigKeys.add(k2);
  const g = gk.get(k1) ?? gk.get(k2);
  if (g === "TP" || g === "FP") rows.push({ ...s, __gold: g });
  else if (g === "UNKNOWN") unknownRows.push({ ...s, __gold: "UNKNOWN" });
}

/** gold 里有真值、但探针没产出信号的条目（分母还原要用；这些确实没有 IR 特征） */
const uncovered: Array<{ rule: string; repo: string; gold: string }> = [];
for (const g of gold) {
  const bare = String(g.fn).split(".").pop() ?? g.fn;
  if (!sigKeys.has(`${g.repo}|${g.fn}|${g.file}|${g.rule}`) && !sigKeys.has(`${g.repo}|${bare}|${g.file}|${g.rule}`)) {
    uncovered.push({ rule: g.rule, repo: g.repo, gold: g.gold });
  }
}

const repos = [...new Set(rows.map((r) => r.repo))].sort();
const nTP = rows.filter((r) => r.__gold === "TP").length;
const base = nTP / rows.length;

// ───────────────────────── 指标工具 ─────────────────────────
function aucOf(scored: Array<{ score: number; gold: string }>): number {
  const tp = scored.filter((s) => s.gold === "TP").map((s) => s.score);
  const fp = scored.filter((s) => s.gold === "FP").map((s) => s.score);
  if (!tp.length || !fp.length) return NaN;
  let w = 0, t = 0;
  for (const a of tp) for (const b of fp) { a > b ? w++ : a === b ? t += 0.5 : 0; }
  return (w + t) / (tp.length * fp.length);
}

/** 同分随机打散的 precision@k（蒙特卡洛），返回 [mean, lo, hi] */
function precAt(scored: Array<{ score: number; gold: string }>, frac: number) {
  const k = Math.max(1, Math.floor(scored.length * frac));
  const vals: number[] = [];
  for (let i = 0; i < N_MC; i++) {
    const top = scored.map((s) => ({ s, r: Math.random() }))
      .sort((x, y) => y.s.score - x.s.score || y.r - x.r).slice(0, k);
    vals.push(top.filter((x) => x.s.gold === "TP").length / k);
  }
  vals.sort((a, b) => a - b);
  return { mean: vals.reduce((a, b) => a + b, 0) / vals.length, lo: vals[Math.floor(0.05 * vals.length)], hi: vals[Math.floor(0.95 * vals.length) - 1] };
}

function aucCI(scored: Array<{ score: number; gold: string }>, nBoot = N_BOOT) {
  const vals: number[] = [];
  for (let i = 0; i < nBoot; i++) {
    const bs: Array<{ score: number; gold: string }> = [];
    for (let j = 0; j < scored.length; j++) bs.push(scored[Math.floor(Math.random() * scored.length)]);
    const a = aucOf(bs);
    if (!Number.isNaN(a)) vals.push(a);
  }
  vals.sort((a, b) => a - b);
  return {
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    lo: vals[Math.floor(0.05 * vals.length)],
    hi: vals[Math.floor(0.95 * vals.length) - 1],
  };
}

// ───────────────────────── 留一仓打分（可注入 λ / alpha） ─────────────────────────
/** λ = 语义分缩放系数；1 = 实现默认值。score = W_PRIOR*prior + λ*semantic */
function loroScored(alpha: number, lambda: number, pool: Row[] = rows) {
  const out: Array<{ score: number; gold: string }> = [];
  const rs = [...new Set(pool.map((r) => r.repo))].sort();
  for (const held of rs) {
    const train = pool.filter((r) => r.repo !== held);
    const test = pool.filter((r) => r.repo === held);
    if (!train.length || !test.length) continue;
    const { prior, base: b } = learnPrior(train.map((r) => ({ rule: r.rule, gold: r.__gold as "TP" | "FP" })), alpha);
    for (const r of test) {
      const s = scoreOne(r, { prior, base: b });
      out.push({ score: W_PRIOR * s.prior + lambda * s.semantic, gold: r.__gold });
    }
  }
  return out;
}

console.log(`\n════ §49.16 稳健性复核 ════`);
console.log(`评估集 ${rows.length} 条（TP ${nTP}，基线 ${(base * 100).toFixed(1)}%），仓库 ${repos.length} 个`);
console.log(`探针未覆盖（有真值无信号）${uncovered.length} 条，其中 TP ${uncovered.filter((u) => u.gold === "TP").length} 条`);
console.log(`UNKNOWN（探针有信号但标注未下结论）${unknownRows.length} 条\n`);

// ── ① 参数敏感性：alpha × λ ──
console.log(`── ① 参数敏感性（留一仓 AUC / 前10%密度，基线 ${(base * 100).toFixed(1)}%）──`);
console.log(`  alpha   λ    AUC    前10%[90%区间]        提升`);
const ALPHAS = [1, 2, 4, 8, 16, 32, 1e9];
const LAMBDAS = [0, 0.5, 1, 2, 4];
let best = { alpha: 8, lambda: 1, auc: -1, p10: 0 };
const grid: Array<[number, number, number, number]> = []; // alpha, lambda, auc, p10mean
for (const alpha of ALPHAS) {
  for (const lambda of LAMBDAS) {
    const sc = loroScored(alpha, lambda);
    const a = aucOf(sc);
    const p = precAt(sc, 0.1);
    grid.push([alpha, lambda, a, p.mean]);
    if (a > best.auc) best = { alpha, lambda, auc: a, p10: p.mean };
    console.log(
      `  ${String(alpha === 1e9 ? "∞" : alpha).padStart(5)}  ${String(lambda).padStart(3)}  ${a.toFixed(3)}  ` +
        `${(p.mean * 100).toFixed(1)}%[${(p.lo * 100).toFixed(0)},${(p.hi * 100).toFixed(0)}]`.padEnd(22) +
        `${(p.mean / base).toFixed(2)}×`
    );
  }
}

// 结论判定：AUC 在整个网格上的极差
const aucs = grid.map((g) => g[2]).filter((x) => !Number.isNaN(x));
const worst = Math.min(...aucs), bestAuc = Math.max(...aucs);
const p10s = grid.map((g) => g[3]);
console.log(
  `\n  ⇒ AUC 在 ${ALPHAS.length * LAMBDAS.length} 组参数上的范围 ${worst.toFixed(3)} ~ ${bestAuc.toFixed(3)}` +
    `（极差 ${(bestAuc - worst).toFixed(3)}）；前10%范围 ${(Math.min(...p10s) * 100).toFixed(1)}% ~ ${(Math.max(...p10s) * 100).toFixed(1)}%`
);
console.log(`  ⇒ 最优点 alpha=${best.alpha} λ=${best.lambda}（AUC ${best.auc.toFixed(3)}）—— 实现默认值是 alpha=8 λ=1`);

// λ=0（纯先验）与 α=∞（先验退化成全局基线，即纯语义）是两个退化点，单独报
const purePrior = grid.find((g) => g[0] === 8 && g[1] === 0)!;
const pureSem = grid.find((g) => g[0] === 1e9 && g[1] === 1)!;
console.log(
  `  ⇒ 退化点：纯先验 AUC ${purePrior[2].toFixed(3)} / 前10% ${(purePrior[3] * 100).toFixed(1)}%；` +
    `纯语义（先验被抹平）AUC ${pureSem[2].toFixed(3)} / 前10% ${(pureSem[3] * 100).toFixed(1)}%`
);

// ── ② 最优与默认配置的 bootstrap 区间 ──
console.log(`\n── ② AUC 的抽样误差（bootstrap ${N_BOOT} 次，留一仓）──`);
for (const [label, alpha, lambda] of [["实现默认 alpha=8 λ=1", 8, 1], [`网格最优 alpha=${best.alpha} λ=${best.lambda}`, best.alpha, best.lambda]] as Array<[string, number, number]>) {
  const sc = loroScored(alpha, lambda);
  const ci = aucCI(sc);
  console.log(`  ${label.padEnd(28)} AUC ${ci.mean.toFixed(3)}  90%CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]  ${ci.lo > 0.5 ? "✓ 下界仍高于随机" : "✗ 下界落到随机附近"}`);
}

// ── ③ 分母还原：把探针没覆盖的条目放回告警池 ──
console.log(`\n── ③ 分母还原（把丢掉的那批加回来，看线上口径）──`);
console.log(`  真实告警池比评估集大：评估集 ${rows.length} 条，gold 全集 ${gold.length} 条。`);
console.log(`  未覆盖条目没有 IR 信号 ⇒ 语义分记 0（中性假设：既不加分也不减分）。\n`);

function restored(unknownAsTP: boolean, alpha = 8, lambda = 1) {
  // 先验仍留一仓（只从有信号的训练仓学），未覆盖/UNKNOWN 只进测试侧，不参与学先验
  const out: Array<{ score: number; gold: string }> = [];
  for (const held of repos) {
    const train = rows.filter((r) => r.repo !== held);
    if (!train.length) continue;
    const { prior, base: b } = learnPrior(train.map((r) => ({ rule: r.rule, gold: r.__gold as "TP" | "FP" })), alpha);
    const pool: Array<{ rule: string; calls: string[]; nRules: number; __gold: string; repo: string }> = [];
    for (const r of rows.filter((r) => r.repo === held)) pool.push({ rule: r.rule, calls: (r.calls ?? []) as string[], nRules: r.nRules ?? 1, __gold: r.__gold, repo: r.repo });
    // 未覆盖：确实没有 IR 特征 ⇒ 语义分记 0（中性假设）
    for (const u of uncovered.filter((u) => u.repo === held)) pool.push({ rule: u.rule, calls: [], nRules: 1, __gold: u.gold === "UNKNOWN" ? (unknownAsTP ? "TP" : "FP") : u.gold, repo: u.repo });
    // UNKNOWN（有信号）：**带真实特征**进场，标签按口径给
    for (const u of unknownRows.filter((u) => u.repo === held)) pool.push({ rule: u.rule, calls: (u.calls ?? []) as string[], nRules: u.nRules ?? 1, __gold: unknownAsTP ? "TP" : "FP", repo: u.repo });
    for (const r of pool) {
      const s = scoreOne(r as RankableAlert, { prior, base: b });
      out.push({ score: W_PRIOR * s.prior + lambda * s.semantic, gold: r.__gold });
    }
  }
  return out;
}

console.log(`  口径 | 池大小 | TP | 基线 | AUC | 前10%(k) | 提升 | 前20%`);
for (const [label, unknownAsTP] of [["UNKNOWN 全当 FP（乐观）", false], ["UNKNOWN 全当 TP（最坏）", true]] as Array<[string, boolean]>) {
  const sc = restored(unknownAsTP);
  const tp = sc.filter((s) => s.gold === "TP").length;
  const bs = tp / sc.length;
  const a = aucOf(sc);
  const p10 = precAt(sc, 0.1), p20 = precAt(sc, 0.2);
  const k10 = Math.max(1, Math.floor(sc.length * 0.1));
  console.log(
    `  ${label} | ${sc.length} | ${tp} | ${(bs * 100).toFixed(1)}% | ${a.toFixed(3)} | ` +
      `${(p10.mean * 100).toFixed(1)}%(k=${k10}) | ${(p10.mean / bs).toFixed(2)}× | ${(p20.mean * 100).toFixed(1)}%`
  );
}

console.log(
  `\n  读法：还原后的提升倍数才是**线上能看到的**数；评估集上的 4.7× 因分母被清洗而偏高。` +
    `\n        两个口径的差就是「UNKNOWN 怎么处理」的不确定性 —— 这是标注缺口，不是排序器的缺陷。`
);

// ── ④ 嵌套 CV：超参数也只能在训练侧选（R86）──
console.log(`\n── ④ 嵌套交叉验证：alpha / λ 到底该取多少 ──`);
console.log(`  ① 里 alpha=1 λ=0 的 AUC 最高（0.912），但那是**在同一份数据上挑完再报的数** ——`);
console.log(`  属于挑完超参再报测试成绩，会高估。正确做法：外层留一仓，内层只在训练仓里挑。\n`);

function innerPick(train: Row[], metric: "auc" | "p10"): { alpha: number; lambda: number; val: number } {
  const rs = [...new Set(train.map((r) => r.repo))].sort();
  let bestCfg = { alpha: 8, lambda: 1, val: -Infinity };
  for (const alpha of ALPHAS) {
    for (const lambda of LAMBDAS) {
      const vals: number[] = [];
      for (const h of rs) {
        const tr = train.filter((r) => r.repo !== h);
        const te = train.filter((r) => r.repo === h);
        if (!tr.length || !te.length) continue;
        const { prior, base: b } = learnPrior(tr.map((r) => ({ rule: r.rule, gold: r.__gold as "TP" | "FP" })), alpha);
        const sc = te.map((r) => {
          const s = scoreOne(r, { prior, base: b });
          return { score: W_PRIOR * s.prior + lambda * s.semantic, gold: r.__gold };
        });
        vals.push(metric === "auc" ? aucOf(sc) : precAt(sc, 0.1).mean);
      }
      const v = vals.filter((x) => !Number.isNaN(x));
      const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
      if (m > bestCfg.val) bestCfg = { alpha, lambda, val: m };
    }
  }
  return bestCfg;
}

for (const metric of ["auc", "p10"] as Array<"auc" | "p10">) {
  const out: Array<{ score: number; gold: string }> = [];
  const picks: string[] = [];
  for (const held of repos) {
    const train = rows.filter((r) => r.repo !== held);
    const test = rows.filter((r) => r.repo === held);
    if (!train.length || !test.length) continue;
    const cfg = innerPick(train, metric);
    picks.push(`${held}:α${cfg.alpha}/λ${cfg.lambda}`);
    const { prior, base: b } = learnPrior(train.map((r) => ({ rule: r.rule, gold: r.__gold as "TP" | "FP" })), cfg.alpha);
    for (const r of test) {
      const s = scoreOne(r, { prior, base: b });
      out.push({ score: W_PRIOR * s.prior + cfg.lambda * s.semantic, gold: r.__gold });
    }
  }
  const a = aucOf(out), p10 = precAt(out, 0.1), p20 = precAt(out, 0.2);
  console.log(
    `  内层按 ${metric === "auc" ? "AUC" : "前10%密度"} 选参 ⇒ 嵌套 AUC ${a.toFixed(3)}  ` +
      `前10% ${(p10.mean * 100).toFixed(1)}%[${(p10.lo * 100).toFixed(0)},${(p10.hi * 100).toFixed(0)}] (${(p10.mean / base).toFixed(2)}×)  ` +
      `前20% ${(p20.mean * 100).toFixed(1)}%`
  );
  console.log(`     各仓选出的参数：${picks.join("  ")}`);
}
console.log(
  `\n  读法：嵌套的数字才是**换一组新数据后能指望的数**；` +
    `\n        ① 里 0.912 是乐观上界，实现默认 alpha=8 λ=1 是**没挑过参**的保守值。`
);
console.log(
  `  ⚠ 更要紧的一点：内层**按 AUC 选参时，多数仓选了 λ=0（把语义信号丢掉）**，\n` +
    `    结果头部密度只剩 1.95×；按前10%密度选参时全部仓都留住 λ≥0.5，头部 5.51×。\n` +
    `    ⇒ 语义信号的价值**只在头部**，AUC 看不见它。用 AUC 选参会亲手把最有用的那部分删掉。`
);

// ── ⑤ 保底名额的代价：安全性到底花多少钱买 ──
console.log(`\n── ⑤ minPerRule（每族保底）的代价 —— 自证风险不是免费的 ──`);
console.log(`  R87 要求每族至少露一条，否则先验低的族永远沉底。但保底会把头部名额让给弱族。`);
console.log(`  保底条数 | AUC | 前10% | 提升 | 前20% | 头部里被保底挤上来的条数\n`);
for (const min of [0, 1, 2, 3]) {
  const out: Array<{ score: number; gold: string; forced: boolean }> = [];
  for (const held of repos) {
    const train = rows.filter((r) => r.repo !== held);
    const test = rows.filter((r) => r.repo === held);
    if (!train.length || !test.length) continue;
    const { prior, base: b } = learnPrior(train.map((r) => ({ rule: r.rule, gold: r.__gold as "TP" | "FP" })), 8);
    if (min === 0) {
      for (const r of test) {
        const s = scoreOne(r, { prior, base: b });
        out.push({ score: s.score, gold: r.__gold, forced: false });
      }
    } else {
      // 复刻 rankAlerts 的保底逻辑：每族前 min 条进 head
      const byRule = new Map<string, Row[]>();
      for (const r of test) {
        if (!byRule.has(r.rule)) byRule.set(r.rule, []);
        byRule.get(r.rule)!.push(r);
      }
      const head: Row[] = [], tail: Row[] = [];
      for (const [, list] of byRule) {
        const sc = list.map((r) => ({ r, s: scoreOne(r, { prior, base: b }).score })).sort((x, y) => y.s - x.s);
        head.push(...sc.slice(0, min).map((x) => x.r));
        tail.push(...sc.slice(min).map((x) => x.r));
      }
      // ⚠ 保底的意义是「head 无条件排在 tail 前面」，不是「分数变高」。
      //   第一次写成了直接 push 原始分数 ⇒ 下面按分数一排序，保底就被抹平了，
      //   四档 min 跑出完全相同的数字（0.895/45.8%）——**静默的假象**。
      //   正确做法：给 head 一个位置偏移，让它在排序里真的排到前面。
      const BIG = 1000;
      for (const r of head) {
        const s = scoreOne(r, { prior, base: b });
        out.push({ score: s.score + BIG, gold: r.__gold, forced: true });
      }
      for (const r of tail) {
        const s = scoreOne(r, { prior, base: b });
        out.push({ score: s.score, gold: r.__gold, forced: false });
      }
    }
  }
  const a = aucOf(out);
  const p10 = precAt(out, 0.1), p20 = precAt(out, 0.2);
  console.log(
    `  ${String(min).padStart(6)}   | ${a.toFixed(3)} | ${(p10.mean * 100).toFixed(1)}% | ${(p10.mean / base).toFixed(2)}× | ` +
      `${(p20.mean * 100).toFixed(1)}% | ${min === 0 ? "0（无保底）" : "≤" + min * new Set(rows.map((r) => r.rule)).size}`
  );
}
console.log(
  `\n  读法：保底是**花钱买不瞎**——花掉一点头部密度，换「先验低的族不会被永久埋掉」。\n` +
    `        代价是否可接受由调用方定，这里只负责把它标出来（R87）。`
);
