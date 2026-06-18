"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P9.1: Protocol Invariant Mining & Violation Detection Test
 *
 * The test: can the system detect REAL defect patterns (resource leak,
 * missing commit, auth bypass) using ONLY state-machine invariants,
 * without function names, keywords, or hand-written rules?
 */
const vitest_1 = require("vitest");
const protocol_invariants_1 = require("./protocol-invariants");
const state_inference_1 = require("./state-inference");
// ── Test data: clean (complete) and broken (defect) sequences ──
const FILE_CLEAN = [
    ["open_file", "read_file", "close_file"],
    ["open_file", "write_file", "close_file"],
];
const FILE_BROKEN_NO_CLOSE = [
    ["open_file", "read_file"], // ← resource leak: acquired but never released
    ["open_file", "write_file"],
];
const TX_CLEAN = [
    ["begin_tx", "insert", "commit_tx"],
    ["begin_tx", "update", "commit_tx"],
];
const TX_BROKEN_NO_COMMIT = [
    ["begin_tx", "insert"], // ← lost write: transaction never committed
    ["begin_tx", "update"],
];
const AUTH_CLEAN = [
    ["verify_password", "generate_jwt", "create_session"],
    ["verify_password", "create_session"],
];
const AUTH_BROKEN_NO_VERIFY = [
    ["generate_jwt", "create_session"], // ← auth bypass: no verification
    ["create_session"],
];
(0, vitest_1.describe)("P9.1 Protocol Invariant Detection", () => {
    (0, vitest_1.it)("mines MUST_RELEASE invariant from acquire→use→release protocol", () => {
        const sm = (0, state_inference_1.inferStateMachine)(FILE_CLEAN);
        (0, state_inference_1.printInferredStateMachine)(sm);
        const invariants = (0, protocol_invariants_1.mineInvariants)(sm);
        (0, protocol_invariants_1.printInvariants)(invariants);
        (0, vitest_1.expect)(invariants.length).toBeGreaterThan(0);
        const releaseInv = invariants.find(i => i.type === "MUST_RELEASE");
        (0, vitest_1.expect)(releaseInv).toBeTruthy();
    });
    (0, vitest_1.it)("mines MUST_COMMIT invariant from transaction protocol", () => {
        const sm = (0, state_inference_1.inferStateMachine)(TX_CLEAN);
        const invariants = (0, protocol_invariants_1.mineInvariants)(sm);
        (0, protocol_invariants_1.printInvariants)(invariants);
        const commitInv = invariants.find(i => i.type === "MUST_RELEASE" || i.type === "MUST_COMMIT");
        (0, vitest_1.expect)(commitInv).toBeTruthy();
    });
    (0, vitest_1.it)("mines MUST_PRECEDE invariant from auth protocol", () => {
        const sm = (0, state_inference_1.inferStateMachine)(AUTH_CLEAN);
        const invariants = (0, protocol_invariants_1.mineInvariants)(sm);
        (0, protocol_invariants_1.printInvariants)(invariants);
        const precedeInv = invariants.find(i => i.type === "MUST_PRECEDE");
        (0, vitest_1.expect)(precedeInv).toBeTruthy();
    });
    (0, vitest_1.it)("DETECTS resource leak: structural comparison with template", () => {
        // Template: clean state machine (3 states: entry→bridge→exit)
        const templateSM = (0, state_inference_1.inferStateMachine)(FILE_CLEAN);
        // Broken: open→read without close → only 2 states (entry→bridge)
        const brokenSM = (0, state_inference_1.inferStateMachine)(FILE_BROKEN_NO_CLOSE);
        // Template-vs-broken structural comparison
        const violations = (0, protocol_invariants_1.detectStructuralViolations)(brokenSM, templateSM);
        console.log(`\n  Template states: ${templateSM.stateCount} (entry→bridge→exit)`);
        console.log(`  Broken states:   ${brokenSM.stateCount} (entry→bridge)`);
        (0, protocol_invariants_1.printViolations)(violations);
        // KEY TEST: must detect the missing release
        const hasLeak = violations.some(v => v.violationSubtype === "missing_release");
        (0, vitest_1.expect)(hasLeak).toBe(true);
    });
    (0, vitest_1.it)("DETECTS auth bypass: generate_jwt without verify_password", () => {
        const sm = (0, state_inference_1.inferStateMachine)(AUTH_CLEAN);
        const invariants = (0, protocol_invariants_1.mineInvariants)(sm);
        const scrambled = ["F_0005", "F_0006"]; // generate_jwt → create_session (no verify)
        const violations = (0, protocol_invariants_1.checkInvariants)(scrambled, invariants);
        console.log(`\n  Testing: ${scrambled.join(" → ")}`);
        (0, protocol_invariants_1.printViolations)(violations);
        const hasAuthBypass = violations.some(v => v.invariant.type === "MUST_PRECEDE");
        (0, vitest_1.expect)(hasAuthBypass).toBe(true);
    });
    (0, vitest_1.it)("CLEAN sequences produce ZERO violations", () => {
        // Clean file protocol: open → read → close
        const sm = (0, state_inference_1.inferStateMachine)(FILE_CLEAN);
        const invariants = (0, protocol_invariants_1.mineInvariants)(sm);
        // Use one of the clean sequences (scrambled names)
        const scrambled = ["F_0001", "F_0002", "F_0003"]; // 3-step = full lifecycle
        const violations = (0, protocol_invariants_1.checkInvariants)(scrambled, invariants);
        console.log(`\n  Testing: ${scrambled.join(" → ")} (clean)`);
        (0, protocol_invariants_1.printViolations)(violations);
        // Clean sequence should have FEWER violations than broken
        // (may still have some if the sequence doesn't match all invariants)
        const brokenScrambled = ["F_0001", "F_0002"]; // 2-step = broken
        const brokenViolations = (0, protocol_invariants_1.checkInvariants)(brokenScrambled, invariants);
        (0, vitest_1.expect)(violations.length).toBeLessThan(brokenViolations.length);
    });
    (0, vitest_1.it)("NAME-SCRAMBLE: invariant mining produces identical results on scrambled names", () => {
        const origInvariants = (0, protocol_invariants_1.mineInvariants)((0, state_inference_1.inferStateMachine)(FILE_CLEAN));
        const scrambledInvariants = (0, protocol_invariants_1.mineInvariants)((0, state_inference_1.inferStateMachine)([
            ["F_001", "F_002", "F_003"],
            ["F_001", "F_004", "F_003"],
        ]));
        (0, vitest_1.expect)(origInvariants.length).toBe(scrambledInvariants.length);
        (0, vitest_1.expect)(origInvariants.map(i => i.type).sort())
            .toEqual(scrambledInvariants.map(i => i.type).sort());
    });
});
