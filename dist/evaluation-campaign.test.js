"use strict";
/**
 * P3.9: Evaluation Campaign Tests
 *
 * Verifying:
 *   1. Failure attribution classifies benchmark misses correctly
 *   2. Error budget dashboard produces actionable breakdown
 *   3. Offline replay computes match rate against user choices
 *   4. Ranker A/B comparison produces delta
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
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const evaluation_campaign_1 = require("./evaluation-campaign");
const planner_telemetry_1 = require("./planner-telemetry");
const planner_trace_1 = require("./planner-trace");
// ═══════════════════════════════════════════════════════════════
// Failure Attribution
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Failure Attribution", () => {
    (0, vitest_1.it)("classifies all 49 benchmark cases", async () => {
        const attributed = await (0, evaluation_campaign_1.runFailureAttribution)();
        (0, vitest_1.expect)(attributed.length).toBeGreaterThanOrEqual(49);
        // Count by failure reason
        const counts = {};
        for (const a of attributed) {
            counts[a.failureReason] = (counts[a.failureReason] || 0) + 1;
        }
        // Should have at least some successes and some failures
        (0, vitest_1.expect)(counts["success"]).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(Object.keys(counts).length).toBeGreaterThanOrEqual(2);
        // Every attributed case has required fields
        for (const a of attributed) {
            (0, vitest_1.expect)(a.failureReason).toBeDefined();
            (0, vitest_1.expect)(a.expectedRepair.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(["success", "missing_candidate", "bad_ranking", "bad_protocol_model", "goal_mismatch", "insufficient_history"]).toContain(a.failureReason);
        }
    }, 60000);
    (0, vitest_1.it)("produces actionable error budget", async () => {
        const attributed = await (0, evaluation_campaign_1.runFailureAttribution)();
        const budget = (0, evaluation_campaign_1.computeErrorBudget)(attributed);
        (0, vitest_1.expect)(budget.totalCases).toBeGreaterThanOrEqual(49);
        (0, vitest_1.expect)(budget.successRate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(budget.successRate).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(budget.recommendation.length).toBeGreaterThan(0);
        // All failure reasons should sum to total
        const sum = Object.values(budget.breakdown).reduce((s, v) => s + v, 0);
        (0, vitest_1.expect)(sum).toBe(budget.totalCases);
        (0, evaluation_campaign_1.printErrorBudget)(budget);
    }, 60000);
});
// ═══════════════════════════════════════════════════════════════
// Offline Replay
// ═══════════════════════════════════════════════════════════════
const REPLAY_DIR = path.resolve(__dirname, "..", "test-evaluation-replay");
process.env.PROGMUNE_PROJECT_DIR = REPLAY_DIR;
fs.mkdirSync(REPLAY_DIR, { recursive: true });
fs.mkdirSync(path.join(REPLAY_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(REPLAY_DIR, ".progmune_corpus", "traces"), { recursive: true });
function seedReplayData() {
    const telemetry = new planner_telemetry_1.PlannerTelemetry(path.join(REPLAY_DIR, ".progmune_corpus", "telemetry", `replay-${Date.now()}.jsonl`));
    const traceStore = new planner_trace_1.PlannerTraceStore(path.join(REPLAY_DIR, ".progmune_corpus", "traces", `replay-${Date.now()}.jsonl`));
    // Seed: candidate A is safe (high acceptance), candidate B is fast (low acceptance)
    const fpA = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
    const fpB = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["atomic_write"], "resource_leak");
    // A accepted 80 times, B rejected 50 times
    for (let i = 0; i < 80; i++) {
        const id = telemetry.recordDecision({
            goal: "safely write file",
            protocol: "FileProtocol",
            violationType: "resource_leak",
            candidates: [
                { candidateId: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
                { candidateId: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], explanation: "fast" },
            ],
            selectedCandidateId: fpA,
        });
        telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
    }
    for (let i = 0; i < 50; i++) {
        const id = telemetry.recordDecision({
            goal: "quick write",
            protocol: "FileProtocol",
            violationType: "resource_leak",
            candidates: [
                { candidateId: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
                { candidateId: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], explanation: "fast" },
            ],
            selectedCandidateId: fpB,
        });
        telemetry.recordFeedback(id, { decision: "rejected", timestamp: Date.now() });
    }
    // Create traces where user chose A over B (original ranker put B first, user chose A)
    for (let i = 0; i < 20; i++) {
        traceStore.recordTrace({
            decisionId: `pd-replay-${i}`,
            goal: "safely write config file",
            protocol: "FileProtocol",
            violationType: "resource_leak",
            candidates: [
                { fingerprint: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], score: 0.73, rank: 1 },
                { fingerprint: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], score: 0.68, rank: 2 },
            ],
            selectedFingerprint: fpA, // user chose A even though B was rank-1
            accepted: true,
        });
    }
    // Traces where user chose rank-1
    for (let i = 20; i < 30; i++) {
        traceStore.recordTrace({
            decisionId: `pd-replay-${i}`,
            goal: "safely write config file",
            protocol: "FileProtocol",
            violationType: "resource_leak",
            candidates: [
                { fingerprint: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], score: 0.81, rank: 1 },
                { fingerprint: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], score: 0.73, rank: 2 },
            ],
            selectedFingerprint: fpA,
            accepted: true,
        });
    }
    return { telemetry, traceStore };
}
(0, vitest_1.describe)("Offline Replay", () => {
    (0, vitest_1.it)("replays decisions and computes match rate", () => {
        const { telemetry, traceStore } = seedReplayData();
        const report = (0, evaluation_campaign_1.replayDecisions)(traceStore, telemetry);
        (0, vitest_1.expect)(report.totalDecisions).toBeGreaterThanOrEqual(30);
        (0, vitest_1.expect)(report.matchRate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.matchRate).toBeLessThanOrEqual(1);
        // LearningRanker should match > 80% (A has 80 accepts vs B has 50 rejects)
        (0, vitest_1.expect)(report.matchRate).toBeGreaterThan(0.8);
        (0, evaluation_campaign_1.printReplayReport)(report);
    });
    (0, vitest_1.it)("compares rankers and shows delta", () => {
        const { telemetry, traceStore } = seedReplayData();
        const { baseline, learning, delta } = (0, evaluation_campaign_1.compareRankers)(traceStore, telemetry);
        (0, vitest_1.expect)(baseline.totalDecisions).toBeGreaterThanOrEqual(30);
        (0, vitest_1.expect)(learning.totalDecisions).toBeGreaterThanOrEqual(30);
        (0, vitest_1.expect)(delta).toBeGreaterThan(0); // LearningRanker outperforms baseline
        // Baseline (rank-1 = what planner showed first): B was rank-1 in 20/30 traces
        // but user chose A. So baseline matches only when A was rank-1 (10/30 ≈ 33%)
        (0, vitest_1.expect)(baseline.matchRate).toBeLessThan(learning.matchRate);
        (0, evaluation_campaign_1.printRankerComparison)(baseline, learning, delta);
    });
});
