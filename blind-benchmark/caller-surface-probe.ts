/**
 * 修冤枉第七刀预研探针：授权族 600 条剩余告警的根因形状量化（只读，不改 src）
 *
 * 候选子类（上一刀收口时登记的「repo 层残留」）：
 *   A. 队列作业调用方未守卫 —— 函数 F 的全部调用方都是无请求面函数
 *      （__progmune_no_request_surface__ 标记，第六刀已注入 @Processor/@Interval/
 *      @Cron/@Timeout/@OnEvent 形态）。F 自身不是作业，但只有作业调它 ⇒
 *      授权族「缺鉴权/缺属主校验」提问不适用（同第六刀语义，差在调用方层级）。
 *   B. 歧义名 —— 同裸名函数多个，消歧 fail-safe 时保守报出。
 *
 * 判据（R75：抑制判据只用正向证据；R57：抑制方向必须报 TP 须 0）：
 *   A 类仅当「调用方集合非空且全部带 no_request_surface 标记」才计入候选——
 *   0 调用方（无法证明内部通道）与混合调用方（含 HTTP 面）一律不计。
 *
 * 用法：
 *   npx ts-node blind-benchmark/caller-surface-probe.ts [--show 30]
 *
 * 输入：blind-benchmark/reports/heldout/trust-docmost-65ab-pre.json（第六刀后
 * 注入开的告警流快照）+ docmost server IR（现场提取，注入开）。
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes } from "../src/extract-ir";

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server");
const ALERTS = path.join(ROOT, "blind-benchmark", "reports", "heldout", "trust-docmost-65ab-pre.json");

const SURFACE_MARK = "__progmune_no_request_surface__";

// ── 1. 提取 docmost server IR（注入开） ──
console.log("extracting IR (injection ON)...");
const fns = extractIRWithTypes(SERVER_DIR).functions;
console.log(`IR functions: ${fns.length}`);

interface FnInfo {
  name: string;
  file?: string;
  calls?: string[];
}
const byFullName = new Map<string, FnInfo>();
for (const f of fns) byFullName.set(f.name, f);

// 裸名 → 全名集合（歧义名量化用）
const byBareName = new Map<string, string[]>();
for (const f of fns) {
  const bare = f.name.split(".").pop() || f.name;
  const arr = byBareName.get(bare) ?? [];
  arr.push(f.name);
  byBareName.set(bare, arr);
}

// 反向调用图：被调名（裸名/全名）→ 调用方全名集合
const callersByFull = new Map<string, Set<string>>();
const callersByBare = new Map<string, Set<string>>();
for (const f of fns) {
  for (const c of f.calls ?? []) {
    const bareC = c.split(".").pop() || c;
    const targetFull = byFullName.get(c) || byFullName.get(bareC);
    if (targetFull) {
      if (!callersByFull.has(targetFull.name)) callersByFull.set(targetFull.name, new Set());
      callersByFull.get(targetFull.name)!.add(f.name);
    }
    if (!callersByBare.has(bareC)) callersByBare.set(bareC, new Set());
    callersByBare.get(bareC)!.add(f.name);
  }
}

// ── 2. 读 65ab-pre 的授权族告警 ──
const report = JSON.parse(fs.readFileSync(ALERTS, "utf8"));
type AlertRow = { rule: string; fn: string; file: string };
const rows: AlertRow[] = [];
for (const g of report.overall.safeguardAlerts.groups) {
  if (!/Authorization|Payment Refund/.test(g.rule)) continue;
  for (const e of g.alerts ?? []) {
    rows.push({ rule: g.rule, fn: e.alert.function, file: e.alert.file });
  }
}
console.log(`authorization alerts: ${rows.length}`);

// ── 3. 分类 ──
// A 类判据：全部调用方（按全名或裸名解析到的）都带 no_request_surface 标记，
// 且调用方集合非空。
// B 类判据：裸名在项目里出现 ≥2 次。
const isJob = (fullName: string): boolean => {
  const f = byFullName.get(fullName);
  return !!f && (f.calls ?? []).includes(SURFACE_MARK);
};

type ClassRow = AlertRow & { classA: boolean; classB: boolean; callerCount: number; jobCallerCount: number; bareCount: number; callers: string[] };

const classified: ClassRow[] = rows.map((r) => {
  const bare = r.fn.split(".").pop() || r.fn;
  const callersFull = callersByFull.get(r.fn);
  const callersBare = callersByBare.get(bare);
  const callers = new Set<string>();
  for (const c of callersFull ?? []) callers.add(c);
  for (const c of callersBare ?? []) callers.add(c);
  const callerList = [...callers];
  const jobCallers = callerList.filter(isJob);
  const classA = callerList.length > 0 && jobCallers.length === callerList.length;
  const bareCount = byBareName.get(bare)?.length ?? 0;
  const classB = bareCount >= 2;
  return { ...r, classA, classB, callerCount: callerList.length, jobCallerCount: jobCallers.length, bareCount, callers: callerList };
});

const countA = classified.filter((c) => c.classA).length;
const countB = classified.filter((c) => c.classB).length;
const countAB = classified.filter((c) => c.classA && c.classB).length;
console.log("\n=== 分类结果 ===");
console.log(`A 类（调用方全为作业，可豁免候选）: ${countA}`);
console.log(`B 类（裸名歧义 ≥2 定义）: ${countB}`);
console.log(`A∩B: ${countAB}`);
console.log(`A 类中调用方为 0 但被排除的（无法证明内部通道）: ${classified.filter((c) => c.callerCount === 0).length}`);
console.log(`混合调用方（含 HTTP 面，不豁免）: ${classified.filter((c) => c.callerCount > 0 && c.jobCallerCount < c.callerCount).length}`);

// A 类按规则分布
const aByRule = new Map<string, number>();
for (const c of classified.filter((x) => x.classA)) aByRule.set(c.rule, (aByRule.get(c.rule) ?? 0) + 1);
console.log("\nA 类按规则:", JSON.stringify(Object.fromEntries(aByRule)));

// B 类按规则分布
const bByRule = new Map<string, number>();
for (const c of classified.filter((x) => x.classB)) bByRule.set(c.rule, (bByRule.get(c.rule) ?? 0) + 1);
console.log("B 类按规则:", JSON.stringify(Object.fromEntries(bByRule)));

// A 类按调用方形态
const aByCaller = new Map<string, number>();
for (const c of classified.filter((x) => x.classA)) {
  const callerBare = c.callers.map((n) => n.split(".").pop()).join(",");
  aByCaller.set(callerBare, (aByCaller.get(callerBare) ?? 0) + 1);
}
console.log("\nA 类按调用方（裸名）top:", JSON.stringify([...aByCaller.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12)));

// ── 4. 输出 A 类清单 ──
const show = process.argv.includes("--show") ? parseInt(process.argv[process.argv.indexOf("--show") + 1] ?? "30") : 30;
console.log(`\n=== A 类清单（前 ${show}）===`);
for (const c of classified.filter((x) => x.classA).slice(0, show)) {
  console.log(`  ${c.rule.slice(0, 42).padEnd(42)} ${c.fn}  callers=[${c.callers.map((n) => n.split(".").pop()).join(", ")}]`);
}

// 写全量分类结果供后续探针复用
const out = path.join(ROOT, "blind-benchmark", "reports", "caller-surface-classification.json");
fs.writeFileSync(out, JSON.stringify(classified, null, 2));
console.log(`\nwrote ${out}`);
