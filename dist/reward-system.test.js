"use strict";
/**
 * P4.1-4.4: Reward System Tests
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
const reward_system_1 = require("./reward-system");
const planner_telemetry_1 = require("./planner-telemetry");
const REW_DIR = path.resolve(__dirname, "..", "test-reward-system");
process.env.PROGMUNE_PROJECT_DIR = REW_DIR;
fs.mkdirSync(REW_DIR, { recursive: true });
fs.mkdirSync(path.join(REW_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
function seedTelemetry(n) {
    const t = new planner_telemetry_1.PlannerTelemetry(path.join(REW_DIR, ".progmune_corpus", "telemetry", `reward-${Date.now()}.jsonl`));
    for (let i = 0; i < n; i++) {
        const safe = i % 3 !== 0;
        const actions = safe ? ["open_file", "write_file", "close_file"] : ["open_file", "write_file"];
        const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", actions, "resource_leak");
        const id = t.recordDecision({
            goal: safe ? "safely write config" : "quick write",
            protocol: "FileProtocol", violationType: "resource_leak",
            candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: safe ? "safe" : "quick" }],
            selectedCandidateId: fp,
        });
        const accepted = safe ? Math.random() < 0.9 : Math.random() < 0.2;
        t.recordFeedback(id, {
            decision: accepted ? "accepted" : "rejected",
            executionResult: accepted ? { success: true, violations: [] } : { success: false, violations: ["resource_leak"] },
            timestamp: Date.now(),
        });
    }
    return t;
}
(0, vitest_1.describe)("P4.4 Reward Dataset", () => {
    (0, vitest_1.it)("builds and persists reward dataset", () => {
        const telemetry = seedTelemetry(100);
        const examples = (0, reward_system_1.buildRewardDataset)(telemetry);
        (0, vitest_1.expect)(examples.length).toBeGreaterThanOrEqual(50);
        for (const e of examples) {
            (0, vitest_1.expect)(e.features.length).toBe(7);
            (0, vitest_1.expect)(typeof e.accepted).toBe("boolean");
        }
        const fp = (0, reward_system_1.saveRewardDataset)(examples, path.join(REW_DIR, "reward_dataset"));
        (0, vitest_1.expect)(fs.existsSync(fp)).toBe(true);
        const loaded = (0, reward_system_1.loadRewardDataset)(path.join(REW_DIR, "reward_dataset"));
        (0, vitest_1.expect)(loaded.length).toBe(examples.length);
    });
});
(0, vitest_1.describe)("P4.1 PairwiseRewardModel", () => {
    (0, vitest_1.it)("trains on pairwise samples", () => {
        const samples = [];
        for (let i = 0; i < 100; i++) {
            samples.push({
                winnerFeatures: [1.0, 0.8, 0.3, 0.4, 0.75, 0.85, 0.9],
                loserFeatures: [0.3, 0.3, 0.6, 0.7, 0.3, 0.15, 0.1],
                goal: "safely write", protocol: "FileProtocol",
            });
        }
        const model = reward_system_1.PairwiseRewardModel.train(samples);
        (0, vitest_1.expect)(model.isTrained).toBe(true);
        (0, vitest_1.expect)(model.sampleCount).toBe(100);
        // Safe should beat leaky
        const prob = model.predictPair([1.0, 0.8, 0.3, 0.4, 0.75, 0.85, 0.9], [0.3, 0.3, 0.6, 0.7, 0.3, 0.15, 0.1]);
        (0, vitest_1.expect)(prob).toBeGreaterThan(0.5);
    });
});
(0, vitest_1.describe)("P4.2 Off-Policy Evaluator++", () => {
    (0, vitest_1.it)("computes NDCG correctly", () => {
        const perfect = [1, 1, 1, 0, 0];
        (0, vitest_1.expect)((0, reward_system_1.computeNDCG)(perfect)).toBe(1.0);
        const terrible = [0, 0, 0, 0, 1];
        (0, vitest_1.expect)((0, reward_system_1.computeNDCG)(terrible)).toBeLessThan(0.5);
        const mixed = [1, 0, 1, 0, 0];
        const ndcg = (0, reward_system_1.computeNDCG)(mixed);
        (0, vitest_1.expect)(ndcg).toBeGreaterThan(0.5);
        (0, vitest_1.expect)(ndcg).toBeLessThan(1.0);
    });
    (0, vitest_1.it)("compares rankers with lift metrics", () => {
        const decisions = Array.from({ length: 20 }, () => {
            const safe = Math.random() < 0.7;
            return {
                candidates: [
                    { features: safe ? [1.0, 0.8, 0.3, 0.4, 0.75, 0.85, 0.9] : [0.3, 0.3, 0.6, 0.5, 0.3, 0.15, 0.1], accepted: safe },
                    { features: safe ? [0.3, 0.3, 0.6, 0.5, 0.3, 0.15, 0.1] : [1.0, 0.8, 0.3, 0.4, 0.75, 0.85, 0.9], accepted: !safe },
                ],
                userChoseIndex: 0,
            };
        });
        // Old ranker: score = sum(features) — puts all weight on first feature magnitude
        const oldRanker = (f) => f.reduce((a, b) => a + b, 0);
        // New ranker: score = 2*acceptance + 2*execution — better aligned with truth
        const newRanker = (f) => f[5] * 2 + f[6] * 2;
        const metrics = (0, reward_system_1.compareRankersOffPolicy)(decisions, oldRanker, newRanker);
        (0, vitest_1.expect)(metrics.ndcg).toBeGreaterThan(0);
        (0, vitest_1.expect)(metrics.acceptanceLift).toBeGreaterThanOrEqual(-1);
        (0, vitest_1.expect)(metrics.acceptanceLift).toBeLessThanOrEqual(1);
        (0, reward_system_1.printRankingMetrics)(metrics);
        const gate = (0, reward_system_1.deploymentGate)(metrics);
        console.log(`  Deployment gate: ${gate.passed ? "PASS" : "FAIL"} — ${gate.reason}`);
    });
    (0, vitest_1.it)("deployment gate rejects negative lift", () => {
        const badMetrics = { ndcg: 0.45, top1Lift: 0.1, top3Lift: 0.05, acceptanceLift: -0.02 };
        (0, vitest_1.expect)((0, reward_system_1.deploymentGate)(badMetrics).passed).toBe(false);
    });
    (0, vitest_1.it)("deployment gate approves positive lift", () => {
        const goodMetrics = { ndcg: 0.55, top1Lift: 0.15, top3Lift: 0.1, acceptanceLift: 0.05 };
        (0, vitest_1.expect)((0, reward_system_1.deploymentGate)(goodMetrics).passed).toBe(true);
    });
});
(0, vitest_1.describe)("P4.3 ContextualRewardModel", () => {
    (0, vitest_1.it)("builds 22-d contextual features", () => {
        const base = [0.8, 0.5, 0.3, 0.4, 0.7, 0.85, 0.9];
        const ctx = (0, reward_system_1.buildContextualFeatures)(base, "safely write config", "FileProtocol", "resource_leak");
        (0, vitest_1.expect)(ctx.length).toBe(22); // 7 + 8 + 4 + 3
        // "safely write" goal bit should be 1
        (0, vitest_1.expect)(ctx[7]).toBe(1.0); // first goal feature
        // "FileProtocol" protocol bit should be 1
        (0, vitest_1.expect)(ctx[7 + 8]).toBe(1.0);
        // "resource_leak" violation bit should be 1
        (0, vitest_1.expect)(ctx[7 + 8 + 4]).toBe(1.0);
    });
    (0, vitest_1.it)("trains on reward examples", () => {
        const telemetry = seedTelemetry(200);
        const examples = (0, reward_system_1.buildRewardDataset)(telemetry);
        const model = reward_system_1.ContextualRewardModel.train(examples);
        (0, vitest_1.expect)(model.isTrained).toBe(true);
        // Safe repair should score higher
        const safeScore = model.score((0, reward_system_1.buildContextualFeatures)([0.8, 0.5, 0.3, 0.4, 0.7, 0.85, 0.9], "safely write config", "FileProtocol", "resource_leak"));
        (0, vitest_1.expect)(safeScore).toBeGreaterThan(0.5);
        const imp = model.featureImportance();
        (0, vitest_1.expect)(imp.length).toBe(22);
        (0, vitest_1.expect)(imp[0].importance).toBeGreaterThan(0);
    });
});
(0, vitest_1.describe)("Reward System Report", () => {
    (0, vitest_1.it)("prints full system report", () => {
        const metrics = { ndcg: 0.62, top1Lift: 0.12, top3Lift: 0.08, acceptanceLift: 0.04 };
        (0, reward_system_1.printRewardSystemReport)(250, 100, metrics);
    });
});
