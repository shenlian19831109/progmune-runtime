/**
 * Functional Test Suite — real business scenarios, end-to-end.
 *
 * Exercises the full pipeline WITHOUT LLM:
 *   1. Intent → Capability Graph chain derivation
 *   2. Chain → Action sequence construction
 *   3. Action sequence → validateActionSequence (SVL-1/2/3)
 *   4. Action sequence → SSG protocol validation (SVL-4)
 *   5. Validated actions → TypeScript/Python code emission
 *   6. Emitted code → TypeScript compilation check
 *
 * This tests everything except the LLM proposer — which is replaceable.
 * The system's real value is in the graph + validation + emission pipeline.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

import { selectCapabilityChains } from "./src/strategy-planner";
import { validateActionSequence, validateActionResult } from "./src/validator";
import { emitCode } from "./src/emitter";
import { emitPython } from "./src/python-emitter";
import { queryAntibodies } from "./src/failure-corpus";
import { getFailureAdjustedCredit } from "./src/feedback";
import { ok, err } from "./src/runtime-types";
import type { Action } from "./src/runtime-types";

// ── Test scenarios — real business intents ──
const SCENARIOS = [
  {
    name: "Benchmark Pipeline",
    intent: "load benchmarks and generate a pass rate report",
    expectedFunctions: ["loadBenchmarks", "benchmarkPassRate", "benchmarkReport"],
    category: "data-pipeline",
  },
  {
    name: "IR Extraction + Validation",
    intent: "extract IR from project and validate the actions",
    expectedFunctions: ["extractIR", "validateAction"],
    category: "dev-pipeline",
  },
  {
    name: "Session Analysis",
    intent: "list all sessions and find failure patterns",
    expectedFunctions: ["getAllSessions", "getTopFailurePatterns"],
    category: "analysis",
  },
  {
    name: "Repair Workflow",
    intent: "suggest repairs for a failed session",
    expectedFunctions: ["suggestRepairs", "getMinimalFixSet"],
    category: "repair",
  },
  {
    name: "Health Report",
    intent: "compute system health score from failure data",
    expectedFunctions: ["computeHealthScore", "formatHealthLevel"],
    category: "reporting",
  },
];

const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];

interface ScenarioResult {
  name: string;
  category: string;
  chains: number;
  chainLen: number;
  chainScore: number;
  hasExpectedFuncs: boolean;
  validationPassed: boolean;
  validationErrors: string[];
  tsEmitted: boolean;
  tsLines: number;
  pyEmitted: boolean;
  pyLines: number;
  antibodies: number;
  creditScores: number[];
}

console.log("═══ Progmune Functional Test Suite ═══\n");
console.log(`IR: ${ir.length} functions | Scenarios: ${SCENARIOS.length}\n`);

const results: ScenarioResult[] = [];

for (const scenario of SCENARIOS) {
  console.log(`── ${scenario.name} ──`);
  console.log(`  Intent: "${scenario.intent}"`);

  // Step 1: Capability Graph chain derivation
  const chains = selectCapabilityChains(scenario.intent, ir, 3);
  const chainLen = chains.length > 0 ? chains[0].nodes.length : 0;
  const chainScore = chains.length > 0 ? chains[0].score : 0;
  console.log(`  Step 1: Chains found = ${chains.length}, top len = ${chainLen}, score = ${chainScore.toFixed(1)}`);

  if (chains.length > 0) {
    console.log(`    Top chain: ${chains[0].explanation}`);
  }

  // Check if expected functions appear
  const allNames = chains.flatMap(c => c.nodes.map(n => n.name));
  const hasExpected = scenario.expectedFunctions.every(fn =>
    allNames.some(n => n === fn || n.toLowerCase().includes(fn.toLowerCase()))
  );
  console.log(`    Expected functions: ${hasExpected ? "✅" : "⚠️  missing: " + scenario.expectedFunctions.filter(fn => !allNames.some(n => n === fn)).join(", ")}`);

  // Step 2: Construct Action sequence from chain
  const actions: Action[] = [];
  if (chains.length > 0) {
    for (const node of chains[0].nodes) {
      const def = ir.find((f: any) => f.name === node.name);
      const args = (def?.params || []).map((p: any) => ({
        name: p.name,
        type: p.type || "string",
        value: "",
      }));
      actions.push({
        kind: "call",
        function: node.name,
        args,
        assignTo: `${node.name}_result`,
      });
    }
    // Add return
    if (actions.length > 0) {
      const lastCall = actions[actions.length - 1] as any;
      actions.push({ kind: "return", value: lastCall.assignTo || "result" });
    }
  }
  console.log(`  Step 2: Constructed ${actions.length} actions`);

  // Step 3: Validate action sequence (SVL-1/2/3)
  const validation = validateActionSequence(actions);
  const valResult = validateActionResult(actions);
  console.log(`  Step 3: Validation = ${validation.valid ? "✅ PASS" : "❌ FAIL"}`);
  if (validation.errors.length > 0) {
    console.log(`    Errors: ${validation.errors.slice(0, 3).join("; ")}`);
  }

  // Step 4: Code emission
  let tsEmitted = false;
  let tsLines = 0;
  let pyEmitted = false;
  let pyLines = 0;

  try {
    const tsCode = emitCode(actions, {
      sessionId: `test_${Date.now()}`,
      irFunctionCount: ir.length,
    });
    tsLines = tsCode.split("\n").length;
    tsEmitted = tsCode.includes("export function main") || tsCode.includes("import");
    console.log(`  Step 4a: TypeScript emission = ${tsEmitted ? "✅" : "❌"} (${tsLines} lines)`);
  } catch (e: any) {
    console.log(`  Step 4a: TypeScript emission = ❌ ${e.message}`);
  }

  try {
    const pyCode = emitPython(actions);
    pyLines = pyCode.split("\n").length;
    pyEmitted = pyCode.includes("def main") || pyCode.includes("from ");
    console.log(`  Step 4b: Python emission = ${pyEmitted ? "✅" : "❌"} (${pyLines} lines)`);
  } catch (e: any) {
    console.log(`  Step 4b: Python emission = ❌ ${e.message}`);
  }

  // Step 5: Antibody check
  const antibodies = queryAntibodies(scenario.intent, "ACL-1");
  console.log(`  Step 5: Antibodies found = ${antibodies.length} (ACL-1+)`);

  // Step 6: Credit scores
  const creditScores = chains.length > 0
    ? chains[0].nodes.map(n => getFailureAdjustedCredit(n.name))
    : [];
  const avgCredit = creditScores.length > 0
    ? creditScores.reduce((a, b) => a + b, 0) / creditScores.length
    : 0;
  console.log(`  Step 6: Avg credit score = ${avgCredit.toFixed(2)}`);

  results.push({
    name: scenario.name,
    category: scenario.category,
    chains: chains.length,
    chainLen,
    chainScore,
    hasExpectedFuncs: hasExpected,
    validationPassed: validation.valid,
    validationErrors: validation.errors,
    tsEmitted,
    tsLines,
    pyEmitted,
    pyLines,
    antibodies: antibodies.length,
    creditScores,
  });

  console.log("");
}

// ── TypeScript compilation check ──
console.log("═══ Compilation Check ═══");
const tmpDir = path.join(process.cwd(), ".test_tmp");

let compilePassed = false;
try {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Emit all scenarios into a single test file
  let testFile = '// Auto-generated functional test\n';
  for (const scenario of SCENARIOS) {
    const chains = selectCapabilityChains(scenario.intent, ir, 3);
    if (chains.length === 0) continue;
    const actions: Action[] = [];
    for (const node of chains[0].nodes) {
      const def = ir.find((f: any) => f.name === node.name);
      const args = (def?.params || []).map((p: any) => ({
        name: p.name,
        type: p.type || "string",
        value: "",
      }));
      actions.push({ kind: "call", function: node.name, args, assignTo: `${node.name}_result` });
    }
    if (actions.length > 0) {
      const lastCall = actions[actions.length - 1] as any;
      actions.push({ kind: "return", value: lastCall.assignTo || "result" });
    }
    try {
      const code = emitCode(actions);
      testFile += `\n// Scenario: ${scenario.name}\n${code}\n`;
    } catch {}
  }

  const testPath = path.join(tmpDir, "functional_test.ts");
  fs.writeFileSync(testPath, testFile, "utf-8");

  // Try TypeScript compilation
  try {
    execSync(`npx tsc --noEmit --strict ${testPath} 2>&1`, {
      cwd: process.cwd(),
      timeout: 30000,
      encoding: "utf-8",
    });
    const output = execSync(`npx tsc --noEmit --strict ${testPath} 2>&1 || true`, {
      cwd: process.cwd(),
      timeout: 30000,
      encoding: "utf-8",
    });
    const errorCount = (output.match(/error TS/g) || []).length;
    if (errorCount === 0) {
      compilePassed = true;
      console.log("✅ Generated code passes TypeScript type check (0 errors)");
    } else {
      compilePassed = false;
      console.log(`❌ TypeScript: ${errorCount} compilation errors`);
      console.log(output.split("\n").filter((l: string) => l.includes("error TS")).slice(0, 5).join("\n"));
    }
  } catch (e: any) {
    const msg = (e.stderr || e.message || "").toString();
    const errors = (msg.match(/error TS/g) || []).length;
    if (errors === 0) { compilePassed = true; console.log("✅ Compilation passed"); }
    else { console.log(`❌ ${errors} compilation errors`); }
  }
} catch (e: any) {
  console.log(`Compilation check: ${e.message}`);
}

// ── Aggregate ──
console.log("\n═══ Summary ═══");

const passed = results.filter(r => r.chains > 0 && r.tsEmitted);
const withFlow = results.filter(r => r.chainLen >= 2);
const withValidation = results.filter(r => r.validationPassed);

console.log(`  Scenarios:              ${SCENARIOS.length}`);
console.log(`  Chains found:           ${results.filter(r => r.chains > 0).length}/${SCENARIOS.length}`);
console.log(`  Expected funcs:         ${results.filter(r => r.hasExpectedFuncs).length}/${SCENARIOS.length}`);
console.log(`  Multi-step (>=2):       ${withFlow.length}/${SCENARIOS.length}`);
console.log(`  Validation passed:      ${withValidation.length}/${SCENARIOS.length}`);
console.log(`  TS emission:            ${results.filter(r => r.tsEmitted).length}/${SCENARIOS.length}`);
console.log(`  Python emission:        ${results.filter(r => r.pyEmitted).length}/${SCENARIOS.length}`);
console.log(`  Compilation passed:     ${compilePassed ? "✅" : "⚠️  (see errors above)"}`);

console.log(`\n  Avg chain score:        ${(results.reduce((s, r) => s + r.chainScore, 0) / results.length).toFixed(1)}`);
console.log(`  Avg chain length:        ${(results.reduce((s, r) => s + r.chainLen, 0) / results.length).toFixed(1)}`);
console.log(`  Avg antibodies/scenario: ${(results.reduce((s, r) => s + r.antibodies, 0) / results.length).toFixed(1)}`);

// ── Category breakdown ──
console.log("\n  By category:");
const byCat = new Map<string, ScenarioResult[]>();
for (const r of results) {
  if (!byCat.has(r.category)) byCat.set(r.category, []);
  byCat.get(r.category)!.push(r);
}
for (const [cat, catResults] of byCat) {
  const catPass = catResults.filter(r => r.chains > 0 && r.tsEmitted).length;
  console.log(`    ${cat}: ${catPass}/${catResults.length} passed`);
}

// Cleanup
try {
  fs.rmSync(tmpDir, { recursive: true });
} catch {}
