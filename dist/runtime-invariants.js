"use strict";
/**
 * Phase 4: Runtime Invariant Assertion Layer
 *
 * Centralized invariant enforcement. All invariant checks → throw on failure.
 * Replaces scattered console.error() with structured InvariantViolationError.
 *
 * Controlled by PROGMUNE_STRICT env var (default: true in dev/ci).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvariantViolationError = void 0;
exports.assertLedgerConsistency = assertLedgerConsistency;
exports.assertDeltaConsistency = assertDeltaConsistency;
exports.assertRuleHashMatch = assertRuleHashMatch;
exports.assertTransitionOrder = assertTransitionOrder;
exports.assertLedgerInvariants = assertLedgerInvariants;
const ssg_validator_1 = require("./ssg-validator");
const protocol_registry_1 = require("./protocol-registry");
// Re-export for convenient import
var ssg_validator_2 = require("./ssg-validator");
Object.defineProperty(exports, "InvariantViolationError", { enumerable: true, get: function () { return ssg_validator_2.InvariantViolationError; } });
// ── Config ──
const STRICT = process.env.PROGMUNE_STRICT !== "false";
const isStrict = () => STRICT;
// ── Assertions ──
/** Assert full ledger passes Invariant-0 + Invariant-1.
 *  Throws InvariantViolationError with the first violation's details. */
/** Assert a ledger passes all invariant checks. */
function assertLedgerConsistency(ledger, namespaceInitialStates = (0, protocol_registry_1.getNsInit)()) {
    if (ledger.length === 0)
        return;
    const result = (0, ssg_validator_1.checkLedgerConsistency)(ledger, namespaceInitialStates);
    if (result.consistent)
        return;
    if (!isStrict()) {
        console.error(`[Invariant] Ledger consistency: ${result.violations.length} violation(s) detected (PROGMUNE_STRICT=false — not throwing)`);
        for (const v of result.violations) {
            console.error(`  [${v.invariant}] index=${v.index}: ${v.detail || ""}`);
        }
        return;
    }
    const first = result.violations[0];
    const msg = result.violations.length === 1
        ? `Ledger invariant violation: [${first.invariant}] at index ${first.index}`
        : `Ledger invariant violation: ${result.violations.length} violations, first: [${first.invariant}] at index ${first.index}`;
    throw new ssg_validator_1.InvariantViolationError(msg, {
        invariant: first.invariant,
        index: first.index,
        expected: first.expected,
        actual: first.actual,
    });
}
/** Assert a single transition's delta consistency.
 *  Checks that applying acquire/invalidate to statesBefore produces statesAfter. */
/** Assert a single transition has consistent state deltas. */
function assertDeltaConsistency(transition) {
    if (!transition.valid)
        return;
    // Replay: apply the delta to statesBefore, compare with statesAfter
    const fromSnapshot = (snap) => {
        const map = new Map();
        for (const [ns, states] of Object.entries(snap)) {
            map.set(ns, new Set(states));
        }
        return map;
    };
    const toSnapshot = (stateMap) => {
        const snap = {};
        for (const [ns, states] of stateMap) {
            snap[ns] = [...states].sort();
        }
        return snap;
    };
    const deltaMap = fromSnapshot(transition.statesBefore);
    for (const s of transition.acquired) {
        const ns = transition.namespace;
        if (!deltaMap.has(ns))
            deltaMap.set(ns, new Set());
        deltaMap.get(ns).add(s);
    }
    for (const s of transition.invalidated) {
        const ns = transition.namespace;
        deltaMap.get(ns)?.delete(s);
    }
    const computedAfter = toSnapshot(deltaMap);
    const deepEqual = (a, b) => {
        const keysA = Object.keys(a).sort();
        const keysB = Object.keys(b).sort();
        if (keysA.length !== keysB.length)
            return false;
        for (const k of keysA) {
            if (!b[k])
                return false;
            if (a[k].join(",") !== b[k].join(","))
                return false;
        }
        return true;
    };
    if (!deepEqual(computedAfter, transition.statesAfter)) {
        const msg = `[Invariant-1] Delta inconsistency in transition[${transition.actionIndex}] "${transition.function}": statesAfter mismatch`;
        if (!isStrict()) {
            console.error(msg);
            return;
        }
        throw new ssg_validator_1.InvariantViolationError(msg, {
            invariant: "delta-consistency",
            namespace: transition.namespace,
            function: transition.function,
            index: transition.actionIndex,
            expected: computedAfter,
            actual: transition.statesAfter,
        });
    }
}
/** Assert rule hashes match — detects when validation rules changed under a ledger. */
/** Assert rule hashes match to detect rule changes. */
function assertRuleHashMatch(expected, actual, context) {
    if (expected === actual)
        return;
    const msg = context
        ? `Rule hash mismatch in ${context}: expected ${expected.slice(0, 16)}, got ${actual.slice(0, 16)}`
        : `Rule hash mismatch: expected ${expected.slice(0, 16)}, got ${actual.slice(0, 16)}`;
    if (!isStrict()) {
        console.error(msg);
        return;
    }
    throw new ssg_validator_1.InvariantViolationError(msg, {
        invariant: "rule-hash-mismatch",
    });
}
/** Assert transition indices are strictly monotonic (no duplicates, non-decreasing). */
/** Assert transition indices are strictly monotonic. */
function assertTransitionOrder(ledger) {
    if (ledger.length <= 1)
        return;
    for (let i = 1; i < ledger.length; i++) {
        if (ledger[i].actionIndex <= ledger[i - 1].actionIndex) {
            const msg = `[Transition Order] Non-monotonic indices at position ${i}: index[${i - 1}]=${ledger[i - 1].actionIndex}, index[${i}]=${ledger[i].actionIndex}`;
            if (!isStrict()) {
                console.error(msg);
                return;
            }
            throw new ssg_validator_1.InvariantViolationError(msg, {
                invariant: "transition-order",
                index: i,
            });
        }
    }
}
/** Convenience: run all invariant checks on a ledger. Does not throw if all pass. */
/** Run all invariant checks on a ledger. */
function assertLedgerInvariants(ledger, namespaceInitialStates = (0, protocol_registry_1.getNsInit)(), expectedRuleHash) {
    assertTransitionOrder(ledger);
    assertLedgerConsistency(ledger, namespaceInitialStates);
    for (const t of ledger) {
        if (t.valid)
            assertDeltaConsistency(t);
    }
    if (expectedRuleHash) {
        const actualRuleHash = (0, ssg_validator_1.hashRules)(new Map()); // ledger's first transition carries ruleHash
        const ledgerRuleHash = ledger[0]?.ruleHash;
        if (ledgerRuleHash) {
            assertRuleHashMatch(expectedRuleHash, ledgerRuleHash, "ledger invariants check");
        }
    }
}
