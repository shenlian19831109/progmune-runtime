/**
 * taintpath 语料族验收闸门（2026-09-19）
 *
 * 背景：TS 795 盲测对「路径穿越标记」连续三次【零覆盖】——语料里没有任何
 * `不可信根 → 文件 sink` 的流，`__progmune_path_traversal__` 出现次数前 0 后 0。
 * 于是「3086 flags LOST 0 / ADDED 0」这道硬门在这项能力上是**空过**。
 *
 * 本闸门把期望直接钉在 per-function 标记上：
 *   mark       —— 必须出现 __progmune_path_traversal__（召回）
 *   suppressed —— 有校验证据 / 无污点，必须**不**出现（精度）
 *   known-gap  —— 已知召回缺口，当前**不**出现；若出现说明缺口已补上，
 *                 本闸门会【失败】并提示更新期望（防止悄悄漂移）
 *
 * 用法：npx ts-node blind-benchmark/check-taintpath.ts [--report <report.json>]
 * 退出码 0 = 全部符合期望；非 0 = 有违反。
 *
 * ⚠ 2026-09-19 修订：**默认实时提取，不再读报告。**
 * 原实现默认读 `reports/batch-scan-results.json`。那是别人跑 batch-scan 留下的
 * 陈旧产物 —— 本闸门因此可以在代码已改、语料已变的情况下照旧报「24/24 全绿」。
 * 实测踩到：C4 落地后 4 条 known-gap 已翻正，闸门仍把它们报成「未标记，符合
 * 预期」（因为报告是上一版生成的）。这是**第二种空过**：不是没覆盖，是覆盖了
 * 但读到旧数据。故改为直接对 generated/taintpath_* 跑 extractIR；
 * 需要走报告时显式加 --report。
 */

import * as fs from "fs";
import * as path from "path";
import { extractIR } from "../src/extract-ir";

const MARKER = "__progmune_path_traversal__";
const EXPECT = path.resolve(__dirname, "taintpath-expectations.json");
const GENERATED = path.resolve(__dirname, "generated");

/** 实时模式：直接对语料目录跑 extractIR；报告模式：读 batch-scan 产物。 */
const reportIdx = process.argv.indexOf("--report");
const REPORT =
  reportIdx >= 0 && process.argv[reportIdx + 1]
    ? path.resolve(process.argv[reportIdx + 1])
    : null;

interface Case {
  fn: string;
  file: string;
  expect: "mark" | "suppressed" | "no-taint" | "known-gap";
  why: string;
}

type FuncRow = { name: string; file: string; calls: string[] };

/**
 * 实时提取：对 generated/<project> 跑一次 extractIR。
 * 语料由 generate-projects-taintpath.ts 确定性重建；目录缺失时报错而不是
 * 静默跳过——否则又是一次空过。
 */
function extractLive(project: string): FuncRow[] | null {
  const dir = path.join(GENERATED, project);
  if (!fs.existsSync(dir)) return null;
  const fns = extractIR(dir) as Array<{ name: string; file?: string; calls?: string[] }>;
  return fns.map((f) => ({ name: f.name, file: f.file || "", calls: f.calls || [] }));
}

function main(): number {
  const expect = JSON.parse(fs.readFileSync(EXPECT, "utf-8"));

  let report: { projects: Array<{ project: string; perFunction: FuncRow[] }> } | null = null;
  if (REPORT) report = JSON.parse(fs.readFileSync(REPORT, "utf-8"));

  const byProject = new Map<string, FuncRow[]>();
  if (report) {
    for (const p of report.projects) byProject.set(p.project, p.perFunction);
  }

  let failures = 0;
  let gapsClosed = 0;
  let total = 0;

  console.log(REPORT ? `数据源：报告 ${REPORT}` : "数据源：实时提取（extractIR）");

  for (const [project, cases] of Object.entries(expect.projects as Record<string, Case[]>)) {
    let funcs = byProject.get(project);
    if (!funcs && !REPORT) {
      funcs = extractLive(project) ?? undefined;
    }
    if (!funcs) {
      console.log(
        REPORT
          ? `✗ ${project}: 报告里没有这个项目（是否忘记跑 batch-scan？）`
          : `✗ ${project}: generated/ 下没有该语料（先跑 generate-projects-taintpath.ts）`
      );
      failures++;
      continue;
    }
    console.log(`\n── ${project} ──`);
    for (const c of cases) {
      total++;
      const f = funcs.find((x) => x.name === c.fn && (c.file ? x.file.includes(path.basename(c.file)) : true));
      if (!f) {
        console.log(`  ✗ ${c.fn}: 报告里找不到该函数（名字变了？）`);
        failures++;
        continue;
      }
      const marked = (f.calls || []).some((x) => x.includes(MARKER));
      let ok: boolean;
      let tag: string;
      if (c.expect === "mark") {
        ok = marked;
        tag = marked ? "✓ 已标记" : "✗ 未标记（漏报）";
      } else if (c.expect === "known-gap") {
        ok = !marked;
        if (marked) {
          gapsClosed++;
          tag = "⚠ 缺口已闭合 —— 请更新期望并转 mark";
        } else {
          tag = "· 已知缺口（未标记，符合预期）";
        }
      } else {
        ok = !marked;
        tag = marked ? `✗ 不应标记却标记了（${c.expect}）` : "✓ 未标记";
      }
      if (!ok) failures++;
      console.log(`  ${ok ? " " : "!"} ${tag.padEnd(34)} ${c.fn}`);
      if (!ok) console.log(`       why: ${c.why}`);
    }
  }

  console.log(`\n合计 ${total} 条：失败 ${failures}、缺口闭合待更新 ${gapsClosed}`);
  // 缺口闭合也算失败：期望表必须与实现同步（这是 R7 的执行点）
  return failures === 0 && gapsClosed === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
