/**
 * Protocol Simulation Test — isolate Runtime vs Planner
 *
 * Constructs the exact action sequence LLM tried to produce:
 *   loadBenchmarks → benchmarkPassRate → benchmarkReport
 *
 * Simulates SSG protocol validation step by step,
 * showing state transitions at each step.
 *
 * Answers: Is the validator rejecting correct plans?
 */

import * as fs from "fs";
import type { Action, ConstraintViolation, StateTransition } from "./src/runtime-types";
import { validateActionSequence } from "./src/validator";

// ── The exact sequence LLM produced ──
const testCases = [
  {
    name: "LLM's first attempt (was rejected)",
    actions: [
      { kind: "call" as const, function: "loadBenchmarks", args: [], assignTo: "BENCHMARK_TASKS" },
      { kind: "call" as const, function: "benchmarkPassRate", args: [], assignTo: "PASS_RATE_DATA" },
      { kind: "call" as const, function: "benchmarkCount", args: [], assignTo: "TASK_COUNT" },
      { kind: "call" as const, function: "benchmarkReport", args: [], assignTo: "BENCHMARK_REPORT" },
      { kind: "return" as const, value: "BENCHMARK_REPORT" },
    ],
  },
  {
    name: "LLM's second attempt (was rejected)",
    actions: [
      { kind: "call" as const, function: "loadBenchmarks", args: [], assignTo: "BENCHMARK_TASKS" },
      { kind: "call" as const, function: "benchmarkReport", args: [], assignTo: "BENCHMARK_REPORT" },
      { kind: "return" as const, value: "BENCHMARK_REPORT" },
    ],
  },
  {
    name: "Simplest valid: load → report",
    actions: [
      { kind: "call" as const, function: "loadBenchmarks", args: [], assignTo: "tasks" },
      { kind: "call" as const, function: "benchmarkReport", args: [], assignTo: "report" },
      { kind: "return" as const, value: "report" },
    ],
  },
  {
    name: "Expected chain: load → passRate → report",
    actions: [
      { kind: "call" as const, function: "loadBenchmarks", args: [], assignTo: "tasks" },
      { kind: "call" as const, function: "benchmarkPassRate", args: [], assignTo: "rate" },
      { kind: "call" as const, function: "benchmarkReport", args: [], assignTo: "report" },
      { kind: "return" as const, value: "report" },
    ],
  },
];

// ── Check protocol definitions ──
console.log("═══ Protocol Simulation Test ═══\n");

const protocolsPath = "protocols.json";
if (fs.existsSync(protocolsPath)) {
  const proto = JSON.parse(fs.readFileSync(protocolsPath, "utf-8"));
  console.log("Protocol rules in protocols.json:");
  const rules = proto.rules || proto;
  for (const [fn, rule] of Object.entries(rules)) {
    const r = rule as any;
    if (fn.includes("benchmark") || fn.includes("loadBenchmarks") || fn.includes("report")) {
      console.log(`  ${fn}: pre=[${(r.pre_states||[]).join(",")}] post=[${(r.post_states||[]).join(",")}]`);
    }
  }
  console.log("");
}

// ── Run test cases ──
for (const tc of testCases) {
  console.log(`── ${tc.name} ──`);
  console.log(`  Actions: ${tc.actions.map(a => a.kind === "return" ? "return" : a.function).join(" → ")}`);

  const result = validateActionSequence(tc.actions);

  if (result.valid) {
    console.log(`  ✅ VALID — no violations`);
  } else {
    console.log(`  ❌ INVALID — ${result.errors.length} errors, ${result.violations.length} violations`);
    for (const v of result.violations) {
      console.log(`    [SVL-${v.svl}] ${v.violatedConstraint}: ${v.description}`);
      if (v.missingStates?.length) console.log(`      missing states: [${v.missingStates.join(", ")}]`);
      if (v.requiredStates?.length) console.log(`      required states: [${v.requiredStates.join(", ")}]`);
      if (v.currentStates?.length) console.log(`      current states: [${v.currentStates.join(", ")}]`);
    }
  }
  console.log("");
}

// ── Diagnose: check if protocol rules are in IR ──
console.log("── IR Protocol Coverage Check ──");
const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];
const benchmarkFuncs = ir.filter((f: any) =>
  f.name.includes("benchmark") || f.name.includes("loadBenchmarks") || f.name.includes("report")
);
for (const f of benchmarkFuncs) {
  console.log(`  ${f.name}: protocol=${JSON.stringify(f.protocol)} requires=[${(f.requires||[]).join(",")}] produces=[${(f.produces||[]).join(",")}]`);
}
