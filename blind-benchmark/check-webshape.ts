/**
 * webshape 语料族验收闸门（2026-09-22）
 *
 * 为什么要有这个闸门：
 *   E2（装饰器鉴权标记）与 E3（DTO schema 标记）两轮的盲测是**空过**的 ——
 *   116 个 generated 项目里 `^\s*@[A-Z]\w*(` 命中 0 个文件，语料根本没有装饰器形状，
 *   于是「LOST 0 / ADDED 0」证明不了任何东西。R23 四次同源。
 *   webshape_A..D 把四种真实 TS web 形状钉进语料；本闸门负责让它们**一直是真的**：
 *
 *   - 默认**实时提取**（extractIR），不读报告 —— 读陈旧产物是第二种空过
 *     （check-taintpath.ts 2026-09-19 已踩过一次，此处沿用同一条纪律）
 *   - 语料目录缺失 ⇒ **报错退出**，不是跳过。generate-projects.ts 会 rm -rf 所有
 *     含 `_` 的目录，跑过它之后本族会静默消失 ⇒ 必须变成硬失败
 *   - 期望表由 generate-projects-webshape.ts 一并写出，禁止手改
 *
 * 用法：npx tsx blind-benchmark/check-webshape.ts
 * 退出码 0 = 全部符合期望；非 0 = 有违反。
 */

import * as fs from "fs";
import * as path from "path";
import { extractIR } from "../src/extract-ir";
import { detectSafeguardViolations } from "../src/protocol-detector";

const EXPECT = path.resolve(__dirname, "webshape-expectations.json");
const GENERATED = path.resolve(__dirname, "generated");

type Marker = "auth_machinery" | "input_schema" | "input_guard" | "input_effect" | "path_traversal";
type TraversalExpect = "mark" | "suppressed" | "no-taint" | "n/a";

interface Case {
  fn: string;
  file: string;
  have?: Marker[];
  none?: Marker[];
  traversal?: TraversalExpect;
  reportRules?: string[];
  suppressRules?: string[];
  why: string;
}

type FuncRow = { name: string; file: string; calls: string[]; params: string[] };

function extractLive(project: string): FuncRow[] | null {
  const dir = path.join(GENERATED, project);
  if (!fs.existsSync(dir)) return null;
  const fns = extractIR(dir) as Array<{
    name: string;
    file?: string;
    calls?: string[];
    params?: Array<{ name: string }>;
  }>;
  return fns.map((f) => ({
    name: f.name,
    file: f.file || "",
    calls: f.calls || [],
    params: (f.params || []).map((p) => p.name),
  }));
}

function main(): number {
  if (!fs.existsSync(EXPECT)) {
    console.error(`✗ 缺期望表 ${EXPECT} —— 先跑 generate-projects-webshape.ts`);
    return 1;
  }
  const expect = JSON.parse(fs.readFileSync(EXPECT, "utf-8"));
  const markers: Record<Marker, string> = expect.markers;

  let failures = 0;
  let total = 0;

  for (const [project, body] of Object.entries(expect.projects as Record<string, { shape: string; cases: Case[] }>)) {
    const funcs = extractLive(project);
    if (!funcs) {
      console.log(`✗ ${project}: generated/ 下没有该语料（先跑 generate-projects-webshape.ts）`);
      failures++;
      continue;
    }
    console.log(`\n── ${project} ── ${body.shape}`);
    for (const c of body.cases) {
      total++;
      const f = funcs.find((x) => x.name === c.fn && (!c.file || x.file.includes(path.basename(c.file))));
      if (!f) {
        console.log(`  ! 找不到函数 ${c.fn}（名字变了？）  ${c.why}`);
        failures++;
        continue;
      }
      const has = (m: Marker) => f.calls.some((x) => x.includes(markers[m]));

      const problems: string[] = [];
      for (const m of c.have || []) if (!has(m)) problems.push(`缺 ${markers[m]}`);
      for (const m of c.none || []) if (has(m)) problems.push(`不该有 ${markers[m]}`);

      // traversal 的口径比 have/none 更严：mark 必须命中，其余必须不命中
      if (c.traversal && c.traversal !== "n/a") {
        const marked = has("path_traversal");
        if (c.traversal === "mark" && !marked) problems.push("path_traversal 应标记（漏报）");
        if (c.traversal !== "mark" && marked) problems.push(`path_traversal 不应标记（应为 ${c.traversal}）`);
      }

      // 违规口径（E4 起）：抑制类机制必须同时守住正面（该压的压掉）与
      // 反面（不该压的必须还在报）。只写正面 ⇒ 无条件抑制也能全绿。
      if (c.reportRules || c.suppressRules) {
        // 与 batch-scan 同口径：language 必须显式给，否则 python-only 规则会套上来
        const rules = new Set(
          detectSafeguardViolations(f.calls, f.name, "typescript", f.params, false).map(
            (v: any) => v.rule as string
          )
        );
        for (const r of c.reportRules || []) {
          if (!rules.has(r)) problems.push(`应报 ${r} 却没报（漏报）`);
        }
        for (const r of c.suppressRules || []) {
          if (rules.has(r)) problems.push(`不该报 ${r} 却在报`);
        }
      }

      const ok = problems.length === 0;
      if (!ok) failures++;
      const present = (Object.keys(markers) as Marker[]).filter(has);
      console.log(
        `  ${ok ? " " : "!"} ${c.fn.padEnd(38)} ${ok ? "✓" : "✗ " + problems.join("; ")}` +
          `   [${present.length ? present.join(",") : "—"}]`
      );
      if (!ok) console.log(`       why: ${c.why}`);
    }
  }

  console.log(`\n合计 ${total} 条：失败 ${failures}`);
  return failures === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
