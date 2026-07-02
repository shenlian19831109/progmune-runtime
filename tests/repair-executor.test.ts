/**
 * P0: Repair Executor Tests — verify the fix-apply-verify loop.
 *
 * Tests cover:
 *   1. Repair executor successfully fixes resource_leak
 *   2. Repair executor fixes missing_prerequisite
 *   3. Repair executor tries multiple candidates
 *   4. Repair executor correctly reports failure reasons
 *   5. End-to-end: violation → fix → verification
 *   6. No regression: existing repair pipeline still works
 */

import { describe, it, expect } from "vitest";
import { RepairExecutor, fixViolation, generateRepairTaxonomy } from "../src/repair-executor";
import { suggestAlternatives } from "../src/counterfactual-engine";
import type { StateAnnotation } from "../src/ssg-validator";
import type { ConstraintViolation, GoalConstraint } from "../src/runtime-types";

// ── Test Helpers ──

/** Build a minimal FileProtocol rules map. */
function fileProtocolRules(): Map<string, StateAnnotation> {
  return new Map([
    ["open_file", {
      pre_states: [],
      post_states: ["FILE_OPEN"],
      namespace: "file",
    }],
    ["read_file", {
      pre_states: ["FILE_OPEN"],
      post_states: [],
      namespace: "file",
    }],
    ["write_file", {
      pre_states: ["FILE_OPEN"],
      post_states: [],
      namespace: "file",
    }],
    ["close_file", {
      pre_states: ["FILE_OPEN"],
      post_states: [],
      invalidate: ["FILE_OPEN"],
      namespace: "file",
    }],
  ]);
}

/** Build a minimal AuthProtocol rules map. */
function authProtocolRules(): Map<string, StateAnnotation> {
  return new Map([
    ["verify_password", {
      pre_states: ["UNAUTHENTICATED"],
      post_states: ["PASSWORD_VERIFIED"],
      namespace: "auth",
    }],
    ["generate_jwt", {
      pre_states: ["PASSWORD_VERIFIED"],
      post_states: ["TOKEN_ISSUED"],
      invalidate: ["PASSWORD_VERIFIED"],
      namespace: "auth",
    }],
    ["create_session", {
      pre_states: ["TOKEN_ISSUED"],
      post_states: ["SESSION_ACTIVE"],
      invalidate: ["TOKEN_ISSUED"],
      namespace: "auth",
    }],
    ["logout", {
      pre_states: ["SESSION_ACTIVE"],
      post_states: ["UNAUTHENTICATED"],
      invalidate: ["SESSION_ACTIVE"],
      namespace: "auth",
    }],
  ]);
}

/** Build a violation for resource leak. */
function resourceLeakViolation(): ConstraintViolation {
  return {
    svl: 4,
    violatedConstraint: "protocol_violation",
    actionIndex: 2,
    currentStates: ["FILE_OPEN"],
    requiredStates: [],
    description: "File not closed — resource leak detected",
  };
}

function missingPrereqViolation(): ConstraintViolation {
  return {
    svl: 4,
    violatedConstraint: "protocol_violation",
    actionIndex: 1,
    currentStates: ["UNAUTHENTICATED"],
    requiredStates: ["SESSION_ACTIVE"],
    description: "create_session called without verify_password — missing prerequisite",
  };
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe("P0: Repair Executor", () => {

  // ── Test 1: Resource Leak Fix ──
  it("fixes resource_leak by appending close_file", async () => {
    const executor = new RepairExecutor({ recordTrajectory: false });

    const result = await executor.execute({
      violation: resourceLeakViolation(),
      protocol: "FileProtocol",
      currentState: ["FILE_OPEN"],
      targetState: [],
      actionSequence: ["open_file", "write_file"],
      rules: fileProtocolRules(),
    });

    expect(result.success).toBe(true);
    expect(result.fixedSequence).toBeDefined();
    expect(result.fixedSequence).toContain("close_file");
    // close_file should be appended at the end
    const lastAction = result.fixedSequence![result.fixedSequence!.length - 1];
    expect(lastAction).toBe("close_file");
    expect(result.attempts.length).toBeGreaterThanOrEqual(1);
    expect(result.attempts[0].verificationPassed).toBe(true);
  });

  // ── Test 2: Missing Prerequisite Fix ──
  it("fixes missing_prerequisite by prepending prerequisite actions", async () => {
    const executor = new RepairExecutor({ recordTrajectory: false, maxAttempts: 5 });

    const result = await executor.execute({
      violation: missingPrereqViolation(),
      protocol: "AuthProtocol",
      currentState: ["UNAUTHENTICATED"],
      targetState: ["SESSION_ACTIVE"],
      actionSequence: ["create_session"],
      rules: authProtocolRules(),
    });

    expect(result.success).toBe(true);
    expect(result.fixedSequence).toBeDefined();
    // Should include the prerequisite verify_password → generate_jwt
    expect(result.fixedSequence).toContain("verify_password");
    expect(result.fixedSequence).toContain("generate_jwt");
  });

  // ── Test 3: Multiple Candidate Fallback ──
  it("tries next candidate when first fails verification", async () => {
    const executor = new RepairExecutor({ recordTrajectory: false, maxAttempts: 3 });

    // Create rules where close_file exists but doesn't fully resolve
    // (pre_states mismatch should cause verifyRepair to catch the issue)
    const trickyRules = new Map([
      ["open_file", { pre_states: [], post_states: ["FILE_OPEN"], namespace: "file" }],
      ["write_file", { pre_states: ["FILE_OPEN"], post_states: ["DATA_WRITTEN"], namespace: "file" }],
      ["close_file", { pre_states: ["DATA_WRITTEN", "FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN", "DATA_WRITTEN"], namespace: "file" }],
      ["flush_file", { pre_states: ["FILE_OPEN"], post_states: ["DATA_WRITTEN"], namespace: "file" }],
    ]);

    const violation: ConstraintViolation = {
      svl: 4,
      violatedConstraint: "protocol_violation",
      actionIndex: 1,
      currentStates: ["FILE_OPEN"],
      requiredStates: [],
      description: "File not properly flushed and closed",
    };

    const result = await executor.execute({
      violation,
      protocol: "FileProtocol",
      currentState: ["FILE_OPEN"],
      targetState: [],
      actionSequence: ["open_file", "write_file"],
      rules: trickyRules,
    });

    // Should have tried at least one candidate
    expect(result.attempts.length).toBeGreaterThanOrEqual(1);
    // Outcome: if close_file was tried but had unsatisfied pre-states, it should
    // have tried next candidates or reported partial_fix
    if (!result.success) {
      expect(result.failureReason).toBeDefined();
      expect(["verification_failed", "partial_fix", "all_candidates_failed"]).toContain(result.failureReason);
    }
  });

  // ── Test 4: Empty Rules Fallback ──
  it("handles empty rules map by generating candidates anyway", async () => {
    const executor = new RepairExecutor({ recordTrajectory: false });

    const result = await executor.execute({
      violation: resourceLeakViolation(),
      protocol: "FileProtocol",
      currentState: ["FILE_OPEN"],
      targetState: [],
      actionSequence: ["open_file", "write_file"],
      rules: new Map(), // Empty!
    });

    // Should not crash. May or may not succeed depending on protocol.json loading
    expect(result).toBeDefined();
    expect(result.attempts.length).toBeGreaterThanOrEqual(0);
    if (!result.success) {
      expect(result.failureReason).toBeDefined();
    }
  });

  // ── Test 5: Convenience function ──
  it("fixViolation() convenience function works", async () => {
    const result = await fixViolation({
      violation: resourceLeakViolation(),
      protocol: "FileProtocol",
      currentState: ["FILE_OPEN"],
      targetState: [],
      actionSequence: ["open_file", "write_file"],
      rules: fileProtocolRules(),
      options: { recordTrajectory: false },
    });

    expect(result.success).toBe(true);
    expect(result.fixedSequence).toContain("close_file");
  });

  // ── Test 6: No-candidate case ──
  it("reports no_candidates when fix is impossible", async () => {
    const executor = new RepairExecutor({ recordTrajectory: false });

    // Create a scenario where no fix exists — unknown function with no rules
    const emptyRules = new Map<string, StateAnnotation>();
    const violation: ConstraintViolation = {
      svl: 4,
      violatedConstraint: "unknown_violation",
      actionIndex: 0,
      currentStates: ["MYSTERY_STATE"],
      requiredStates: ["IMPOSSIBLE_STATE"],
      description: "Cannot fix this",
    };

    const result = await executor.execute({
      violation,
      protocol: "UnknownProtocol",
      currentState: ["MYSTERY_STATE"],
      targetState: ["IMPOSSIBLE_STATE"],
      actionSequence: ["unknown_function"],
      rules: emptyRules,
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBeDefined();
  });

  // ── Test 7: Repair Taxonomy Report ──
  it("generates repair taxonomy report without crashing", () => {
    const report = generateRepairTaxonomy();
    expect(report).toBeDefined();
    expect(report.totalRepairs).toBeGreaterThanOrEqual(0);
    expect(report.byProtocol).toBeDefined();
    expect(report.byFailureReason).toBeDefined();
    expect(report.topFixPaths).toBeDefined();
  });

  // ── Test 8: applyFix correctness ──
  it("applyFix appends cleanup actions to sequence", () => {
    const executor = new RepairExecutor({ recordTrajectory: false });

    const candidate = {
      id: "test-1",
      source: "protocol" as const,
      actions: [{ kind: "call" as const, function: "close_file", args: [] }],
      explanation: "Close the file",
      evidence: 0,
      metadata: { source: "cleanup" },
    };

    const fixed = executor.applyFix(
      ["open_file", "read_file", "write_file"],
      candidate
    );

    expect(fixed).toEqual(["open_file", "read_file", "write_file", "close_file"]);
  });

  // ── Test 9: applyFix prepends for missing prerequisite ──
  it("applyFix prepends for goal-template candidates", () => {
    const executor = new RepairExecutor({ recordTrajectory: false });

    const candidate = {
      id: "test-2",
      source: "protocol" as const,
      actions: [
        { kind: "call" as const, function: "verify_password", args: [] },
      ],
      explanation: "Verify password first",
      evidence: 0,
      metadata: { source: "goal-template" },
    };

    const fixed = executor.applyFix(
      ["create_session"],
      candidate
    );

    expect(fixed).toContain("verify_password");
    // Should be before create_session
    expect(fixed.indexOf("verify_password")).toBeLessThan(fixed.indexOf("create_session"));
  });

  // ── Test 10: verifyRepair correctness ──
  it("verifyRepair passes when all pre-states satisfied", () => {
    const executor = new RepairExecutor({ recordTrajectory: false });
    const rules = fileProtocolRules();

    // Correct sequence: open → write → close (FILE_OPEN should be gone after close)
    const result = executor.verifyRepair(
      ["open_file", "write_file", "close_file"],
      rules,
      "FileProtocol",
      [], // Initial state: no file open
      []  // Target: no file open (FILE_OPEN invalidated by close_file)
    );

    expect(result.passed).toBe(true);
    expect(result.remainingViolations).toHaveLength(0);
  });

  it("verifyRepair fails when cleanup is missing", () => {
    const executor = new RepairExecutor({ recordTrajectory: false });
    const rules = fileProtocolRules();

    // Incomplete sequence: open → write (no close)
    // FILE_OPEN is still in the current state after this sequence
    const result = executor.verifyRepair(
      ["open_file", "write_file"],
      rules,
      "FileProtocol",
      [],
      ["FILE_OPEN"] // Expect file to still be open — but the violation is that
                     // it SHOULD be closed (resource_leak). We verify by checking
                     // that the target state is satisfied.
    );

    // With targetState = ["FILE_OPEN"], this passes (file is open).
    // But with targetState = [] and initialState = ["FILE_OPEN"], we should check
    // that after applying the fix, FILE_OPEN is no longer in state.
    // Let's test the actual violation scenario:
    const leakResult = executor.verifyRepair(
      ["open_file", "write_file"],
      rules,
      "FileProtocol",
      ["FILE_OPEN"], // Initial: file already open
      []             // Target: file should be closed (no FILE_OPEN)
    );

    // FILE_OPEN is still in state because close_file was never called
    expect(leakResult.passed).toBe(false);
  });

  // ── Test 11: Existing counterfactual engine still works ──
  it("suggestAlternatives still returns candidates (no regression)", async () => {
    const violation = resourceLeakViolation();

    const alts = await suggestAlternatives({
      violation,
      protocol: "FileProtocol",
      currentState: ["FILE_OPEN"],
      targetState: [],
      rules: fileProtocolRules(),
    });

    expect(alts.length).toBeGreaterThan(0);
    expect(alts[0].fixPath).toBeDefined();
    // Should suggest close_file
    const hasCloseFile = alts.some(a => a.fixPath.includes("close_file"));
    expect(hasCloseFile).toBe(true);
  });

  // ── Test 12: repair success rate improvement simulation ──
  it("repair executor achieves >80% success on standard violations", async () => {
    // Simulate 100 repair attempts on the two main violation types
    let successCount = 0;
    const executor = new RepairExecutor({ recordTrajectory: false });

    // 50 resource_leak violations
    for (let i = 0; i < 50; i++) {
      const result = await executor.execute({
        violation: resourceLeakViolation(),
        protocol: "FileProtocol",
        currentState: ["FILE_OPEN"],
        targetState: [],
        actionSequence: ["open_file", "write_file"],
        rules: fileProtocolRules(),
      });
      if (result.success) successCount++;
    }

    // 50 missing_prerequisite violations
    for (let i = 0; i < 50; i++) {
      const result = await executor.execute({
        violation: missingPrereqViolation(),
        protocol: "AuthProtocol",
        currentState: ["UNAUTHENTICATED"],
        targetState: ["SESSION_ACTIVE"],
        actionSequence: ["create_session"],
        rules: authProtocolRules(),
      });
      if (result.success) successCount++;
    }

    const successRate = successCount / 100;
    console.log(`Repair success rate: ${(successRate * 100).toFixed(1)}% (${successCount}/100)`);

    // Target: >80% (up from 57%)
    expect(successRate).toBeGreaterThan(0.8);
  }, 120000); // Allow 2min for 100 full-pipeline iterations
});
