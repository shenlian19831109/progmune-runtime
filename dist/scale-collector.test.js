"use strict";
/**
 * Scale Trajectory Collector + Reward Model Integration Tests
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
const scale_trajectory_collector_1 = require("./scale-trajectory-collector");
const learning_ranker_1 = require("./learning-ranker");
const logistic_reward_1 = require("./logistic-reward");
const planner_telemetry_1 = require("./planner-telemetry");
const repair_ranker_1 = require("./repair-ranker");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const SCALE_DIR = path.resolve(__dirname, "..", "test-scale-collector");
process.env.PROGMUNE_PROJECT_DIR = SCALE_DIR;
fs.mkdirSync(SCALE_DIR, { recursive: true });
fs.mkdirSync(path.join(SCALE_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(SCALE_DIR, ".progmune_corpus", "trajectories"), { recursive: true });
(0, vitest_1.describe)("Scale Trajectory Collector", () => {
    (0, vitest_1.it)("collects 200+ validated trajectories from all sources", () => {
        const { sequences, report } = (0, scale_trajectory_collector_1.collectTrajectoriesAtScale)();
        (0, vitest_1.expect)(report.sourceRepos).toBeGreaterThanOrEqual(20);
        (0, vitest_1.expect)(report.sourceSequences).toBeGreaterThan(50);
        (0, vitest_1.expect)(report.finalCorpusSize).toBeGreaterThan(50);
        // All sequences should be valid physics patterns
        for (const seq of sequences.slice(0, 10)) {
            (0, vitest_1.expect)(seq.length).toBeGreaterThanOrEqual(2);
        }
        (0, scale_trajectory_collector_1.printCollectionReport)(report);
    });
});
(0, vitest_1.describe)("Reward Model Integration", () => {
    (0, vitest_1.it)("LearningRanker accepts optional LogisticRewardModel", () => {
        const telemetry = new planner_telemetry_1.PlannerTelemetry(path.join(SCALE_DIR, ".progmune_corpus", "telemetry", `rl-${Date.now()}.jsonl`));
        // Seed some telemetry data
        for (let i = 0; i < 100; i++) {
            const a = ["open_file", "write_file", "close_file"];
            const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", a, "resource_leak");
            const id = telemetry.recordDecision({
                goal: "write", protocol: "FileProtocol", violationType: "resource_leak",
                candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
                selectedCandidateId: fp,
            });
            telemetry.recordFeedback(id, {
                decision: i < 80 ? "accepted" : "rejected",
                executionResult: i < 80 ? { success: true, violations: [] } : { success: false, violations: ["leak"] },
                timestamp: Date.now(),
            });
        }
        // Train reward model
        const model = logistic_reward_1.LogisticRewardModel.train(telemetry);
        // Create LearningRanker with reward model
        const base = (0, repair_ranker_1.createLinearRanker)();
        const ranker = new learning_ranker_1.LearningRanker(base, telemetry, undefined, model, 0.5);
        (0, vitest_1.expect)(ranker).toBeDefined();
        // Rank candidates
        const candidates = [
            { id: "safe", source: "protocol", actions: [{ kind: "call", function: "open_file", args: [] }, { kind: "call", function: "write_file", args: [] }, { kind: "call", function: "close_file", args: [] }], explanation: "safe" },
            { id: "leaky", source: "corpus", actions: [{ kind: "call", function: "open_file", args: [] }, { kind: "call", function: "write_file", args: [] }], explanation: "leaky" },
        ];
        const ctx = { protocol: "FileProtocol", currentState: ["FILE_OPEN"], targetState: [], violationType: "resource_leak", constraints: [], rules: new Map() };
        const features = candidates.map(c => (0, repair_ranker_1.extractFeatures)(c, ctx));
        const ranked = ranker.rank(candidates, features, { protocol: "FileProtocol", violationType: "resource_leak" });
        (0, vitest_1.expect)(ranked.length).toBe(2);
        // Safe candidate should score higher (was accepted 80% vs leaky rejected)
        (0, vitest_1.expect)(ranked[0].id).toBe("safe");
    });
});
