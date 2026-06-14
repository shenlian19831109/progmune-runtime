"use strict";
/**
 * P2.5 Telemetry + Analytics + Benchmark Integration Tests
 *
 * Verifies:
 *   1. PlannerTelemetry records decisions and feedback
 *   2. Acceptance dashboard produces correct aggregates
 *   3. Benchmark harness runs against known fixtures
 *   4. 1000 simulated decisions produce a coherent dashboard
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
const planner_telemetry_1 = require("./planner-telemetry");
const analytics_1 = require("./analytics");
const benchmark_harness_1 = require("./benchmark-harness");
// ═══════════════════════════════════════════════════════════════
// Candidate ID
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Candidate Fingerprint v2", () => {
    (0, vitest_1.it)("produces stable hash for same action sequence", () => {
        (0, vitest_1.expect)((0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["open_file", "close_file"]))
            .toBe((0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["open_file", "close_file"]));
    });
    (0, vitest_1.it)("different protocol = different hash (no collision)", () => {
        const a = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]);
        const b = (0, planner_telemetry_1.candidateFingerprint)("AuthProtocol", ["close_file"]);
        (0, vitest_1.expect)(a).not.toBe(b);
    });
    (0, vitest_1.it)("different violationType = different hash", () => {
        const a = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"], "resource_leak");
        const b = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"], "missing_prerequisite");
        (0, vitest_1.expect)(a).not.toBe(b);
    });
    (0, vitest_1.it)("different functions = different hash", () => {
        (0, vitest_1.expect)((0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]))
            .not.toBe((0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["flush"]));
    });
});
// ═══════════════════════════════════════════════════════════════
// Telemetry: record → query roundtrip
// ═══════════════════════════════════════════════════════════════
const TELEMETRY_DIR = path.resolve(__dirname, "..", "test-telemetry");
process.env.PROGMUNE_PROJECT_DIR = TELEMETRY_DIR;
fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
fs.mkdirSync(path.join(TELEMETRY_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
function createTelemetry() {
    return new planner_telemetry_1.PlannerTelemetry(path.join(TELEMETRY_DIR, ".progmune_corpus", "telemetry", `test-${Date.now()}.jsonl`));
}
(0, vitest_1.describe)("PlannerTelemetry", () => {
    (0, vitest_1.it)("records a decision and returns an ID", () => {
        const t = createTelemetry();
        const id = t.recordDecision({
            goal: "safely write config file",
            protocol: "FileProtocol",
            candidates: [{
                    candidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]),
                    source: "protocol",
                    evidenceSources: ["protocol"],
                    actions: ["close_file"],
                    explanation: "Close the file",
                }],
            selectedCandidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]),
        });
        (0, vitest_1.expect)(id).toMatch(/^PD-/);
        (0, vitest_1.expect)(t.size).toBe(1);
        (0, vitest_1.expect)(t.withFeedback).toBe(0);
    });
    (0, vitest_1.it)("records accepted feedback and updates acceptance rate", () => {
        const t = createTelemetry();
        const id = t.recordDecision({
            goal: "authenticate user",
            protocol: "AuthProtocol",
            candidates: [{
                    candidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["verify_password"]),
                    source: "protocol",
                    evidenceSources: ["protocol"],
                    actions: ["verify_password", "generate_jwt"],
                    explanation: "Full auth flow",
                }],
            selectedCandidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["verify_password"]),
        });
        t.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, userReason: "safer", timestamp: Date.now() });
        (0, vitest_1.expect)(t.withFeedback).toBe(1);
        (0, vitest_1.expect)(t.getAcceptanceRate()).toBe(1.0);
    });
    (0, vitest_1.it)("records rejected feedback", () => {
        const t = createTelemetry();
        const id = t.recordDecision({
            goal: "write file unsafely",
            protocol: "FileProtocol",
            candidates: [{
                    candidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["write_file"]),
                    source: "antibody",
                    evidenceSources: ["antibody"],
                    actions: ["write_file"],
                    explanation: "Just write",
                }],
            selectedCandidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["write_file"]),
        });
        t.recordFeedback(id, { decision: "rejected", userReason: "irrelevant", timestamp: Date.now() });
        (0, vitest_1.expect)(t.withFeedback).toBe(1);
        (0, vitest_1.expect)(t.getAcceptanceRate()).toBe(0.0);
    });
    (0, vitest_1.it)("records execution result with latency", () => {
        const t = createTelemetry();
        const id = t.recordDecision({
            goal: "quick operation",
            protocol: "FileProtocol",
            candidates: [{
                    candidateId: "q",
                    source: "corpus",
                    evidenceSources: ["corpus"],
                    actions: ["flush"],
                    explanation: "Quick flush",
                }],
        });
        t.recordExecutionResult(id, true, [], 42);
        const events = t.all();
        const ev = events.find(e => e.id === id);
        (0, vitest_1.expect)(ev?.feedback?.executionResult?.success).toBe(true);
        (0, vitest_1.expect)(ev?.cost?.latencyMs).toBe(42);
    });
});
// ═══════════════════════════════════════════════════════════════
// Telemetry: aggregation queries
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Telemetry aggregation", () => {
    (0, vitest_1.it)("getAcceptanceBySource breaks down by strategy", () => {
        const t = createTelemetry();
        // Corpus: 2 accepted out of 2
        for (let i = 0; i < 2; i++) {
            const id = t.recordDecision({
                goal: "test",
                protocol: "FileProtocol",
                candidates: [{
                        candidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]),
                        source: "corpus",
                        evidenceSources: ["corpus"],
                        actions: ["close_file"],
                        explanation: "close",
                    }],
                selectedCandidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]),
            });
            t.recordFeedback(id, { decision: "accepted", userReason: "safer", timestamp: Date.now() });
        }
        // Protocol: 1 accepted out of 1
        const pid = t.recordDecision({
            goal: "test",
            protocol: "FileProtocol",
            candidates: [{
                    candidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]),
                    source: "protocol",
                    evidenceSources: ["protocol"],
                    actions: ["close_file"],
                    explanation: "close",
                }],
            selectedCandidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]),
        });
        t.recordFeedback(pid, { decision: "accepted", userReason: "faster", timestamp: Date.now() });
        // Antibody: 0 accepted out of 1
        const aid = t.recordDecision({
            goal: "test",
            protocol: "FileProtocol",
            candidates: [{
                    candidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["flush"]),
                    source: "antibody",
                    evidenceSources: ["antibody"],
                    actions: ["flush"],
                    explanation: "flush instead",
                }],
            selectedCandidateId: (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["flush"]),
        });
        t.recordFeedback(aid, { decision: "rejected", userReason: "incorrect", timestamp: Date.now() });
        const stats = (0, analytics_1.getStrategyStats)(t);
        (0, vitest_1.expect)(stats.length).toBe(3);
        const corpus = stats.find(s => s.strategy === "corpus");
        (0, vitest_1.expect)(corpus.rate).toBe(1.0); // 100%
        (0, vitest_1.expect)(corpus.accepted).toBe(2);
        const protocol = stats.find(s => s.strategy === "protocol");
        (0, vitest_1.expect)(protocol.rate).toBe(1.0);
        const antibody = stats.find(s => s.strategy === "antibody");
        (0, vitest_1.expect)(antibody.rate).toBe(0.0);
    });
    (0, vitest_1.it)("getTopAcceptedRepairs returns ranked list", () => {
        const t = createTelemetry();
        const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]);
        for (let i = 0; i < 3; i++) {
            const id = t.recordDecision({
                goal: "safely write config file",
                protocol: "FileProtocol",
                candidates: [{
                        candidateId: fp,
                        source: "corpus",
                        evidenceSources: ["corpus", "protocol"],
                        actions: ["close_file"],
                        explanation: "close",
                    }],
                selectedCandidateId: fp,
            });
            t.recordFeedback(id, { decision: "accepted", userReason: "safer", timestamp: Date.now() });
        }
        const tops = (0, analytics_1.getTopAcceptedRepairs)(t);
        (0, vitest_1.expect)(tops.length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(tops[0].actions).toBe("close_file");
        (0, vitest_1.expect)(tops[0].count).toBe(3);
        (0, vitest_1.expect)(tops[0].goal).toBe("safely write config file");
    });
});
// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Acceptance Dashboard", () => {
    (0, vitest_1.it)("generates a complete dashboard report", () => {
        const t = createTelemetry();
        // Seed with FileProtocol decisions
        const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"]);
        for (let i = 0; i < 5; i++) {
            const id = t.recordDecision({
                goal: "safely write config file",
                protocol: "FileProtocol",
                candidates: [{
                        candidateId: fp,
                        source: i < 4 ? "corpus" : "protocol",
                        evidenceSources: i < 4 ? ["corpus"] : ["protocol"],
                        actions: ["close_file"],
                        explanation: "close",
                    }],
                selectedCandidateId: fp,
            });
            if (i < 4)
                t.recordFeedback(id, { decision: "accepted", userReason: "safer", timestamp: Date.now() });
            else
                t.recordFeedback(id, { decision: "rejected", userReason: "incorrect", timestamp: Date.now() });
        }
        // Seed with AuthProtocol
        const ap = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["verify_password"]);
        for (let i = 0; i < 3; i++) {
            const id = t.recordDecision({
                goal: "authenticate user",
                protocol: "AuthProtocol",
                candidates: [{
                        candidateId: ap,
                        source: "corpus",
                        evidenceSources: ["corpus", "protocol"],
                        actions: ["verify_password", "generate_jwt"],
                        explanation: "auth flow",
                    }],
                selectedCandidateId: ap,
            });
            t.recordFeedback(id, { decision: "accepted", userReason: "safer", timestamp: Date.now() });
        }
        const report = (0, analytics_1.generateDashboard)(t);
        (0, vitest_1.expect)(report.summary.totalDecisions).toBe(8);
        (0, vitest_1.expect)(report.summary.withFeedback).toBe(8);
        // 7 accepted out of 8 = 87.5%
        (0, vitest_1.expect)(report.summary.overallAcceptanceRate).toBe(7 / 8);
        (0, vitest_1.expect)(report.byProtocol.length).toBe(2);
        const fileProto = report.byProtocol.find(p => p.protocol === "FileProtocol");
        (0, vitest_1.expect)(fileProto.rate).toBe(4 / 5);
        const authProto = report.byProtocol.find(p => p.protocol === "AuthProtocol");
        (0, vitest_1.expect)(authProto.rate).toBe(1.0);
        (0, vitest_1.expect)(report.topAccepted.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.topRejected.length).toBeGreaterThan(0);
        // Dashboard prints without crashing
        (0, analytics_1.printDashboard)(t);
    });
});
// ═══════════════════════════════════════════════════════════════
// Benchmark harness
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Benchmark harness", () => {
    (0, vitest_1.it)("runs against benchmark fixtures and produces report", async () => {
        const report = await (0, benchmark_harness_1.runBenchmark)();
        (0, vitest_1.expect)(report.cases).toBeGreaterThanOrEqual(5);
        (0, vitest_1.expect)(report.top1Rate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.top1Rate).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(report.top3Rate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.top3Rate).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(report.avgLatencyMs).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.avgCandidates).toBeGreaterThan(0);
        // Print for visual inspection
        (0, benchmark_harness_1.printBenchmarkReport)(report);
    }, 30000);
});
// ═══════════════════════════════════════════════════════════════
// 1000 simulated decisions → coherent dashboard
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("1000-simulated-decisions smoke test", () => {
    (0, vitest_1.it)("produces coherent dashboard after 1000 simulated decisions", () => {
        const t = createTelemetry();
        const strategies = ["corpus", "protocol", "antibody"];
        const protocols = ["FileProtocol", "AuthProtocol", "DBProtocol", "IRProtocol"];
        const goals = {
            FileProtocol: ["safely write config file", "read file and close it", "append and close file"],
            AuthProtocol: ["authenticate user", "create user session", "verify and logout"],
            DBProtocol: ["connect and query", "insert record safely", "migrate and clean up"],
            IRProtocol: ["extract and validate", "emit validated code", "record session"],
        };
        const repairs = {
            FileProtocol: ["open_file→write_file→close_file", "open_file→read_file→close_file", "open_file→append→close_file"],
            AuthProtocol: ["verify_password→generate_jwt→create_session", "verify_password→generate_jwt→logout", "verify_password→create_session→logout"],
            DBProtocol: ["connect_db→query_db→disconnect_db", "connect_db→insert→disconnect_db", "connect_db→migrate→disconnect_db"],
            IRProtocol: ["extractIR→validateAction", "validateActionSequence→emitCode", "extractIR→emitCode→recordSession"],
        };
        // Acceptance probabilities per strategy (matching expected hierarchy)
        const acceptProb = { corpus: 0.90, protocol: 0.84, antibody: 0.72 };
        for (let i = 0; i < 1000; i++) {
            const protocol = protocols[i % protocols.length];
            const goalList = goals[protocol];
            const repairList = repairs[protocol];
            const goal = goalList[i % goalList.length];
            const repair = repairList[i % repairList.length];
            const source = strategies[i % strategies.length];
            const cid = (0, planner_telemetry_1.candidateFingerprint)(protocol, repair.split("→"));
            const id = t.recordDecision({
                goal,
                protocol,
                candidates: [{
                        candidateId: cid,
                        source,
                        evidenceSources: [source],
                        actions: repair.split("→"),
                        explanation: `Repair: ${repair}`,
                    }],
                selectedCandidateId: cid,
                cost: { latencyMs: 2 + Math.random() * 10, actionCount: repair.split("→").length },
            });
            // Accept with strategy-specific probability
            if (Math.random() < acceptProb[source]) {
                const reasons = ["safer", "faster", "clearer", "more_auditable"];
                const reason = reasons[Math.floor(Math.random() * reasons.length)];
                const rating = (reason === "safer" || reason === "faster") ? (4 + Math.floor(Math.random() * 2)) : (3 + Math.floor(Math.random() * 2));
                t.recordFeedback(id, { decision: "accepted", userReason: reason, timestamp: Date.now() });
            }
            else {
                t.recordFeedback(id, { decision: "rejected", userReason: Math.random() < 0.5 ? "incorrect" : "irrelevant", timestamp: Date.now() });
            }
        }
        // Verify coherence
        const report = (0, analytics_1.generateDashboard)(t);
        (0, vitest_1.expect)(report.summary.totalDecisions).toBe(1000);
        (0, vitest_1.expect)(report.summary.withFeedback).toBe(1000);
        // Overall acceptance should be between 72% and 90%
        (0, vitest_1.expect)(report.summary.overallAcceptanceRate).toBeGreaterThan(0.70);
        (0, vitest_1.expect)(report.summary.overallAcceptanceRate).toBeLessThan(0.92);
        // Strategy hierarchy: corpus > protocol > antibody
        const stratStats = (0, analytics_1.getStrategyStats)(t);
        const corpus = stratStats.find(s => s.strategy === "corpus");
        const protocol = stratStats.find(s => s.strategy === "protocol");
        const antibody = stratStats.find(s => s.strategy === "antibody");
        (0, vitest_1.expect)(corpus.rate).toBeGreaterThan(protocol.rate);
        (0, vitest_1.expect)(protocol.rate).toBeGreaterThan(antibody.rate);
        // Top accepted repair should be present
        const topAccepted = (0, analytics_1.getTopAcceptedRepairs)(t, 3);
        (0, vitest_1.expect)(topAccepted.length).toBeGreaterThanOrEqual(3);
        // Top rejected repair should be present
        const topRejected = (0, analytics_1.getTopRejectedRepairs)(t, 3);
        (0, vitest_1.expect)(topRejected.length).toBeGreaterThanOrEqual(3);
        // Print dashboard for visual confirmation
        (0, analytics_1.printDashboard)(t);
        // Also print strategy stats as table
        console.log("\nStrategy Acceptance (1000 decisions):");
        for (const s of stratStats) {
            console.log(`  ${s.strategy.padEnd(16)} ${(s.rate * 100).toFixed(0)}%  (${s.accepted}/${s.total})`);
        }
    });
});
