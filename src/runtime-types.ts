// Runtime Ontology — Progmune 执行语义的 formal type system
// 所有 runtime primitive 的单一定义源

import * as crypto from "crypto";

// ── 从权威来源重新导出 ──

export type { StateAnnotation, FunctionProtocol, SSGRejection, SSGStepResult, SSGTraceNode } from "./ssg-validator";
export { StateMachineValidator, parseProtocolsFromJSON } from "./ssg-validator";
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
}

// ── Attempt ──

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
