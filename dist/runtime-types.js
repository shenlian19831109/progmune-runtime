// Runtime Ontology — Progmune 执行语义的 formal type system
// 所有 runtime primitive 的单一定义源
import * as crypto from "crypto";
export { StateMachineValidator, parseProtocolsFromJSON } from "./ssg-validator";
// Phase 3: Semantic Ledger pure functions (re-exported from ssg-validator)
export { rebuildState, applyTransitionDelta, validateTransition, checkLedgerConsistency, findFixPathStatic, hashRules, hashLedger, diffLedgers, explainRejection, rejectionToJSON, findProducer, findConsumer, findViolations, findTransition, listAllStates } from "./ssg-validator";
// Phase 4: Invariant assertion layer
export { InvariantViolationError, assertLedgerConsistency, assertDeltaConsistency, assertRuleHashMatch, assertTransitionOrder, assertLedgerInvariants } from "./runtime-invariants";
// Phase 4: Fingerprint Registry
export { registerFingerprint, getFingerprint, getFingerprintRegistry, verifyFingerprint, verifyAllFingerprints, registerAllMissingFingerprints } from "./ledger-registry";
// Phase 4: Branch Ledger
export { createRootBranch, createBranch, forkBranch, mergeBranches, flattenBranch, getBranchPath, replayBranch, buildBranchMap, findRootBranch, wrapAsBranch, unwrapBranchTree, describeBranchTree } from "./branch-ledger";
// Phase 4: Repair Proposal Engine
export { suggestRepairs, suggestProtocolRepair, suggestInvariantRepair, applyProposalAsBranch, validateProposal, generateRepairSummary, getMinimalFixSet } from "./repair-proposal";
// Phase 4: Deterministic Replay
export { replaySession, replayLedger, replayWithDetail } from "./deterministic-replay";
/** Create an Ok result. */
export function ok(value) {
    return { ok: true, value };
}
/** Create an Err result. */
export function err(error) {
    return { ok: false, error };
}
// ── ID生成工具 ──
export function generateAttemptId() {
    return `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function generatePlannerSeed(prompt, model) {
    return crypto.createHash("md5").update(`${prompt}|${model}|${Date.now()}`).digest("hex").slice(0, 8);
}
