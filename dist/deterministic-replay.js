"use strict";
/**
 * Phase 4: Deterministic Replay (P1)
 *
 * Verifies that replaying a session's ledger against current rules
 * produces the same result as the stored execution certificate.
 *
 * Answers: "Would this execution produce the same result today?"
 * Not just "read the log" — actively re-validates every transition.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaySession = replaySession;
exports.replayLedger = replayLedger;
exports.replayWithDetail = replayWithDetail;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ledger_registry_1 = require("./ledger-registry");
const ssg_validator_1 = require("./ssg-validator");
const branch_ledger_1 = require("./branch-ledger");
// ── Core Replay ──
/** Replay a session from disk, comparing against its stored fingerprint. */
function replaySession(sessionId, currentRules, namespaceInitialStates = new Map([["_global", "INIT"]])) {
    // Load session
    const sessionsDir = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus/sessions");
    const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(sessionFile)) {
        return {
            success: false,
            sessionId,
            finalState: {},
            replayedHash: "",
            storedHash: "",
            ruleHashMatch: false,
            ledgerHashMatch: false,
            totalTransitions: 0,
            validTransitions: 0,
            invalidTransitions: 0,
            divergencePoint: 0,
            divergenceDetail: `Session file not found: ${sessionFile}`,
        };
    }
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    // Collect all transitions
    let transitions = [];
    let sessionRuleHash = session.ruleHash || "";
    // Handle branch tree if present (Phase 4)
    if (session.branchTree && session.branchTree.length > 0) {
        const branches = session.branchTree;
        const map = (0, branch_ledger_1.buildBranchMap)(branches);
        const root = (0, branch_ledger_1.findRootBranch)(branches);
        if (root) {
            transitions = (0, branch_ledger_1.flattenBranch)(root, map);
        }
        // Use first attempt's ruleHash as session hash
        if (!sessionRuleHash && branches[0]?.transitions[0]?.ruleHash) {
            sessionRuleHash = branches[0].transitions[0].ruleHash;
        }
    }
    else {
        // Legacy: collect from attempts
        for (const attempt of (session.attempts || [])) {
            if (attempt.transitions) {
                transitions = transitions.concat(attempt.transitions);
            }
            if (!sessionRuleHash && (attempt.ruleHash || session.ruleHash)) {
                sessionRuleHash = attempt.ruleHash || session.ruleHash;
            }
        }
    }
    // Load fingerprint
    const fingerprint = (0, ledger_registry_1.getFingerprint)(sessionId);
    const storedHash = fingerprint?.ledgerHash || "";
    // Compute current rule hash
    let currentRuleHash = "";
    if (currentRules && currentRules.size > 0) {
        currentRuleHash = (0, ssg_validator_1.hashRules)(currentRules);
    }
    return replayLedger(sessionId, transitions, sessionRuleHash, storedHash, currentRuleHash, currentRules, namespaceInitialStates);
}
/** Core replay logic: replay transitions against (optional) current rules. */
function replayLedger(sessionId, transitions, storedRuleHash, storedLedgerHash, currentRuleHash, currentRules, namespaceInitialStates = new Map([["_global", "INIT"]])) {
    const replayedHash = transitions.length > 0 ? (0, ssg_validator_1.hashLedger)(transitions) : "";
    const ruleHashMatch = !currentRuleHash || !storedRuleHash
        ? true // can't compare if either is missing
        : currentRuleHash === storedRuleHash;
    const ledgerHashMatch = !storedLedgerHash
        ? true // no fingerprint to compare against
        : replayedHash === storedLedgerHash;
    // Replay each transition if we have current rules
    let validTransitions = 0;
    let invalidTransitions = 0;
    let divergencePoint;
    let divergenceDetail;
    if (currentRules && currentRules.size > 0) {
        const ctx = {
            ledger: [],
            currentState: (0, ssg_validator_1.rebuildState)([], namespaceInitialStates),
        };
        for (let i = 0; i < transitions.length; i++) {
            const t = transitions[i];
            if (!t.valid) {
                invalidTransitions++;
                continue;
            }
            try {
                // Re-validate against current rules
                const { valid, transition } = (0, ssg_validator_1.validateTransition)(ctx, t.function, i, currentRules, namespaceInitialStates, currentRuleHash || "");
                if (!valid && divergencePoint === undefined) {
                    divergencePoint = i;
                    divergenceDetail = `Transition[${i}] "${t.function}" is no longer valid under current rules.`;
                }
                // Check statesBefore matches rebuilt state
                const rebuiltBefore = ctx.currentState;
                const beforeMatch = deepEqualSnapshots(rebuiltBefore, t.statesBefore);
                if (!beforeMatch && divergencePoint === undefined) {
                    divergencePoint = i;
                    divergenceDetail = `Transition[${i}] "${t.function}" statesBefore mismatch: rebuilt=${JSON.stringify(rebuiltBefore[t.namespace] || [])} recorded=${JSON.stringify(t.statesBefore[t.namespace] || [])}`;
                }
                if (valid) {
                    validTransitions++;
                    ctx.ledger.push(transition);
                    ctx.currentState = transition.statesAfter;
                }
                else {
                    invalidTransitions++;
                    ctx.ledger.push({ ...t, valid: false });
                }
            }
            catch {
                invalidTransitions++;
                if (divergencePoint === undefined) {
                    divergencePoint = i;
                    divergenceDetail = `Transition[${i}] "${t.function}" threw an error during replay. Rule may have changed.`;
                }
            }
        }
    }
    else {
        // No current rules: just verify structural consistency
        const consistency = (0, ssg_validator_1.checkLedgerConsistency)(transitions, namespaceInitialStates);
        if (!consistency.consistent) {
            divergencePoint = consistency.violations[0]?.index;
            divergenceDetail = `Structural inconsistency: ${consistency.violations.length} violation(s). First: [${consistency.violations[0]?.invariant}] at index ${consistency.violations[0]?.index}`;
        }
        validTransitions = transitions.filter(t => t.valid).length;
        invalidTransitions = transitions.filter(t => !t.valid).length;
    }
    // Compute final state
    const finalState = transitions.length > 0
        ? (0, ssg_validator_1.rebuildState)(transitions.filter(t => t.valid), namespaceInitialStates)
        : {};
    const success = ruleHashMatch && ledgerHashMatch && divergencePoint === undefined;
    return {
        success,
        sessionId,
        finalState,
        divergencePoint,
        divergenceDetail,
        replayedHash,
        storedHash: storedLedgerHash,
        ruleHashMatch,
        ledgerHashMatch,
        totalTransitions: transitions.length,
        validTransitions,
        invalidTransitions,
    };
}
/** Replay with per-transition detail — for debugging and UI. */
function replayWithDetail(transitions, currentRules, namespaceInitialStates = new Map([["_global", "INIT"]])) {
    if (!currentRules || currentRules.size === 0) {
        return transitions.map(t => ({
            index: t.actionIndex,
            function: t.function,
            namespace: t.namespace,
            originalValid: t.valid,
            replayValid: t.valid,
            statesBeforeMatch: true,
            statesAfterMatch: true,
        }));
    }
    const ctx = {
        ledger: [],
        currentState: (0, ssg_validator_1.rebuildState)([], namespaceInitialStates),
    };
    const currentRuleHash = (0, ssg_validator_1.hashRules)(currentRules);
    const results = [];
    for (let i = 0; i < transitions.length; i++) {
        const t = transitions[i];
        const result = {
            index: t.actionIndex,
            function: t.function,
            namespace: t.namespace,
            originalValid: t.valid,
            replayValid: false,
            statesBeforeMatch: false,
            statesAfterMatch: false,
        };
        if (!t.valid) {
            result.detail = "Originally invalid";
            results.push(result);
            continue;
        }
        try {
            const { valid, transition } = (0, ssg_validator_1.validateTransition)(ctx, t.function, i, currentRules, namespaceInitialStates, currentRuleHash);
            result.replayValid = valid;
            result.statesBeforeMatch = deepEqualSnapshots(ctx.currentState, t.statesBefore);
            result.statesAfterMatch = valid
                ? deepEqualSnapshots(transition.statesAfter, t.statesAfter)
                : false;
            if (!result.statesBeforeMatch) {
                result.detail = `statesBefore mismatch`;
            }
            else if (!result.statesAfterMatch) {
                result.detail = `statesAfter mismatch`;
            }
            else if (!valid) {
                result.detail = `No longer valid under current rules`;
            }
            ctx.ledger.push(valid ? transition : { ...t, valid: false });
            ctx.currentState = valid ? transition.statesAfter : ctx.currentState;
        }
        catch (e) {
            result.replayValid = false;
            result.detail = `Error: ${e.message?.slice(0, 80)}`;
        }
        results.push(result);
    }
    return results;
}
// ── Helpers ──
function deepEqualSnapshots(a, b) {
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
}
