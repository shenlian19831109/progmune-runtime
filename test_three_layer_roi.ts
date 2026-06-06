/**
 * Three-Layer Knowledge ROI Experiment
 *
 * Layer 1: Graph impact — how much does Capability Graph reduce search space?
 * Layer 2: Antibody impact — how do antibodies change error patterns?
 * Layer 3: Success rate — compile + validation outcome
 */

import * as fs from "fs";
import { selectCapabilityChains } from "./src/strategy-planner";
import { validateActionSequence } from "./src/validator";
import { queryAntibodies, getFailureGenome } from "./src/failure-corpus";
import type { Action } from "./src/runtime-types";

const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];

const TASKS = [
  "generate benchmark report",
  "extract IR and validate",
  "list sessions and find failures",
  "suggest repairs",
  "compute health score",
  "check ledger consistency",
  "format failure summary",
  "validate protocol transitions",
  "import fingerprints",
  "audit source files",
];

console.log("═══ Three-Layer Knowledge ROI ═══\n");
console.log(`IR: ${ir.length} functions | Tasks: ${TASKS.length}\n`);

// ═══════════════════════════════════════════
// Layer 1: Graph Impact — search space reduction
// ═══════════════════════════════════════════
console.log("── Layer 1: Graph Impact ──");
console.log(`{"Task":<45} {"OFF-cand":>7} {"ON-cand":>7} {"ON-len":>5} {"Δ":>6}`);
console.log("─".repeat(80));

let offTotal = 0, onTotal = 0, onLenTotal = 0;

for (const task of TASKS) {
  // Graph OFF: keyword-only candidates
  const keywords = task.toLowerCase().split(/[\s,]+/);
  const offCandidates = ir
    .filter((f: any) => f.exported)
    .filter((f: any) => {
      for (const kw of keywords) {
        if (f.name.toLowerCase().includes(kw)) return true;
        if ((f.purpose || "").toLowerCase().includes(kw)) return true;
      }
      return false;
    });

  // Graph ON: capability chain nodes
  const { chains } = selectCapabilityChains(task, ir, 3);
  const onNodes = new Set<string>();
  for (const c of chains) {
    for (const n of c.nodes) onNodes.add(n.name);
  }
  const onLen = chains.length > 0 ? chains[0].nodes.length : 0;

  const reduction = offCandidates.length > 0
    ? Math.round((1 - onNodes.size / offCandidates.length) * 100)
    : 0;

  console.log(
    `${task.slice(0, 43).padEnd(45)} ${String(offCandidates.length).padStart(7)} ${String(onNodes.size).padStart(7)} ${String(onLen).padStart(5)} ${(reduction > 0 ? "↓" : "+")}${Math.abs(reduction)}%`
  );

  offTotal += offCandidates.length;
  onTotal += onNodes.size;
  onLenTotal += onLen;
}

const avgReduction = offTotal > 0 ? Math.round((1 - onTotal / offTotal) * 100) : 0;
console.log(`\n  Avg: ${Math.round(offTotal/TASKS.length)} → ${Math.round(onTotal/TASKS.length)} candidates (↓${avgReduction}%)`);
console.log(`  Avg chain length: ${(onLenTotal/TASKS.length).toFixed(1)}`);

// ═══════════════════════════════════════════
// Layer 2: Antibody Impact — error pattern change
// ═══════════════════════════════════════════
console.log("\n── Layer 2: Antibody Impact ──");

const genome = getFailureGenome();
console.log(`  Total failures: ${genome.totalFailures}`);
console.log(`  By SVL: SVL-1=${genome.bySVL["SVL-1"]||0} SVL-2=${genome.bySVL["SVL-2"]||0} SVL-3=${genome.bySVL["SVL-3"]||0} SVL-4=${genome.bySVL["SVL-4"]||0}`);
console.log(`  Avg retries: ${genome.averageRetriesToSuccess.toFixed(1)}`);

let abTotal = 0;
let abHits = 0;
for (const task of TASKS) {
  const abs = queryAntibodies(task, "ACL-1");
  abTotal++;
  if (abs.length > 0) abHits++;
}
console.log(`  Antibody coverage: ${abHits}/${abTotal} tasks have matching antibodies`);

// Show top patterns
console.log(`  Top failure patterns:`);
const topPats = Object.entries(genome.byConstraintType || {})
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);
for (const [k, v] of topPats) {
  console.log(`    ${k}: ${v}x`);
}

// ═══════════════════════════════════════════
// Layer 3: Success Rate — the bottom line
// ═══════════════════════════════════════════
console.log("\n── Layer 3: Success Rate ──");

let valPass = 0, valTotal = 0;
for (const task of TASKS) {
  const { chains } = selectCapabilityChains(task, ir, 3);
  if (chains.length === 0) continue;

  const actions: Action[] = chains[0].nodes.map((node: any) => {
    const def = ir.find((f: any) => f.name === node.name);
    const args = (def?.params || []).map((p: any) => ({
      name: p.name, type: p.type || "string", value: "",
    }));
    return { kind: "call" as const, function: node.name, args, assignTo: `${node.name}_r` };
  });
  const lastCall = actions[actions.length - 1] as any;
  actions.push({ kind: "return" as const, value: lastCall.assignTo || "r" });

  const validation = validateActionSequence(actions);
  valTotal++;
  if (validation.valid) valPass++;
}

console.log(`  Validation: ${valPass}/${valTotal} (${Math.round(valPass/valTotal*100)}%)`);

// ═══════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════
console.log(`\n═══════ Three-Layer Summary ═══════`);
console.log(`  L1 Graph:     Search space ↓${avgReduction}% (${Math.round(offTotal/TASKS.length)} → ${Math.round(onTotal/TASKS.length)} candidates)`);
console.log(`  L2 Antibody:  ${abHits}/${abTotal} tasks covered, ${genome.totalFailures} failures recorded`);
console.log(`  L3 Success:   ${valPass}/${valTotal} validation pass (${Math.round(valPass/valTotal*100)}%)`);
