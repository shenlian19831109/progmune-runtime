import * as fs from "fs";
import * as path from "path";
import { withLock } from "./file-lock";

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
  ssgTrace?: { function: string; statesBefore: string[]; statesAfter: string[] }[];

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
  successfulAlternative?: any[];  // 最终成功的 action sequence
  totalRetries: number;
  resolved: boolean;
}

// 优先使用 PROGMUNE_PROJECT_DIR（由 MCP 服务器在调用时设置），确保多项目隔离
const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const CORPUS_DIR = process.env.PROGMUNE_CORPUS_DIR
  || path.resolve(projectDir, ".progmune_corpus");
const SESSIONS_DIR = path.join(CORPUS_DIR, "sessions");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

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
    try { seq = parseInt(fs.readFileSync(seqFile, 'utf-8'), 10); } catch {}
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

/** 记录一个完整的意图会话（成功或失败的所有尝试） */
export function recordSession(session: Omit<IntentSession, "sessionId">): string {
  ensureDir(SESSIONS_DIR);
  const sessionId = `sess_${Date.now()}`;
  const fullSession: IntentSession = { ...session, sessionId };
  fs.writeFileSync(
    path.join(SESSIONS_DIR, `${sessionId}.json`),
    JSON.stringify(fullSession, null, 2)
  );
  return sessionId;
}

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
        } catch {}
      }
    }
  }
  return records;
}

export function getFailuresBySVL(level: SVL): FailureRecord[] {
  return getAllFailures().filter(r => r.violatedSVL === level);
}

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
export function getFailureGenome(): {
  totalFailures: number;
  bySVL: Record<SVL, number>;
  byConstraintType: Record<string, number>;
  topPatterns: { pattern: string; count: number; examples: string[] }[];
  commonFixPaths: { violation: string; fixPath: string[]; count: number }[];
  averageRetriesToSuccess: number;
} {
  const all = getAllFailures();
  const bySVL: Record<SVL, number> = { "SVL-1": 0, "SVL-2": 0, "SVL-3": 0, "SVL-4": 0 };
  const byConstraint: Record<string, number> = {};

  // 修复路径统计
  const fixPathCounts = new Map<string, number>();
  let totalRetries = 0;

  for (const r of all) {
    bySVL[r.violatedSVL] = (bySVL[r.violatedSVL] || 0) + 1;
    byConstraint[r.constraintType] = (byConstraint[r.constraintType] || 0) + 1;
    totalRetries += r.plannerAttempt || 1;

    if (r.ssgFixPath && r.ssgFixPath.length > 0) {
      const key = `${r.violatedSVL}:${r.ssgFixPath.join('→')}`;
      fixPathCounts.set(key, (fixPathCounts.get(key) || 0) + 1);
    }
  }

  const commonFixPaths = [...fixPathCounts.entries()]
    .map(([key, count]) => {
      const [violation, ...rest] = key.split(':');
      return { violation, fixPath: rest.join(':').split('→'), count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalFailures: all.length,
    bySVL,
    byConstraintType: byConstraint,
    topPatterns: getTopFailurePatterns(5),
    commonFixPaths,
    averageRetriesToSuccess: all.length > 0 ? Math.round((totalRetries / all.length) * 10) / 10 : 0,
  };
}

/** 获取所有意图会话 */
export function getAllSessions(): IntentSession[] {
  const sessions: IntentSession[] = [];
  if (!fs.existsSync(SESSIONS_DIR)) return sessions;
  for (const file of fs.readdirSync(SESSIONS_DIR)) {
    if (file.endsWith(".json")) {
      try {
        sessions.push(JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8")));
      } catch {}
    }
  }
  return sessions;
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
      if (!a.ssgFixPath || a.ssgFixPath.length === 0) continue;
      const signature = `${a.violatedSVL}:${(a.ssgMissingFunctions || ["unknown"]).join(",")}`;
      const existing = agg.get(signature);
      if (existing) {
        existing.count++;
        existing.intents.add(s.intent);
        if (s.resolved) existing.resolvedCount++;
        if (s.timestamp > existing.lastSeen) existing.lastSeen = s.timestamp;
      } else {
        agg.set(signature, {
          violation: `${a.violatedSVL}: ${(a.ssgMissingFunctions || ["unknown"]).join(", ")}`,
          fixPath: a.ssgFixPath,
          count: 1,
          intents: new Set([s.intent]),
          resolvedCount: s.resolved ? 1 : 0,
          firstSeen: s.timestamp,
          lastSeen: s.timestamp,
        });
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

/** 语义热力图：哪些协议/层最脆弱，约束如何聚类 */
export function getSemanticHeatmap(): {
  fragileProtocols: { function: string; violationCount: number; svl: string }[];
  svlHotspots: { svl: string; count: number; percentage: number }[];
  constraintClusters: { constraints: string[]; count: number; intent: string }[];
  highFrictionIntents: { intent: string; adaptationCount: number; anomalyTypes: string[] }[];
} {
  const sessions = getAllSessions();
  const allFailures = getAllFailures();
  const total = allFailures.length || 1;

  // Fragile protocols: which functions are most frequently blocked
  const funcCounts = new Map<string, { count: number; svl: string }>();
  for (const r of allFailures) {
    const blockedMatch = r.errorDetail.match(/(\w+)\s*(要求|requires|blocked|不允许|不合法)/);
    const fn = blockedMatch ? blockedMatch[1] : (r.actionSequence?.[0]?.function || "unknown");
    const existing = funcCounts.get(fn);
    if (existing) {
      existing.count++;
    } else {
      funcCounts.set(fn, { count: 1, svl: r.violatedSVL });
    }
  }

  const fragileProtocols = [...funcCounts.entries()]
    .map(([fn, data]) => ({ function: fn, violationCount: data.count, svl: data.svl }))
    .sort((a, b) => b.violationCount - a.violationCount)
    .slice(0, 10);

  // SVL hotspots
  const svlHotspots: { svl: string; count: number; percentage: number }[] = [];
  const svlCounts: Record<string, number> = {};
  for (const r of allFailures) {
    svlCounts[r.violatedSVL] = (svlCounts[r.violatedSVL] || 0) + 1;
  }
  for (const [svl, count] of Object.entries(svlCounts)) {
    svlHotspots.push({ svl, count, percentage: Math.round((count / total) * 100) });
  }
  svlHotspots.sort((a, b) => b.count - a.count);

  // Constraint clusters: which anomaly types co-occur in the same session
  const constraintClusters: { constraints: string[]; count: number; intent: string }[] = [];
  for (const s of sessions) {
    if (s.attempts.length < 2) continue;
    const types = [...new Set(s.attempts.map(a => a.constraintType))].sort();
    if (types.length >= 2) {
      constraintClusters.push({ constraints: types, count: s.attempts.length, intent: s.intent });
    }
  }
  constraintClusters.sort((a, b) => b.count - a.count);

  // High friction intents: which tasks require the most adaptations
  const highFrictionIntents = sessions
    .map(s => ({
      intent: s.intent,
      adaptationCount: s.totalRetries,
      anomalyTypes: [...new Set(s.attempts.map(a => a.constraintType))],
    }))
    .sort((a, b) => b.adaptationCount - a.adaptationCount)
    .slice(0, 8);

  return { fragileProtocols, svlHotspots, constraintClusters, highFrictionIntents };
}

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
