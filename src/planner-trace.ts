/**
 * P3.2: Planner Trace — Ranking Decision Observability
 *
 * Records every ranking decision with full candidate list,
 * selected candidate, source attribution, and outcome.
 *
 * This enables answering questions like:
 *   - Why do users reject corpus suggestions more than protocol?
 *   - Which strategy performs best for AuthProtocol?
 *   - What features correlate with acceptance?
 *
 * These traces become the training features for the P4 Reward Model.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { RepairCandidate } from "./repair-types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface CandidateSnapshot {
  fingerprint: string;
  source: string;
  evidenceSources: string[];
  actions: string[];
  score: number;
  rank: number;
}

export interface PlannerTrace {
  traceId: string;
  timestamp: number;
  decisionId: string;
  goal: string;
  protocol: string;
  violationType?: string;
  candidates: CandidateSnapshot[];
  selectedFingerprint?: string;
  accepted?: boolean;
  /** Data quality verification signals. */
  executionSucceeded?: boolean;
  postValidationPassed?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Trace Store
// ═══════════════════════════════════════════════════════════════

const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const TRACE_DIR = path.resolve(projectDir, ".progmune_corpus", "traces");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class PlannerTraceStore {
  private traces: PlannerTrace[] = [];
  private persistPath: string;

  constructor(persistPath?: string) {
    this.persistPath = persistPath || path.join(TRACE_DIR, "traces.jsonl");
    this.load();
  }

  /** Record a ranking decision. */
  recordTrace(trace: Omit<PlannerTrace, "traceId" | "timestamp">): string {
    const traceId = `TR-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const record: PlannerTrace = { ...trace, traceId, timestamp: Date.now() };
    this.traces.push(record);
    this.append(record);
    return traceId;
  }

  /** Update outcome for a trace. */
  updateOutcome(traceId: string, updates: {
    accepted?: boolean;
    executionSucceeded?: boolean;
    postValidationPassed?: boolean;
  }): boolean {
    const t = this.traces.find(tr => tr.traceId === traceId);
    if (!t) return false;
    if (updates.accepted !== undefined) t.accepted = updates.accepted;
    if (updates.executionSucceeded !== undefined) t.executionSucceeded = updates.executionSucceeded;
    if (updates.postValidationPassed !== undefined) t.postValidationPassed = updates.postValidationPassed;
    return true;
  }

  // ── Analytics ──

  /** Acceptance rate by source. */
  getAcceptanceBySource(): Record<string, { total: number; accepted: number; rate: number }> {
    const stats: Record<string, { total: number; accepted: number }> = {};
    const withOutcome = this.traces.filter(t => t.accepted !== undefined);
    for (const t of withOutcome) {
      for (const c of t.candidates) {
        const src = c.source;
        if (!stats[src]) stats[src] = { total: 0, accepted: 0 };
        stats[src].total++;
        if (t.accepted && t.selectedFingerprint === c.fingerprint) stats[src].accepted++;
      }
    }
    return Object.fromEntries(
      Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }])
    );
  }

  /** Acceptance rate by protocol. */
  getAcceptanceByProtocol(): Record<string, { total: number; accepted: number; rate: number }> {
    const stats: Record<string, { total: number; accepted: number }> = {};
    const withOutcome = this.traces.filter(t => t.accepted !== undefined);
    for (const t of withOutcome) {
      const proto = t.protocol;
      if (!stats[proto]) stats[proto] = { total: 0, accepted: 0 };
      stats[proto].total++;
      if (t.accepted) stats[proto].accepted++;
    }
    return Object.fromEntries(
      Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }])
    );
  }

  /** Top rejected fingerprints. */
  getTopRejectedFingerprints(k: number = 10): { fingerprint: string; actions: string; source: string; rejections: number }[] {
    const rejected = this.traces.filter(t => t.accepted === false);
    const counts = new Map<string, { actions: string; source: string; count: number }>();
    for (const t of rejected) {
      if (!t.selectedFingerprint) continue;
      const sel = t.candidates.find(c => c.fingerprint === t.selectedFingerprint);
      if (!sel) continue;
      const fp = t.selectedFingerprint;
      const existing = counts.get(fp);
      if (existing) { existing.count++; }
      else { counts.set(fp, { actions: sel.actions.join("→"), source: sel.source, count: 1 }); }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, k)
      .map(([fingerprint, v]) => ({ fingerprint, actions: v.actions, source: v.source, rejections: v.count }));
  }

  /** Rank-1 vs accepted correlation. */
  getRank1AcceptanceRate(): number {
    const withOutcome = this.traces.filter(t => t.accepted !== undefined && t.candidates.length > 0);
    if (withOutcome.length === 0) return 0;
    const rank1Accepted = withOutcome.filter(
      t => t.accepted && t.selectedFingerprint === t.candidates[0]?.fingerprint
    ).length;
    return rank1Accepted / withOutcome.length;
  }

  get size(): number { return this.traces.length; }
  all(): readonly PlannerTrace[] { return this.traces; }

  // ── Persistence ──

  private append(record: PlannerTrace): void {
    try {
      ensureDir(path.dirname(this.persistPath));
      fs.appendFileSync(this.persistPath, JSON.stringify(record) + "\n");
    } catch { /* best-effort */ }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const lines = fs.readFileSync(this.persistPath, "utf-8").trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this.traces.push(JSON.parse(line)); } catch { /* skip */ }
      }
    } catch { /* start fresh */ }
  }
}

// ═══════════════════════════════════════════════════════════════
// Reward Signal Pre-collection (P4 pre-burial)
// ═══════════════════════════════════════════════════════════════

export interface RewardTuple {
  state: string;
  action: string;
  nextState: string;
  reward: number;
  timestamp: number;
}

const REWARD_DIR = path.resolve(projectDir, ".progmune_corpus", "rewards");

export function recordRewardTuple(tuple: Omit<RewardTuple, "timestamp">): void {
  const record: RewardTuple = { ...tuple, timestamp: Date.now() };
  try {
    ensureDir(REWARD_DIR);
    const date = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(
      path.join(REWARD_DIR, `${date}.jsonl`),
      JSON.stringify(record) + "\n"
    );
  } catch { /* best-effort */ }
}

export function loadRewardTuples(since?: string): RewardTuple[] {
  const results: RewardTuple[] = [];
  try {
    if (!fs.existsSync(REWARD_DIR)) return results;
    const files = fs.readdirSync(REWARD_DIR).filter(f => f.endsWith(".jsonl"));
    for (const file of files) {
      if (since && file < since) continue;
      const lines = fs.readFileSync(path.join(REWARD_DIR, file), "utf-8").trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try { results.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }
  } catch { /* start fresh */ }
  return results;
}
