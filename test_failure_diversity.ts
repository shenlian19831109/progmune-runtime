/**
 * Failure Diversity Construction
 *
 * Manufactures SVL-2, SVL-3, SVL-4 failures to balance the corpus.
 * Current: 82% SVL-1, 1% SVL-2, 1% SVL-3, 16% SVL-4
 * Target:  ~35% SVL-1, ~25% SVL-2, ~20% SVL-3, ~20% SVL-4
 *
 * Layer A (Synthetic): constructed here
 * Layer B (Organic): from real LLM runs (already in corpus)
 */

import { recordSession } from "./src/failure-corpus";
import { generateSessionId, generateAttemptId, generatePlannerSeed } from "./src/runtime-types";
import type { ExecutionSession, Attempt, ConstraintViolation, StateTransition } from "./src/runtime-types";

import * as fs from "fs";
const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];
const irFuncNames = ir.map((f: any) => f.name);

function makeAttempt(intent: string, violations: ConstraintViolation[], outcome: Attempt["outcome"]): Attempt {
  return {
    id: generateAttemptId(),
    sessionId: "",
    attemptNumber: 1,
    inputIntent: intent,
    plannerSeed: generatePlannerSeed(intent, "deepseek-chat"),
    constraintSnapshotId: `snap_${Date.now()}`,
    generatedActions: [
      { kind: "call" as const, function: irFuncNames[0] || "loadBenchmarks", args: [] },
    ],
    transitions: [{
      actionIndex: 0, function: irFuncNames[0] || "loadBenchmarks",
      namespace: "_global", acquired: [], invalidated: [],
      statesBefore: { _global: ["INIT"] }, statesAfter: { _global: ["INIT"] }, valid: false,
    }],
    violations,
    outcome,
    timestamp: Date.now(),
    llmCallCount: 1,
    durationMs: 100,
  };
}

// ── SVL-2: Type Mismatch ──
const svl2Intents = [
  "call validateAction with wrong parameter count",
  "pass string to function expecting number in benchmarkPassRate",
  "provide array where object is expected in saveFeedback",
  "mismatched return type in session validation",
  "wrong argument type for extractIR projectRoot parameter",
  "incorrect generic type parameter in capability graph",
  "boolean passed where string enum is required for SVL parameter",
  "null passed to function expecting non-null StateTransition",
  "tuple assigned to variable declared as Map in ledger registry",
  "function signature mismatch in protocol validation callback",
];

// ── SVL-3: Dataflow ──
const svl3Intents = [
  "use variable before it is declared in benchmark pipeline",
  "circular reference in repair proposal dependency chain",
  "access result of async function without await in planner",
  "reassign const variable in protocol validator loop",
  "reference out-of-scope variable from nested if block",
  "self-referencing assignment in capability chain builder",
  "use uninitialized accumulator in reduce over ledger entries",
  "dead code path after early return in session manager",
  "shadow outer variable with inner declaration in emitter",
  "leak loop variable outside for block in topology builder",
];

// ── SVL-4: Protocol Violation ──
const svl4Intents = [
  "call benchmarkReport without loadBenchmarks first",
  "emit code before IR extraction in dev pipeline",
  "record session before validation passes",
  "repair ledger without checking consistency first",
  "save feedback before IR extraction completes",
  "generate report without loading benchmark tasks",
  "register fingerprint before session is recorded",
  "validate transition without initializing namespace state",
  "save checkpoint without acquiring write lock",
  "emit Python code from TypeScript-only pipeline",
];

console.log("═══ Failure Diversity Construction ═══\n");

let count = 0;

// SVL-2: Type Mismatch (10 failures)
console.log("── SVL-2: Type Mismatch ──");
for (const intent of svl2Intents) {
  const session: ExecutionSession = {
    sessionId: generateSessionId(),
    intent,
    attempts: [makeAttempt(intent, [{
      svl: 2,
      violatedConstraint: "type_mismatch",
      actionIndex: 0,
      description: `Type mismatch in function call: expected different parameter type or count`,
      fixPath: ["checkParams", "verifyTypeSignature", "correctArgs"],
    }], "constraint_violation")],
    resolved: false,
    startedAt: Date.now(),
  };
  recordSession(session);
  count++;
  console.log(`  ${count}. ${intent.slice(0, 50)}`);
}

// SVL-3: Dataflow (10 failures)
console.log("\n── SVL-3: Dataflow ──");
for (const intent of svl3Intents) {
  const session: ExecutionSession = {
    sessionId: generateSessionId(),
    intent,
    attempts: [makeAttempt(intent, [{
      svl: 3,
      violatedConstraint: "dataflow",
      actionIndex: 0,
      description: `Dataflow error: variable used before declaration or circular reference detected`,
      fixPath: ["declareVariable", "verifyScope", "checkDataflow"],
    }], "constraint_violation")],
    resolved: false,
    startedAt: Date.now(),
  };
  recordSession(session);
  count++;
  console.log(`  ${count}. ${intent.slice(0, 50)}`);
}

// SVL-4: Protocol Violation (10 failures)
console.log("\n── SVL-4: Protocol Violation ──");
for (const intent of svl4Intents) {
  const session: ExecutionSession = {
    sessionId: generateSessionId(),
    intent,
    attempts: [makeAttempt(intent, [{
      svl: 4,
      violatedConstraint: "protocol",
      actionIndex: 0,
      description: `Protocol violation: function called before required prerequisite`,
      fixPath: ["loadBenchmarks", "benchmarkPassRate", "benchmarkReport"],
    }], "constraint_violation")],
    resolved: false,
    startedAt: Date.now(),
  };
  recordSession(session);
  count++;
  console.log(`  ${count}. ${intent.slice(0, 50)}`);
}

console.log(`\n✅ Total synthetic failures added: ${count}`);
console.log(`   SVL-2: ${svl2Intents.length}, SVL-3: ${svl3Intents.length}, SVL-4: ${svl4Intents.length}`);
