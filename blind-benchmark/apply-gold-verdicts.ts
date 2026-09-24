#!/usr/bin/env npx tsx
/**
 * apply-gold-verdicts.ts —— 把补核判定合并回真值集
 *
 * 设计要点（R38：口径变更不可比，所以口径尽量不动）：
 *   · gold_confidence 仍只有 verified / heuristic 两档 —— 新增的 verified 归入
 *     verified 档，比例口径不变。
 *   · 新增 verified_by 字段标注**谁核的**："ai-read-source" = 读源码 + 留证据，
 *     区别于人工确证。这样「verified 比例」可比，而「谁核的」可追溯。
 *   · 每条都写 verified_evidence（源码依据），判定可被任何人复核。
 *
 * 用法：npx tsx blind-benchmark/apply-gold-verdicts.ts
 */

import fs from "node:fs";
import path from "node:path";

const HERE = __dirname;
const GOLD = path.join(HERE, "fp-gold.jsonl");
const VERDICTS = path.join(HERE, "gold-verdicts-2026-09-23.json");

function main() {
  const v = JSON.parse(fs.readFileSync(VERDICTS, "utf8"));
  const rows = fs.readFileSync(GOLD, "utf8").trim().split("\n").map(JSON.parse);

  const before: Record<string, number> = {};
  for (const r of rows) {
    const k = `${r.gold}/${r.gold_confidence}`;
    before[k] = (before[k] || 0) + 1;
  }

  const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]));
  let applied = 0;
  const missed: string[] = [];
  const changed: string[] = [];

  for (const d of v.verdicts) {
    const row = byId.get(d.id);
    if (!row) {
      missed.push(d.id);
      continue;
    }
    const was = `${row.gold}/${row.gold_confidence}`;
    row.gold = d.gold;
    row.gold_confidence = d.gold === "UNKNOWN" ? "unlabeled" : "verified";
    row.gold_reason = d.reason;
    row.verified_by = "ai-read-source";
    row.verified_evidence = d.evidence;
    row.verified_at = "2026-09-23";
    applied++;
    changed.push(`${d.id}: ${was} → ${row.gold}/${row.gold_confidence}`);
  }

  const after: Record<string, number> = {};
  for (const r of rows) {
    const k = `${r.gold}/${r.gold_confidence}`;
    after[k] = (after[k] || 0) + 1;
  }

  fs.writeFileSync(GOLD, rows.map((r: any) => JSON.stringify(r)).join("\n") + "\n");

  const total = rows.length;
  const vBefore = (before["TP/verified"] || 0) + (before["FP/verified"] || 0);
  const vAfter = (after["TP/verified"] || 0) + (after["FP/verified"] || 0);

  console.log(`[apply] 应用 ${applied} / ${v.verdicts.length} 条${missed.length ? `，未匹配 ${missed.length}` : ""}`);
  for (const m of missed) console.log(`  ! 未匹配：${m}`);
  console.log("\n[apply] 分层变化：");
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[k] || 0;
    const a = after[k] || 0;
    if (b !== a) console.log(`  ${k.padEnd(16)} ${b} → ${a}  (${a - b >= 0 ? "+" : ""}${a - b})`);
    else console.log(`  ${k.padEnd(16)} ${b}`);
  }
  console.log(`\n[apply] verified 比例 ${vBefore}/${total} (${((vBefore / total) * 100).toFixed(1)}%) → ${vAfter}/${total} (${((vAfter / total) * 100).toFixed(1)}%)`);
  console.log(`[apply] TP/verified ${before["TP/verified"] || 0} → ${after["TP/verified"] || 0}`);
}

if (require.main === module) main();
