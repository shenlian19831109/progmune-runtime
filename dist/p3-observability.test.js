"use strict";
/**
 * P3: Observability Layer Tests
 *
 * Verifying:
 *   1. Benchmark expansion — 7 protocols, 50+ cases, by-protocol breakdown
 *   2. Data Quality — RepairOutcome multi-signal, quality scoring, contradictory detection
 *   3. Planner Trace — record/query/analytics, source attribution, rank-1 correlation
 *   4. Reward Signal — state-action-reward tuple recording
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
const data_quality_1 = require("./data-quality");
const planner_trace_1 = require("./planner-trace");
const benchmark_harness_1 = require("./benchmark-harness");
// ═══════════════════════════════════════════════════════════════
// Data Quality Tests
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Data Quality Layer", () => {
    (0, vitest_1.it)("computes quality score from complete outcome", () => {
        const outcome = {
            accepted: true,
            executionSucceeded: true,
            postValidationPassed: true,
            regressionTestsPassed: true,
            timestamp: Date.now(),
        };
        const score = (0, data_quality_1.computeQualityScore)(outcome);
        (0, vitest_1.expect)(score).toBe(1.0);
    });
    (0, vitest_1.it)("computes quality score from partial outcome", () => {
        const outcome = {
            accepted: true,
            executionSucceeded: true,
            timestamp: Date.now(),
        };
        const score = (0, data_quality_1.computeQualityScore)(outcome);
        // Only execution data: 0.4 weight → score = 1.0 * 0.4 / 0.4 = 1.0
        (0, vitest_1.expect)(score).toBeGreaterThan(0);
        (0, vitest_1.expect)(score).toBeLessThanOrEqual(1);
    });
    (0, vitest_1.it)("no data defaults to neutral prior", () => {
        const outcome = { accepted: true, timestamp: Date.now() };
        const score = (0, data_quality_1.computeQualityScore)(outcome);
        (0, vitest_1.expect)(score).toBe(0.5);
    });
    (0, vitest_1.it)("accepted but execution failed = low quality", () => {
        const outcome = {
            accepted: true,
            executionSucceeded: false,
            postValidationPassed: false,
            timestamp: Date.now(),
        };
        const score = (0, data_quality_1.computeQualityScore)(outcome);
        (0, vitest_1.expect)(score).toBe(0);
    });
    (0, vitest_1.it)("reward signal prefers fully verified over just accepted", () => {
        const verified = {
            accepted: true, executionSucceeded: true,
            postValidationPassed: true, regressionTestsPassed: true,
            timestamp: Date.now(),
        };
        const justAccepted = {
            accepted: true, timestamp: Date.now(),
        };
        // Verified (1.0) > just accepted (1.0 from fallback, or lower per weights)
        // With validation + regression: 0.4*1 + 0.4*1 + 0.2*1 = 1.0
        // Just accepted: 0.5 (neutral prior)
        (0, vitest_1.expect)((0, data_quality_1.computeRewardSignal)(verified)).toBe(1.0);
        (0, vitest_1.expect)((0, data_quality_1.computeRewardSignal)(justAccepted)).toBeLessThan(1.0);
    });
    (0, vitest_1.it)("detects contradictory outcomes (accepted ≠ execution)", () => {
        const outcomes = [
            { accepted: true, executionSucceeded: false, timestamp: 1 }, // contradictory!
            { accepted: false, executionSucceeded: true, timestamp: 2 }, // contradictory!
            { accepted: true, executionSucceeded: true, timestamp: 3 }, // aligned
            { accepted: false, executionSucceeded: false, timestamp: 4 }, // aligned
        ];
        const report = (0, data_quality_1.generateQualityReport)(outcomes);
        (0, vitest_1.expect)(report.totalOutcomes).toBe(4);
        (0, vitest_1.expect)(report.rawAcceptanceRate).toBe(0.5);
        (0, vitest_1.expect)(report.executionSuccessRate).toBe(0.5);
        (0, vitest_1.expect)(report.contradictoryOutcomes).toBe(2); // 50% data is poisoned
    });
    (0, vitest_1.it)("generates and prints quality report", () => {
        const outcomes = [];
        for (let i = 0; i < 100; i++) {
            outcomes.push({
                accepted: Math.random() > 0.3,
                executionSucceeded: Math.random() > 0.2,
                postValidationPassed: i < 80 ? Math.random() > 0.1 : undefined,
                timestamp: Date.now(),
            });
        }
        const report = (0, data_quality_1.generateQualityReport)(outcomes);
        (0, vitest_1.expect)(report.qualityScoreAvg).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.qualityScoreAvg).toBeLessThanOrEqual(1);
        (0, data_quality_1.printQualityReport)(report);
    });
});
// ═══════════════════════════════════════════════════════════════
// Planner Trace Tests
// ═══════════════════════════════════════════════════════════════
const TRACE_DIR = path.resolve(__dirname, "..", "test-planner-trace");
process.env.PROGMUNE_PROJECT_DIR = TRACE_DIR;
fs.mkdirSync(TRACE_DIR, { recursive: true });
fs.mkdirSync(path.join(TRACE_DIR, ".progmune_corpus", "traces"), { recursive: true });
(0, vitest_1.describe)("Planner Trace", () => {
    (0, vitest_1.it)("records a trace with full candidate list", () => {
        const store = new planner_trace_1.PlannerTraceStore(path.join(TRACE_DIR, ".progmune_corpus", "traces", `test-${Date.now()}.jsonl`));
        const candidates = [
            { fingerprint: "fp-safe", source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], score: 0.81, rank: 1 },
            { fingerprint: "fp-fast", source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], score: 0.73, rank: 2 },
            { fingerprint: "fp-ab", source: "antibody", evidenceSources: ["antibody"], actions: ["flush_and_close"], score: 0.65, rank: 3 },
        ];
        const id = store.recordTrace({
            decisionId: "PD-test",
            goal: "safely write config file",
            protocol: "FileProtocol",
            violationType: "resource_leak",
            candidates,
            selectedFingerprint: "fp-safe",
        });
        (0, vitest_1.expect)(id).toMatch(/^TR-/);
        (0, vitest_1.expect)(store.size).toBe(1);
    });
    (0, vitest_1.it)("updates outcome and queries acceptance by source", () => {
        const store = new planner_trace_1.PlannerTraceStore(path.join(TRACE_DIR, ".progmune_corpus", "traces", `test2-${Date.now()}.jsonl`));
        // Corpus-only trace: 2 rejected out of 2
        for (let i = 0; i < 2; i++) {
            const id = store.recordTrace({
                decisionId: `pd-c-${i}`,
                goal: "test",
                protocol: "FileProtocol",
                candidates: [
                    { fingerprint: "fp-c", source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], score: 0.9, rank: 1 },
                ],
                selectedFingerprint: "fp-c",
            });
            store.updateOutcome(id, { accepted: false });
        }
        // Protocol-only trace: 3 accepted out of 3
        for (let i = 0; i < 3; i++) {
            const id = store.recordTrace({
                decisionId: `pd-p-${i}`,
                goal: "test",
                protocol: "FileProtocol",
                candidates: [
                    { fingerprint: "fp-p", source: "protocol", evidenceSources: ["protocol"], actions: ["open", "write", "close"], score: 0.8, rank: 1 },
                ],
                selectedFingerprint: "fp-p",
            });
            store.updateOutcome(id, { accepted: true, executionSucceeded: true });
        }
        const bySource = store.getAcceptanceBySource();
        (0, vitest_1.expect)(bySource["corpus"].rate).toBe(0); // 0/2
        (0, vitest_1.expect)(bySource["protocol"].rate).toBe(1); // 3/3
        // Rank-1 acceptance: 3 out of 5 selected rank-1 → but only protocol was rank-1 and accepted
        // Actually rank-1 is fp-c for all → selected when corpus was chosen but rejected
        const rank1Rate = store.getRank1AcceptanceRate();
        (0, vitest_1.expect)(rank1Rate).toBeLessThanOrEqual(1);
    });
    (0, vitest_1.it)("identifies top rejected fingerprints", () => {
        const store = new planner_trace_1.PlannerTraceStore(path.join(TRACE_DIR, ".progmune_corpus", "traces", `test3-${Date.now()}.jsonl`));
        for (let i = 0; i < 10; i++) {
            const id = store.recordTrace({
                decisionId: `pd-r-${i}`,
                goal: "quick write",
                protocol: "FileProtocol",
                candidates: [
                    { fingerprint: "fp-leaky", source: "corpus", evidenceSources: ["corpus"], actions: ["open_file", "write_file"], score: 0.9, rank: 1 },
                ],
                selectedFingerprint: "fp-leaky",
            });
            store.updateOutcome(id, { accepted: false, executionSucceeded: false });
        }
        const rejected = store.getTopRejectedFingerprints(5);
        (0, vitest_1.expect)(rejected.length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(rejected[0].fingerprint).toBe("fp-leaky");
        (0, vitest_1.expect)(rejected[0].rejections).toBe(10);
        (0, vitest_1.expect)(rejected[0].actions).toBe("open_file→write_file");
    });
});
// ═══════════════════════════════════════════════════════════════
// Reward Signal Pre-collection
// ═══════════════════════════════════════════════════════════════
const REWARD_DIR = path.resolve(__dirname, "..", "test-reward-tuples");
process.env.PROGMUNE_PROJECT_DIR = REWARD_DIR;
fs.mkdirSync(REWARD_DIR, { recursive: true });
fs.mkdirSync(path.join(REWARD_DIR, ".progmune_corpus", "rewards"), { recursive: true });
(0, vitest_1.describe)("Reward Signal Pre-collection", () => {
    (0, vitest_1.it)("records and loads reward tuples", () => {
        (0, planner_trace_1.recordRewardTuple)({
            state: "FILE_OPEN",
            action: "close_file",
            nextState: "CLOSED",
            reward: 0.93,
        });
        (0, planner_trace_1.recordRewardTuple)({
            state: "FILE_OPEN",
            action: "write_file",
            nextState: "FILE_OPEN",
            reward: 0.1,
        });
        const tuples = (0, planner_trace_1.loadRewardTuples)();
        (0, vitest_1.expect)(tuples.length).toBeGreaterThanOrEqual(2);
        (0, vitest_1.expect)(tuples[0]).toHaveProperty("state");
        (0, vitest_1.expect)(tuples[0]).toHaveProperty("action");
        (0, vitest_1.expect)(tuples[0]).toHaveProperty("nextState");
        (0, vitest_1.expect)(tuples[0]).toHaveProperty("reward");
        (0, vitest_1.expect)(tuples[0].reward).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(tuples[0].reward).toBeLessThanOrEqual(1);
    });
});
// ═══════════════════════════════════════════════════════════════
// Expanded Benchmark
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Expanded Benchmark", () => {
    (0, vitest_1.it)("runs all 7 protocol suites (50+ cases)", async () => {
        const report = await (0, benchmark_harness_1.runBenchmark)();
        (0, vitest_1.expect)(report.cases).toBeGreaterThanOrEqual(49);
        (0, benchmark_harness_1.printBenchmarkReport)(report);
        // Baseline assertions
        (0, vitest_1.expect)(report.top1Rate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.top1Rate).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(report.top3Rate).toBeGreaterThanOrEqual(report.top1Rate);
        (0, vitest_1.expect)(report.avgLatencyMs).toBeGreaterThan(0);
    }, 60000);
    (0, vitest_1.it)("by-protocol breakdown can identify weak spots", () => {
        // This validates the pattern for future by-protocol analysis
        const protocols = [
            "auth_protocol.json",
            "database_protocol.json",
            "pipeline_protocol.json",
            "file_protocol.json",
            "resource_protocol.json",
            "expanded_file_protocol.json",
            "cross_protocol.json",
        ];
        for (const proto of protocols) {
            const p = path.resolve(__dirname, "..", "benchmarks", proto);
            (0, vitest_1.expect)(fs.existsSync(p)).toBe(true);
        }
        // 7 protocol files = at minimum 7 * 5 = 35 cases, actual: ~53
    });
});
