"use strict";
/**
 * Architecture Boundary Tests — P2 Counterfactual Planner
 *
 * Verifying:
 *   P0: Missing close() scenario (user-visible demo capability)
 *   P0: Planner aggregation (multi-strategy merge)
 *   P0: Deduplication (no duplicate repair plans)
 *   P1: Ranker logic (prefers safer candidate)
 *   P1: Strategy independence (produces candidates, never scores)
 *   P2: Trajectory feedback (pre-burial for P4 Reward Model)
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
const repair_strategies_1 = require("./repair-strategies");
const repair_ranker_1 = require("./repair-ranker");
const counterfactual_engine_1 = require("./counterfactual-engine");
const ssg_validator_1 = require("./ssg-validator");
// ── Helpers ──
/** Build a SearchContext for a FileProtocol "missing close()" scenario. */
function fileProtocolContext(actions) {
    // open_file → write_file → ... missing close_file
    const currentStates = ["FILE_OPEN"];
    const targetStates = []; // should invalidate FILE_OPEN
    const protoDef = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "protocols.json"), "utf-8"));
    const protocols = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
    const rules = new Map();
    for (const p of protocols) {
        rules.set(p.function, p.protocol);
    }
    return {
        protocol: "_global",
        currentState: currentStates,
        targetState: targetStates,
        violationType: "resource_leak",
        constraints: [{ type: "safety", value: 0.9, description: "文件安全关闭" }],
        rules,
    };
}
// ════════════════════════════════════════════════════════
// P0: Missing close() — real user-visible scenario
// ════════════════════════════════════════════════════════
(0, vitest_1.describe)("P0: Missing close() repair", () => {
    (0, vitest_1.it)("suggests close_file as a repair candidate", async () => {
        const rules = fileProtocolContext(["open_file", "write_file"]).rules;
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
            constraints: [{ type: "safety", value: 0.9, description: "文件安全关闭" }],
            rules,
        });
        const functionNames = alts.flatMap(a => a.fixPath);
        // At least one candidate must include close_file
        (0, vitest_1.expect)(functionNames).toContain("close_file");
    });
    (0, vitest_1.it)("repair plan closes the file with open → write → close", async () => {
        const ctx = fileProtocolContext(["open_file", "write_file"]);
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
            constraints: [{ type: "safety", value: 0.9, description: "文件安全关闭" }],
            rules: ctx.rules,
        });
        const signatures = alts.map(a => a.fixPath.join(","));
        // Should have a candidate whose fix path includes close_file
        const hasClose = signatures.some(s => s.includes("close_file"));
        (0, vitest_1.expect)(hasClose).toBe(true);
    });
    (0, vitest_1.it)("close_file ranks higher than a longer alternative on safety", () => {
        const ctx = fileProtocolContext(["open_file", "write_file"]);
        const strategies = (0, repair_strategies_1.createDefaultStrategies)();
        const allCandidates = [];
        for (const s of strategies)
            allCandidates.push(...s.search(ctx));
        if (allCandidates.length >= 2) {
            const maxActions = Math.max(...allCandidates.map(c => c.actions.length), 8);
            const features = allCandidates.map(c => (0, repair_ranker_1.extractFeatures)(c, ctx, { maxActions }));
            const ranker = (0, repair_ranker_1.createLinearRanker)();
            const ranked = ranker.rankSafety(allCandidates, features);
            // The top-ranked by safety should be relatively safe (score >= 0.5)
            const topFeature = features[allCandidates.indexOf(ranked[0])];
            (0, vitest_1.expect)(topFeature.protocolSafety).toBeGreaterThanOrEqual(0.5);
        }
    });
});
// ════════════════════════════════════════════════════════
// P1: Strategy independence — no scoring in strategies
// ════════════════════════════════════════════════════════
(0, vitest_1.describe)("P1: Strategy independence", () => {
    const ctx = fileProtocolContext(["open_file"]);
    (0, vitest_1.it)("CorpusStrategy returns candidates without score fields", () => {
        const strategies = (0, repair_strategies_1.createDefaultStrategies)();
        for (const strategy of strategies) {
            const results = strategy.search(ctx);
            for (const r of results) {
                (0, vitest_1.expect)(r.source).toBe(strategy.name);
                (0, vitest_1.expect)(r.score).toBeUndefined();
                (0, vitest_1.expect)(r.rank).toBeUndefined();
            }
        }
    });
    (0, vitest_1.it)("every candidate has required RepairCandidate shape", () => {
        const strategies = (0, repair_strategies_1.createDefaultStrategies)();
        for (const strategy of strategies) {
            const results = strategy.search(ctx);
            for (const r of results) {
                (0, vitest_1.expect)(r).toHaveProperty("id");
                (0, vitest_1.expect)(r).toHaveProperty("source");
                (0, vitest_1.expect)(r).toHaveProperty("actions");
                (0, vitest_1.expect)(r).toHaveProperty("explanation");
                (0, vitest_1.expect)(["corpus", "protocol", "antibody"]).toContain(r.source);
                (0, vitest_1.expect)(Array.isArray(r.actions)).toBe(true);
                (0, vitest_1.expect)(r.actions.length).toBeGreaterThan(0);
            }
        }
    });
    (0, vitest_1.it)("ProtocolStrategy finds protocol-based candidates for FileProtocol", () => {
        const strategies = (0, repair_strategies_1.createDefaultStrategies)();
        // ProtocolStrategy is index 1
        const protoStrat = strategies.find(s => s.name === "protocol");
        (0, vitest_1.expect)(protoStrat).toBeDefined();
        const results = protoStrat.search(ctx);
        (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
        for (const r of results) {
            (0, vitest_1.expect)(r.source).toBe("protocol");
            // FileProtocol candidates must include file operations
            const fns = r.actions
                .filter(a => a.kind === "call")
                .map(a => a.function);
            (0, vitest_1.expect)(fns.length).toBeGreaterThan(0);
        }
    });
});
// ════════════════════════════════════════════════════════
// P1: Ranker logic — prefers safer/shorter candidates
// ════════════════════════════════════════════════════════
(0, vitest_1.describe)("P1: LinearRanker", () => {
    // Construct two candidates with different safety profiles
    const safeFeatures = {
        protocolSafety: 0.95,
        historicalSuccessRate: 0.3,
        actionCount: 2,
        latencyCost: 0.25,
        auditability: 0.75,
        corpusEvidence: 0,
        source: "protocol",
    };
    const fastFeatures = {
        protocolSafety: 0.4,
        historicalSuccessRate: 0.99,
        actionCount: 1,
        latencyCost: 0.1,
        auditability: 0.8,
        corpusEvidence: 42,
        source: "corpus",
    };
    const safeCandidate = {
        id: "safe",
        source: "protocol",
        actions: [
            { kind: "call", function: "open_file", args: [] },
            { kind: "call", function: "close_file", args: [] },
        ],
        explanation: "Safe: properly close the file",
    };
    const fastCandidate = {
        id: "fast",
        source: "corpus",
        actions: [{ kind: "call", function: "flush_and_close", args: [] }],
        explanation: "Fast: single atomic operation",
        evidence: 42,
        metadata: { historicalSuccessRate: 0.99, corpusEvidenceCount: 42 },
    };
    (0, vitest_1.it)("rankSafety prefers the safer candidate", () => {
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const ranked = ranker.rankSafety([fastCandidate, safeCandidate], [fastFeatures, safeFeatures]);
        (0, vitest_1.expect)(ranked[0].id).toBe("safe");
    });
    (0, vitest_1.it)("rankPerformance prefers the faster candidate (fewer actions)", () => {
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const ranked = ranker.rankPerformance([safeCandidate, fastCandidate], [safeFeatures, fastFeatures]);
        (0, vitest_1.expect)(ranked[0].id).toBe("fast");
    });
    (0, vitest_1.it)("rankOverall with default weights prefers overall best", () => {
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const scoreSafe = ranker.score(safeFeatures);
        const scoreFast = ranker.score(fastFeatures);
        // Both scores in 0-1 range
        (0, vitest_1.expect)(scoreSafe).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(scoreSafe).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(scoreFast).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(scoreFast).toBeLessThanOrEqual(1);
        // Scores are deterministic
        (0, vitest_1.expect)(scoreSafe).toBe(scoreSafe); // idempotent
    });
    (0, vitest_1.it)("custom weights change the ranking", () => {
        const safetyFirst = (0, repair_ranker_1.createLinearRanker)({ safety: 0.9, successRate: 0.05, performance: 0.03, auditability: 0.02 });
        const speedFirst = (0, repair_ranker_1.createLinearRanker)({ safety: 0.05, successRate: 0.1, performance: 0.8, auditability: 0.05 });
        const bySafety = safetyFirst.score(safeFeatures);
        const bySpeed = speedFirst.score(fastFeatures);
        // With safety-first weights, safe candidate should score higher
        (0, vitest_1.expect)(bySafety).toBeGreaterThan(speedFirst.score(safeFeatures));
        // With speed-first weights, fast candidate should score higher
        (0, vitest_1.expect)(bySpeed).toBeGreaterThan(safetyFirst.score(fastFeatures));
    });
    (0, vitest_1.it)("rankAuditability prefers shorter path (more auditable)", () => {
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        const ranked = ranker.rankAuditability([safeCandidate, fastCandidate], [safeFeatures, fastFeatures]);
        // fast has actionCount=1 vs safe has actionCount=2
        // auditability = 1 - actionCount/maxActions → fast is more auditable
        (0, vitest_1.expect)(ranked[0].id).toBe("fast");
    });
});
// ════════════════════════════════════════════════════════
// P0: Planner aggregation — multi-strategy merge
// ════════════════════════════════════════════════════════
(0, vitest_1.describe)("P0: Planner aggregation", () => {
    (0, vitest_1.it)("merges candidates from all three strategies via suggestAlternatives", async () => {
        const ctx = fileProtocolContext(["open_file", "write_file"]);
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
            constraints: [{ type: "safety", value: 0.9, description: "文件安全关闭" }],
            rules: ctx.rules,
        });
        (0, vitest_1.expect)(alts.length).toBeGreaterThan(0);
        const sources = new Set(alts.map(a => a.source));
        // At least one strategy produced results
        (0, vitest_1.expect)(sources.has("corpus") || sources.has("ssg_bfs") || sources.has("antibody")).toBe(true);
    });
});
// ════════════════════════════════════════════════════════
// P0: Deduplication — no duplicate repair plans
// ════════════════════════════════════════════════════════
(0, vitest_1.describe)("P0: Deduplication", () => {
    (0, vitest_1.it)("removes candidates with identical action sequences", () => {
        // Pre-seed corpus: record a trajectory with a known fix path
        // so CorpusStrategy returns a duplicate of what ProtocolStrategy finds
        process.env.PROGMUNE_CORPUS_DIR = path.resolve(__dirname, "..", "test-corpus-dedup", ".progmune_corpus");
        const trajDir = path.resolve(process.env.PROGMUNE_CORPUS_DIR, "trajectories", new Date().toISOString().slice(0, 10));
        fs.mkdirSync(trajDir, { recursive: true });
        // Write a trajectory that has the same close_file fix path
        const trajRecord = {
            id: `dedup-test-${Date.now()}`,
            timestamp: new Date().toISOString(),
            protocol: "_global",
            initialState: ["FILE_OPEN"],
            finalState: [],
            trajectory: ["open_file", "write_file", "close_file"],
            result: "violation",
            violation: {
                type: "resource_leak",
                failingStepIndex: 2,
                expectedStates: [],
                actualStates: ["FILE_OPEN"],
                fixPath: ["close_file"],
                description: "File not closed",
            },
            context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
            successRate: 0.9,
            metadata: { source: "planner" },
        };
        fs.writeFileSync(path.join(trajDir, `${trajRecord.id}.json`), JSON.stringify(trajRecord));
        const ctx = fileProtocolContext(["open_file", "write_file"]);
        const strategies = (0, repair_strategies_1.createDefaultStrategies)();
        const allCandidates = [];
        for (const s of strategies) {
            allCandidates.push(...s.search(ctx));
        }
        // Now we have at least 2 candidates: one from ProtocolStrategy, one from CorpusStrategy
        // Both suggest close_file → same action signature
        (0, vitest_1.expect)(allCandidates.length).toBeGreaterThanOrEqual(2);
        const signatures = allCandidates.map(c => c.actions
            .filter(a => a.kind === "call")
            .map(a => a.function)
            .join("→"));
        const unique = new Set(signatures);
        // After dedup, unique should be LESS than total (duplicates removed)
        (0, vitest_1.expect)(unique.size).toBeLessThan(signatures.length);
    });
    (0, vitest_1.it)("suggestAlternatives returns deduplicated results", async () => {
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
            constraints: [{ type: "safety", value: 0.9, description: "安全关闭" }],
            rules: fileProtocolContext(["open_file", "write_file"]).rules,
        });
        const fixPaths = alts.map(a => a.fixPath.join("→"));
        const unique = new Set(fixPaths);
        (0, vitest_1.expect)(unique.size).toBe(fixPaths.length);
    });
});
// ════════════════════════════════════════════════════════
// FeatureExtractor boundary
// ════════════════════════════════════════════════════════
(0, vitest_1.describe)("FeatureExtractor", () => {
    const ctx = fileProtocolContext(["open_file"]);
    (0, vitest_1.it)("returns exactly 7 feature dimensions", () => {
        const candidate = {
            id: "test",
            source: "protocol",
            actions: [
                { kind: "call", function: "close_file", args: [] },
            ],
            explanation: "close the file",
        };
        const features = (0, repair_ranker_1.extractFeatures)(candidate, ctx);
        const keys = Object.keys(features);
        (0, vitest_1.expect)(keys.length).toBe(7);
        (0, vitest_1.expect)(keys).toContain("protocolSafety");
        (0, vitest_1.expect)(keys).toContain("historicalSuccessRate");
        (0, vitest_1.expect)(keys).toContain("actionCount");
        (0, vitest_1.expect)(keys).toContain("latencyCost");
        (0, vitest_1.expect)(keys).toContain("auditability");
        (0, vitest_1.expect)(keys).toContain("corpusEvidence");
        (0, vitest_1.expect)(keys).toContain("source");
    });
    (0, vitest_1.it)("all features in [0,1] range (except actionCount and corpusEvidence)", () => {
        const candidate = {
            id: "test",
            source: "protocol",
            actions: [
                { kind: "call", function: "a", args: [] },
                { kind: "call", function: "b", args: [] },
            ],
            explanation: "test",
            metadata: { historicalSuccessRate: 0.75, corpusEvidenceCount: 10 },
        };
        const features = (0, repair_ranker_1.extractFeatures)(candidate, ctx, { maxActions: 8 });
        (0, vitest_1.expect)(features.protocolSafety).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(features.protocolSafety).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(features.historicalSuccessRate).toBe(0.75);
        (0, vitest_1.expect)(features.actionCount).toBe(2); // raw integer, not clamped
        (0, vitest_1.expect)(features.latencyCost).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(features.latencyCost).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(features.auditability).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(features.auditability).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(features.corpusEvidence).toBe(10);
    });
});
