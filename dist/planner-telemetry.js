"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerTelemetry = void 0;
exports.candidateFingerprint = candidateFingerprint;
exports.fingerprintFromCandidate = fingerprintFromCandidate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// ═══════════════════════════════════════════════════════════════
// Fingerprint v2
// ═══════════════════════════════════════════════════════════════
/**
 * Stable fingerprint: protocol + violationType + normalized action sequence.
 * Cross-protocol collision avoided by including protocol namespace.
 */
function candidateFingerprint(protocol, actions, violationType) {
    const normalized = [...actions].sort().join("→");
    const payload = `${protocol}:${violationType || "none"}:${normalized}`;
    return crypto.createHash("sha1").update(payload).digest("hex").slice(0, 16);
}
/** Convenience: fingerprint from a RepairCandidate + protocol context. */
function fingerprintFromCandidate(candidate, protocol, violationType) {
    const actions = candidate.actions
        .filter(a => a.kind === "call")
        .map(a => a.function);
    return candidateFingerprint(protocol, actions, violationType);
}
function emptyStats() {
    return { accepted: 0, rejected: 0, executionSuccess: 0, executionFailure: 0, totalLatency: 0, latencySamples: 0 };
}
// ═══════════════════════════════════════════════════════════════
// TelemetryIndex — O(1) stats lookup
// ═══════════════════════════════════════════════════════════════
class TelemetryIndex {
    constructor() {
        this.stats = new Map();
    }
    get(fp) {
        return this.stats.get(fp) || emptyStats();
    }
    recordAccepted(fp, executionSuccess, latencyMs) {
        const s = this.getOrCreate(fp);
        s.accepted++;
        if (executionSuccess === true)
            s.executionSuccess++;
        else if (executionSuccess === false)
            s.executionFailure++;
        if (latencyMs !== undefined) {
            s.totalLatency += latencyMs;
            s.latencySamples++;
            s.avgLatency = s.totalLatency / s.latencySamples;
        }
    }
    recordRejected(fp) {
        const s = this.getOrCreate(fp);
        s.rejected++;
    }
    getAcceptanceRate(fp, minSamples = 5) {
        const s = this.stats.get(fp);
        if (!s)
            return 0.5; // prior
        const total = s.accepted + s.rejected;
        if (total < minSamples)
            return 0.5;
        return s.accepted / total;
    }
    /**
     * Effective reward: balances acceptance with actual execution success.
     *   accepted ≠ good. 50% acceptance + 50% execution success.
     *   Prevents the system from learning to prefer fast-but-leaky repairs.
     */
    getEffectiveReward(fp, minSamples = 5) {
        const s = this.stats.get(fp);
        if (!s)
            return 0.5;
        const total = s.accepted + s.rejected;
        if (total < minSamples)
            return 0.5;
        const acceptanceRate = s.accepted / total;
        const execTotal = s.executionSuccess + s.executionFailure;
        const executionRate = execTotal > 0 ? s.executionSuccess / execTotal : 0.5;
        return 0.5 * acceptanceRate + 0.5 * executionRate;
    }
    allStats() {
        return new Map(this.stats);
    }
    getOrCreate(fp) {
        if (!this.stats.has(fp))
            this.stats.set(fp, emptyStats());
        return this.stats.get(fp);
    }
}
// ═══════════════════════════════════════════════════════════════
// PlannerTelemetry (v2)
// ═══════════════════════════════════════════════════════════════
const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const TELEMETRY_DIR = path.resolve(projectDir, ".progmune_corpus", "telemetry");
const LIFECYCLE_DIR = path.resolve(projectDir, ".progmune_corpus", "lifecycles");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
class PlannerTelemetry {
    constructor(persistPath) {
        this.events = [];
        this.lifecycles = [];
        this.index = new TelemetryIndex();
        this.persistPath = persistPath || path.join(TELEMETRY_DIR, "decisions.jsonl");
        this.lifecyclePath = path.join(LIFECYCLE_DIR, "lifecycles.jsonl");
        this.load();
        this.rebuildIndex();
    }
    // ── Recording ──
    recordDecision(decision) {
        const id = `PD-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
        const record = { ...decision, id, timestamp: Date.now() };
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
    recordFeedback(decisionId, feedback) {
        const event = this.events.find(e => e.id === decisionId);
        if (!event)
            return false;
        event.feedback = feedback;
        // Update TelemetryIndex
        const fp = event.selectedCandidateId;
        if (fp) {
            if (feedback.decision === "accepted") {
                this.index.recordAccepted(fp, feedback.executionResult?.success, event.cost?.latencyMs);
            }
            else if (feedback.decision === "rejected") {
                this.index.recordRejected(fp);
            }
            // "modified" — counted as neither accepted nor rejected for now
        }
        // Update lifecycle
        const lc = this.lifecycles.find(l => l.candidateFingerprint === fp && !l.acceptedAt);
        if (lc) {
            lc.acceptedAt = feedback.timestamp;
            lc.userReason = feedback.userReason;
            this.appendLifecycle(lc);
        }
        this.appendToFile(event);
        return true;
    }
    recordExecutionResult(decisionId, success, violations = [], latencyMs) {
        const event = this.events.find(e => e.id === decisionId);
        if (!event)
            return false;
        if (!event.feedback) {
            event.feedback = { decision: "accepted", timestamp: Date.now() };
        }
        event.feedback.executionResult = { success, violations };
        if (latencyMs !== undefined && !event.cost)
            event.cost = {};
        if (latencyMs !== undefined && event.cost)
            event.cost.latencyMs = latencyMs;
        // Update stats with execution result
        const fp = event.selectedCandidateId;
        if (fp) {
            this.index.recordAccepted(fp, success, latencyMs);
        }
        // Update lifecycle
        const lc = this.lifecycles.find(l => l.candidateFingerprint === fp && l.executionSucceeded === undefined);
        if (lc) {
            lc.executedAt = Date.now();
            lc.executionSucceeded = success;
            if (latencyMs !== undefined)
                lc.executionLatencyMs = latencyMs;
            this.appendLifecycle(lc);
        }
        this.appendToFile(event);
        return true;
    }
    // ── Querying (O(1) via TelemetryIndex) ──
    /** Acceptance rate for a specific candidate fingerprint. */
    getCandidateAcceptance(fp, minSamples = 5) {
        return this.index.getAcceptanceRate(fp, minSamples);
    }
    /** Effective reward: 50% acceptance + 50% execution success. */
    getCandidateReward(fp, minSamples = 5) {
        return this.index.getEffectiveReward(fp, minSamples);
    }
    /** Full stats for a candidate fingerprint. */
    getCandidateStats(fp) {
        return this.index.get(fp);
    }
    getAllCandidateStats() {
        return this.index.allStats();
    }
    /** Overall acceptance rate. */
    getAcceptanceRate() {
        const withFeedback = this.events.filter(e => e.feedback);
        if (withFeedback.length === 0)
            return 0;
        const accepted = withFeedback.filter(e => e.feedback.decision === "accepted");
        return accepted.length / withFeedback.length;
    }
    getAcceptanceBySource() {
        const stats = {};
        for (const e of this.events) {
            if (!e.feedback)
                continue;
            for (const c of e.candidates) {
                const src = c.source;
                if (!stats[src])
                    stats[src] = { total: 0, accepted: 0 };
                stats[src].total++;
                if (e.feedback.decision === "accepted" && e.selectedCandidateId === c.candidateId) {
                    stats[src].accepted++;
                }
            }
        }
        return Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }]));
    }
    getAcceptanceByProtocol() {
        const stats = {};
        for (const e of this.events) {
            if (!e.feedback)
                continue;
            const proto = e.protocol;
            if (!stats[proto])
                stats[proto] = { total: 0, accepted: 0 };
            stats[proto].total++;
            if (e.feedback.decision === "accepted")
                stats[proto].accepted++;
        }
        return Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }]));
    }
    getAcceptanceByGoal() {
        const stats = {};
        for (const e of this.events) {
            if (!e.feedback)
                continue;
            const goal = e.goal;
            if (!stats[goal])
                stats[goal] = { total: 0, accepted: 0 };
            stats[goal].total++;
            if (e.feedback.decision === "accepted")
                stats[goal].accepted++;
        }
        return Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }]));
    }
    getTopAcceptedRepairs(k = 5) {
        const accepted = this.events.filter(e => e.feedback?.decision === "accepted" && e.selectedCandidateId);
        const counts = new Map();
        for (const e of accepted) {
            const sel = e.candidates.find(c => c.candidateId === e.selectedCandidateId);
            if (!sel)
                continue;
            const key = sel.actions.join("→");
            const existing = counts.get(key);
            if (existing) {
                existing.count++;
            }
            else {
                counts.set(key, { count: 1, goal: e.goal });
            }
        }
        const total = accepted.length;
        return [...counts.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, k)
            .map(([actions, v]) => ({ actions, count: v.count, goal: v.goal, rate: total > 0 ? v.count / total : 0 }));
    }
    getTopRejectedRepairs(k = 5) {
        const rejected = this.events.filter(e => e.feedback?.decision === "rejected" && e.selectedCandidateId);
        const counts = new Map();
        for (const e of rejected) {
            const sel = e.candidates.find(c => c.candidateId === e.selectedCandidateId);
            if (!sel)
                continue;
            const key = sel.actions.join("→");
            const existing = counts.get(key);
            if (existing) {
                existing.count++;
            }
            else {
                counts.set(key, { count: 1, goal: e.goal });
            }
        }
        const total = rejected.length;
        return [...counts.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, k)
            .map(([actions, v]) => ({ actions, count: v.count, goal: v.goal, rate: total > 0 ? v.count / total : 0 }));
    }
    /** Summary stats for KPI dashboards. */
    getSummaryStats() {
        const withFb = this.events.filter(e => e.feedback);
        return {
            totalDecisions: this.events.length,
            withFeedback: withFb.length,
            accepted: withFb.filter(e => e.feedback.decision === "accepted").length,
            rejected: withFb.filter(e => e.feedback.decision === "rejected").length,
            modified: withFb.filter(e => e.feedback.decision === "modified").length,
        };
    }
    get size() { return this.events.length; }
    get withFeedback() { return this.events.filter(e => e.feedback).length; }
    all() { return this.events; }
    allLifecycles() { return this.lifecycles; }
    // ── Persistence ──
    appendToFile(record) {
        try {
            ensureDir(path.dirname(this.persistPath));
            fs.appendFileSync(this.persistPath, JSON.stringify(record) + "\n");
        }
        catch { /* best-effort */ }
    }
    appendLifecycle(lc) {
        try {
            ensureDir(path.dirname(this.lifecyclePath));
            fs.appendFileSync(this.lifecyclePath, JSON.stringify(lc) + "\n");
        }
        catch { /* best-effort */ }
    }
    load() {
        try {
            if (fs.existsSync(this.persistPath)) {
                const lines = fs.readFileSync(this.persistPath, "utf-8").trim().split("\n");
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        this.events.push(JSON.parse(line));
                    }
                    catch { /* skip */ }
                }
            }
            if (fs.existsSync(this.lifecyclePath)) {
                const lines = fs.readFileSync(this.lifecyclePath, "utf-8").trim().split("\n");
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        this.lifecycles.push(JSON.parse(line));
                    }
                    catch { /* skip */ }
                }
            }
        }
        catch { /* start fresh */ }
    }
    rebuildIndex() {
        for (const e of this.events) {
            if (!e.feedback || !e.selectedCandidateId)
                continue;
            const fp = e.selectedCandidateId;
            if (e.feedback.decision === "accepted") {
                this.index.recordAccepted(fp, e.feedback.executionResult?.success, e.cost?.latencyMs);
            }
            else if (e.feedback.decision === "rejected") {
                this.index.recordRejected(fp);
            }
        }
    }
}
exports.PlannerTelemetry = PlannerTelemetry;
