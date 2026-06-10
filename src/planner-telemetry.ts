/**
 * P2.6: Planner Telemetry Layer (v2)
 *
 * Upgrades from P2.5:
 *   - Fingerprint v2: protocol + violationType + actions hash
 *   - RepairFeedback v2: decision (accepted|rejected|modified) + executionResult
 *   - RepairLifecycle: proposed → accepted → executed → success chain (RLHF data pipeline)
 *   - TelemetryIndex: O(1) CandidateStats lookup via Map
 *   - CandidateStats: accepted, rejected, executionSuccess, executionFailure, avgLatency
 *
 * This turns telemetry from a log into a training dataset for P4 Reward Model.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { RepairCandidate } from "./repair-types";

// ═══════════════════════════════════════════════════════════════
// Fingerprint v2
// ═══════════════════════════════════════════════════════════════

/**
 * Stable fingerprint: protocol + violationType + normalized action sequence.
 * Cross-protocol collision avoided by including protocol namespace.
 */
export function candidateFingerprint(
  protocol: string,
  actions: string[],
  violationType?: string
): string {
  const normalized = [...actions].sort().join("→");
  const payload = `${protocol}:${violationType || "none"}:${normalized}`;
  return crypto.createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

/** Convenience: fingerprint from a RepairCandidate + protocol context. */
export function fingerprintFromCandidate(
  candidate: RepairCandidate,
  protocol: string,
  violationType?: string
): string {
  const actions = candidate.actions
    .filter(a => a.kind === "call")
    .map(a => (a as { function: string }).function);
  return candidateFingerprint(protocol, actions, violationType);
}

// ═══════════════════════════════════════════════════════════════
// RepairFeedback v2
// ═══════════════════════════════════════════════════════════════

export interface RepairFeedback {
  /** What did the user/system decide? */
  decision: "accepted" | "rejected" | "modified";
  /** Did the repair actually execute successfully? */
  executionResult?: {
    success: boolean;
    violations: string[];
  };
  /** Optional user explanation (future text analysis). */
  userReason?: string;
  /** Epoch ms when feedback was recorded. */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// RepairLifecycle — the RLHF data pipeline
// ═══════════════════════════════════════════════════════════════

export interface RepairLifecycle {
  candidateFingerprint: string;
  goal?: string;
  proposedAt: number;
  acceptedAt?: number;
  executedAt?: number;
  executionSucceeded?: boolean;
  executionLatencyMs?: number;
  userReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// CandidateStats
// ═══════════════════════════════════════════════════════════════

export interface CandidateStats {
  accepted: number;
  rejected: number;
  executionSuccess: number;
  executionFailure: number;
  avgLatency?: number;
  totalLatency: number;
  latencySamples: number;
}

function emptyStats(): CandidateStats {
  return { accepted: 0, rejected: 0, executionSuccess: 0, executionFailure: 0, totalLatency: 0, latencySamples: 0 };
}

// ═══════════════════════════════════════════════════════════════
// PlannerDecision (v2 compatible)
// ═══════════════════════════════════════════════════════════════

export interface PlannerDecision {
  id: string;
  timestamp: number;
  goal: string;
  protocol: string;
  violationType?: string;
  candidates: {
    candidateId: string;
    source: string;
    evidenceSources: string[];
    actions: string[];
    explanation: string;
  }[];
  selectedCandidateId?: string;
  feedback?: RepairFeedback;
  cost?: { latencyMs?: number; actionCount?: number };
}

// ═══════════════════════════════════════════════════════════════
// TelemetryIndex — O(1) stats lookup
// ═══════════════════════════════════════════════════════════════

class TelemetryIndex {
  private stats = new Map<string, CandidateStats>();

  get(fp: string): CandidateStats {
    return this.stats.get(fp) || emptyStats();
  }

  recordAccepted(fp: string, executionSuccess?: boolean, latencyMs?: number): void {
    const s = this.getOrCreate(fp);
    s.accepted++;
    if (executionSuccess === true) s.executionSuccess++;
    else if (executionSuccess === false) s.executionFailure++;
    if (latencyMs !== undefined) {
      s.totalLatency += latencyMs;
      s.latencySamples++;
      s.avgLatency = s.totalLatency / s.latencySamples;
    }
  }

  recordRejected(fp: string): void {
    const s = this.getOrCreate(fp);
    s.rejected++;
  }

  getAcceptanceRate(fp: string, minSamples: number = 5): number {
    const s = this.stats.get(fp);
    if (!s) return 0.5; // prior
    const total = s.accepted + s.rejected;
    if (total < minSamples) return 0.5;
    return s.accepted / total;
  }

  /**
   * Effective reward: balances acceptance with actual execution success.
   *   accepted ≠ good. 50% acceptance + 50% execution success.
   *   Prevents the system from learning to prefer fast-but-leaky repairs.
   */
  getEffectiveReward(fp: string, minSamples: number = 5): number {
    const s = this.stats.get(fp);
    if (!s) return 0.5;
    const total = s.accepted + s.rejected;
    if (total < minSamples) return 0.5;
    const acceptanceRate = s.accepted / total;
    const execTotal = s.executionSuccess + s.executionFailure;
    const executionRate = execTotal > 0 ? s.executionSuccess / execTotal : 0.5;
    return 0.5 * acceptanceRate + 0.5 * executionRate;
  }

  allStats(): Map<string, CandidateStats> {
    return new Map(this.stats);
  }

  private getOrCreate(fp: string): CandidateStats {
    if (!this.stats.has(fp)) this.stats.set(fp, emptyStats());
    return this.stats.get(fp)!;
  }
}

// ═══════════════════════════════════════════════════════════════
// PlannerTelemetry (v2)
// ═══════════════════════════════════════════════════════════════

const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const TELEMETRY_DIR = path.resolve(projectDir, ".progmune_corpus", "telemetry");
const LIFECYCLE_DIR = path.resolve(projectDir, ".progmune_corpus", "lifecycles");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class PlannerTelemetry {
  private events: PlannerDecision[] = [];
  private lifecycles: RepairLifecycle[] = [];
  private index = new TelemetryIndex();
  private persistPath: string;
  private lifecyclePath: string;

  constructor(persistPath?: string) {
    this.persistPath = persistPath || path.join(TELEMETRY_DIR, "decisions.jsonl");
    this.lifecyclePath = path.join(LIFECYCLE_DIR, "lifecycles.jsonl");
    this.load();
    this.rebuildIndex();
  }

  // ── Recording ──

  recordDecision(decision: Omit<PlannerDecision, "id" | "timestamp">): string {
    const id = `PD-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const record: PlannerDecision = { ...decision, id, timestamp: Date.now() };
    this.events.push(record);

    // Record lifecycle: proposed
    if (decision.selectedCandidateId) {
      const sel = decision.candidates.find(c => c.candidateId === decision.selectedCandidateId);
      if (sel) {
        this.lifecycles.push({
          candidateFingerprint: sel.candidateId,
          goal: decision.goal,
          proposedAt: record.timestamp,
        });
      }
    }

    return id;
  }

  recordFeedback(decisionId: string, feedback: RepairFeedback): boolean {
    const event = this.events.find(e => e.id === decisionId);
    if (!event) return false;
    event.feedback = feedback;

    // Update TelemetryIndex
    const fp = event.selectedCandidateId;
    if (fp) {
      if (feedback.decision === "accepted") {
        this.index.recordAccepted(fp, feedback.executionResult?.success, event.cost?.latencyMs);
      } else if (feedback.decision === "rejected") {
        this.index.recordRejected(fp);
      }
      // "modified" — counted as neither accepted nor rejected for now
    }

    // Update lifecycle
    const lc = this.lifecycles.find(
      l => l.candidateFingerprint === fp && !l.acceptedAt
    );
    if (lc) {
      lc.acceptedAt = feedback.timestamp;
      lc.userReason = feedback.userReason;
      this.appendLifecycle(lc);
    }

    this.appendToFile(event);
    return true;
  }

  recordExecutionResult(decisionId: string, success: boolean, violations: string[] = [], latencyMs?: number): boolean {
    const event = this.events.find(e => e.id === decisionId);
    if (!event) return false;

    if (!event.feedback) {
      event.feedback = { decision: "accepted", timestamp: Date.now() };
    }
    event.feedback.executionResult = { success, violations };
    if (latencyMs !== undefined && !event.cost) event.cost = {};
    if (latencyMs !== undefined && event.cost) event.cost.latencyMs = latencyMs;

    // Update stats with execution result
    const fp = event.selectedCandidateId;
    if (fp) {
      this.index.recordAccepted(fp, success, latencyMs);
    }

    // Update lifecycle
    const lc = this.lifecycles.find(
      l => l.candidateFingerprint === fp && l.executionSucceeded === undefined
    );
    if (lc) {
      lc.executedAt = Date.now();
      lc.executionSucceeded = success;
      if (latencyMs !== undefined) lc.executionLatencyMs = latencyMs;
      this.appendLifecycle(lc);
    }

    this.appendToFile(event);
    return true;
  }

  // ── Querying (O(1) via TelemetryIndex) ──

  /** Acceptance rate for a specific candidate fingerprint. */
  getCandidateAcceptance(fp: string, minSamples: number = 5): number {
    return this.index.getAcceptanceRate(fp, minSamples);
  }

  /** Effective reward: 50% acceptance + 50% execution success. */
  getCandidateReward(fp: string, minSamples: number = 5): number {
    return this.index.getEffectiveReward(fp, minSamples);
  }

  /** Full stats for a candidate fingerprint. */
  getCandidateStats(fp: string): CandidateStats {
    return this.index.get(fp);
  }

  getAllCandidateStats(): Map<string, CandidateStats> {
    return this.index.allStats();
  }

  /** Overall acceptance rate. */
  getAcceptanceRate(): number {
    const withFeedback = this.events.filter(e => e.feedback);
    if (withFeedback.length === 0) return 0;
    const accepted = withFeedback.filter(
      e => e.feedback!.decision === "accepted"
    );
    return accepted.length / withFeedback.length;
  }

  getAcceptanceBySource(): Record<string, { total: number; accepted: number; rate: number }> {
    const stats: Record<string, { total: number; accepted: number }> = {};
    for (const e of this.events) {
      if (!e.feedback) continue;
      for (const c of e.candidates) {
        const src = c.source;
        if (!stats[src]) stats[src] = { total: 0, accepted: 0 };
        stats[src].total++;
        if (e.feedback.decision === "accepted" && e.selectedCandidateId === c.candidateId) {
          stats[src].accepted++;
        }
      }
    }
    return Object.fromEntries(
      Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }])
    );
  }

  getAcceptanceByProtocol(): Record<string, { total: number; accepted: number; rate: number }> {
    const stats: Record<string, { total: number; accepted: number }> = {};
    for (const e of this.events) {
      if (!e.feedback) continue;
      const proto = e.protocol;
      if (!stats[proto]) stats[proto] = { total: 0, accepted: 0 };
      stats[proto].total++;
      if (e.feedback.decision === "accepted") stats[proto].accepted++;
    }
    return Object.fromEntries(
      Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }])
    );
  }

  getAcceptanceByGoal(): Record<string, { total: number; accepted: number; rate: number }> {
    const stats: Record<string, { total: number; accepted: number }> = {};
    for (const e of this.events) {
      if (!e.feedback) continue;
      const goal = e.goal;
      if (!stats[goal]) stats[goal] = { total: 0, accepted: 0 };
      stats[goal].total++;
      if (e.feedback.decision === "accepted") stats[goal].accepted++;
    }
    return Object.fromEntries(
      Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }])
    );
  }

  getTopAcceptedRepairs(k: number = 5): { actions: string; count: number; goal: string; rate: number }[] {
    const accepted = this.events.filter(
      e => e.feedback?.decision === "accepted" && e.selectedCandidateId
    );
    const counts = new Map<string, { count: number; goal: string }>();
    for (const e of accepted) {
      const sel = e.candidates.find(c => c.candidateId === e.selectedCandidateId);
      if (!sel) continue;
      const key = sel.actions.join("→");
      const existing = counts.get(key);
      if (existing) { existing.count++; } else { counts.set(key, { count: 1, goal: e.goal }); }
    }
    const total = accepted.length;
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, k)
      .map(([actions, v]) => ({ actions, count: v.count, goal: v.goal, rate: total > 0 ? v.count / total : 0 }));
  }

  getTopRejectedRepairs(k: number = 5): { actions: string; count: number; goal: string; rate: number }[] {
    const rejected = this.events.filter(
      e => e.feedback?.decision === "rejected" && e.selectedCandidateId
    );
    const counts = new Map<string, { count: number; goal: string }>();
    for (const e of rejected) {
      const sel = e.candidates.find(c => c.candidateId === e.selectedCandidateId);
      if (!sel) continue;
      const key = sel.actions.join("→");
      const existing = counts.get(key);
      if (existing) { existing.count++; } else { counts.set(key, { count: 1, goal: e.goal }); }
    }
    const total = rejected.length;
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, k)
      .map(([actions, v]) => ({ actions, count: v.count, goal: v.goal, rate: total > 0 ? v.count / total : 0 }));
  }

  /** Summary stats for KPI dashboards. */
  getSummaryStats(): { totalDecisions: number; withFeedback: number; accepted: number; rejected: number; modified: number } {
    const withFb = this.events.filter(e => e.feedback);
    return {
      totalDecisions: this.events.length,
      withFeedback: withFb.length,
      accepted: withFb.filter(e => e.feedback!.decision === "accepted").length,
      rejected: withFb.filter(e => e.feedback!.decision === "rejected").length,
      modified: withFb.filter(e => e.feedback!.decision === "modified").length,
    };
  }

  get size(): number { return this.events.length; }
  get withFeedback(): number { return this.events.filter(e => e.feedback).length; }
  all(): readonly PlannerDecision[] { return this.events; }
  allLifecycles(): readonly RepairLifecycle[] { return this.lifecycles; }

  // ── Persistence ──

  private appendToFile(record: PlannerDecision): void {
    try {
      ensureDir(path.dirname(this.persistPath));
      fs.appendFileSync(this.persistPath, JSON.stringify(record) + "\n");
    } catch { /* best-effort */ }
  }

  private appendLifecycle(lc: RepairLifecycle): void {
    try {
      ensureDir(path.dirname(this.lifecyclePath));
      fs.appendFileSync(this.lifecyclePath, JSON.stringify(lc) + "\n");
    } catch { /* best-effort */ }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.persistPath)) {
        const lines = fs.readFileSync(this.persistPath, "utf-8").trim().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try { this.events.push(JSON.parse(line)); } catch { /* skip */ }
        }
      }
      if (fs.existsSync(this.lifecyclePath)) {
        const lines = fs.readFileSync(this.lifecyclePath, "utf-8").trim().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try { this.lifecycles.push(JSON.parse(line)); } catch { /* skip */ }
        }
      }
    } catch { /* start fresh */ }
  }

  private rebuildIndex(): void {
    for (const e of this.events) {
      if (!e.feedback || !e.selectedCandidateId) continue;
      const fp = e.selectedCandidateId;
      if (e.feedback.decision === "accepted") {
        this.index.recordAccepted(fp, e.feedback.executionResult?.success, e.cost?.latencyMs);
      } else if (e.feedback.decision === "rejected") {
        this.index.recordRejected(fp);
      }
    }
  }
}
