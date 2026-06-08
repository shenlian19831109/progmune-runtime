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

// ── P0: Trajectory Schema v1 ──
// Records ALL behavior — success, violation, repair, optimal — not just failures.
// This is the "Code World Model Dataset": the training fuel for future planning,
// reward learning, and latent protocol models.
//
// Design principle: every (state, action, next_state, verdict) tuple is a data point.
// Just as MuZero trains on (s,a,s',r), Progmune trains on trajectory records.

/** Multi-dimensional reward vector — protocol-specific weights. */
export interface RewardVector {
  safety: number;          // 0-1
  latency: number;         // 0-1 (inverted: 1=fast)
  maintainability: number; // 0-1
  security: number;        // 0-1
  auditability: number;    // 0-1
  /** Domain-specific dimensions (e.g., "throughput", "compliance"). */
  custom: Record<string, number>;
}

/** Outcome type for trajectory records. */
export type TrajectoryResult = "success" | "violation" | "repair" | "optimal";

/** A single trajectory record — the atomic unit of the Code World Model Dataset. */
export interface TrajectoryRecord {
  /** Unique ID, e.g. "T-1780928181015-a1b2". */
  id: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Protocol namespace, e.g. "FileProtocol". */
  protocol: string;
  /** Initial protocol state(s) before the trajectory began. */
  initialState: string[];
  /** Final protocol state(s) after the trajectory completed. */
  finalState: string[];
  /** The action/function sequence executed. */
  trajectory: string[];
  /** Outcome classification. */
  result: TrajectoryResult;
  /** Estimated reward vector (required for "optimal" records). */
  reward?: RewardVector;
  /** Violation details (present only for "violation" and "repair" results). */
  violation?: TrajectoryViolation;
  /** For "repair" results: the failure ID this repair was derived from. */
  repairFrom?: string;
  /** Structural context at the time of recording. */
  context: ContextFeatures;
  /** Historical success rate of the action pattern (0-1, updated incrementally). */
  successRate: number;
  /** Source of the trajectory. */
  metadata: {
    source: "human" | "llm" | "planner" | "antibody";
    intent?: string;
    sessionId?: string;
  };
  /** P1: Goal Skeleton — the goal that produced this trajectory (optional). */
  goal?: GoalRecord;
}

// ── P1: Goal Skeleton ──
// Lightweight goal→trajectory pairing. Collected from natural language goals
// via async LLM annotation. No graph structure — just raw (goal, outcome) pairs.
// When enough data accumulates, Goal Graphs will be mined from this corpus.

/** A recorded goal and its structured extraction. */
export interface GoalRecord {
  /** Original natural language goal text. */
  text: string;
  /** Extracted protocol namespace. */
  protocol: string;
  /** Extracted initial state. */
  initial_state: string;
  /** Extracted target state. */
  target_state: string;
  /** Extracted constraint labels. */
  constraints: string[];
  /** Extraction method. */
  method: "llm_extracted" | "manual" | "inferred" | "failed";
  /** LLM confidence (0-1) if llm_extracted. */
  confidence: number;
}

/** Violation info embedded in trajectory records. */
export interface TrajectoryViolation {
  type: ViolationType;
  failingStepIndex: number;
  expectedStates: string[];
  actualStates: string[];
  fixPath?: string[];
  description: string;
}

// ── Legacy Schema v2 types (kept for backward compat, use TrajectoryRecord for new code) ──

/** @deprecated Use ViolationType from above. */
export type LegacyViolationType = ViolationType;

/** @deprecated Use TrajectoryRecord for new code. */
export interface FailureRecordV2 {
  failureId: string;
  timestamp: string;
  protocol: string;
  codeSnippet: string;
  expectedStateSequence: string[];
  actualStateSequence: string[];
  violationType: ViolationType;
  failingStepIndex: number;
  contextFeatures: ContextFeatures;
  repairAttempts: RepairAttempt[];
  successRate: number;
  actionSequence: string[];
  ssgStateAtViolation?: string[];
  ssgFixPath?: string[];
  parentSessionId?: string;
  intent?: string;
}

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
