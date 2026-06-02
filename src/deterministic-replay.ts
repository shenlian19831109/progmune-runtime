/**
 * Phase 4: Deterministic Replay (P1)
 *
 * Verifies that replaying a session's ledger against current rules
 * produces the same result as the stored execution certificate.
 *
 * Answers: "Would this execution produce the same result today?"
 * Not just "read the log" — actively re-validates every transition.
 */

import * as fs from "fs";
import * as path from "path";
import type { StateTransition } from "./runtime-types";
import type { LedgerFingerprint } from "./ledger-registry";
import { getFingerprint } from "./ledger-registry";
import { getNsInit } from "./protocol-registry";
import {
  rebuildState,
  validateTransition,
  checkLedgerConsistency,
  hashLedger,
  hashRules,
} from "./ssg-validator";
import { flattenBranch, buildBranchMap, findRootBranch, wrapAsBranch } from "./branch-ledger";
import type { Branch } from "./branch-ledger";

// ── Types ──

export interface ReplayResult {
  success: boolean;
  sessionId: string;
  finalState: Record<string, string[]>;
  divergencePoint?: number;          // first transition index where replay diverged
  divergenceDetail?: string;         // human-readable divergence description
  replayedHash: string;              // hash of the replayed ledger
  storedHash: string;                // hash from the stored fingerprint
  ruleHashMatch: boolean;           // current rules match stored ruleHash
  ledgerHashMatch: boolean;         // replayed transitions match stored ledgerHash
  totalTransitions: number;
  validTransitions: number;
  invalidTransitions: number;       // transitions that fail current rules
}

export interface ReplayTransition {
  index: number;
  function: string;
  namespace: string;
  originalValid: boolean;           // was it valid when recorded?
  replayValid: boolean;             // is it valid on replay?
  statesBeforeMatch: boolean;       // does replayed statesBefore match recorded?
  statesAfterMatch: boolean;        // does replayed statesAfter match recorded?
  detail?: string;                  // mismatch detail
}

// ── Core Replay ──

/** Replay a session from disk, comparing against its stored fingerprint. */
/** Deterministically replay a session ledger and verify against stored fingerprint. */
/** @requires SESSION_DATA @produces REPLAY_RESULT */
export function replaySession(
  sessionId: string,
  currentRules?: Map<string, import("./ssg-validator").StateAnnotation>,
  namespaceInitialStates: Map<string, string> = getNsInit()
): ReplayResult {
  // Load session
  const sessionsDir = path.resolve(
    process.env.PROGMUNE_PROJECT_DIR || process.cwd(),
    ".progmune_corpus/sessions"
  );
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
  let transitions: StateTransition[] = [];
  let sessionRuleHash = session.ruleHash || "";

  // Handle branch tree if present (Phase 4)
  if (session.branchTree && session.branchTree.length > 0) {
    const branches = session.branchTree as Branch[];
    const map = buildBranchMap(branches);
    const root = findRootBranch(branches);
    if (root) {
      transitions = flattenBranch(root, map);
    }
    // Use first attempt's ruleHash as session hash
    if (!sessionRuleHash && branches[0]?.transitions[0]?.ruleHash) {
      sessionRuleHash = branches[0].transitions[0].ruleHash;
    }
  } else {
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
  const fingerprint = getFingerprint(sessionId);
  const storedHash = fingerprint?.ledgerHash || "";

  // Compute current rule hash
  let currentRuleHash = "";
  if (currentRules && currentRules.size > 0) {
    currentRuleHash = hashRules(currentRules);
  }

  return replayLedger(
    sessionId,
    transitions,
    sessionRuleHash,
    storedHash,
    currentRuleHash,
    currentRules,
    namespaceInitialStates
  );
}

/** Core replay logic: replay transitions against (optional) current rules. */
/** Replay a ledger of transitions against current rules and verify consistency. */
/** @requires LEDGER_DATA @produces REPLAY_RESULT */
export function replayLedger(
  sessionId: string,
  transitions: StateTransition[],
  storedRuleHash: string,
  storedLedgerHash: string,
  currentRuleHash?: string,
  currentRules?: Map<string, import("./ssg-validator").StateAnnotation>,
  namespaceInitialStates: Map<string, string> = getNsInit()
): ReplayResult {
  const replayedHash = transitions.length > 0 ? hashLedger(transitions) : "";
  const ruleHashMatch = !currentRuleHash || !storedRuleHash
    ? true  // can't compare if either is missing
    : currentRuleHash === storedRuleHash;

  const ledgerHashMatch = !storedLedgerHash
    ? true  // no fingerprint to compare against
    : replayedHash === storedLedgerHash;

  // Replay each transition if we have current rules
  let validTransitions = 0;
  let invalidTransitions = 0;
  let divergencePoint: number | undefined;
  let divergenceDetail: string | undefined;

  if (currentRules && currentRules.size > 0) {
    const ctx: import("./ssg-validator").ValidationContext = {
      ledger: [],
      currentState: rebuildState([], namespaceInitialStates),
    };

    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];
      if (!t.valid) {
        invalidTransitions++;
        continue;
      }

      try {
        // Re-validate against current rules
        const { valid, transition } = validateTransition(
          ctx, t.function, i, currentRules, namespaceInitialStates,
          currentRuleHash || ""
        );

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
        } else {
          invalidTransitions++;
          ctx.ledger.push({ ...t, valid: false });
        }
      } catch {
        invalidTransitions++;
        if (divergencePoint === undefined) {
          divergencePoint = i;
          divergenceDetail = `Transition[${i}] "${t.function}" threw an error during replay. Rule may have changed.`;
        }
      }
    }
  } else {
    // No current rules: just verify structural consistency
    const consistency = checkLedgerConsistency(transitions, namespaceInitialStates);
    if (!consistency.consistent) {
      divergencePoint = consistency.violations[0]?.index;
      divergenceDetail = `Structural inconsistency: ${consistency.violations.length} violation(s). First: [${consistency.violations[0]?.invariant}] at index ${consistency.violations[0]?.index}`;
    }
    validTransitions = transitions.filter(t => t.valid).length;
    invalidTransitions = transitions.filter(t => !t.valid).length;
  }

  // Compute final state
  const finalState = transitions.length > 0
    ? rebuildState(transitions.filter(t => t.valid), namespaceInitialStates)
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
/** Replay transitions with per-step detail for debugging. */
/** @requires TRANSITIONS @produces DETAIL_RESULT */
export function replayWithDetail(
  transitions: StateTransition[],
  currentRules?: Map<string, import("./ssg-validator").StateAnnotation>,
  namespaceInitialStates: Map<string, string> = getNsInit()
): ReplayTransition[] {
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

  const ctx: import("./ssg-validator").ValidationContext = {
    ledger: [],
    currentState: rebuildState([], namespaceInitialStates),
  };

  const currentRuleHash = hashRules(currentRules);
  const results: ReplayTransition[] = [];

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const result: ReplayTransition = {
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
      const { valid, transition } = validateTransition(
        ctx, t.function, i, currentRules, namespaceInitialStates, currentRuleHash
      );

      result.replayValid = valid;
      result.statesBeforeMatch = deepEqualSnapshots(ctx.currentState, t.statesBefore);
      result.statesAfterMatch = valid
        ? deepEqualSnapshots(transition.statesAfter, t.statesAfter)
        : false;

      if (!result.statesBeforeMatch) {
        result.detail = `statesBefore mismatch`;
      } else if (!result.statesAfterMatch) {
        result.detail = `statesAfter mismatch`;
      } else if (!valid) {
        result.detail = `No longer valid under current rules`;
      }

      ctx.ledger.push(valid ? transition : { ...t, valid: false });
      ctx.currentState = valid ? transition.statesAfter : ctx.currentState;
    } catch (e: any) {
      result.replayValid = false;
      result.detail = `Error: ${e.message?.slice(0, 80)}`;
    }

    results.push(result);
  }

  return results;
}

// ── Helpers ──

function deepEqualSnapshots(
  a: Record<string, string[]>,
  b: Record<string, string[]>
): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!b[k]) return false;
    if (a[k].join(",") !== b[k].join(",")) return false;
  }
  return true;
}
