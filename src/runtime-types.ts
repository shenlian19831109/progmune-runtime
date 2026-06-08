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
export { SVL as LegacySVL } from "./failure-corpus";

// ── P2: Goal constraint (shared between intent parser and counterfactual engine) ──
export interface GoalConstraint {
  type: "retry" | "safety" | "latency" | "maintainability" | "security";
  value: number;     // 0-1 weight
  description: string;
}

// ── P0: Failure Schema v2 ──
// Structured failure records for building a Code Behavior Dynamics Dataset.
// Design goal: each validation failure auto-collects enough context for
// counterfactual search and pattern mining — not just an error log.

/** Root cause categories mapped from legacy F01-F10 codes. */
export type ViolationType =
  | "unexported_function"      // F01 — function in IR but not exported
  | "wrong_import_path"        // F02 — import path doesn't resolve
  | "type_name_error"          // F03 — type import has wrong name/module
  | "wrong_arg_count"          // F04 — parameter count mismatch
  | "wrong_arg_type"           // F05 — parameter type mismatch
  | "undefined_variable"       // F06 — variable used but never declared
  | "planning_failure"         // F07 — LLM output unparseable
  | "return_type_error"        // F08 — wrong return type annotation
  | "protocol_violation"       // F09 — SSG state machine blocked
  | "resource_leak"            // protocol implied but state not closed
  | "missing_prerequisite"     // required function not called before action
  | "illegal_state_transition" // SSG transition not in allowed set
  | "timeout"                  // operation exceeded time boundary
  | "other";                   // F10 — uncategorized

/** Structural context around the failure site. */
export interface ContextFeatures {
  /** How deeply nested is the failing call (0 = top-level). */
  nestingDepth: number;
  /** Is the failing call inside a try/catch block? */
  exceptionHandled: boolean;
  /** Is the failing call inside a loop? */
  insideLoop: boolean;
  /** Number of conditional branches in scope. */
  branchCount: number;
  /** Is there an async/await in the call chain? */
  asyncContext: boolean;
}

/** A single repair attempt and its outcome. */
export interface RepairAttempt {
  /** The suggested fix (code snippet or function name). */
  suggestedAction: string;
  /** Source of the suggestion: antibody | graph | llm | manual. */
  source: "antibody" | "graph" | "llm" | "manual";
  /** Did the user accept this suggestion? */
  accepted: boolean;
  /** Did applying the fix resolve the violation? */
  success: boolean;
  /** How many ms the repair took to apply. */
  latencyMs: number;
  /** Timestamp of the repair attempt. */
  timestamp: string;
}

/** Schema v2 failure record — the core unit of the Code Behavior Dynamics Dataset. */
export interface FailureRecordV2 {
  /** Unique failure ID, e.g. "F-1780379347057-0ubd". */
  failureId: string;
  /** ISO 8601 timestamp when the violation was detected. */
  timestamp: string;
  /** The protocol namespace that was violated, e.g. "FileProtocol". */
  protocol: string;
  /** The violating code snippet (extracted from AST, not full file). */
  codeSnippet: string;
  /** The sequence of protocol states that the code intended to follow. */
  expectedStateSequence: string[];
  /** The actual state trace observed by the SSG validator. */
  actualStateSequence: string[];
  /** Structured category of the violation. */
  violationType: ViolationType;
  /** Index into the action sequence where the failure was detected. */
  failingStepIndex: number;
  /** Structural context around the failure site. */
  contextFeatures: ContextFeatures;
  /** All repair attempts made for this failure (may be empty). */
  repairAttempts: RepairAttempt[];
  /** Historical success rate of the most-applied repair pattern for this failure type (0-1). */
  successRate: number;
  /** The action sequence that triggered the violation (sanitized). */
  actionSequence: string[];
  /** The SSG state snapshot at the point of violation. */
  ssgStateAtViolation?: string[];
  /** The SSG fix path: which functions to call to reach the target state. */
  ssgFixPath?: string[];
  /** Link to parent session for longitudinal tracking. */
  parentSessionId?: string;
  /** Intent that produced this failure. */
  intent?: string;
}

/** Legacy F-code → ViolationType mapping. */
export function mapLegacyFCode(fCode: string): ViolationType {
  const map: Record<string, ViolationType> = {
    F01: "unexported_function",
    F02: "wrong_import_path",
    F03: "type_name_error",
    F04: "wrong_arg_count",
    F05: "wrong_arg_type",
    F06: "undefined_variable",
    F07: "planning_failure",
    F08: "return_type_error",
    F09: "protocol_violation",
    F10: "other",
  };
  return map[fCode] || "other";
}

// ── Result type — replaces { success: boolean; error?: string } ──

/** Ok variant: operation succeeded. */
export type Ok<T> = { ok: true; value: T };

/** Err variant: operation failed with a typed error. */
export type Err<E> = { ok: false; error: E };

/** Discriminated result: either success with T or failure with E. */
export type Result<T, E = string> = Ok<T> | Err<E>;

/** Create an Ok result. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Create an Err result. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// ── Simple validation error (for gradual migration) ──

export interface ValidationError {
  message: string;
  code: string;
  index?: number;
  details?: string[];
}

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
  /** P2 V3: Counterfactual repair alternatives (top-3). */
  repairAlternatives?: {
    rank: number;
    description: string;
    fixPath: string[];
    source: string;
    score: number;
    historicalSuccessRate: number;
  }[];
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
