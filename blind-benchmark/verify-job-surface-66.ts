/**
 * 修冤枉第七刀验收：23 条被压告警逐条核对（只读）
 *
 * 输入：
 *   1. blind-benchmark/reports/heldout/trust-docmost-66ab-pre.json（toggle 开的扫描产物）
 *   2. benchmarks/ts-apps/docmost/apps/server/ir.json（扫描写盘的 IR，注入开）
 *
 * 核对项（每条被压告警）：
 *   R5/R6  函数自身不带 __progmune_no_request_surface__ 标记（直接标记不重复豁免）
 *   调用方 并集非空 且 全部带标记（B 判据结构保证，此处独立复核）
 *   TP 面  列出调用方清单（名字+文件），供人工确认都是作业处理器而非 HTTP 面
 *
 * 用法：npx ts-node blind-benchmark/verify-job-surface-66.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const REPORT = path.join(ROOT, "blind-benchmark", "reports", "heldout", "trust-docmost-66ab-pre.json");
const IR = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server", "ir.json");
const MARK = "__progmune_no_request_surface__";

const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
const ir = JSON.parse(fs.readFileSync(IR, "utf8"));
const functions: Array<{ name: string; file?: string; calls?: string[] }> = Array.isArray(ir)
  ? ir
  : ir.functions || [];

const suppressed = (report.overall.safeguardAlerts.suppressed || []).filter(
  (s: any) => s.suppressedByJobSurfacePropagation === true
);
console.log(`被压条目（job 标记）: ${suppressed.length}`);

const byName = new Map(functions.map((f) => [f.name, f]));
const byBare = new Map<string, string[]>();
for (const f of functions) {
  const bare = f.name.split(".").pop() || f.name;
  const arr = byBare.get(bare) ?? [];
  arr.push(f.name);
  byBare.set(bare, arr);
}
const marked = new Set(functions.filter((f) => (f.calls ?? []).includes(MARK)).map((f) => f.name));

let pass = 0;
const problems: string[] = [];
for (const s of suppressed) {
  const fn = s.function;
  const f = byName.get(fn);
  const bare = fn.split(".").pop() || fn;
  // R5/R6：自身不带标记
  const selfMarked = f ? (f.calls ?? []).includes(MARK) : false;
  // 调用方并集（IR 调用名即裸名；同名族全收）
  const callers: string[] = [];
  const nonJobCallers: string[] = [];
  for (const cf of functions) {
    for (const c of cf.calls ?? []) {
      const cb = c.split(".").pop() || c;
      if (cb === bare && !callers.includes(cf.name)) {
        callers.push(cf.name);
        if (!marked.has(cf.name)) nonJobCallers.push(cf.name);
      }
    }
  }
  const ok = !selfMarked && callers.length > 0 && nonJobCallers.length === 0;
  if (ok) pass++;
  else {
    problems.push(
      `  ✗ ${fn}: selfMarked=${selfMarked} callers=${callers.length} nonJobCallers=[${nonJobCallers.join(",")}]`
    );
  }
  console.log(
    `${ok ? "✓" : "✗"} ${s.rule.slice(0, 40).padEnd(40)} ${fn}\n      callers: ${callers.map((c) => `${c.split(".").pop()}${marked.has(c) ? "(job)" : "(HTTP?)"}`).join(", ") || "（无）"}`
  );
}
console.log(`\n核对通过 ${pass}/${suppressed.length}`);
if (problems.length) {
  console.log("问题条目：");
  for (const p of problems) console.log(p);
  process.exit(1);
}
