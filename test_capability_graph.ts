/**
 * Test 4: Does Planner use Capability Graph or LLM guessing?
 *
 * Tests whether chains are auto-derived from the graph,
 * or if the planner still relies on LLM keyword matching.
 */
import { selectCapabilityChains, formatChainHint } from "./src/strategy-planner";
import * as fs from "fs";

console.log("═══ Test 4: Capability Graph vs LLM Guessing ═══\n");

// Load real IR
const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
const functions = ir.functions || ir;
console.log(`IR: ${functions.length} functions`);

// Count capability metadata
const withPurpose = functions.filter((f: any) => f.purpose).length;
const withRequires = functions.filter((f: any) => (f.requires || []).length > 0).length;
const withProduces = functions.filter((f: any) => (f.produces || []).length > 0).length;
console.log(`  purpose: ${withPurpose} | requires: ${withRequires} | produces: ${withProduces}`);

// ── Test: Can the graph derive a chain without LLM? ──
console.log("\n── Test 4a: Chain derivation (no LLM) ──");

const testIntents = [
  "generate benchmark report",
  "validate actions and extract IR",
  "authenticate user",
  "fetch user data",
  "handle errors",
];

for (const intent of testIntents) {
  const chains = selectCapabilityChains(intent, functions, 3);
  const hint = formatChainHint(chains);

  if (chains.length > 0) {
    const topChain = chains[0];
    const avgScore = topChain.score.toFixed(1);
    const chainLen = topChain.nodes.length;
    console.log(`  "${intent}" → ${chains.length} chains, top: ${topChain.explanation} (★${avgScore}, ${chainLen} nodes)`);

    // Check if any node has a meaningful score (> 0 = keyword match found)
    const hasScored = topChain.nodes.some(n => n.score > 0);
    if (hasScored) {
      console.log(`    ✅ Keywords matched — graph search active`);
    } else {
      console.log(`    ⚠️  All scores = 0 — fallback mode (random seed)`);
    }
  } else {
    console.log(`  "${intent}" → ❌ No chains found`);
  }
}

// ── Test 4b: Chain quality ──
console.log("\n── Test 4b: Chain quality ──");

// Test with an intent that should produce a clear chain
const reportChain = selectCapabilityChains("generate benchmark report", functions, 5);
if (reportChain.length > 0) {
  const best = reportChain[0];
  const names = best.nodes.map(n => n.name);

  const hasReportFunc = names.some(n => n.includes("benchmark") || n.includes("Report") || n.includes("report"));
  const isMultiStep = best.nodes.length >= 2;

  console.log(`  Best report chain: ${best.explanation}`);
  console.log(`  Contains report-related: ${hasReportFunc ? "✅" : "⚠️  No benchmark/report function in chain"}`);
  console.log(`  Multi-step (≥2): ${isMultiStep ? "✅ Graph derived chain" : "⚠️  Single node — minimal derivation"}`);

  // Check if chain uses data-flow connections (produces→requires)
  let hasDataFlow = false;
  for (let i = 0; i < best.nodes.length - 1; i++) {
    const current = best.nodes[i];
    const next = best.nodes[i + 1];
    if (current.produces.some(p => next.requires.includes(p))) {
      hasDataFlow = true;
      break;
    }
  }
  console.log(`  Data-flow driven: ${hasDataFlow ? "✅ produces→requires links found" : "⚠️  No direct data-flow — topology/score based"}`);
}

// ── Summary ──
console.log("\n═══ Test 4 Result ═══");

const coldIntent = selectCapabilityChains("xyz abc def something completely unrelated", functions, 3);
const coldHasFallback = coldIntent.length > 0;
const allScores = coldIntent.flatMap(c => c.nodes.map(n => n.score));
const allZero = allScores.every(s => s === 0);

console.log(`  Cold intent chains:    ${coldHasFallback ? "✅ Fallback works" : "❌ No chains at all"}`);
console.log(`  Cold intent scores:    ${allZero ? "⚠️  All zero — random seed (no keyword match)" : "✅ Semantic match found"}`);
console.log(`  Capability metadata:   ${withPurpose}/${withRequires}/${withProduces} (purpose/requires/produces)`);
console.log(`  Graph-driven chains:   ${reportChain.length > 0 ? "✅ Active" : "❌ Not used"}`);
console.log(`  LLM still needed:      ${allZero ? "⚠️  YES — when no keywords match, still relies on LLM" : "—"}`);
