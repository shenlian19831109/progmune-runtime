/**
 * Knowledge ROI Experiment
 *
 * Measures how much the Capability Graph + Antibody system improves
 * planning vs. raw LLM guessing.
 *
 * Round A (Graph OFF): pure keyword similarity scoring on raw IR
 * Round B (Graph ON):  v2.5.0 full pipeline — capability chains + topology
 *
 * Metric: average seeds found, avg chain score, avg chain length,
 *         data-flow connectivity ratio
 */

import * as fs from "fs";
import { selectCapabilityChains, formatChainHint } from "./src/strategy-planner";
import { getTopology, rebuildTopology, SemanticTopology } from "./src/semantic-topology";
import { jaccardSimilarity, extractKeywords } from "./src/utils";

const irRaw = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
const ir = irRaw.functions || irRaw;
console.log(`IR: ${ir.length} functions\n`);

// ── Task set: real business intents ──
const TASKS = [
  // Data pipeline
  "generate benchmark report from results",
  "load benchmark tasks and count them",
  "save benchmark results to disk",
  // IR / extraction
  "extract IR from project and validate actions",
  "audit source files for generated markers",
  // Immune / knowledge
  "check ledger consistency and report violations",
  "query antibody registry for known failure patterns",
  "import external failure fingerprints",
  // Session / state
  "list all sessions and find the latest one",
  "format session timeline for debugging",
  // Auth / protocol (SSG)
  "authenticate user and validate password",
  "generate JWT token after authentication",
  // Reports
  "format failure genome summary",
  "generate semantic heatmap from corpus",
  // Repair
  "suggest repair proposals for a failed session",
  // Cross-module tasks
  "extract IR then validate then generate report",
  "load sessions and compare fingerprints",
  "validate protocol transitions and repair if needed",
  "generate comprehensive system health report",
  "bulk-generate benchmark reports for all tasks",
];

// ── Round A: Graph OFF (raw keyword scoring only) ──
console.log("═══════ Round A: Graph OFF (keyword only) ═══════");

interface TaskResult {
  task: string;
  chains: number;
  avgScore: number;
  avgLen: number;
  hasDataFlow: boolean;
  topChain: string;
}

function runGraphOff(intent: string, ir: any[]): TaskResult {
  const keywords = extractKeywords(intent);
  const intentLower = intent.toLowerCase();

  // Simple keyword scoring (no capability graph, no topology)
  const scored = ir
    .filter((f: any) => f.exported)
    .map((f: any) => {
      let score = 0;
      for (const kw of keywords) {
        if (f.name.toLowerCase().includes(kw)) score += 1;
        if ((f.purpose || "").toLowerCase().includes(kw)) score += 0.5;
      }
      return { ...f, score };
    })
    .filter((f: any) => f.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5);

  const chains = scored.map((f: any) => ({
    nodes: [f],
    score: f.score,
    explanation: f.name,
    hasDataFlow: false,
  }));

  if (chains.length === 0) {
    return { task: intent, chains: 0, avgScore: 0, avgLen: 0, hasDataFlow: false, topChain: "NONE" };
  }

  return {
    task: intent,
    chains: chains.length,
    avgScore: chains.reduce((s, c) => s + c.score, 0) / chains.length,
    avgLen: 1,
    hasDataFlow: false,
    topChain: chains[0].explanation,
  };
}

// ── Round B: Graph ON (v2.5.0 full pipeline) ──
console.log("═══════ Round B: Graph ON  (capability chains + topology) ═══");

function runGraphOn(intent: string, ir: any[]): TaskResult {
  const chains = selectCapabilityChains(intent, ir, 5);

  if (chains.length === 0) {
    return { task: intent, chains: 0, avgScore: 0, avgLen: 0, hasDataFlow: false, topChain: "NONE" };
  }

  // Check data-flow connectivity
  let hasDataFlow = false;
  for (const c of chains) {
    for (let i = 0; i < c.nodes.length - 1; i++) {
      if ((c.nodes[i].produces || []).some(p => (c.nodes[i + 1].requires || []).includes(p))) {
        hasDataFlow = true;
        break;
      }
    }
    if (hasDataFlow) break;
  }

  return {
    task: intent,
    chains: chains.length,
    avgScore: chains.reduce((s, c) => s + c.score, 0) / chains.length,
    avgLen: chains.reduce((s, c) => s + c.nodes.length, 0) / chains.length,
    hasDataFlow,
    topChain: chains[0]?.explanation || "NONE",
  };
}

// ── Run experiment ──
const resultsA: TaskResult[] = [];
const resultsB: TaskResult[] = [];

for (const task of TASKS) {
  resultsA.push(runGraphOff(task, ir));
  resultsB.push(runGraphOn(task, ir));
}

// ── Print results ──
console.log(`\n${"Task".padEnd(55)} ${"A-score".padEnd(8)} ${"B-score".padEnd(8)} ${"A-len".padEnd(6)} ${"B-len".padEnd(6)} ${"Flow"}`);
console.log("─".repeat(95));

for (let i = 0; i < TASKS.length; i++) {
  const a = resultsA[i];
  const b = resultsB[i];
  const taskName = TASKS[i].slice(0, 53).padEnd(55);
  const aScore = a.avgScore.toFixed(1).padEnd(8);
  const bScore = b.avgScore.toFixed(1).padEnd(8);
  const aLen = String(a.avgLen).padEnd(6);
  const bLen = String(b.avgLen).padEnd(6);
  const flow = b.hasDataFlow ? "✅ flow" : "—";
  console.log(`${taskName} ${aScore} ${bScore} ${aLen} ${bLen} ${flow}`);
}

// ── Aggregate ──
const aAvgScore = resultsA.reduce((s, r) => s + r.avgScore, 0) / resultsA.length;
const bAvgScore = resultsB.reduce((s, r) => s + r.avgScore, 0) / resultsB.length;
const aAvgLen = resultsA.reduce((s, r) => s + r.avgLen, 0) / resultsA.length;
const bAvgLen = resultsB.reduce((s, r) => s + r.avgLen, 0) / resultsB.length;
const aHits = resultsA.filter(r => r.chains > 0).length;
const bHits = resultsB.filter(r => r.chains > 0).length;
const bFlow = resultsB.filter(r => r.hasDataFlow).length;

console.log(`\n═══════ Summary ═══════`);
console.log(`                     Graph OFF    Graph ON     Δ`);
console.log(`  Avg score          ${aAvgScore.toFixed(1).padStart(8)}    ${bAvgScore.toFixed(1).padStart(8)}    ${bAvgScore > aAvgScore ? "+" : ""}${(bAvgScore - aAvgScore).toFixed(1)}`);
console.log(`  Avg chain length   ${aAvgLen.toFixed(1).padStart(8)}    ${bAvgLen.toFixed(1).padStart(8)}    ${bAvgLen > aAvgLen ? "+" : ""}${(bAvgLen - aAvgLen).toFixed(1)}`);
console.log(`  Tasks with chains  ${String(aHits).padStart(8)}    ${String(bHits).padStart(8)}    ${bHits >= aHits ? "+" : ""}${bHits - aHits}`);
console.log(`  Data-flow chains   ${"—".padStart(8)}    ${String(bFlow).padStart(8)}    —`);
console.log(`\n  Knowledge ROI: score +${((bAvgScore - aAvgScore) / Math.max(0.01, aAvgScore) * 100).toFixed(0)}%, length +${bAvgLen > aAvgLen ? ((bAvgLen - aAvgLen) / Math.max(0.01, aAvgLen) * 100).toFixed(0) : 0}%`);

// Sample best chain from each round
console.log(`\n═══ Sample best chains ═══`);
console.log(`\nGraph OFF best chains:`);
resultsA
  .filter(r => r.chains > 0)
  .sort((a, b) => b.avgScore - a.avgScore)
  .slice(0, 3)
  .forEach(r => console.log(`  ${r.task.slice(0, 45)} → ${r.topChain}`));

console.log(`\nGraph ON best chains:`);
resultsB
  .filter(r => r.chains > 0)
  .sort((a, b) => b.avgScore - a.avgScore)
  .slice(0, 3)
  .forEach(r => console.log(`  ${r.task.slice(0, 45)} → ${r.topChain}`));
