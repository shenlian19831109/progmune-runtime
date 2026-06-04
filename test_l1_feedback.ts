/**
 * Test 1: L1 Feedback Loop — real test
 *
 * Manufactures 10 identical failures via recordSession(),
 * then checks whether antibodies are generated and consistent.
 *
 * Key finding: antibodies come from SESSIONS (recordSession),
 * not from individual failure records (recordFailure).
 */
import { saveFeedback } from "./src/feedback";
import { queryAntibodies, getLearnedPatterns, getFailureGenome, recordSession, SVL } from "./src/failure-corpus";
import { consolidateSemantic } from "./src/memory-layer";
import { generateAttemptId, generateSessionId, generatePlannerSeed } from "./src/runtime-types";
import type { ExecutionSession, Attempt, ConstraintViolation, StateTransition } from "./src/runtime-types";

const ERROR_INTENT = "generate report from benchmark data";
const ERROR_FUNC = "formatReportAsMarkdown";
const FIX_PATH = ["loadBenchmarks", "benchmarkPassRate", "benchmarkReport"];

console.log("═══ Test 1: L1 Feedback Loop ═══\n");

// ── Phase 1: Record 10 sessions with the SAME failure pattern ──
console.log("Phase 1: Recording 10 sessions with identical failure pattern...");

for (let i = 0; i < 10; i++) {
  const sessionId = generateSessionId();
  const violation: ConstraintViolation = {
    svl: 1,
    violatedConstraint: "symbol_existence",
    actionIndex: 0,
    description: `LLM hallucinated function: ${ERROR_FUNC} does not exist in IR`,
    fixPath: FIX_PATH,
  };
  const transition: StateTransition = {
    actionIndex: 0,
    function: ERROR_FUNC,
    namespace: "_global",
    acquired: [],
    invalidated: [],
    statesBefore: { _global: ["INIT"] },
    statesAfter: { _global: ["INIT"] },
    valid: false,
  };
  const attempt: Attempt = {
    id: generateAttemptId(),
    sessionId,
    attemptNumber: 1,
    inputIntent: ERROR_INTENT,
    plannerSeed: generatePlannerSeed(ERROR_INTENT, "deepseek-chat"),
    constraintSnapshotId: `snap_${i}`,
    generatedActions: [{ kind: "call", function: ERROR_FUNC, args: [] }],
    transitions: [transition],
    violations: [violation],
    outcome: "constraint_violation",
    timestamp: Date.now() - (10 - i) * 60000,
    llmCallCount: 1,
    durationMs: 100,
  };
  const session: ExecutionSession = {
    sessionId,
    intent: ERROR_INTENT,
    attempts: [attempt],
    resolved: false,
    startedAt: Date.now() - (10 - i) * 60000,
  };
  recordSession(session);

  // Also record in feedback (L3 credit)
  saveFeedback({
    intent: ERROR_INTENT,
    functionName: ERROR_FUNC,
    success: false,
    errorType: "SVL-1",
    svlLevel: "SVL-1",
    timestamp: new Date(Date.now() - (10 - i) * 60000).toISOString(),
  });
}

console.log("  10 sessions recorded.\n");

// ── Phase 2: Check antibodies ──
console.log("Phase 2: Antibody generation...");
consolidateSemantic(3);

const learned = getLearnedPatterns();
console.log(`  Total learned patterns: ${learned.failureToFix.length}`);
for (const p of learned.failureToFix) {
  console.log(`    ${p.antibodyLevel} | ${p.signature} | ${p.occurrenceCount}x | fix: ${(p.fixPath || []).join(" → ")}`);
}

const antibodies = queryAntibodies(ERROR_INTENT, "ACL-1");
console.log(`\n  Query "${ERROR_INTENT}" → ${antibodies.length} antibodies`);

// ── Phase 3: Stability ──
console.log("\nPhase 3: Stability — 3 queries, same intent...");
const sigs: string[] = [];
for (let i = 0; i < 3; i++) {
  const abs = queryAntibodies(ERROR_INTENT, "ACL-1");
  sigs.push(abs[0]?.signature || "NONE");
  console.log(`  Query ${i + 1}: ${abs[0]?.antibodyLevel || "NONE"} | ${abs[0]?.signature || "—"}`);
}

console.log(`\n  Stability: ${new Set(sigs).size === 1 && sigs[0] !== "NONE" ? "✅ CONSISTENT" : "❌ INCONSISTENT OR EMPTY"}`);

// ── Phase 4: L1 hint ──
console.log("\nPhase 4: L1 hint injection check...");
const acl3 = queryAntibodies(ERROR_INTENT, "ACL-3");
if (acl3.length > 0) {
  console.log(`  ✅ ACL-3+ antibody exists → L1 hint WOULD be injected`);
  console.log(`     Pattern: ${acl3[0].signature}`);
  console.log(`     Occurrences: ${acl3[0].occurrenceCount}x`);
  console.log(`     Fix: ${acl3[0].fixPath.join(" → ")}`);
} else {
  console.log(`  ❌ No ACL-3+ antibody → L1 hint empty (need more distinct intents or occurrences)`);
}

// ── Summary ──
const genome = getFailureGenome();
console.log(`\n═══ Test 1 Result ═══`);
console.log(`  Total failures:        ${genome.totalFailures}`);
console.log(`  Learned patterns:      ${learned.failureToFix.length}`);
console.log(`  ACL-1+ antibodies:     ${antibodies.length > 0 ? "✅" : "❌"}`);
console.log(`  ACL-3+ ready:          ${acl3.length > 0 ? "✅" : "❌"}`);
console.log(`  Database only:         ${genome.totalFailures >= 10 && acl3.length === 0 ? "⚠️ YES — data growing, not learning" : "—"}`);
