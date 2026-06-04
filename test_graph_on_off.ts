/**
 * P0: Graph ON/OFF Experiment — v2.6 core
 *
 * 15 external real-world tasks × 2 modes (Graph OFF / ON)
 * Measures: first-pass rate, retries, LLM calls, candidates, chain length
 *
 * Categories:
 *   A: Issue Fix
 *   B: Feature Addition
 *   C: Refactor
 */

import * as fs from "fs";

const KEY = process.env.LLM_API_KEY || "";
if (!KEY) { console.log("Set LLM_API_KEY"); process.exit(1); }

const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];

const TASKS = [
  // Type A: Issue Fix
  { intent: "fix missing import when loading benchmark data", cat: "A" },
  { intent: "fix the bug where session count returns wrong number", cat: "A" },
  { intent: "handle null pointer when corpus directory is empty", cat: "A" },
  { intent: "fix protocol validation failure when state is empty", cat: "A" },
  { intent: "patch the fingerprint verification error in ledger", cat: "A" },
  // Type B: Feature Addition
  { intent: "add logging to all repair proposal functions", cat: "B" },
  { intent: "add a cache layer for frequently accessed IR functions", cat: "B" },
  { intent: "add input validation before saving benchmark results", cat: "B" },
  { intent: "add retry logic to session loading when disk is busy", cat: "B" },
  { intent: "add a health check endpoint that reports immune metrics", cat: "B" },
  // Type C: Refactor
  { intent: "extract common IR loading logic into a shared utility", cat: "C" },
  { intent: "refactor the protocol validator to use a single entry point", cat: "C" },
  { intent: "consolidate duplicate validation code in planner and validator", cat: "C" },
  { intent: "split the large session manager into focused modules", cat: "C" },
  { intent: "unify error reporting across all immune system modules", cat: "C" },
];

interface TaskReport {
  intent: string; cat: string;
  valid: boolean; retries: number; actions: number;
  firstTry: boolean; llmCalls: number;
}

async function runRound(label: string, graphMode: string): Promise<TaskReport[]> {
  const reports: TaskReport[] = [];
  const { plan } = await import("./src/planner");
  process.env.PROGMUNE_GRAPH_MODE = graphMode;

  for (const t of TASKS) {
    const start = Date.now();
    let valid = false, retries = 0, actions = 0, firstTry = false, llmCalls = 0;
    try {
      const r = await plan(t.intent);
      actions = (r.actions || []).length;
      retries = r.attempts ? r.attempts.length : 1;
      firstTry = retries <= 1;
      llmCalls = r.attempts?.[0]?.llmCallCount || 1;
      valid = actions > 0 && actions < 50; // < 50 = not fallback
      if (valid) console.log(`  ✅ ${t.intent.slice(0,40)} | ${actions} acts | ${Date.now()-start}ms`);
      else console.log(`  ❌ ${t.intent.slice(0,40)} | fallback(${actions} acts)`);
    } catch (e: any) {
      console.log(`  💥 ${t.intent.slice(0,40)} | ${e.message?.slice(0,30)}`);
    }
    reports.push({ intent: t.intent, cat: t.cat, valid, retries, actions, firstTry, llmCalls });
  }
  return reports;
}

async function main() {
  console.log("═══ Graph ON/OFF Experiment ═══\n");
  console.log(`Tasks: ${TASKS.length} | A:5 B:5 C:5\n`);

  // Round A: OFF
  console.log("── Round A: Graph OFF ──");
  const off = await runRound("OFF", "off");

  // Round B: ON
  console.log("\n── Round B: Graph ON ──");
  const on = await runRound("ON", "on");

  // ── Analysis ──
  const analyze = (rs: TaskReport[], label: string) => {
    const valid = rs.filter(r => r.valid);
    const firstTry = rs.filter(r => r.firstTry);
    const byCat: Record<string, TaskReport[]> = { A:[], B:[], C:[] };
    for (const r of rs) { byCat[r.cat].push(r); }

    console.log(`\n${label}:`);
    console.log(`  Overall:    ${valid.length}/${rs.length} valid (${Math.round(valid.length/rs.length*100)}%)`);
    console.log(`  First-try:  ${firstTry.length}/${rs.length} (${Math.round(firstTry.length/rs.length*100)}%)`);
    console.log(`  Avg acts:   ${(rs.reduce((s,r)=>s+r.actions,0)/rs.length).toFixed(1)}`);
    console.log(`  Avg retry:  ${(rs.reduce((s,r)=>s+r.retries,0)/rs.length).toFixed(1)}`);
    for (const [c, cr] of Object.entries(byCat)) {
      const cv = cr.filter(r => r.valid);
      console.log(`  Cat ${c}:       ${cv.length}/${cr.length} (${Math.round(cv.length/cr.length*100)}%)`);
    }
    return { valid, firstTry };
  };

  const offStats = analyze(off, "Graph OFF");
  const onStats = analyze(on, "Graph ON");

  // ── Delta ──
  console.log(`\n═══════ Graph Impact ═══════`);
  const offRate = offStats.valid.length / off.length;
  const onRate = onStats.valid.length / on.length;
  const offFirst = offStats.firstTry.length / off.length;
  const onFirst = onStats.firstTry.length / on.length;
  console.log(`              OFF      ON       Δ`);
  console.log(`  Valid       ${String(offStats.valid.length).padStart(2)}/15    ${String(onStats.valid.length).padStart(2)}/15    ${onRate>offRate?"+":""}${Math.round((onRate-offRate)*100)}%`);
  console.log(`  First-try   ${String(offStats.firstTry.length).padStart(2)}/15    ${String(onStats.firstTry.length).padStart(2)}/15    ${onFirst>offFirst?"+":""}${Math.round((onFirst-offFirst)*100)}%`);
  console.log(`\n  Graph ROI: ${onRate>offRate?"✅":"❌"} (${Math.round(onRate*100)}% vs ${Math.round(offRate*100)}%)`);
}

main().catch(console.error);
