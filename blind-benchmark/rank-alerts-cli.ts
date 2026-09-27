/**
 * §49.16 排序器命令行入口 —— 把 alert-ranker.ts 接到**真实扫描产物**上（2026-09-28）
 *
 * 为什么单开一个 CLI 而不是改扫描器
 *   排序是**呈现层**的事，不是判定层的事。改扫描器会让「判定什么」和「先给看什么」
 *   耦合在一起，以后调排序就要重跑扫描、还要重过四门。这里只读扫描产物、只重排顺序，
 *   **一条告警都不会被删掉**（输入 N 条 ⇒ 输出 N 条），判定逻辑零改动。
 *
 * 输入格式：batch-scan / fp-pool-scan 的 JSON（projects[].perFunction[]），
 *   每条函数有 name / file / calls / safeguardViolations[{rule,...}]。
 *   ⇒ 需要的字段扫描产物里**全都有**，不需要扩 IR、不需要改 src。
 *
 * 用法：
 *   npx tsx blind-benchmark/rank-alerts-cli.ts reports/batch-scan-results.json
 *   npx tsx blind-benchmark/rank-alerts-cli.ts <scan.json> --top 30 --grouped --min-per-rule 1
 *   npx tsx blind-benchmark/rank-alerts-cli.ts <scan.json> --project docmost --json out.json
 *   npx tsx blind-benchmark/rank-alerts-cli.ts <scan.json> --no-prior        # 只用语义信号
 *   npx tsx blind-benchmark/rank-alerts-cli.ts <scan.json> --prior-file p.json  # 用自己项目的先验
 */
import * as fs from "fs";
import * as path from "path";
import { rankAlerts, groupAlerts, scoreOne, RankableAlert, RankOptions, DEFAULT_RULE_PRIOR, learnPrior } from "./alert-ranker";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? (argv[i + 1] ?? d ?? "") : (d ?? "");
};
const has = (n: string) => argv.includes(n);

const input = argv.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("用法: npx tsx blind-benchmark/rank-alerts-cli.ts <scan.json> [--top N] [--grouped] [--min-per-rule N] [--project P] [--json out.json] [--no-prior] [--prior-file f.json]");
  process.exit(1);
}
const TOP = Number(flag("--top", "20") || 20);
const GROUPED = has("--grouped");
const MIN_PER_RULE = Number(flag("--min-per-rule", "0") || 0);
const PROJECT = flag("--project", "");
const JSONOUT = flag("--json", "");

// ── 读入扫描产物，摊平成告警列表 ──
const scan = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), input), "utf8"));
const projects: any[] = Array.isArray(scan.projects) ? scan.projects : [scan];
if (PROJECT) {
  const keep = projects.filter((p) => String(p.project ?? p.name ?? "").includes(PROJECT));
  if (!keep.length) console.error(`⚠ 没有项目名包含 "${PROJECT}"`);
  projects.length = 0; projects.push(...keep);
}

type Alert = RankableAlert & { __project: string; __file: string; __fn: string };
const alerts: Alert[] = [];
for (const p of projects) {
  const pname = String(p.project ?? p.name ?? "?");
  for (const f of p.perFunction ?? p.functions ?? []) {
    const calls: string[] = Array.isArray(f.calls) ? f.calls : [];
    const vs: any[] = f.safeguardViolations ?? [];
    for (const v of vs) {
      alerts.push({
        rule: String(v.rule ?? v.category ?? "?"),
        calls,
        params: f.params ?? [],
        nRules: vs.length,
        __project: pname,
        __file: String(f.file ?? ""),
        __fn: String(f.name ?? ""),
      });
    }
  }
}

const opts: RankOptions = { minPerRule: MIN_PER_RULE };
if (has("--no-prior")) opts.usePrior = false;
if (has("--prior-file")) {
  const pf = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), flag("--prior-file")), "utf8"));
  opts.prior = pf.prior ?? pf;
  opts.base = pf.base;
}

const rankedRaw = GROUPED
  ? groupAlerts(alerts, opts).flatMap((g) => g.alerts)
  : rankAlerts(alerts, opts);

/**
 * 形态去重：同一个「规则族 + 函数名」在不同项目里重复出现时只占一个头部位置。
 * 为什么必须有：实测在 batch-scan 的 2605 条上，前 15 条里有 11 条是不同项目里
 * 同构的 `createAccount`（分数一模一样）——头部被同一问题的 11 份拷贝占满，
 * 用户翻三页看到的是同一件事。**排序的第一屏是稀缺资源，不能批发给重复项。**
 */
const DEDUPE = !has("--no-dedupe");
interface Buck { rep: typeof rankedRaw[number]; n: number; projects: string[]; files: string[] }
const ranked: Array<typeof rankedRaw[number]> = [];
const dups = new Map<string, Buck>();
if (DEDUPE) {
  for (const r of rankedRaw) {
    const a = r.alert as Alert;
    const key = `${a.rule}|${String(a.__fn).split(".").pop()}`;
    const b = dups.get(key);
    if (!b) {
      dups.set(key, { rep: r, n: 1, projects: [a.__project], files: [a.__file] });
      ranked.push(r);
    } else {
      b.n++;
      if (!b.projects.includes(a.__project)) b.projects.push(a.__project);
      if (b.files.length < 3 && !b.files.includes(a.__file)) b.files.push(a.__file);
    }
  }
} else {
  ranked.push(...rankedRaw);
}

// ── 输出 ──
console.log(`\n════ 告警排序（${GROUPED ? "分组形态 · 推荐" : "全局平铺"}）════`);
console.log(`输入 ${alerts.length} 条告警 / ${projects.length} 个项目 / ${new Set(alerts.map((a) => a.rule)).size} 个规则族`);
console.log(`⚠ 排序**不删任何告警**：排序结果仍是 ${rankedRaw.length} 条 == 输入 ${alerts.length} 条。`);
console.log(`  下面的列表只是把「同族 + 同函数名」的重复项**合并展示**为 ${ranked.length} 个形态` +
  `（--no-dedupe 可关掉；--json 导出的是**未合并的全量**）。\n`);

console.log(`── 前 ${Math.min(TOP, ranked.length)} 条${DEDUPE ? "（同族同名已合并）" : "（未去重）"} ──`);
console.log(` #  分数   先验   项目 / 函数                                 规则族`);
ranked.slice(0, TOP).forEach((r, i) => {
  const a = r.alert as Alert;
  const loc = `${a.__project}/${a.__fn}`.slice(0, 44);
  const buck = DEDUPE ? dups.get(`${a.rule}|${String(a.__fn).split(".").pop()}`) : undefined;
  const dup = buck && buck.n > 1 ? ` ×${buck.n}` : "";
  console.log(
    `${String(i + 1).padStart(2)}  ${r.score.toFixed(2).padStart(5)}  ${r.prior.toFixed(3)}  ${loc.padEnd(45)} ${a.rule.slice(0, 34)}${dup}`
  );
  if (buck && buck.n > 1) {
    const others = buck.projects.filter((p) => p !== a.__project);
    console.log(`      ↳ 同类另有 ${buck.n - 1} 处：${others.slice(0, 3).join("、")}${others.length > 3 ? ` 等 ${buck.projects.length} 个项目` : ""}`);
  }
  if (r.reasons.length) console.log(`      ↳ ${r.reasons.join("；")}`);
});
if (DEDUPE) {
  console.log(
    `\n  去重效果：${rankedRaw.length} 条 → ${ranked.length} 个形态` +
      `（合并掉 ${rankedRaw.length - ranked.length} 条同族同名重复）`
  );
}

// ── 排序到底把什么提上来了：头部族分布 vs 全池族分布 ──
const k = Math.max(1, Math.floor(ranked.length * 0.1));
const head = ranked.slice(0, k);
// ⚠ 口径统一：全池占比必须也按**去重后的池**算，否则拿去重后的头部去比未去重的全池，
//   变化量会被放大成假的（这就是 R77 说的分母意识）。
const pool = ranked.map((r) => r.alert as Alert);
const cntAll = new Map<string, number>(), cntHead = new Map<string, number>();
for (const a of pool) cntAll.set(a.rule, (cntAll.get(a.rule) ?? 0) + 1);
for (const r of head) cntHead.set(r.alert.rule, (cntHead.get(r.alert.rule) ?? 0) + 1);
console.log(`\n── 前 10%（k=${k}）的族构成 vs 全池 —— 排序到底改变了什么 ──`);
console.log(` 规则族                                    全池占比   前10%占比   变化`);
const rules = [...new Set(pool.map((a) => a.rule))].sort(
  (x, y) => (cntHead.get(y) ?? 0) / k - (cntHead.get(x) ?? 0) / k
);
for (const r of rules.slice(0, 12)) {
  const pa = (cntAll.get(r) ?? 0) / alerts.length;
  const ph = (cntHead.get(r) ?? 0) / k;
  const d = ph - pa;
  console.log(
    ` ${r.slice(0, 42).padEnd(43)} ${(pa * 100).toFixed(1).padStart(5)}%   ${(ph * 100).toFixed(1).padStart(5)}%   ${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}pp`
  );
}

// ── 先验来源提示（R87 的自证风险）──
const unknownRules = [...new Set(alerts.map((a) => a.rule))].filter((r) => !(r in DEFAULT_RULE_PRIOR));
if (unknownRules.length) {
  console.log(`\n⚠ ${unknownRules.length} 个族不在内置先验表里，按全局基线 ${(opts.base ?? 0.0984).toFixed(4)} 处理：`);
  console.log(`  ${unknownRules.slice(0, 8).join(" / ")}${unknownRules.length > 8 ? " …" : ""}`);
  console.log(`  ⇒ 这些族没有历史数据支撑 ⇒ 建议在项目里攒够反馈后用 learnPrior 重估（--prior-file）。`);
}
console.log(
  `\n⚠ 先验来自 fp-gold 标注，有自证风险：先验低的族会沉底 ⇒ 永远发现不了它的真漏洞。\n` +
    `  生产建议：用 --grouped（每族都有一块）或 --min-per-rule 1（每族保底一条）。\n`
);

if (JSONOUT) {
  // 导出**全量未合并**的排序结果（契约：一条不少），重复项带上 dupKey 供下游自己聚合
  const out = rankedRaw.map((r, i) => {
    const a = r.alert as Alert;
    const dupKey = `${a.rule}|${String(a.__fn).split(".").pop()}`;
    return {
      rank: i + 1,
      project: a.__project,
      file: a.__file,
      fn: a.__fn,
      rule: a.rule,
      score: Number(r.score.toFixed(4)),
      prior: Number(r.prior.toFixed(4)),
      semantic: Number(r.semantic.toFixed(4)),
      reasons: r.reasons,
      dupKey,
      dupCount: dups.get(dupKey)?.n ?? 1,
    };
  });
  fs.writeFileSync(path.resolve(process.cwd(), JSONOUT), JSON.stringify(out, null, 2));
  console.log(`✓ 已写出全部 ${out.length} 条到 ${JSONOUT}（未合并，含 dupKey/dupCount）`);
}
