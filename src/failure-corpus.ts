import * as fs from "fs";
import * as path from "path";
import { withLock } from "./file-lock";
import type { Attempt, ExecutionSession } from "./runtime-types";

export type SVL = "SVL-1" | "SVL-2" | "SVL-3" | "SVL-4";

/** AI 语义失败基因组 —— 单条失败记录 */
export interface FailureRecord {
  id: string;
  timestamp: string;
  intent: string;
  projectFunctions: string[];
  violatedSVL: SVL;
  constraintType: string;
  actionSequence: any[];
  errorDetail: string;

  // ── 基因组维度 ──

  /** 违规时的 SSG 状态快照 */
  ssgState?: string[];

  /** SSG 完整跟踪（从初始状态到违规点） */
  ssgTrace?: { function: string; statesBefore: Record<string, string[]>; statesAfter: Record<string, string[]> }[];

  /** SSG 修复路径：要调用哪些函数才能达到目标状态 */
  ssgFixPath?: string[];

  /** 违规时缺失的函数 */
  ssgMissingFunctions?: string[];

  /** 规划器路径: 第几次尝试（1-based） */
  plannerAttempt: number;

  /** 规划器重试总数（同一次 plan() 调用中的最大重试次数） */
  plannerRetryTotal: number;

  /** 同一意图的父会话 ID，用于链接成功/失败对 */
  parentSessionId?: string;
}

/** 会话中的单次尝试记录（省略跨 attempt 共享的字段） */
export type SessionAttempt = Omit<FailureRecord, "id" | "timestamp" | "parentSessionId" | "intent" | "projectFunctions">;

/** 意图的完整会话记录 —— 链接一次 plan() 调用的所有尝试 */
export interface IntentSession {
  sessionId: string;
  intent: string;
  timestamp: string;
  attempts: SessionAttempt[];
  successfulAlternative?: any[];
  totalRetries: number;
  resolved: boolean;
  /** IR 快照 ID，用于确定性回放 */
  snapshotId?: string;
}

// 优先使用 PROGMUNE_PROJECT_DIR（由 MCP 服务器在调用时设置），确保多项目隔离
const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const CORPUS_DIR = process.env.PROGMUNE_CORPUS_DIR
  || path.resolve(projectDir, ".progmune_corpus");
const SESSIONS_DIR = path.join(CORPUS_DIR, "sessions");
const CHECKPOINT_DIR = path.join(CORPUS_DIR, "checkpoints");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Planner checkpoint: 执行持久化，支持中断恢复 ──

export interface PlannerCheckpoint {
  intent: string;
  attemptIndex: number;       // 已完成的尝试次数（下次从 r = attemptIndex 继续）
  sessionAttempts: Attempt[]; // serialized Attempt objects from the session
  currentPrompt: string;
  useSystem: boolean;
  timestamp: string;
}

function checkpointPath(intent: string): string {
  // 用 intent 的稳定 hash 作为文件名，避免特殊字符
  const hash = Buffer.from(intent).toString("base64").replace(/[/+=]/g, "_").slice(0, 32);
  return path.join(CHECKPOINT_DIR, `ckpt_${hash}.json`);
}

/** Save planner checkpoint for crash recovery. */
export function saveCheckpoint(intent: string, data: Omit<PlannerCheckpoint, "intent" | "timestamp">): void {
  ensureDir(CHECKPOINT_DIR);
  const cp: PlannerCheckpoint = {
    ...data,
    intent,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(checkpointPath(intent), JSON.stringify(cp, null, 2));
}

/** Load a previously saved planner checkpoint. */
export function loadCheckpoint(intent: string): PlannerCheckpoint | null {
  try {
    const raw = fs.readFileSync(checkpointPath(intent), "utf-8");
    return JSON.parse(raw) as PlannerCheckpoint;
  } catch {
    return null;
  }
}

/** Clear a saved planner checkpoint. */
export function clearCheckpoint(intent: string): void {
  try { fs.unlinkSync(checkpointPath(intent)); } catch { /* checkpoint file may not exist */ }
}

/** Record a constraint violation to the failure corpus. */
export function recordFailure(
  record: Omit<FailureRecord, "id" | "timestamp" | "parentSessionId"> & { sessionId?: string } & Partial<Pick<FailureRecord, "plannerAttempt" | "plannerRetryTotal">>
) {
  withLock("failure-corpus", () => {
    ensureDir(CORPUS_DIR);
    const date = new Date().toISOString().slice(0, 10);
    const dateDir = path.join(CORPUS_DIR, date);
    ensureDir(dateDir);

    const seqFile = path.join(CORPUS_DIR, ".seq");
    let seq = 0;
    try { seq = parseInt(fs.readFileSync(seqFile, 'utf-8'), 10); } catch { /* checkpoint file may not exist */ }
    seq++;
    fs.writeFileSync(seqFile, String(seq));

    const id = `fail_${Date.now()}_${seq}`;
    const fullRecord: FailureRecord = {
      ...record,
      id,
      timestamp: new Date().toISOString(),
      plannerAttempt: record.plannerAttempt || 1,
      plannerRetryTotal: record.plannerRetryTotal || 1,
    };

    const filename = `${id}.json`;
    fs.writeFileSync(path.join(dateDir, filename), JSON.stringify(fullRecord, null, 2));
    console.error(`[FailureCorpus] ${record.violatedSVL} | 尝试 ${record.plannerAttempt}/${record.plannerRetryTotal} | ${id}`);
  });
}

// ═══════════════════════════════════════════════════════════════
// P0: Trajectory Schema v1 — Code World Model Dataset
// Records ALL outcomes: success, violation, repair, optimal.
// Just as MuZero trains on (s,a,s',r), Progmune trains on trajectories.
// ═══════════════════════════════════════════════════════════════

import type { TrajectoryRecord, TrajectoryResult, ContextFeatures, ViolationType, RewardVector } from "./runtime-types";
import { mapLegacyFCode } from "./runtime-types";

const TRAJECTORY_DIR = path.join(CORPUS_DIR, "trajectories");

function writeTrajectoryFile(record: TrajectoryRecord): void {
  setImmediate(() => {
    try {
      const date = record.timestamp.slice(0, 10);
      const dateDir = path.join(TRAJECTORY_DIR, date);
      ensureDir(dateDir);
      fs.writeFileSync(path.join(dateDir, `${record.id}.json`), JSON.stringify(record, null, 2));
    } catch { /* corpus write must never crash */ }
  });
}

let _trajSeq = 0;
function nextTrajId(): string {
  if (_trajSeq === 0) {
    const seqFile = path.join(TRAJECTORY_DIR, ".seq");
    try { _trajSeq = parseInt(fs.readFileSync(seqFile, "utf-8"), 10); } catch {}
  }
  _trajSeq++;
  setImmediate(() => {
    try { fs.writeFileSync(path.join(TRAJECTORY_DIR, ".seq"), String(_trajSeq)); } catch {}
  });
  return `T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Record any trajectory — success, violation, repair, or optimal.
 * This is the single entry point for the Code World Model Dataset.
 */
export function recordTrajectory(params: {
  protocol: string;
  initialState: string[];
  finalState: string[];
  trajectory: string[];
  result: TrajectoryResult;
  reward?: RewardVector;
  violationType?: ViolationType;
  violationDesc?: string;
  failingStepIndex?: number;
  fixPath?: string[];
  repairFrom?: string;
  context?: ContextFeatures;
  successRate?: number;
  source?: "human" | "llm" | "planner" | "antibody";
  intent?: string;
  sessionId?: string;
  goal?: import("./runtime-types").GoalRecord;
  feedback?: { accepted?: boolean; rejected?: boolean };
  cost?: { latency?: number; actions?: number };
}): void {
  ensureDir(TRAJECTORY_DIR);

  const defaultCtx: ContextFeatures = { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false };
  const defaultReward: RewardVector = { safety: 0.5, latency: 0.5, maintainability: 0.5, security: 0.5, auditability: 0.5, custom: {} };

  const record: TrajectoryRecord = {
    id: nextTrajId(),
    timestamp: new Date().toISOString(),
    protocol: params.protocol,
    initialState: params.initialState,
    finalState: params.finalState,
    trajectory: params.trajectory,
    result: params.result,
    reward: params.result === "success" || params.result === "optimal" ? (params.reward || defaultReward) : undefined,
    violation: params.result === "violation" || params.result === "repair" ? {
      type: params.violationType || "other",
      failingStepIndex: params.failingStepIndex || 0,
      expectedStates: params.finalState,
      actualStates: params.initialState,
      fixPath: params.fixPath,
      description: params.violationDesc || "",
    } : undefined,
    repairFrom: params.repairFrom,
    context: params.context || defaultCtx,
    successRate: params.successRate || 0,
    metadata: {
      source: params.source || "llm",
      intent: params.intent,
      sessionId: params.sessionId,
    },
    goal: params.goal,
    feedback: params.feedback,
    cost: params.cost,
  };

  writeTrajectoryFile(record);
  console.error(`[Trajectory] ${record.result} | ${params.protocol} | ${record.id}`);
}

/**
 * Record a successful trajectory — positive sample for reward learning.
 * Call this when validation passes without violations.
 */
export function recordSuccess(params: {
  protocol: string;
  initialState: string[];
  finalState: string[];
  trajectory: string[];
  reward?: RewardVector;
  context?: ContextFeatures;
  source?: "human" | "llm" | "planner" | "antibody";
  intent?: string;
  sessionId?: string;
}): void {
  recordTrajectory({ ...params, result: "success", successRate: 1.0 });
}

/**
 * Record a repair trajectory — shows what fix was applied and whether it worked.
 */
export function recordRepair(params: {
  protocol: string;
  initialState: string[];
  finalState: string[];
  trajectory: string[];
  violationType: ViolationType;
  violationDesc: string;
  repairFrom: string;
  fixPath: string[];
  success: boolean;
  source?: "human" | "llm" | "planner" | "antibody";
  intent?: string;
  sessionId?: string;
}): void {
  recordTrajectory({
    ...params,
    result: "repair",
    successRate: params.success ? 1.0 : 0.0,
    failingStepIndex: 0,
  });
}

// ── Backward-compatible wrappers ──

/** @deprecated Use recordTrajectory() with result: "violation" instead. */
export function recordFailureV2(record: Omit<import("./runtime-types").FailureRecordV2, "failureId" | "timestamp">): void {
  recordTrajectory({
    protocol: record.protocol,
    initialState: record.actualStateSequence,
    finalState: record.expectedStateSequence,
    trajectory: record.actionSequence,
    result: "violation",
    violationType: record.violationType,
    violationDesc: record.violationType,
    failingStepIndex: record.failingStepIndex,
    fixPath: record.ssgFixPath,
    context: record.contextFeatures,
    successRate: record.successRate,
    intent: record.intent,
    sessionId: record.parentSessionId,
  });
}

/** @deprecated Use loadTrajectories() instead. */
export function loadFailuresV2(): import("./runtime-types").FailureRecordV2[] {
  return loadTrajectories()
    .filter(t => t.result === "violation")
    .map(t => ({
      failureId: t.id,
      timestamp: t.timestamp,
      protocol: t.protocol,
      codeSnippet: (t.trajectory || []).join("; "),
      expectedStateSequence: t.finalState || [],
      actualStateSequence: t.initialState || [],
      violationType: t.violation?.type || "other",
      failingStepIndex: t.violation?.failingStepIndex || 0,
      contextFeatures: t.context,
      repairAttempts: [],
      successRate: t.successRate,
      actionSequence: t.trajectory || [],
      ssgStateAtViolation: t.initialState || [],
      ssgFixPath: t.violation?.fixPath || [],
      parentSessionId: t.metadata?.sessionId,
      intent: t.metadata?.intent || "",
    }));
}

// ═══════════════════════════════════════════════════════════════
// P0: Trajectory query API
// ═══════════════════════════════════════════════════════════════

/** Load all trajectory records from the corpus. */
export function loadTrajectories(): TrajectoryRecord[] {
  const results: TrajectoryRecord[] = [];
  if (!fs.existsSync(TRAJECTORY_DIR)) return results;

  const dateDirs = fs.readdirSync(TRAJECTORY_DIR, { withFileTypes: true });
  for (const entry of dateDirs) {
    if (!entry.isDirectory()) continue;
    const files = fs.readdirSync(path.join(TRAJECTORY_DIR, entry.name));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(TRAJECTORY_DIR, entry.name, file), "utf-8");
        results.push(JSON.parse(raw) as TrajectoryRecord);
      } catch { /* skip corrupted files */ }
    }
  }
  return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Query trajectories by result type. */
export function queryByResult(result: TrajectoryResult): TrajectoryRecord[] {
  return loadTrajectories().filter(t => t.result === result);
}

/** Query violations by type. */
export function queryByViolationType(type: ViolationType): TrajectoryRecord[] {
  return loadTrajectories().filter(t => t.violation?.type === type);
}

/** Query trajectories by protocol. */
export function queryByProtocol(protocol: string): TrajectoryRecord[] {
  return loadTrajectories().filter(t => t.protocol === protocol);
}

/** Get top N violation patterns across all trajectories. */
export function getTopPatterns(limit: number = 10): { violationType: ViolationType; contextKey: string; count: number; avgSuccessRate: number }[] {
  const all = loadTrajectories().filter(t => t.result === "violation");
  const buckets: Record<string, { records: TrajectoryRecord[] }> = {};

  for (const t of all) {
    const ctx = t.context;
    const key = `${t.violation?.type || "other"}|d${ctx.nestingDepth}|${ctx.exceptionHandled ? "try" : "no-try"}|${ctx.insideLoop ? "loop" : "no-loop"}`;
    if (!buckets[key]) buckets[key] = { records: [] };
    buckets[key].records.push(t);
  }

  return Object.entries(buckets)
    .sort((a, b) => b[1].records.length - a[1].records.length)
    .slice(0, limit)
    .map(([key, bucket]) => {
      const [vt, ...rest] = key.split("|");
      const avg = bucket.records.reduce((s, t) => s + t.successRate, 0) / bucket.records.length;
      return {
        violationType: vt as ViolationType,
        contextKey: rest.join(" "),
        count: bucket.records.length,
        avgSuccessRate: avg,
      };
    });
}

/** Get total trajectory count and breakdown by result type. */
export function corpusTrajectoryStats(): { total: number; success: number; violation: number; repair: number; optimal: number } {
  const all = loadTrajectories();
  return {
    total: all.length,
    success: all.filter(t => t.result === "success").length,
    violation: all.filter(t => t.result === "violation").length,
    repair: all.filter(t => t.result === "repair").length,
    optimal: all.filter(t => t.result === "optimal").length,
  };
}

/** Get repair acceptance statistics for P4 Reward Model training data. */
export function getRepairStats(): {
  acceptedRepairs: number;
  rejectedRepairs: number;
  totalRepairs: number;
  acceptanceRate: number;
  avgLatency: number;
} {
  const all = loadTrajectories().filter(t => t.result === "repair");
  const accepted = all.filter(t => t.feedback?.accepted === true).length;
  const rejected = all.filter(t => t.feedback?.rejected === true).length;
  const total = all.length;
  const acceptanceRate = total > 0 ? accepted / total : 0;
  const costs = all
    .map(t => t.cost?.latency)
    .filter((l): l is number => l !== undefined);
  const avgLatency = costs.length > 0
    ? costs.reduce((s, l) => s + l, 0) / costs.length
    : 0;
  return { acceptedRepairs: accepted, rejectedRepairs: rejected, totalRepairs: total, acceptanceRate, avgLatency };
}

/** @deprecated Use corpusTrajectoryStats() instead. */
export function corpusV2Size(): number {
  return corpusTrajectoryStats().total;
}

/** 记录一个完整的意图会话（支持 ExecutionSession 和旧 IntentSession） */
/**
 * 保存执行会话（含所有尝试、违规、状态转移）。
 * @protocol namespace=dev_pipeline pre_states=["CODE_EMITTED"] post_states=["SESSION_RECORDED"] invalidate=["CODE_EMITTED"]
 */
/** @requires EXECUTION_DATA @produces SESSION_ID */
/** @requires EXECUTION_DATA @produces SESSION_ID */
export function recordSession(session: ExecutionSession | Omit<IntentSession, "sessionId">): string {
  ensureDir(SESSIONS_DIR);
  const sessionId = (session as any).sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // 检测新格式：ExecutionSession has .attempts[0]?.violations
  const isExecutionSession = (session as any).attempts?.length > 0 && (session as any).attempts[0].violations;

  if (isExecutionSession) {
    // 新格式：直接保存 ExecutionSession
    const fullSession: ExecutionSession = { ...(session as ExecutionSession), sessionId };
    fs.writeFileSync(
      path.join(SESSIONS_DIR, `${sessionId}.json`),
      JSON.stringify(fullSession, null, 2)
    );

    // 为每个违规的 attempt 记录到 failure corpus（向后兼容）
    for (const attempt of fullSession.attempts) {
      for (const violation of attempt.violations) {
        const svlStr = `SVL-${violation.svl}` as SVL;
        const blockingFn = attempt.generatedActions[violation.actionIndex];
        recordFailure({
          intent: fullSession.intent,
          projectFunctions: [],
          violatedSVL: svlStr,
          constraintType: violation.violatedConstraint,
          actionSequence: attempt.generatedActions,
          errorDetail: violation.description,
          ssgState: violation.currentStates,
          ssgFixPath: violation.fixPath,
          ssgMissingFunctions: violation.missingStates,
          plannerAttempt: attempt.attemptNumber,
          plannerRetryTotal: fullSession.attempts.length,
        });
      }
    }
    return sessionId;
  }

  // 旧格式：兼容保存
  const fullSession: IntentSession = { ...(session as any), sessionId };
  fs.writeFileSync(
    path.join(SESSIONS_DIR, `${sessionId}.json`),
    JSON.stringify(fullSession, null, 2)
  );
  return sessionId;
}

/** @requires FAILURE_CORPUS @produces FAILURE_LIST */
export function getAllFailures(): FailureRecord[] {
  const records: FailureRecord[] = [];
  if (!fs.existsSync(CORPUS_DIR)) return records;
  const dirs = fs.readdirSync(CORPUS_DIR).filter(d => d !== 'sessions');
  for (const dir of dirs) {
    const dirPath = path.join(CORPUS_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const file of fs.readdirSync(dirPath)) {
      if (file.endsWith(".json")) {
        try {
          records.push(JSON.parse(fs.readFileSync(path.join(dirPath, file), "utf-8")));
        } catch { /* checkpoint file may not exist */ }
      }
    }
  }
  return records;
}

/** @requires FAILURE_LIST @produces FILTERED_FAILURES */
export function getFailuresBySVL(level: SVL): FailureRecord[] {
  return getAllFailures().filter(r => r.violatedSVL === level);
}

/** @requires FAILURE_LIST @produces FAILURE_PATTERNS */
export function getTopFailurePatterns(limit: number = 5): { pattern: string; count: number; examples: string[] }[] {
  const groups = new Map<string, { count: number; examples: string[] }>();
  for (const r of getAllFailures()) {
    const key = `${r.violatedSVL}:${r.constraintType}`;
    const entry = groups.get(key) || { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 3) entry.examples.push(r.intent);
    groups.set(key, entry);
  }
  return [...groups.entries()]
    .map(([pattern, entry]) => ({ pattern, count: entry.count, examples: entry.examples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** 构建 AI 失败基因组 —— 按失效模式分组的完整画像 */
/** Get failure genome statistics: total failures, SVL distribution, constraint types, top patterns.
 * @tags failure, statistics, genome, audit
 */
/** Get failure genome statistics: total failures by SVL, constraint type, and fix path. */
/** @requires FAILURE_DATA @produces FAILURE_GENOME */
/** @requires FAILURE_DATA @produces FAILURE_GENOME */
/** @useWhen user asks why generation failed; benchmark compile rate drops; analyzing error patterns */
export function getFailureGenome(): {
  totalFailures: number;
  bySVL: Record<SVL, number>;
  byConstraintType: Record<string, number>;
  topPatterns: { pattern: string; count: number; examples: string[] }[];
  commonFixPaths: { violation: string; fixPath: string[]; count: number }[];
  averageRetriesToSuccess: number;
} {
  const sessions = getAllSessions();
  const bySVL: Record<SVL, number> = { "SVL-1": 0, "SVL-2": 0, "SVL-3": 0, "SVL-4": 0 };
  const byConstraint: Record<string, number> = {};
  const patternCounts = new Map<string, { count: number; examples: string[] }>();
  const fixPathCounts = new Map<string, number>();
  let totalViolations = 0;
  let totalRetries = 0;
  let resolvedSessions = 0;

  for (const s of sessions) {
    const sessionRetries = s.attempts.filter(a => a.outcome !== "success").length;
    totalRetries += sessionRetries;
    if (s.resolved) resolvedSessions++;

    for (const a of s.attempts) {
      for (const v of a.violations) {
        totalViolations++;
        const svlKey = `SVL-${v.svl}` as SVL;
        bySVL[svlKey] = (bySVL[svlKey] || 0) + 1;
        const ct = v.violatedConstraint || "unknown";
        byConstraint[ct] = (byConstraint[ct] || 0) + 1;

        // Pattern grouping
        const patternKey = `${svlKey}:${ct}`;
        const entry = patternCounts.get(patternKey) || { count: 0, examples: [] };
        entry.count++;
        if (entry.examples.length < 3) entry.examples.push(s.intent);
        patternCounts.set(patternKey, entry);

        if (v.fixPath && v.fixPath.length > 0) {
          const key = `${svlKey}:${v.fixPath.join("→")}`;
          fixPathCounts.set(key, (fixPathCounts.get(key) || 0) + 1);
        }
      }
    }
  }

  const topPatterns = [...patternCounts.entries()]
    .map(([pattern, entry]) => ({ pattern, count: entry.count, examples: entry.examples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const commonFixPaths = [...fixPathCounts.entries()]
    .map(([key, count]) => {
      const [violation, ...rest] = key.split(":");
      return { violation, fixPath: rest.join(":").split("→"), count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalFailures: totalViolations,
    bySVL,
    byConstraintType: byConstraint,
    topPatterns,
    commonFixPaths,
    averageRetriesToSuccess: totalViolations > 0 ? Math.round((totalRetries / totalViolations) * 10) / 10 : 0,
  };
}

/** 获取所有意图会话（归一化为 ExecutionSession[]） */
/** Load all execution sessions from the corpus directory.
 * @tags session, corpus, audit, history
 */
/** @requires SESSION_DATA @produces SESSION_LIST */
/** @requires SESSION_CORPUS @produces SESSION_LIST */
/** @requires SESSION_CORPUS @produces SESSION_LIST */
/** @requires SESSION_CORPUS @produces SESSION_LIST */
/** @useWhen listing all past executions; auditing session history; checking coverage */
export function getAllSessions(): ExecutionSession[] {
  const sessions: ExecutionSession[] = [];
  if (!fs.existsSync(SESSIONS_DIR)) return sessions;
  for (const file of fs.readdirSync(SESSIONS_DIR)) {
    if (file.endsWith(".json")) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8"));
        sessions.push(normalizeSession(raw));
      } catch { /* checkpoint file may not exist */ }
    }
  }
  return sessions;
}

/** 检测并归一化新旧两种会话格式 */
function normalizeSession(raw: any): ExecutionSession {
  // 新格式：attempts[0] 有 violations 字段
  if (raw.attempts?.length > 0 && raw.attempts[0].violations) {
    return raw as ExecutionSession;
  }
  // 旧 IntentSession 格式 → 上转
  return convertOldSession(raw);
}

/** 将旧 IntentSession 转换为 ExecutionSession */
function convertOldSession(old: IntentSession): ExecutionSession {
  const attempts: Attempt[] = (old.attempts || []).map((sa, i) => ({
    id: `${old.sessionId}_att_${i + 1}`,
    sessionId: old.sessionId,
    attemptNumber: (sa as any).plannerAttempt || i + 1,
    inputIntent: old.intent,
    plannerSeed: old.sessionId,
    constraintSnapshotId: old.snapshotId || "",
    generatedActions: sa.actionSequence || [],
    transitions: [],
    violations: [{
      svl: parseInt((sa.violatedSVL || "SVL-1").split("-")[1]) as 1|2|3|4,
      violatedConstraint: sa.constraintType || "unknown",
      actionIndex: 0,
      currentStates: (sa as any).ssgState,
      missingStates: sa.ssgMissingFunctions,
      fixPath: sa.ssgFixPath,
      description: sa.errorDetail || "",
    }],
    outcome: "constraint_violation" as const,
    timestamp: new Date(old.timestamp).getTime(),
    llmCallCount: 1,
    durationMs: 0,
  }));

  return {
    sessionId: old.sessionId,
    intent: old.intent,
    attempts,
    successfulAttempt: old.resolved && old.successfulAlternative
      ? {
          id: `${old.sessionId}_success`,
          sessionId: old.sessionId,
          attemptNumber: old.totalRetries + 1,
          inputIntent: old.intent,
          plannerSeed: old.sessionId,
          constraintSnapshotId: old.snapshotId || "",
          generatedActions: old.successfulAlternative,
          transitions: [],
          violations: [],
          outcome: "success",
          timestamp: new Date(old.timestamp).getTime(),
          llmCallCount: old.totalRetries,
          durationMs: 0,
        }
      : undefined,
    resolved: old.resolved,
    snapshotId: old.snapshotId,
    startedAt: new Date(old.timestamp).getTime(),
    endedAt: new Date(old.timestamp).getTime(),
  };
}

/** 查询学到的东西：哪些失效模式最常见，对应的修复路径是什么 */

export type AntibodyLevel = "ACL-1" | "ACL-2" | "ACL-3" | "ACL-4";

export interface LearnedPattern {
  signature: string;
  violation: string;
  fixPath: string[];
  occurrenceCount: number;
  distinctIntents: string[];
  resolvedRate: number;
  antibodyLevel: AntibodyLevel;
  firstSeen: string;
  lastSeen: string;
}

function computeACL(count: number, distinctIntents: number, resolvedRate: number): AntibodyLevel {
  const acl4Count = parseInt(process.env.PROGMUNE_ACL4_COUNT || "10", 10);
  const acl4Intents = parseInt(process.env.PROGMUNE_ACL4_INTENTS || "5", 10);
  const acl3Count = parseInt(process.env.PROGMUNE_ACL3_COUNT || "4", 10);
  const acl3Intents = parseInt(process.env.PROGMUNE_ACL3_INTENTS || "3", 10);
  const acl2Count = parseInt(process.env.PROGMUNE_ACL2_COUNT || "2", 10);

  if (count >= acl4Count && distinctIntents >= acl4Intents) return "ACL-4";
  if (count >= acl3Count || distinctIntents >= acl3Intents) return "ACL-3";
  if (count >= acl2Count) return "ACL-2";
  return "ACL-1";
}

/** Get antibody patterns learned from failure history. */
/** @requires FAILURE_HISTORY @produces LEARNED_PATTERNS */
/** @useWhen finding what fixes worked before; reusing successful repairs */
export function getLearnedPatterns(): { failureToFix: LearnedPattern[] } {
  const sessions = getAllSessions();
  const agg = new Map<string, {
    violation: string;
    fixPath: string[];
    count: number;
    intents: Set<string>;
    resolvedCount: number;
    firstSeen: string;
    lastSeen: string;
  }>();

  for (const s of sessions) {
    for (const a of s.attempts) {
      // Extract SSG violations from Attempt.violations
      for (const v of a.violations) {
        if (!v.fixPath || v.fixPath.length === 0) continue;
        const violatedLabel = `SVL-${v.svl}`;
        // Use violatedConstraint if available, otherwise fall back to missingStates
        const constraintKey = v.violatedConstraint
          || (v.missingStates || ["unknown"]).join(",");
        const signature = `${violatedLabel}:${constraintKey}`;
        const existing = agg.get(signature);
        const ts = new Date(s.startedAt).toISOString();
        if (existing) {
          existing.count++;
          existing.intents.add(s.intent);
          if (s.resolved) existing.resolvedCount++;
          if (ts > existing.lastSeen) existing.lastSeen = ts;
        } else {
          agg.set(signature, {
            violation: `${violatedLabel}: ${constraintKey}`,
            fixPath: v.fixPath,
            count: 1,
            intents: new Set([s.intent]),
            resolvedCount: s.resolved ? 1 : 0,
            firstSeen: ts,
            lastSeen: ts,
          });
        }
      }
    }
  }

  const patterns: LearnedPattern[] = [];
  for (const [signature, data] of agg) {
    const distinctCount = data.intents.size;
    const resolvedRate = data.count > 0 ? Math.round((data.resolvedCount / data.count) * 100) / 100 : 0;
    patterns.push({
      signature,
      violation: data.violation,
      fixPath: data.fixPath,
      occurrenceCount: data.count,
      distinctIntents: [...data.intents],
      resolvedRate,
      antibodyLevel: computeACL(data.count, distinctCount, resolvedRate),
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
    });
  }

  patterns.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  return { failureToFix: patterns };
}

/** 查询匹配当前意图的高置信度抗体（ACL-3+），用于推理层免疫加速 */
/** Query antibody registry for matching repair patterns. */
/** @requires FAILURE_SIGNATURE @produces ANTIBODY_MATCH */
export function queryAntibodies(intent: string, minACL: AntibodyLevel = "ACL-3"): LearnedPattern[] {
  const { failureToFix } = getLearnedPatterns();
  const aclRank: Record<AntibodyLevel, number> = { "ACL-1": 1, "ACL-2": 2, "ACL-3": 3, "ACL-4": 4 };
  const minRank = aclRank[minACL];

  const intentLower = intent.toLowerCase();
  const intentWords = new Set(intentLower.split(/[\s,，、]+|(?<=[一-鿿])(?=[一-鿿])/).filter(w => w.length > 0));

  return failureToFix
    .filter(p => aclRank[p.antibodyLevel] >= minRank)
    .filter(p => p.fixPath && p.fixPath.length > 0)
    .map(p => {
      // 计算意图相似度
      let overlapScore = 0;
      for (const di of p.distinctIntents) {
        const diWords = new Set(di.toLowerCase().split(/[\s,，、]+|(?<=[一-鿿])(?=[一-鿿])/).filter(w => w.length > 0));
        const intersection = [...intentWords].filter(w => diWords.has(w)).length;
        const union = new Set([...intentWords, ...diWords]).size;
        overlapScore = Math.max(overlapScore, union > 0 ? intersection / union : 0);
      }
      return { ...p, _score: overlapScore };
    })
    .filter(p => p._score >= 0.2) // 至少 20% 的 Jaccard 相似度
    .sort((a, b) => b._score - a._score);
}

/** 语义热力图：哪些协议/层最脆弱，约束如何聚类 */
/** Get semantic heatmap showing fragile protocols and SVL hotspots. */
/** @requires FAILURE_DATA @produces HEATMAP */
/** @requires FAILURE_HEATMAP @produces HEATMAP_DATA */
export function getSemanticHeatmap(): {
  fragileProtocols: { function: string; violationCount: number; svl: string }[];
  svlHotspots: { svl: string; count: number; percentage: number }[];
  constraintClusters: { constraints: string[]; count: number; intent: string }[];
  highFrictionIntents: { intent: string; adaptationCount: number; anomalyTypes: string[] }[];
} {
  const sessions = getAllSessions();

  // Count total violations from sessions
  let totalViolations = 0;
  const svlCounts: Record<string, number> = {};
  const funcCounts = new Map<string, { count: number; svl: string }>();

  for (const s of sessions) {
    for (const a of s.attempts) {
      for (const v of a.violations) {
        totalViolations++;
        const svlKey = `SVL-${v.svl}`;
        svlCounts[svlKey] = (svlCounts[svlKey] || 0) + 1;

        // Fragile protocols: extract blocked function from description
        const blockedMatch = v.description.match(/(\w+)\s*(要求|requires|blocked|不允许|不合法)/);
        const fn = blockedMatch ? blockedMatch[1] : (a.generatedActions.find(x => x.kind === "call")?.function || "unknown");
        const existing = funcCounts.get(fn);
        if (existing) {
          existing.count++;
        } else {
          funcCounts.set(fn, { count: 1, svl: svlKey });
        }
      }
    }
  }
  const total = totalViolations || 1;

  const fragileProtocols = [...funcCounts.entries()]
    .map(([fn, data]) => ({ function: fn, violationCount: data.count, svl: data.svl }))
    .sort((a, b) => b.violationCount - a.violationCount)
    .slice(0, 10);

  // SVL hotspots
  const svlHotspots: { svl: string; count: number; percentage: number }[] = [];
  for (const [svl, count] of Object.entries(svlCounts)) {
    svlHotspots.push({ svl, count, percentage: Math.round((count / total) * 100) });
  }
  svlHotspots.sort((a, b) => b.count - a.count);

  // Constraint clusters: which anomaly types co-occur in the same session
  const constraintClusters: { constraints: string[]; count: number; intent: string }[] = [];
  for (const s of sessions) {
    if (s.attempts.length < 2) continue;
    const types = [...new Set(s.attempts.flatMap(a => a.violations.map(v => v.violatedConstraint)))].filter(Boolean).sort();
    if (types.length >= 2) {
      constraintClusters.push({ constraints: types, count: s.attempts.length, intent: s.intent });
    }
  }
  constraintClusters.sort((a, b) => b.count - a.count);

  // High friction intents: which tasks require the most adaptations
  const highFrictionIntents = sessions
    .map(s => ({
      intent: s.intent,
      adaptationCount: s.attempts.filter(a => a.outcome !== "success").length,
      anomalyTypes: [...new Set(s.attempts.flatMap(a => a.violations.map(v => v.violatedConstraint)))].filter(Boolean),
    }))
    .sort((a, b) => b.adaptationCount - a.adaptationCount)
    .slice(0, 8);

  return { fragileProtocols, svlHotspots, constraintClusters, highFrictionIntents };
}

/** 抗体效能统计：量化免疫加速节省的 LLM 调用和 token */
/** Get antibody efficacy statistics: hits by level, tokens saved, top signatures.
 * @tags antibody, immune, statistics, efficiency
 */
/** @requires ANTIBODY_DATA @produces ANTIBODY_STATS */
/** @requires ANTIBODY_DATA @produces ANTIBODY_STATS */
/** @useWhen checking immune system effectiveness; measuring token savings */
export function getAntibodyStats(): {
  totalHits: number;
  fastPathHits: number;
  injectedHintHits: number;
  totalLLMCallsSaved: number;
  totalTokensSaved: number;
  byLevel: Record<string, { hits: number; llmSaved: number; tokensSaved: number }>;
  topSignatures: { signature: string; hits: number; avgSimilarity: number }[];
} {
  const sessions = getAllSessions();
  let totalHits = 0;
  let fastPathHits = 0;
  let injectedHintHits = 0;
  let totalLLMCallsSaved = 0;
  let totalTokensSaved = 0;
  const byLevel: Record<string, { hits: number; llmSaved: number; tokensSaved: number }> = {};
  const sigMap = new Map<string, { hits: number; similarities: number[] }>();

  for (const s of sessions) {
    for (const a of s.attempts) {
      const hit = (a as any).antibodyHit;
      if (!hit) continue;
      totalHits++;
      if (hit.action === "fast_path") fastPathHits++;
      else if (hit.action === "injected_hint") injectedHintHits++;
      totalLLMCallsSaved += hit.llmCallsSaved || 0;
      totalTokensSaved += hit.estimatedTokensSaved || 0;

      const level = hit.level || "ACL-1";
      const lb = byLevel[level] || { hits: 0, llmSaved: 0, tokensSaved: 0 };
      lb.hits++;
      lb.llmSaved += hit.llmCallsSaved || 0;
      lb.tokensSaved += hit.estimatedTokensSaved || 0;
      byLevel[level] = lb;

      const sig = hit.signature || "unknown";
      const se = sigMap.get(sig) || { hits: 0, similarities: [] };
      se.hits++;
      se.similarities.push(hit.similarityScore || 0);
      sigMap.set(sig, se);
    }
  }

  const topSignatures = [...sigMap.entries()]
    .map(([signature, d]) => ({
      signature,
      hits: d.hits,
      avgSimilarity: Math.round((d.similarities.reduce((a, b) => a + b, 0) / d.similarities.length) * 100) / 100,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 10);

  return { totalHits, fastPathHits, injectedHintHits, totalLLMCallsSaved, totalTokensSaved, byLevel, topSignatures };
}

// ── Edge rejection tracking ──
const MEMORY_DIR = path.join(CORPUS_DIR, "..", ".progmune_memory");
const REJECTION_FILE = path.join(MEMORY_DIR, "edge_rejections.json");

/** Record that the LLM rejected a recommended edge (picked a different function). */
export function recordEdgeRejection(producer: string, consumer: string): void {
  withLock("edge_rejections", () => {
    let data: Record<string, number> = {};
    try { if (fs.existsSync(REJECTION_FILE)) data = JSON.parse(fs.readFileSync(REJECTION_FILE, "utf-8")); } catch {}
    const key = `${producer}→${consumer}`;
    data[key] = (data[key] || 0) + 1;
    fs.writeFileSync(REJECTION_FILE, JSON.stringify(data, null, 2));
  });
}

function getEdgeRejections(): Map<string, number> {
  try {
    if (!fs.existsSync(REJECTION_FILE)) return new Map();
    const data = JSON.parse(fs.readFileSync(REJECTION_FILE, "utf-8"));
    return new Map(Object.entries(data));
  } catch { return new Map(); }
}

/** Edge confidence from session history.
 *  For each producer→consumer edge, returns how often it appeared
 *  in successful vs failed chains. Used by Capability Ranking. */
export interface EdgeConfidence {
  producer: string;
  consumer: string;
  successCount: number;
  failureCount: number;
  totalCount: number;
  /** Confidence score: 0-1, Laplace smoothed */
  confidence: number;
}

export function getEdgeConfidence(producer?: string, consumer?: string): EdgeConfidence[] {
  const sessions = getAllSessions();
  const edgeStats = new Map<string, { success: number; failure: number }>();

  for (const s of sessions) {
    for (const a of s.attempts) {
      const calls = a.transitions
        .filter(t => t.function)
        .sort((x, y) => x.actionIndex - y.actionIndex);
      const isSuccess = a.outcome === "success";

      for (let i = 0; i < calls.length - 1; i++) {
        const edgeKey = `${calls[i].function}→${calls[i + 1].function}`;
        if (!edgeStats.has(edgeKey)) {
          edgeStats.set(edgeKey, { success: 0, failure: 0 });
        }
        const stats = edgeStats.get(edgeKey)!;
        if (isSuccess) stats.success++;
        else stats.failure++;
      }
    }
  }

  const rejections = getEdgeRejections();

  const results: EdgeConfidence[] = [];
  for (const [key, stats] of edgeStats) {
    const [prod, cons] = key.split("→");
    if (producer && prod !== producer) continue;
    if (consumer && cons !== consumer) continue;
    // Factor in explicit LLM rejections as negative signal
    const rejectionCount = rejections.get(key) || 0;
    const effectiveSuccess = Math.max(0, stats.success - rejectionCount);
    const effectiveTotal = stats.success + stats.failure + rejectionCount;
    // Laplace smoothing: Beta(1,1) prior
    const confidence = (effectiveSuccess + 1) / (effectiveTotal + 2);
    results.push({
      producer: prod,
      consumer: cons,
      successCount: stats.success,
      failureCount: stats.failure,
      totalCount: effectiveTotal,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  results.sort((a, b) => b.confidence * b.totalCount - a.confidence * a.totalCount);
  return results;
}

/** Generate candidate immune rules from failure patterns. */
export function generateCandidateRules(): string[] {
  const genome = getFailureGenome();
  const rules: string[] = [];

  // SVL-4 修复路径
  const ssgFixes = genome.commonFixPaths.filter(f => f.violation === 'SVL-4');
  if (ssgFixes.length > 0) {
    const top = ssgFixes[0];
    rules.push(`SSG 修复规则: 当检测到协议违规时，优先尝试调用 ${top.fixPath.join(' → ')}。`);
  }

  if (genome.bySVL["SVL-1"] > genome.bySVL["SVL-4"]) {
    rules.push("SVL-1 是最高频失效模式——建议强化 IR 提取的符号覆盖度。");
  }
  if (genome.bySVL["SVL-4"] > 0) {
    rules.push("SVL-4 协议违规建议：为关键函数添加 @protocol JSDoc 注解。");
  }
  if (genome.averageRetriesToSuccess > 2) {
    rules.push(`平均需要 ${genome.averageRetriesToSuccess} 次重试才能成功——考虑优化 Planner 路径排序。`);
  }

  return rules;
}
