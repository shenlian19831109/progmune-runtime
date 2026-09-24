#!/usr/bin/env npx tsx
/**
 * derive-cut-expectations.ts —— 反向验证的「期望推导」工具（R34 根治）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 为什么要有这个工具（R34 三次同形踩坑的病根）
 * ───────────────────────────────────────────────────────────────────────────
 * 反向验证的做法是「退回旧行为，看转红清单是否只落在自己那组」。转红清单本来
 * 靠手算，而手算三次漏掉同一个东西：**只推了「违规报不报」这一个维度，忘了
 * 期望表还有「标记有没有」这个维度**。
 *
 *   §二十六 CUT-4/5  漏 traversal 维度
 *   §三十   CUT-C    漏 reportRules 维度
 *   §三十一 CUT-A    漏 have 维度（少算 uploadDraft）
 *
 * 三次修的都是推导逻辑，不是代码 —— 说明手列期望这个动作本身不可靠。人之常情：
 * 推「该报的会转红」时，脑子里想的是违规，就会把标记维度忘掉。
 *
 * 工具做什么
 * ───────────────────────────────────────────────────────────────────────────
 * 期望表（webshape-expectations.json）已有 **5 个维度**：
 *   have / none / traversal / reportRules / suppressRules
 * 工具对每个 case 把 5 个维度**全部**逐项重算，不再挑着看。转红集合 = 变换后
 * 违反任一维度的 case 集合，且每条都标明**因哪个维度转红**。
 *
 * 关键设计：刀施加在 **IR 层**，不改源码
 * ───────────────────────────────────────────────────────────────────────────
 * 旧做法改源码再跑整个提取，慢，且有「忘记还原」污染后续验收的风险（MEMORY 里
 * 有前科）。本工具只变换已提取的 IR（增删标记），再调 detectSafeguardViolations
 * 重放规则 —— 规则引擎是纯函数，重放结果等价于改源码后的结果，但：
 *   · 不碰源码 ⇒ 零残留风险
 *   · 只重放不重提 ⇒ 秒级
 *
 * 语义等价性（为什么 IR 层变换能代表「规则侧移除 requireMarker」）：
 *   requireMarker 移除 ⇒ 有没有标记都触发 ⇒ 等价于「所有函数都带标记」= always
 *   注入侧恒 false      ⇒ 标记永不产出     ⇒ 等价于「所有函数都不带标记」= never
 * 两种施加点（提取侧 / 规则侧）在本规则上**效果相同**，工具化后这个事实会自动
 * 暴露出来（CUT-B 与 CUT-C 转红集合相同）—— 见下方输出。
 *
 * 两道不变量（R34 的锁）
 * ───────────────────────────────────────────────────────────────────────────
 *   never 刀 ⇒ 所有 have:[m] 的 case **必须**因标记维度转红
 *   always 刀 ⇒ 所有 none:[m] 的 case **必须**因标记维度转红
 * 不满足 ⇒ 报 INVARIANT FAIL。有了这两条，「漏维度」在结构上不可能再发生。
 *
 * 顺带产出：机制-语料覆盖矩阵（R23 空过检测）
 * ───────────────────────────────────────────────────────────────────────────
 * 若某机制的 never/always 刀转红数都是 0 ⇒ 没有任何语料钉住它 ⇒ 空过风险。
 * 这正是「四门全绿但机制其实没被验证」的自动化探测器。
 *
 * 用法
 * ───────────────────────────────────────────────────────────────────────────
 *   npx tsx blind-benchmark/derive-cut-expectations.ts            # 内置刀（E5 三刀）
 *   npx tsx blind-benchmark/derive-cut-expectations.ts --all      # 全机制矩阵（5×2）
 *   npx tsx blind-benchmark/derive-cut-expectations.ts --json     # 只输出 JSON 路径
 * 退出码 0 = 全部不变量成立。
 */

import fs from "node:fs";
import path from "node:path";
import { extractIR } from "../src/extract-ir";
import { detectSafeguardViolations } from "../src/protocol-detector";

const HERE = __dirname;
const EXPECT_PATH = path.join(HERE, "webshape-expectations.json");
const GENERATED = path.join(HERE, "generated");
const OUT_PATH = path.join(HERE, "reports", "cut-expectations.json");

type Marker = "auth_machinery" | "input_schema" | "input_guard" | "input_effect" | "path_traversal";

interface Case {
  fn: string;
  file?: string;
  have?: Marker[];
  none?: Marker[];
  traversal?: string;
  reportRules?: string[];
  suppressRules?: string[];
  why?: string;
}

interface Func {
  name: string;
  file: string;
  calls: string[];
  params: string[];
}

/** 一刀 = 对某个标记施加一种策略。数据驱动，未来新机制只需加一行。 */
interface CutSpec {
  id: string;
  desc: string;
  marker: Marker;
  policy: "never" | "always";
}

/**
 * 内置刀：E5 的三刀。
 * 注意 CUT-B 与 CUT-C 在 IR 层是同一刀（见文件头语义等价性）—— 保留两个 id 是
 * 为了与历史脚本对账，工具会明确报出它们等价。
 */
const BUILTIN_CUTS: CutSpec[] = [
  {
    id: "CUT-A",
    desc: "注入侧恒 false：input_effect 永不产出",
    marker: "input_effect",
    policy: "never",
  },
  {
    id: "CUT-B",
    desc: "规则侧移除 requireMarker：等价于人人都有标记",
    marker: "input_effect",
    policy: "always",
  },
  {
    id: "CUT-C",
    desc: "注入侧恒 true：无条件注入标记（与 CUT-B 等价）",
    marker: "input_effect",
    policy: "always",
  },
];

const ALL_MARKERS: Marker[] = [
  "auth_machinery",
  "input_schema",
  "input_guard",
  "input_effect",
  "path_traversal",
];

function loadExpect() {
  if (!fs.existsSync(EXPECT_PATH)) {
    console.error(`✗ 缺期望表 ${EXPECT_PATH} —— 先跑 generate-projects-webshape.ts`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(EXPECT_PATH, "utf-8")) as {
    markers: Record<Marker, string>;
    projects: Record<string, { shape: string; cases: Case[] }>;
  };
}

function extractLive(project: string): Func[] | null {
  const dir = path.join(GENERATED, project);
  if (!fs.existsSync(dir)) return null;
  const fns = extractIR(dir as any) as Array<{
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

/** 施加标记策略后的 calls：never=剔除该标记，always=补上该标记 */
function applyCut(calls: string[], markerText: string, policy: "never" | "always"): string[] {
  const stripped = calls.filter((c) => !c.includes(markerText));
  return policy === "never" ? stripped : [...stripped, markerText];
}

/**
 * 逐维度重算期望。**5 个维度全部检查**，这是本工具存在的全部理由。
 * 返回每条违反的原因，带维度前缀（如 `have:input_effect`）。
 */
function evaluate(c: Case, f: Func, markers: Record<Marker, string>): string[] {
  const problems: string[] = [];
  const has = (m: Marker) => f.calls.some((x) => x.includes(markers[m]));

  // ── 维度 1：标记必须有 ──
  for (const m of c.have || []) if (!has(m)) problems.push(`have:${m}`);
  // ── 维度 2：标记必须没有 ──
  for (const m of c.none || []) if (has(m)) problems.push(`none:${m}`);
  // ── 维度 3：path_traversal 专属口径 ──
  if (c.traversal && c.traversal !== "n/a") {
    const marked = has("path_traversal");
    if (c.traversal === "mark" && !marked) problems.push("traversal:mark(漏报)");
    if (c.traversal !== "mark" && marked) problems.push(`traversal:${c.traversal}(误报)`);
  }
  // ── 维度 4/5：规则该报 / 不该报 ──
  if (c.reportRules || c.suppressRules) {
    // 与 check-webshape / batch-scan 同口径：language 必须显式给
    const rules = new Set(
      (detectSafeguardViolations(f.calls, f.name, "typescript", f.params, false) as any[]).map(
        (v) => v.rule as string
      )
    );
    for (const r of c.reportRules || []) if (!rules.has(r)) problems.push(`reportRules:${r}`);
    for (const r of c.suppressRules || []) if (rules.has(r)) problems.push(`suppressRules:${r}`);
  }
  return problems;
}

interface CutResult {
  id: string;
  desc: string;
  marker: Marker;
  policy: "never" | "always";
  /** 转红的 case（键 = `项目::函数名`） */
  red: Array<{ key: string; fn: string; project: string; reasons: string[]; why?: string }>;
  /** 因标记维度直接转红（不变量保证的那部分） */
  markerDirect: string[];
  /** 仅因规则维度转红 —— 需人工确认，但至少被看见（R34 漏的就是这类） */
  ruleMediated: string[];
  invariantOk: boolean;
  invariantNote: string;
}

function main(): number {
  const args = process.argv.slice(2);
  const useAll = args.includes("--all");
  const jsonOnly = args.includes("--json");

  const expect = loadExpect();
  const markers = expect.markers;

  const cuts: CutSpec[] = useAll
    ? ALL_MARKERS.flatMap((m) => [
        { id: `${m}:never`, desc: `${m} 永不产出`, marker: m, policy: "never" as const },
        { id: `${m}:always`, desc: `${m} 无条件产出`, marker: m, policy: "always" as const },
      ])
    : BUILTIN_CUTS;

  // ── 一次性提取全部语料并建索引 ──
  const funcsByProject = new Map<string, Func[]>();
  for (const project of Object.keys(expect.projects)) {
    const fns = extractLive(project);
    if (!fns) {
      console.error(`✗ ${project}: generated/ 下没有该语料（先跑 generate-projects-webshape.ts）`);
      return 1;
    }
    funcsByProject.set(project, fns);
  }

  // ── 基线：未切刀时，全部期望必须成立（否则正向门本就没过，推导无意义） ──
  const baselineBad: string[] = [];
  const located = new Map<string, { project: string; c: Case; f: Func }>();
  for (const [project, body] of Object.entries(expect.projects)) {
    const fns = funcsByProject.get(project)!;
    for (const c of body.cases) {
      const f = fns.find(
        (x) => x.name === c.fn && (!c.file || x.file.includes(path.basename(c.file)))
      );
      if (!f) {
        baselineBad.push(`${project}::${c.fn}（找不到函数，语料漂移？）`);
        continue;
      }
      located.set(`${project}::${c.fn}`, { project, c, f });
      const p = evaluate(c, f, markers);
      if (p.length) baselineBad.push(`${project}::${c.fn} → ${p.join(", ")}`);
    }
  }
  if (!jsonOnly) {
    console.log(`\n基线（未切刀）：${located.size} 条期望，违反 ${baselineBad.length}`);
    for (const b of baselineBad) console.log(`  ✗ ${b}`);
  }
  if (baselineBad.length) {
    console.error("\n✗ 基线未全绿 —— 正向门没过，反向推导无意义。先修语料或实现。");
    return 1;
  }

  // ── 逐刀推导 ──
  const results: CutResult[] = [];
  for (const cut of cuts) {
    const markerText = markers[cut.marker];
    const red: CutResult["red"] = [];
    const markerDirect: string[] = [];
    const ruleMediated: string[] = [];

    for (const [key, { project, c, f }] of located) {
      const tCalls = applyCut(f.calls, markerText, cut.policy);
      const tf: Func = { ...f, calls: tCalls };
      const reasons = evaluate(c, tf, markers);
      if (!reasons.length) continue;

      red.push({ key, fn: c.fn, project, reasons, why: c.why });
      // 分类：是否直接因「该标记的 have/none」维度转红
      const direct =
        (cut.policy === "never" && (c.have || []).includes(cut.marker)) ||
        (cut.policy === "always" && (c.none || []).includes(cut.marker));
      if (direct) markerDirect.push(key);
      else ruleMediated.push(key);
    }

    // ── 不变量（R34 的锁） ──
    const mustRed = [...located.entries()].filter(([, { c }]) =>
      cut.policy === "never"
        ? (c.have || []).includes(cut.marker)
        : (c.none || []).includes(cut.marker)
    );
    const missing = mustRed.filter(([k]) => !red.some((r) => r.key === k));
    const invariantOk = missing.length === 0;
    const invariantNote = invariantOk
      ? `不变量成立：${mustRed.length} 条声明 ${
          cut.policy === "never" ? "have" : "none"
        }:${cut.marker} 的 case 全部转红`
      : `不变量违反：${missing.length} 条声明 ${
          cut.policy === "never" ? "have" : "none"
        }:${cut.marker} 的 case 竟未转红 → ${missing.map(([k]) => k).join(", ")}`;

    results.push({ ...cut, red, markerDirect, ruleMediated, invariantOk, invariantNote });
  }

  // ── 输出 ──
  if (!jsonOnly) {
    for (const r of results) {
      console.log(`\n── ${r.id} ── ${r.desc}`);
      console.log(`   转红 ${r.red.length} 条（标记维度直接 ${r.markerDirect.length} / 规则维度介导 ${r.ruleMediated.length}）`);
      for (const x of r.red) {
        console.log(`     ! ${x.fn.padEnd(30)} ${x.reasons.join(", ")}`);
      }
      console.log(`   ${r.invariantOk ? "✓" : "✗"} ${r.invariantNote}`);
      if (r.ruleMediated.length) {
        console.log(
          `   ⓘ 仅因规则维度转红（需人工确认，历史漏维度就发生在这里）：${r.ruleMediated.join(", ")}`
        );
      }
    }

    // ── 机制-语料覆盖矩阵（R23 空过检测） ──
    if (useAll) {
      console.log(`\n── 机制-语料覆盖矩阵（某机制两刀都转红 0 ⇒ 无语料钉住 ⇒ 空过风险）──`);
      for (const m of ALL_MARKERS) {
        const nv = results.find((r) => r.marker === m && r.policy === "never");
        const aw = results.find((r) => r.marker === m && r.policy === "always");
        const n = (nv?.red.length || 0) + (aw?.red.length || 0);
        console.log(
          `   ${m.padEnd(16)} never ${String(nv?.red.length || 0).padStart(2)}  always ${String(
            aw?.red.length || 0
          ).padStart(2)}   ${n === 0 ? "⚠ 无语料钉住" : ""}`
        );
      }
    }

    // ── 等价性提示 ──
    const seen = new Map<string, string[]>();
    for (const r of results) {
      const sig = [...r.red.map((x) => x.key)].sort().join("|");
      if (!seen.has(sig)) seen.set(sig, []);
      seen.get(sig)!.push(r.id);
    }
    for (const [, ids] of seen) {
      if (ids.length > 1) console.log(`\nⓘ ${ids.join(" 与 ")} 转红集合完全相同 ⇒ IR 层同一刀，历史上是两个施加点`);
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baselineTotal: located.size,
        baselineViolations: baselineBad.length,
        cuts: results.map((r) => ({
          id: r.id,
          desc: r.desc,
          marker: r.marker,
          policy: r.policy,
          redFns: r.red.map((x) => x.fn),
          red: r.red,
          markerDirect: r.markerDirect,
          ruleMediated: r.ruleMediated,
          invariantOk: r.invariantOk,
          invariantNote: r.invariantNote,
        })),
      },
      null,
      2
    ) + "\n"
  );

  const bad = results.filter((r) => !r.invariantOk);
  if (!jsonOnly) {
    console.log(`\n合计 ${results.length} 刀：不变量失败 ${bad.length}`);
    console.log(`期望已落盘 → ${path.relative(process.cwd(), OUT_PATH)}`);
  }
  return bad.length ? 1 : 0;
}

if (require.main === module) process.exit(main());
