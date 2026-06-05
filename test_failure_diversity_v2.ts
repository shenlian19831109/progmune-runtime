/**
 * Failure Diversity v2 — novel root cause types
 * Adds import_error, null_reference, state_corruption, race_condition
 */

import * as fs from "fs";
import { recordSession } from "./src/failure-corpus";
import { generateSessionId, generateAttemptId, generatePlannerSeed } from "./src/runtime-types";
import type { ExecutionSession, Attempt, ConstraintViolation } from "./src/runtime-types";

const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];

function makeAttempt(intent: string, violations: ConstraintViolation[]): Attempt {
  return {
    id: generateAttemptId(), sessionId: "",
    attemptNumber: 1, inputIntent: intent,
    plannerSeed: generatePlannerSeed(intent, "deepseek-chat"),
    constraintSnapshotId: `snap_${Date.now()}`,
    generatedActions: [{ kind: "call" as const, function: ir[0]?.name || "loadBenchmarks", args: [] }],
    transitions: [{
      actionIndex: 0, function: ir[0]?.name || "loadBenchmarks",
      namespace: "_global", acquired: [], invalidated: [],
      statesBefore: { _global: ["INIT"] }, statesAfter: { _global: ["INIT"] }, valid: false,
    }],
    violations, outcome: "constraint_violation",
    timestamp: Date.now(), llmCallCount: 1, durationMs: 100,
  };
}

function record(intent: string, svl: 1|2|3|4, constraint: string, desc: string, fix: string[]) {
  const session: ExecutionSession = {
    sessionId: generateSessionId(), intent,
    attempts: [makeAttempt(intent, [{ svl, violatedConstraint: constraint, actionIndex: 0, description: desc, fixPath: fix }])],
    resolved: false, startedAt: Date.now(),
  };
  recordSession(session);
}

let count = 0;
console.log("═══ Failure Diversity v2 — Novel Root Causes ═══\n");

// import_error: SVL-1 variant — import resolution failure
console.log("── import_error ──");
const importIntents = [
  "import missing module in benchmark loader",
  "resolve circular import between validator and planner",
  "fix broken default export in capability graph",
  "handle optional dependency import failure in emitter",
  "resolve namespace collision in protocol registry imports",
];
for (const intent of importIntents) {
  record(intent, 1, "import_error", "Import resolution failed: module not found or circular dependency",
    ["checkModulePath", "verifyExports", "resolveImport"]);
  console.log(`  ${++count}. ${intent}`);
}

// null_reference: SVL-3 variant — null/undefined access
console.log("\n── null_reference ──");
const nullIntents = [
  "handle undefined session in formatSessionValidation",
  "guard against null transition in ledger consistency check",
  "prevent undefined access in fingerprint verification",
  "check null return from loadBenchmarks before pipeline",
  "handle empty failure corpus in antibody query",
];
for (const intent of nullIntents) {
  record(intent, 3, "null_reference", "Null/undefined reference: accessed property on null or undefined",
    ["addNullCheck", "provideDefault", "earlyReturn"]);
  console.log(`  ${++count}. ${intent}`);
}

// state_corruption: SVL-4 variant — invalid state mutation
console.log("\n── state_corruption ──");
const stateIntents = [
  "prevent state corruption when invalidating BENCHMARKS_LOADED twice",
  "fix inconsistent namespace state after partial protocol repair",
  "recover from ledger state mismatch after branch merge",
  "detect unauthorized state mutation outside protocol validator",
  "restore corrupted session state from replay checkpoint",
];
for (const intent of stateIntents) {
  record(intent, 4, "state_corruption", "State corruption: namespace state inconsistent after invalid operation",
    ["rebuildState", "validateLedger", "restoreFromSnapshot"]);
  console.log(`  ${++count}. ${intent}`);
}

// concurrency_error: SVL-4 variant — race condition in state transitions
console.log("\n── concurrency_error ──");
const raceIntents = [
  "fix race condition when two sessions write to same corpus",
  "prevent concurrent modification of protocol registry during validation",
  "handle file lock timeout in parallel benchmark execution",
  "resolve deadlock between ledger write and fingerprint verify",
  "synchronize access to topology cache during concurrent builds",
];
for (const intent of raceIntents) {
  record(intent, 4, "concurrency_error", "Concurrency error: race condition or deadlock in state transition",
    ["acquireLock", "checkConsistency", "retryWithBackoff"]);
  console.log(`  ${++count}. ${intent}`);
}

console.log(`\n✅ Novel root causes added: ${count}`);
console.log(`   import_error: ${importIntents.length}, null_reference: ${nullIntents.length}`);
console.log(`   state_corruption: ${stateIntents.length}, concurrency_error: ${raceIntents.length}`);
