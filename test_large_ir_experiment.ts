/**
 * Large-IR Graph ON/OFF Experiment — 1200 functions
 *
 * Same 15 external tasks, but with 651 noise functions added.
 * Tests whether Graph routing outperforms keyword matching when
 * the search space is 2.3× larger.
 */

import * as fs from "fs";

const KEY = process.env.LLM_API_KEY || "";
if (!KEY) { console.log("Set LLM_API_KEY"); process.exit(1); }

const ir = JSON.parse(fs.readFileSync("ir_large.json", "utf-8")).functions || [];
console.log(`IR: ${ir.length} functions (549 real + ${ir.length - 549} noise)\n`);

const TASKS = [
  { intent: "generate benchmark report from results", cat: "A" },
  { intent: "extract IR from project and validate the actions", cat: "A" },
  { intent: "list all sessions and find failure patterns", cat: "A" },
  { intent: "fix the bug where session count returns wrong number", cat: "A" },
  { intent: "suggest repairs for a failed session", cat: "A" },
  { intent: "add logging to all repair proposal functions", cat: "B" },
  { intent: "add input validation before saving benchmark results", cat: "B" },
  { intent: "add a health check endpoint that reports immune metrics", cat: "B" },
  { intent: "consolidate duplicate validation code in planner and validator", cat: "C" },
  { intent: "unify error reporting across all immune system modules", cat: "C" },
];

console.log(`Tasks: ${TASKS.length}\n`);

interface Report {
  intent: string; valid: boolean; retries: number; actions: number;
}

async function runRound(label: string, graphMode: string): Promise<Report[]> {
  const reports: Report[] = [];
  // Swap ir.json with ir_large.json for the planner
  const origIR = "ir.json";
  const backup = "ir.json.bak";
  fs.copyFileSync(origIR, backup);
  fs.copyFileSync("ir_large.json", origIR);

  process.env.PROGMUNE_GRAPH_MODE = graphMode;
  const { plan } = await import("./src/planner");

  for (const t of TASKS) {
    try {
      const r = await plan(t.intent);
      const actions = (r.actions || []).length;
      const valid = actions > 0 && actions < 80;
      console.log(`  ${valid ? "✅" : "❌"} ${t.intent.slice(0,45)} | ${actions}a`);
      reports.push({ intent: t.intent, valid, retries: r.attempts?.length || 1, actions });
    } catch (e: any) {
      console.log(`  💥 ${t.intent.slice(0,40)} | ${e.message?.slice(0,30)}`);
      reports.push({ intent: t.intent, valid: false, retries: 99, actions: 0 });
    }
  }

  // Restore original IR
  fs.copyFileSync(backup, origIR);
  fs.unlinkSync(backup);
  return reports;
}

async function main() {
  console.log("═══ Large-IR Experiment (1200 functions) ═══\n");

  console.log("── Graph OFF ──");
  const off = await runRound("OFF", "off");

  console.log("\n── Graph ON ──");
  const on = await runRound("ON", "on");

  const offOk = off.filter(r => r.valid).length;
  const onOk = on.filter(r => r.valid).length;
  const offActs = off.reduce((s, r) => s + r.actions, 0) / off.length;
  const onActs = on.reduce((s, r) => s + r.actions, 0) / on.length;

  console.log(`\n═══════ Large-IR Results ═══════`);
  console.log(`              OFF       ON        Δ`);
  console.log(`  Valid       ${offOk}/10    ${onOk}/10    ${onOk > offOk ? "+" : ""}${onOk - offOk}`);
  console.log(`  Avg acts    ${offActs.toFixed(1)}      ${onActs.toFixed(1)}`);
  console.log(`  ROI: ${onOk > offOk ? "✅ Graph wins" : offOk > onOk ? "❌ OFF wins" : "Tied"}`);
}

main().catch(console.error);
