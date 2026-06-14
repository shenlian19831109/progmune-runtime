"use strict";
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
exports.PlannerTraceStore = void 0;
exports.recordRewardTuple = recordRewardTuple;
exports.loadRewardTuples = loadRewardTuples;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// ═══════════════════════════════════════════════════════════════
// Trace Store
// ═══════════════════════════════════════════════════════════════
const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const TRACE_DIR = path.resolve(projectDir, ".progmune_corpus", "traces");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
class PlannerTraceStore {
    constructor(persistPath) {
        this.traces = [];
        this.persistPath = persistPath || path.join(TRACE_DIR, "traces.jsonl");
        this.load();
    }
    /** Record a ranking decision. */
    recordTrace(trace) {
        const traceId = `TR-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
        const record = { ...trace, traceId, timestamp: Date.now() };
        this.traces.push(record);
        this.append(record);
        return traceId;
    }
    /** Update outcome for a trace. */
    updateOutcome(traceId, updates) {
        const t = this.traces.find(tr => tr.traceId === traceId);
        if (!t)
            return false;
        if (updates.accepted !== undefined)
            t.accepted = updates.accepted;
        if (updates.executionSucceeded !== undefined)
            t.executionSucceeded = updates.executionSucceeded;
        if (updates.postValidationPassed !== undefined)
            t.postValidationPassed = updates.postValidationPassed;
        return true;
    }
    // ── Analytics ──
    /** Acceptance rate by source. */
    getAcceptanceBySource() {
        const stats = {};
        const withOutcome = this.traces.filter(t => t.accepted !== undefined);
        for (const t of withOutcome) {
            for (const c of t.candidates) {
                const src = c.source;
                if (!stats[src])
                    stats[src] = { total: 0, accepted: 0 };
                stats[src].total++;
                if (t.accepted && t.selectedFingerprint === c.fingerprint)
                    stats[src].accepted++;
            }
        }
        return Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }]));
    }
    /** Acceptance rate by protocol. */
    getAcceptanceByProtocol() {
        const stats = {};
        const withOutcome = this.traces.filter(t => t.accepted !== undefined);
        for (const t of withOutcome) {
            const proto = t.protocol;
            if (!stats[proto])
                stats[proto] = { total: 0, accepted: 0 };
            stats[proto].total++;
            if (t.accepted)
                stats[proto].accepted++;
        }
        return Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { ...v, rate: v.total > 0 ? v.accepted / v.total : 0 }]));
    }
    /** Top rejected fingerprints. */
    getTopRejectedFingerprints(k = 10) {
        const rejected = this.traces.filter(t => t.accepted === false);
        const counts = new Map();
        for (const t of rejected) {
            if (!t.selectedFingerprint)
                continue;
            const sel = t.candidates.find(c => c.fingerprint === t.selectedFingerprint);
            if (!sel)
                continue;
            const fp = t.selectedFingerprint;
            const existing = counts.get(fp);
            if (existing) {
                existing.count++;
            }
            else {
                counts.set(fp, { actions: sel.actions.join("→"), source: sel.source, count: 1 });
            }
        }
        return [...counts.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, k)
            .map(([fingerprint, v]) => ({ fingerprint, actions: v.actions, source: v.source, rejections: v.count }));
    }
    /** Rank-1 vs accepted correlation. */
    getRank1AcceptanceRate() {
        const withOutcome = this.traces.filter(t => t.accepted !== undefined && t.candidates.length > 0);
        if (withOutcome.length === 0)
            return 0;
        const rank1Accepted = withOutcome.filter(t => t.accepted && t.selectedFingerprint === t.candidates[0]?.fingerprint).length;
        return rank1Accepted / withOutcome.length;
    }
    get size() { return this.traces.length; }
    all() { return this.traces; }
    // ── Persistence ──
    append(record) {
        try {
            ensureDir(path.dirname(this.persistPath));
            fs.appendFileSync(this.persistPath, JSON.stringify(record) + "\n");
        }
        catch { /* best-effort */ }
    }
    load() {
        try {
            if (!fs.existsSync(this.persistPath))
                return;
            const lines = fs.readFileSync(this.persistPath, "utf-8").trim().split("\n");
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    this.traces.push(JSON.parse(line));
                }
                catch { /* skip */ }
            }
        }
        catch { /* start fresh */ }
    }
}
exports.PlannerTraceStore = PlannerTraceStore;
const REWARD_DIR = path.resolve(projectDir, ".progmune_corpus", "rewards");
function recordRewardTuple(tuple) {
    const record = { ...tuple, timestamp: Date.now() };
    try {
        ensureDir(REWARD_DIR);
        const date = new Date().toISOString().slice(0, 10);
        fs.appendFileSync(path.join(REWARD_DIR, `${date}.jsonl`), JSON.stringify(record) + "\n");
    }
    catch { /* best-effort */ }
}
function loadRewardTuples(since) {
    const results = [];
    try {
        if (!fs.existsSync(REWARD_DIR))
            return results;
        const files = fs.readdirSync(REWARD_DIR).filter(f => f.endsWith(".jsonl"));
        for (const file of files) {
            if (since && file < since)
                continue;
            const lines = fs.readFileSync(path.join(REWARD_DIR, file), "utf-8").trim().split("\n");
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    results.push(JSON.parse(line));
                }
                catch { /* skip */ }
            }
        }
    }
    catch { /* start fresh */ }
    return results;
}
