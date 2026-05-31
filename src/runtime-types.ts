// Runtime Ontology — Progmune 执行语义的 formal type system
// 所有 runtime primitive 的单一定义源

import * as crypto from "crypto";

// ── 从权威来源重新导出 ──

export type { StateAnnotation, FunctionProtocol, SSGRejection, SSGStepResult, SSGTraceNode, ValidationContext, LedgerConsistencyViolation, LedgerQueryResult, LedgerDiff } from "./ssg-validator";
export { StateMachineValidator, parseProtocolsFromJSON } from "./ssg-validator";
// Phase 3: Semantic Ledger pure functions (re-exported from ssg-validator)
export { rebuildState, applyTransitionDelta, validateTransition, checkLedgerConsistency, findFixPathStatic, hashRules, hashLedger, diffLedgers, explainRejection, rejectionToJSON, findProducer, findConsumer, findViolations, findTransition, listAllStates } from "./ssg-validator";
// Phase 4: Invariant assertion layer
export { InvariantViolationError, assertLedgerConsistency, assertDeltaConsistency, assertRuleHashMatch, assertTransitionOrder, assertLedgerInvariants } from "./runtime-invariants";
export type { InvariantViolationDetail } from "./ssg-validator";
// Phase 4: Fingerprint Registry
export { registerFingerprint, getFingerprint, getFingerprintRegistry, verifyFingerprint, verifyAllFingerprints, registerAllMissingFingerprints } from "./ledger-registry";
export type { LedgerFingerprint, FingerprintVerifyResult, RegistrySummary } from "./ledger-registry";
// Phase 4: Branch Ledger
export { createRootBranch, createBranch, forkBranch, mergeBranches, flattenBranch, getBranchPath, replayBranch, buildBranchMap, findRootBranch, wrapAsBranch, unwrapBranchTree, describeBranchTree } from "./branch-ledger";
export type { Branch, BranchReason, BranchReplayResult } from "./branch-ledger";
// Phase 4: Repair Proposal Engine
export { suggestRepairs, suggestProtocolRepair, suggestInvariantRepair, applyProposalAsBranch, validateProposal, generateRepairSummary, getMinimalFixSet } from "./repair-proposal";
export type { RepairProposal, RepairStrategy, RepairSummary } from "./repair-proposal";
// Phase 4: Deterministic Replay
export { replaySession, replayLedger, replayWithDetail } from "./deterministic-replay";
export type { ReplayResult, ReplayTransition } from "./deterministic-replay";
export type { SVL } from "./failure-corpus";

// ── Action DSL ──

export type Action =
  | { kind: "call"; function: string; args: Arg[]; assignTo?: string }
  | { kind: "assign"; target: string; value: string | Action }
  | { kind: "return"; value: string | Action }
  | { kind: "if"; condition: string; thenActions: Action[]; elseActions?: Action[] }
  | { kind: "for"; variable: string; iterable: string; bodyActions: Action[] };

export type Arg = { name: string; type: string; value: string | Action };

// ── Constraint Violation ──

export interface ConstraintViolation {
  svl: 1 | 2 | 3 | 4;
  violatedConstraint: string;
  actionIndex: number;
  currentStates?: string[];
  requiredStates?: string[];
  missingStates?: string[];
  conflictingStates?: string[];
  fixPath?: string[];
  namespace?: string;
  description: string;
}

// ── State Transition ──

export interface StateTransition {
  actionIndex: number;
  function: string;
  namespace: string;
  acquired: string[];
  invalidated: string[];
  statesBefore: Record<string, string[]>;  // per-namespace snapshot before
  statesAfter: Record<string, string[]>;   // per-namespace snapshot after
  valid: boolean;
  /** SHA256 hash of the rule set used when this transition was created (P1: Constraint Snapshot) */
  ruleHash?: string;
}

// ── Attempt ──

export interface AntibodyHit {
  level: string;           // ACL-1 | ACL-2 | ACL-3 | ACL-4
  signature: string;
  fixPath: string[];
  similarityScore: number;
  action: "fast_path" | "injected_hint";  // ACL-4 = fast_path, ACL-3 = injected_hint
  llmCallsSaved: number;
  estimatedTokensSaved: number;
}

export interface Attempt {
  id: string;
  sessionId: string;
  attemptNumber: number;           // 1-based
  parentAttemptId?: string;
  inputIntent: string;
  plannerSeed: string;             // hash of prompt + model + timestamp
  constraintSnapshotId: string;    // link to IR snapshot
  generatedActions: Action[];
  transitions: StateTransition[];  // per-action SSG state deltas
  violations: ConstraintViolation[];
  outcome: "success" | "constraint_violation" | "planner_failure";
  timestamp: number;
  llmCallCount: number;
  durationMs: number;
  antibodyHit?: AntibodyHit;
  /** SHA256 hash of the SSG rule set in effect during this attempt (P1-A: Constraint Snapshot) */
  ruleHash?: string;
}

// ── Execution Session ──

export interface ExecutionSession {
  sessionId: string;
  intent: string;
  attempts: Attempt[];
  successfulAttempt?: Attempt;
  resolved: boolean;
  snapshotId?: string;
  startedAt: number;
  endedAt?: number;
  /** SHA256 hash of the SSG rule set in effect during this session (P1-A: Constraint Snapshot) */
  ruleHash?: string;
  /** Phase 4: Branch tree — replaces/extends flat attempts for multi-path execution */
  branchTree?: import("./branch-ledger").Branch[];
  rootBranchId?: string;
}

// ── ID生成工具 ──

export function generateAttemptId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function generatePlannerSeed(prompt: string, model: string): string {
  return crypto.createHash("md5").update(`${prompt}|${model}|${Date.now()}`).digest("hex").slice(0, 8);
}
