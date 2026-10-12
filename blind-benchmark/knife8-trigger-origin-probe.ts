/**
 * 第八刀探针二：mutation 告警的触发来源定位（只读，import 真实实现）
 *
 * 对每条 Unauthenticated Mutation 告警，用真实 identifierParse 复现
 * triggerEffectiveCalls（V7：函数名 + 自身 calls + 同文件级 calls +
 * 词解析展开），报告**具体哪个 token**命中了 trigger，以及它来自
 * 哪一层（own-name / own-call / file-level）。
 *
 * 目标：验证 C1/C2 的真实根因是不是「同文件级触发词污染」。
 *
 * 用法：npx ts-node blind-benchmark/knife8-trigger-origin-probe.ts [--show 30]
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes } from "../src/extract-ir";
import { identifierParse } from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server");
const ALERTS = path.join(ROOT, "blind-benchmark", "reports", "heldout", "trust-docmost-66ab-pre.json");

const MUT_TRIGGER = /\b(add|create|update|set|publish|insert|submit)(?:[A-Z]\w*|_\w+)|(?:[A-Z]\w*|_\w+)(Add|Create|Update|Set|Publish|Insert|Submit)\b/i;

console.log("extracting IR...");
const functions = extractIRWithTypes(SERVER_DIR).functions;
const byName = new Map(functions.map((f) => [f.name, f]));
const fileCalls = new Map<string, Set<string>>();
const funcFile = new Map<string, string>();
for (const f of functions) {
  if (!f.file) continue;
  funcFile.set(f.name, f.file);
  if (!fileCalls.has(f.file)) fileCalls.set(f.file, new Set());
  for (const c of f.calls || []) fileCalls.get(f.file)!.add(c);
}

const report = JSON.parse(fs.readFileSync(ALERTS, "utf8"));
const mut: Array<{ fn: string; file: string }> = [];
for (const g of report.overall.safeguardAlerts.groups) {
  if (g.rule !== "Authorization (Unauthenticated Mutation)") continue;
  for (const e of g.alerts ?? []) mut.push({ fn: e.alert.function, file: e.alert.file });
}
console.log(`mutation 告警: ${mut.length}`);

function originOf(fn: string): Array<{ token: string; origin: string }> {
  const f = byName.get(fn)!;
  const ownName = fn.split(".").pop() || fn;
  const ownCalls = f.calls || [];
  const file = funcFile.get(fn);
  const fLevel = (file && fileCalls.get(file)) ? [...fileCalls.get(file)!].filter((c) => !ownCalls.includes(c)) : [];
  const rawOwn = [ownName, ...ownCalls];
  const rawAll = [...new Set([...rawOwn, ...fLevel])];
  const out: Array<{ token: string; origin: string }> = [];
  const seen = new Set<string>();
  for (const c of rawAll) {
    const words = identifierParse(c);
    for (const w of [c, ...words]) {
      if (seen.has(w)) continue;
      seen.add(w);
      if (!MUT_TRIGGER.test(w)) continue;
      // 归层：先查自身名/自身调用，再查文件级
      let origin = "file-level";
      if (w === ownName || (rawOwn.includes(w) && words.includes(w) && ownCalls.includes(w))) origin = "own-call";
      if (w === ownName) origin = "own-name";
      // 文件级 token 也可能恰好是 own 调用原文（上面 rawAll 已去重），用集合判定：
      if (rawOwn.includes(w) && !ownCalls.includes(w)) origin = "own-name";
      if (ownCalls.includes(w)) origin = "own-call";
      out.push({ token: w, origin });
    }
  }
  return out;
}

type Stat = { ownName: number; ownCall: number; fileLevel: number; mixed: number };
const stats: Stat = { ownName: 0, ownCall: 0, fileLevel: 0, mixed: 0 };
const byClass: Record<string, { fn: string; hits: Array<{ token: string; origin: string }> }[]> = {
  "C1-forUpdate": [],
  "C2-cipher": [],
  "C4-repo-update": [],
  "其他": [],
};

for (const m of mut) {
  const f = byName.get(m.fn);
  const hits = originOf(m.fn);
  const origins = new Set(hits.map((h) => h.origin));
  if (origins.size > 1) stats.mixed++;
  else if (origins.has("own-name")) stats.ownName++;
  else if (origins.has("own-call")) stats.ownCall++;
  else stats.fileLevel++;

  const key = (f?.calls || []).includes("forUpdate") ? "C1-forUpdate"
    : (f?.calls || []).includes("createCipheriv") || (f?.calls || []).includes("createDecipheriv") ? "C2-cipher"
    : /^(update|set|add|create|insert)/i.test(m.fn.split(".").pop() || "") ? "C4-repo-update"
    : "其他";
  byClass[key].push({ fn: m.fn, hits });
}

console.log("\n=== 触发来源统计（mutation 158 全量）===");
console.log(`  own-name: ${stats.ownName} | own-call: ${stats.ownCall} | file-level: ${stats.fileLevel} | mixed: ${stats.mixed}`);

const show = process.argv.includes("--show") ? parseInt(process.argv[process.argv.indexOf("--show") + 1] ?? "30") : 30;
for (const [k, arr] of Object.entries(byClass)) {
  console.log(`\n=== ${k}（${arr.length}）命中 token 明细（前 ${show}）===`);
  for (const a of arr.slice(0, show)) {
    console.log(`  ${a.fn.padEnd(50)} | ${a.hits.map((h) => `${h.token}[${h.origin}]`).join(", ")}`);
  }
}
