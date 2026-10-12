/**
 * 修冤枉第八刀预研探针：授权族 577 条残留告警的根因形状量化（只读，不改 src）
 *
 * 候选子类（第七刀收口时登记的「词撞类」）：
 *   C1 forUpdate 词撞 —— Kysely 悲观锁 SELECT 调用 .forUpdate()，词段
 *      "Update" 撞 mutation trigger（select+lock 不是数据变更）
 *   C2 cipher.update 词撞 —— node crypto 增量接口 update()/final()，
 *      词段 "update" 撞 mutation trigger（加密流不是数据变更）
 *   C3 withLastUpdatedBy 词撞 —— 纯读 query builder 名含 "Updated"
 *   C4 repo 层 update* 真名 —— 真 mutation 名但发生在 repo 层
 *      （鉴权在 controller，语义类，与词撞无关——单独数）
 *   C5 getter 类 —— Access 族 get* 名（语义类，单独数）
 *
 * 判据（R75：抑制判据只用正向证据）：词撞类须逐条读源码确认 TP 0
 * 才进入候选。输出分类计数 + 每类样本清单，供人工复核后决定动刀范围。
 *
 * 用法：npx ts-node blind-benchmark/knife8-word-collision-probe.ts [--show 40]
 *
 * 输入：blind-benchmark/reports/heldout/trust-docmost-66ab-pre.json（第七刀后
 * 告警流快照）+ docmost server IR（现场提取，注入开）。
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes } from "../src/extract-ir";

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server");
const ALERTS = path.join(ROOT, "blind-benchmark", "reports", "heldout", "trust-docmost-66ab-pre.json");

// ── 1. IR + 告警行 ──
console.log("extracting IR...");
const functions = extractIRWithTypes(SERVER_DIR).functions;
console.log(`IR functions: ${functions.length}`);

const report = JSON.parse(fs.readFileSync(ALERTS, "utf8"));
type Row = { rule: string; fn: string; file: string };
const rows: Row[] = [];
for (const g of report.overall.safeguardAlerts.groups) {
  if (!/Authorization|Payment Refund/.test(g.rule)) continue;
  for (const e of g.alerts ?? []) rows.push({ rule: g.rule, fn: e.alert.function, file: e.alert.file });
}
console.log(`授权族告警行: ${rows.length}`);

const byName = new Map(functions.map((f) => [f.name, f]));

// mutation trigger 的逐 token 匹配复现（/i 大小写不敏感词根）
const MUT_TRIGGER = /\b(add|create|update|set|publish|insert|submit)(?:[A-Z]\w*|_\w+)|(?:[A-Z]\w*|_\w+)(Add|Create|Update|Set|Publish|Insert|Submit)\b/i;

function tokenHits(text: string): string[] {
  // 粗复现：把名字/calls 的 camelCase/snake 词段展开后逐词测试
  const words = text.split(/[^A-Za-z0-9_]+/).flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean));
  const hits: string[] = [];
  for (const w of words) if (MUT_TRIGGER.test(w)) hits.push(w);
  return hits;
}

const cls: Record<string, number> = {};
const samples: Record<string, Array<{ rule: string; fn: string; file: string; matched: string }>> = {};
function bump(key: string, row: Row, matched: string, cap = 60) {
  cls[key] = (cls[key] || 0) + 1;
  if (!samples[key]) samples[key] = [];
  if (samples[key].length < cap) samples[key].push({ rule: row.rule, fn: row.fn, file: row.file, matched });
}

for (const row of rows) {
  const f = byName.get(row.fn);
  const calls = f?.calls || [];
  const nameTokens = tokenHits(row.fn.split(".").pop() || row.fn);
  const callTokens = calls.flatMap((c) => tokenHits(c));
  const matched = [...new Set([...nameTokens, ...callTokens])].join(",");

  if (row.rule.includes("Mutation")) {
    if (calls.includes("forUpdate")) bump("C1-forUpdate", row, matched);
    else if (calls.includes("createCipheriv") || calls.includes("createDecipheriv")) bump("C2-cipher", row, matched);
    else if (/LastUpdatedBy|UpdatedBy/.test(row.fn)) bump("C3-updatedBy-词撞", row, matched);
    else bump("C4-repo-update-语义", row, matched);
  } else if (row.rule.includes("Access")) {
    if (calls.includes("createCipheriv") || calls.includes("createDecipheriv")) bump("C2b-cipher-Access", row, matched);
    else if (/^get[A-Z]|\.get[A-Z]/.test(row.fn)) bump("C5-getter-语义", row, matched);
    else bump("C6-其他-Access", row, matched);
  } else {
    bump("C7-其他族", row, matched);
  }
}

console.log("\n=== 分类计数 ===");
for (const [k, v] of Object.entries(cls).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

const show = process.argv.includes("--show") ? parseInt(process.argv[process.argv.indexOf("--show") + 1] ?? "40") : 40;
for (const [k, arr] of Object.entries(samples)) {
  if (!k.startsWith("C1") && !k.startsWith("C2") && !k.startsWith("C3")) continue;
  console.log(`\n=== ${k} 样本（前 ${show}）===`);
  for (const s of arr.slice(0, show)) {
    console.log(`  ${s.fn.padEnd(52)} | ${s.rule.slice(30, 58).padEnd(28)} | matched=[${s.matched}]`);
  }
}
