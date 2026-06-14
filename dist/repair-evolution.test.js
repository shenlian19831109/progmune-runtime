"use strict";
/**
 * P2→P4 Evolution Path Verification Tests
 *
 * These tests verify that the refactored architecture truly opens
 * the path from Counterfactual Planner → Reward Model.
 *
 * Five architecture-level invariants:
 *   1. Strategy never knows about ranking
 *   2. Same candidate from multiple sources = merged evidence
 *   3. Same candidate ranks differently under different objectives
 *   4. Feedback + cost survive trajectory persistence (P4 pre-burial)
 *   5. Goal → Repair → Feedback → Corpus closed loop (the flywheel)
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
const repair_ranker_1 = require("./repair-ranker");
const counterfactual_engine_1 = require("./counterfactual-engine");
const ssg_validator_1 = require("./ssg-validator");
// ── Helpers ──
function fileProtocolRules() {
    const protoDef = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "protocols.json"), "utf-8"));
    const protocols = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
    const rules = new Map();
    for (const p of protocols)
        rules.set(p.function, p.protocol);
    return rules;
}
function fileProtocolContext(targetState) {
    return {
        protocol: "_global",
        currentState: ["FILE_OPEN"],
        targetState: targetState || [],
        violationType: "resource_leak",
        constraints: [],
        rules: fileProtocolRules(),
    };
}
// ════════════════════════════════════════════════════════
// Test 1: Strategy completely unaware of ranking
// ════════════════════════════════════════════════════════
class DummyStrategy {
    constructor() {
        this.name = "dummy";
    }
    search(_) {
        return [{
                id: "dummy-1",
                source: "protocol",
                actions: [
                    { kind: "call", function: "open_file", args: [] },
                    { kind: "call", function: "write_file", args: [] },
                    { kind: "call", function: "close_file", args: [] },
                ],
                explanation: "dummy test candidate",
            }];
    }
}
(0, vitest_1.describe)("Test 1: Strategy unaware of ranking", () => {
    (0, vitest_1.it)("strategy returns candidates without score or rank", () => {
        const s = new DummyStrategy();
        const result = s.search({});
        (0, vitest_1.expect)(result.length).toBe(1);
        (0, vitest_1.expect)(result[0].score).toBeUndefined();
        (0, vitest_1.expect)(result[0].rank).toBeUndefined();
        // Has required RepairCandidate shape
        (0, vitest_1.expect)(result[0].id).toBeDefined();
        (0, vitest_1.expect)(result[0].source).toBe("protocol");
        (0, vitest_1.expect)(result[0].actions.length).toBe(3);
        (0, vitest_1.expect)(result[0].explanation).toBeDefined();
    });
    (0, vitest_1.it)("future LLMRepairStrategy would not need Ranker changes", () => {
        // Any class implementing CandidateSearchStrategy works
        const iface = new DummyStrategy();
        (0, vitest_1.expect)(iface.name).toBe("dummy");
        (0, vitest_1.expect)(typeof iface.search).toBe("function");
        // The Ranker consumes RepairCandidate[], not strategy-specific types
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const ctx = {
            protocol: "test", currentState: [], targetState: ["DONE"],
            violationType: "test", constraints: [], rules: new Map(),
        };
        const candidate = iface.search(ctx)[0];
        const features = (0, repair_ranker_1.extractFeatures)(candidate, ctx);
        const score = ranker.score(features);
        (0, vitest_1.expect)(score).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(score).toBeLessThanOrEqual(1);
    });
});
// ════════════════════════════════════════════════════════
// Test 2: Cross-source evidence merging
// ════════════════════════════════════════════════════════
(0, vitest_1.describe)("Test 2: Cross-source evidence merge", () => {
    (0, vitest_1.it)("merges identical action sequences from different sources", () => {
        const candidates = [
            {
                id: "corpus-close",
                source: "corpus",
                actions: [{ kind: "call", function: "close_file", args: [] }],
                explanation: "From historical data: close the file",
                evidence: 42,
                metadata: { historicalSuccessRate: 0.85 },
            },
            {
                id: "protocol-close",
                source: "protocol",
                actions: [{ kind: "call", function: "close_file", args: [] }],
                explanation: "From SSG: close_file invalidates FILE_OPEN",
                evidence: 0,
                metadata: { pathLength: 1 },
            },
            {
                id: "antibody-close",
                source: "antibody",
                actions: [{ kind: "call", function: "close_file", args: [] }],
                explanation: "From antibody: resource leak → close_file",
                evidence: 0,
                metadata: { avgSuccessRate: 0.5 },
            },
        ];
        const merged = (0, counterfactual_engine_1.deduplicateCandidates)(candidates);
        (0, vitest_1.expect)(merged.length).toBe(1);
        (0, vitest_1.expect)(merged[0].evidenceSources).toBeDefined();
        (0, vitest_1.expect)(merged[0].evidenceSources.sort()).toEqual(["antibody", "corpus", "protocol"]);
        // Evidence count takes max from all sources
        (0, vitest_1.expect)(merged[0].evidence).toBe(42);
        // Metadata merges: highest historicalSuccessRate survives
        (0, vitest_1.expect)(merged[0].metadata?.historicalSuccessRate).toBe(0.85);
    });
    (0, vitest_1.it)("single-source candidate has evidenceSources = [source]", () => {
        const candidates = [{
                id: "solo",
                source: "protocol",
                actions: [{ kind: "call", function: "verify_email", args: [] }],
                explanation: "Only from protocol",
            }];
        const merged = (0, counterfactual_engine_1.deduplicateCandidates)(candidates);
        (0, vitest_1.expect)(merged.length).toBe(1);
        (0, vitest_1.expect)(merged[0].evidenceSources).toEqual(["protocol"]);
    });
    (0, vitest_1.it)("different action sequences stay separate", () => {
        const candidates = [
            {
                id: "a", source: "protocol",
                actions: [{ kind: "call", function: "close_file", args: [] }],
                explanation: "close",
            },
            {
                id: "b", source: "corpus",
                actions: [
                    { kind: "call", function: "flush", args: [] },
                    { kind: "call", function: "close_file", args: [] },
                ],
                explanation: "flush then close",
            },
        ];
        const merged = (0, counterfactual_engine_1.deduplicateCandidates)(candidates);
        (0, vitest_1.expect)(merged.length).toBe(2);
        // Each has its own evidenceSources
        for (const m of merged) {
            (0, vitest_1.expect)(m.evidenceSources.length).toBe(1);
        }
    });
});
// ════════════════════════════════════════════════════════
// Test 3: Ranking mode switching
// ════════════════════════════════════════════════════════
(0, vitest_1.describe)("Test 3: Ranking mode switching", () => {
    const safeCandidate = {
        id: "safe", source: "protocol",
        actions: [
            { kind: "call", function: "open_file", args: [] },
            { kind: "call", function: "write_file", args: [] },
            { kind: "call", function: "close_file", args: [] },
        ],
        explanation: "Safe: full open-write-close sequence",
    };
    const fastCandidate = {
        id: "fast", source: "corpus",
        actions: [
            { kind: "call", function: "atomic_write", args: [] },
        ],
        explanation: "Fast: single atomic operation",
        evidence: 42,
        metadata: { historicalSuccessRate: 0.99, corpusEvidenceCount: 42 },
    };
    const safeFeatures = {
        protocolSafety: 1.0,
        historicalSuccessRate: 0.5,
        actionCount: 3,
        latencyCost: 0.6,
        auditability: 0.8,
        corpusEvidence: 0,
        source: "protocol",
        goalMatch: 0,
    };
    const fastFeatures = {
        protocolSafety: 0.7,
        historicalSuccessRate: 0.99,
        actionCount: 1,
        latencyCost: 0.1,
        auditability: 0.5,
        corpusEvidence: 42,
        source: "corpus",
        goalMatch: 0,
    };
    (0, vitest_1.it)("ranks safe higher under safety objective", () => {
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const ranked = ranker.rankSafety([fastCandidate, safeCandidate], [fastFeatures, safeFeatures]);
        (0, vitest_1.expect)(ranked[0].id).toBe("safe");
    });
    (0, vitest_1.it)("ranks fast higher under performance objective", () => {
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const ranked = ranker.rankPerformance([safeCandidate, fastCandidate], [safeFeatures, fastFeatures]);
        (0, vitest_1.expect)(ranked[0].id).toBe("fast");
    });
    (0, vitest_1.it)("different objectives produce different orderings", () => {
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const bySafety = ranker.rankSafety([safeCandidate, fastCandidate], [safeFeatures, fastFeatures]);
        const byPerf = ranker.rankPerformance([safeCandidate, fastCandidate], [safeFeatures, fastFeatures]);
        // Same candidates, different orderings
        (0, vitest_1.expect)(bySafety[0].id).not.toBe(byPerf[0].id);
    });
    (0, vitest_1.it)("future RewardModelRanker would use same interface", () => {
        // The Ranker interface is { score(features: CandidateFeatures): number }
        // Any implementation works — linear weights, learned model, etc.
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const score = ranker.score(safeFeatures);
        (0, vitest_1.expect)(score).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(score).toBeLessThanOrEqual(1);
    });
});
// ════════════════════════════════════════════════════════
// Test 4: P4 pre-burial — feedback + cost persistence
// ════════════════════════════════════════════════════════
// Set env BEFORE importing from failure-corpus
const FEEDBACK_DIR = path.resolve(__dirname, "..", "test-evolution-feedback");
process.env.PROGMUNE_PROJECT_DIR = FEEDBACK_DIR;
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
fs.mkdirSync(path.join(FEEDBACK_DIR, ".progmune_corpus"), { recursive: true });
fs.mkdirSync(path.join(FEEDBACK_DIR, ".progmune_corpus", "trajectories"), { recursive: true });
const failure_corpus_1 = require("./failure-corpus");
// ── Wait helper (recordTrajectory writes via setImmediate) ──
function flushWrites() {
    return new Promise(resolve => setImmediate(resolve));
}
(0, vitest_1.describe)("Test 4: P4 pre-burial", () => {
    (0, vitest_1.it)("feedback {accepted, rejected} survives write→read roundtrip", async () => {
        const uniqueSig = `test-evo-accepted-${Date.now()}`;
        (0, failure_corpus_1.recordTrajectory)({
            protocol: "FileProtocol",
            initialState: ["FILE_OPEN"],
            finalState: [],
            trajectory: ["open_file", "write_file", "close_file"],
            result: "repair",
            violationType: "resource_leak",
            violationDesc: uniqueSig,
            fixPath: ["close_file"],
            successRate: 1.0,
            source: "planner",
            feedback: { accepted: true, rejected: false },
            cost: { latency: 12, actions: 3 },
        });
        await flushWrites();
        const loaded = (0, failure_corpus_1.loadTrajectories)();
        const repair = loaded.find(t => t.result === "repair" && t.violation?.description === uniqueSig);
        (0, vitest_1.expect)(repair).toBeDefined();
        (0, vitest_1.expect)(repair.feedback?.accepted).toBe(true);
        (0, vitest_1.expect)(repair.feedback?.rejected).toBe(false);
        (0, vitest_1.expect)(repair.cost?.latency).toBe(12);
        (0, vitest_1.expect)(repair.cost?.actions).toBe(3);
    });
    (0, vitest_1.it)("rejected repair is also recorded", async () => {
        const uniqueSig = `test-evo-rejected-${Date.now()}`;
        (0, failure_corpus_1.recordTrajectory)({
            protocol: "FileProtocol",
            initialState: ["FILE_OPEN"],
            finalState: ["FILE_OPEN"],
            trajectory: ["open_file", "write_file"],
            result: "repair",
            violationType: "resource_leak",
            violationDesc: uniqueSig,
            fixPath: ["close_file"],
            successRate: 0.0,
            source: "llm",
            feedback: { accepted: false, rejected: true },
            cost: { latency: 7, actions: 2 },
        });
        await flushWrites();
        const loaded = (0, failure_corpus_1.loadTrajectories)();
        const rejected = loaded.filter(t => t.result === "repair" && t.feedback?.rejected === true && t.violation?.description === uniqueSig);
        (0, vitest_1.expect)(rejected.length).toBe(1);
        (0, vitest_1.expect)(rejected[0].cost?.latency).toBe(7);
    });
    (0, vitest_1.it)("getRepairStats aggregates feedback for P4 Reward Model", async () => {
        (0, failure_corpus_1.recordTrajectory)({
            protocol: "AuthProtocol",
            initialState: ["UNAUTHENTICATED"],
            finalState: ["SESSION_ACTIVE"],
            trajectory: ["verify_password", "generate_jwt", "create_session"],
            result: "repair",
            violationType: "missing_prerequisite",
            violationDesc: "Skipped verification",
            fixPath: ["verify_password"],
            successRate: 1.0,
            source: "planner",
            feedback: { accepted: true, rejected: false },
            cost: { latency: 25, actions: 3 },
        });
        await flushWrites();
        const stats = (0, failure_corpus_1.getRepairStats)();
        (0, vitest_1.expect)(stats.totalRepairs).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(stats.acceptedRepairs).toBeGreaterThanOrEqual(2);
        (0, vitest_1.expect)(stats.rejectedRepairs).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(stats.acceptanceRate).toBeGreaterThan(0);
        (0, vitest_1.expect)(stats.acceptanceRate).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(stats.avgLatency).toBeGreaterThan(0);
    });
});
// ════════════════════════════════════════════════════════
// Test 5: Goal → Repair → Feedback → Corpus closed loop
// ════════════════════════════════════════════════════════
// Separate corpus dir for the flywheel test
const FLYWHEEL_DIR = path.resolve(__dirname, "..", "test-evolution-flywheel");
fs.mkdirSync(FLYWHEEL_DIR, { recursive: true });
const flywheelCorpus = path.join(FLYWHEEL_DIR, ".progmune_corpus");
fs.mkdirSync(flywheelCorpus, { recursive: true });
fs.mkdirSync(path.join(flywheelCorpus, "trajectories"), { recursive: true });
(0, vitest_1.describe)("Test 5: Goal → Repair → Feedback → Corpus flywheel", () => {
    (0, vitest_1.it)("accepted repair feeds back into corpus as future evidence", async () => {
        // Point to flywheel corpus for this test
        process.env.PROGMUNE_PROJECT_DIR = FLYWHEEL_DIR;
        const flywheelId = `flywheel-accepted-${Date.now()}`;
        // Step 1: Generate a repair plan via the Planner
        const rules = fileProtocolRules();
        const alts = await (0, counterfactual_engine_1.suggestAlternatives)({
            violation: {
                svl: 4,
                violatedConstraint: "resource_leak",
                actionIndex: 2,
                currentStates: ["FILE_OPEN"],
                requiredStates: [],
                description: "File not closed after write",
            },
            protocol: "_global",
            currentState: ["FILE_OPEN"],
            targetState: [],
            constraints: [],
            rules,
        });
        (0, vitest_1.expect)(alts.length).toBeGreaterThan(0);
        const topRepair = alts[0];
        // Step 2: Simulate user accepting the repair
        (0, failure_corpus_1.recordTrajectory)({
            protocol: "FileProtocol",
            initialState: ["FILE_OPEN"],
            finalState: [],
            trajectory: ["open_file", "write_file", ...topRepair.fixPath],
            result: "repair",
            violationType: "resource_leak",
            violationDesc: flywheelId,
            fixPath: topRepair.fixPath,
            successRate: 1.0,
            source: "planner",
            intent: "safely write config file",
            feedback: { accepted: true, rejected: false },
            cost: { latency: 15, actions: topRepair.fixPath.length + 2 },
        });
        await flushWrites();
        // Step 3: Verify corpus has the accepted repair
        const loaded = (0, failure_corpus_1.loadTrajectories)();
        const repairs = loaded.filter(t => t.result === "repair" && t.violation?.description === flywheelId);
        (0, vitest_1.expect)(repairs.length).toBe(1);
        (0, vitest_1.expect)(repairs[0].feedback?.accepted).toBe(true);
        (0, vitest_1.expect)(repairs[0].metadata.intent).toBe("safely write config file");
        (0, vitest_1.expect)(repairs[0].violation?.fixPath?.length).toBeGreaterThan(0);
        // Step 4: The flywheel is spinning
        // Goal → Planner → Repair → Accepted → Corpus → (future) Planner
        const stats = {
            accepted: repairs.length,
            hasIntent: repairs.filter(r => r.metadata.intent).length,
            hasFixPath: repairs.filter(r => r.violation?.fixPath?.length).length,
        };
        (0, vitest_1.expect)(stats.accepted).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(stats.hasIntent).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(stats.hasFixPath).toBeGreaterThanOrEqual(1);
    });
    (0, vitest_1.it)("rejected repair also feeds the flywheel (negative signal)", async () => {
        process.env.PROGMUNE_PROJECT_DIR = FLYWHEEL_DIR;
        const flywheelId = `flywheel-rejected-${Date.now()}`;
        (0, failure_corpus_1.recordTrajectory)({
            protocol: "FileProtocol",
            initialState: ["FILE_OPEN"],
            finalState: ["FILE_OPEN"], // still open — repair failed
            trajectory: ["open_file", "write_file"],
            result: "repair",
            violationType: "resource_leak",
            violationDesc: flywheelId,
            fixPath: [],
            successRate: 0.0,
            source: "llm",
            intent: "safely write config file",
            feedback: { accepted: false, rejected: true },
            cost: { latency: 8, actions: 2 },
        });
        await flushWrites();
        const loaded = (0, failure_corpus_1.loadTrajectories)();
        const myRecord = loaded.filter(t => t.violation?.description === flywheelId);
        (0, vitest_1.expect)(myRecord.length).toBe(1);
        (0, vitest_1.expect)(myRecord[0].feedback?.accepted).toBe(false);
        (0, vitest_1.expect)(myRecord[0].feedback?.rejected).toBe(true);
        // Both signals present — P4 Reward Model can learn from both
        const allRepairs = loaded.filter(t => t.result === "repair");
        const accepted = allRepairs.filter(t => t.feedback?.accepted === true).length;
        const rejected = allRepairs.filter(t => t.feedback?.rejected === true).length;
        (0, vitest_1.expect)(accepted).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(rejected).toBeGreaterThanOrEqual(1);
    });
});
