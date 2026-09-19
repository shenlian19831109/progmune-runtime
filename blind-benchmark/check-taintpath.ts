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
 * 用法：npx ts-node blind-benchmark/check-taintpath.ts [report.json]
 * 退出码 0 = 全部符合期望；非 0 = 有违反。
 */

import * as fs from "fs";
import * as path from "path";

const MARKER = "__progmune_path_traversal__";
const REPORT = process.argv[2] || path.resolve(__dirname, "reports/batch-scan-results.json");
const EXPECT = path.resolve(__dirname, "taintpath-expectations.json");

interface Case {
  fn: string;
  file: string;
  expect: "mark" | "suppressed" | "no-taint" | "known-gap";
  why: string;
}

function main(): number {
  const report = JSON.parse(fs.readFileSync(REPORT, "utf-8"));
  const expect = JSON.parse(fs.readFileSync(EXPECT, "utf-8"));

  const byProject = new Map<string, Array<{ name: string; file: string; calls: string[] }>>();
  for (const p of report.projects as Array<{ project: string; perFunction: Array<{ name: string; file: string; calls: string[] }> }>) {
    byProject.set(p.project, p.perFunction);
  }

  let failures = 0;
  let gapsClosed = 0;
  let total = 0;

  for (const [project, cases] of Object.entries(expect.projects as Record<string, Case[]>)) {
    const funcs = byProject.get(project);
    if (!funcs) {
      console.log(`✗ ${project}: 盲测报告里没有这个项目（是否忘记跑 batch-scan？）`);
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
  console.log(REPORT.replace(process.cwd(), "."));
  return failures === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
