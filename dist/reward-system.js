"use strict";
/**
 * P4.1-4.4: Reward System — Pairwise + Evaluator + Context + Dataset
 *
 * P4.1 Bradley-Terry Pairwise Model:
 *   P(A > B) = σ(score(A) - score(B))
 *   Trains on RepairPreference data from P3.11
 *   Signal quality: pairwise (A > B) > binary (accepted/rejected)
 *
 * P4.2 Off-Policy Evaluator++:
 *   Ranking-aware metrics: NDCG, Top1 Lift, Top3 Lift, Acceptance Lift
 *   Any new Ranker must pass Acceptance Lift > 0 before deployment
 *
 * P4.3 Contextual Reward:
 *   One-hot goal/protocol/violation features
 *   Same logistic regression, richer feature space
 *
 * P4.4 Reward Dataset:
 *   RewardExample JSONL export for future retraining at scale
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
exports.ContextualRewardModel = exports.PairwiseRewardModel = void 0;
exports.buildRewardDataset = buildRewardDataset;
exports.saveRewardDataset = saveRewardDataset;
exports.loadRewardDataset = loadRewardDataset;
exports.computeNDCG = computeNDCG;
exports.compareRankersOffPolicy = compareRankersOffPolicy;
exports.deploymentGate = deploymentGate;
exports.printRankingMetrics = printRankingMetrics;
exports.buildContextualFeatures = buildContextualFeatures;
exports.printRewardSystemReport = printRewardSystemReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const REWARD_DS_DIR = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus", "reward_dataset");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
/** Export all telemetry decisions as RewardExample JSONL. */
function buildRewardDataset(telemetry) {
    const examples = [];
    for (const d of telemetry.all()) {
        if (!d.feedback || !d.selectedCandidateId)
            continue;
        const sel = d.candidates.find(c => c.candidateId === d.selectedCandidateId);
        if (!sel || sel.actions.length === 0)
            continue;
        const accepted = d.feedback.decision === "accepted";
        const executed = d.feedback.executionResult?.success === true;
        const success = accepted && executed;
        const actionCount = sel.actions.length;
        const maxActions = Math.max(actionCount, 8);
        const safety = Math.max(0, 1.0 - actionCount / 10);
        examples.push({
            fingerprint: sel.candidateId,
            features: [
                safety, // protocolSafety
                0.5, // historicalSuccessRate
                actionCount / maxActions, // normActionCount
                Math.min(1, actionCount / maxActions), // latencyCost
                1.0 - actionCount / maxActions, // auditability
                accepted ? 1.0 : 0.0, // acceptanceRate
                executed ? 1.0 : 0.0, // executionSuccessRate
            ],
            accepted, executed, success,
            goal: d.goal,
            protocol: d.protocol,
            violationType: d.violationType,
            timestamp: d.timestamp,
        });
    }
    return examples;
}
/** Persist reward dataset to JSONL. */
function saveRewardDataset(examples, dir) {
    const outDir = dir || REWARD_DS_DIR;
    ensureDir(outDir);
    const filepath = path.join(outDir, `reward-${new Date().toISOString().slice(0, 10)}.jsonl`);
    const lines = examples.map(e => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(filepath, lines);
    return filepath;
}
/** Load all reward datasets. */
function loadRewardDataset(dir) {
    const outDir = dir || REWARD_DS_DIR;
    if (!fs.existsSync(outDir))
        return [];
    const examples = [];
    const files = fs.readdirSync(outDir).filter(f => f.endsWith(".jsonl"));
    for (const file of files) {
        const lines = fs.readFileSync(path.join(outDir, file), "utf-8").trim().split("\n");
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                examples.push(JSON.parse(line));
            }
            catch { /* skip */ }
        }
    }
    return examples;
}
// ═══════════════════════════════════════════════════════════════
// P4.1: Bradley-Terry Pairwise Model
// ═══════════════════════════════════════════════════════════════
function sigmoid(z) {
    if (z > 20)
        return 1.0;
    if (z < -20)
        return 0.0;
    return 1.0 / (1.0 + Math.exp(-z));
}
function dot(a, b) {
    return a.reduce((s, v, i) => s + v * b[i], 0);
}
/**
 * Bradley-Terry pairwise reward model.
 *
 *   score(x) = w·x + b
 *   P(A > B) = σ(score(A) - score(B))
 *
 * Trains on RepairPreference data (winner > loser pairs).
 */
class PairwiseRewardModel {
    constructor(weights, bias) {
        this.weights = weights || new Array(7).fill(0);
        this.bias = bias || 0;
        this.trained = weights !== undefined;
        this.trainedSamples = 0;
    }
    get isTrained() { return this.trained; }
    get sampleCount() { return this.trainedSamples; }
    /** Score a feature vector. */
    score(features) {
        return dot(this.weights, features) + this.bias;
    }
    /** Probability that A beats B. */
    predictPair(winnerFeatures, loserFeatures) {
        return sigmoid(this.score(winnerFeatures) - this.score(loserFeatures));
    }
    /** Convert preferences to pairwise samples. */
    static preferencesToSamples(preferences) {
        // We need feature vectors for each fingerprint — extract from telemetry
        // For now, use heuristic features based on action length
        return preferences.map(p => {
            // Heuristic: winner has shorter action chain? or parse from fingerprint
            const wCount = p.winnerActionCount || 1;
            const lCount = p.loserActionCount || 2;
            const maxA = Math.max(wCount, lCount, 8);
            return {
                winnerFeatures: [
                    1.0 - wCount / maxA, 0.5, wCount / maxA,
                    Math.min(1, wCount / maxA), 1.0 - wCount / maxA,
                    0.8, 0.9,
                ],
                loserFeatures: [
                    1.0 - lCount / maxA, 0.5, lCount / maxA,
                    Math.min(1, lCount / maxA), 1.0 - lCount / maxA,
                    0.2, 0.1,
                ],
                goal: p.goal,
                protocol: p.protocol,
            };
        });
    }
    /** Train on pairwise preference samples. */
    static train(samples, learningRate = 0.01, epochs = 100, l2Lambda = 0.001) {
        if (samples.length === 0)
            return new PairwiseRewardModel();
        let w = new Array(7).fill(0).map(() => (Math.random() - 0.5) * 0.1);
        let b = 0.0;
        for (let epoch = 0; epoch < epochs; epoch++) {
            const shuffled = [...samples].sort(() => Math.random() - 0.5);
            const wGrad = new Array(7).fill(0);
            for (const s of shuffled) {
                const diff = featureDiff(s.winnerFeatures, s.loserFeatures);
                const z = dot(w, diff); // + b cancels out for pairwise
                const p = sigmoid(z);
                const error = p - 1.0; // winner should win
                for (let i = 0; i < 7; i++) {
                    wGrad[i] += error * diff[i];
                }
            }
            const n = shuffled.length;
            for (let i = 0; i < 7; i++) {
                w[i] -= learningRate * (wGrad[i] / n + l2Lambda * w[i]);
            }
        }
        const model = new PairwiseRewardModel(w, b);
        model.trained = true;
        model.trainedSamples = samples.length;
        return model;
    }
}
exports.PairwiseRewardModel = PairwiseRewardModel;
function featureDiff(a, b) {
    return a.map((v, i) => v - b[i]);
}
/**
 * Compute NDCG for a ranked list against ground truth relevance.
 * relevance: binary array (1 = correct, 0 = incorrect).
 */
function computeNDCG(relevance, k) {
    const K = k || relevance.length;
    let dcg = 0;
    for (let i = 0; i < Math.min(K, relevance.length); i++) {
        dcg += relevance[i] / Math.log2(i + 2); // i+2 because log2(1) = 0, so start at log2(2)
    }
    // Ideal DCG: sorted descending
    const ideal = [...relevance].sort((a, b) => b - a);
    let idcg = 0;
    for (let i = 0; i < Math.min(K, ideal.length); i++) {
        idcg += ideal[i] / Math.log2(i + 2);
    }
    return idcg > 0 ? dcg / idcg : 0;
}
/**
 * Compare two ranking systems using NDCG and lift metrics.
 *
 * @param decisions  Historical decisions with ground truth (user choice)
 * @param oldRanker  Baseline ranker
 * @param newRanker  New ranker to evaluate
 * @returns          Lift metrics
 */
function compareRankersOffPolicy(decisions, _oldRanker, newRanker) {
    let oldNdcgTotal = 0;
    let newNdcgTotal = 0;
    let oldTop1 = 0;
    let newTop1 = 0;
    let oldTop3 = 0;
    let newTop3 = 0;
    let oldAccept = 0;
    let newAccept = 0;
    for (const d of decisions) {
        // Old ranker: assume original order (index 0 = rank 1)
        const oldRelevance = d.candidates.map(c => (c.accepted ? 1 : 0));
        const oldNdcg = computeNDCG(oldRelevance, 3);
        // New ranker: re-rank by newRanker scores
        const scored = d.candidates.map((c, i) => ({ ...c, origIdx: i, score: newRanker(c.features) }));
        scored.sort((a, b) => b.score - a.score);
        const newRelevance = scored.map(c => (c.accepted ? 1 : 0));
        const newNdcg = computeNDCG(newRelevance, 3);
        oldNdcgTotal += oldNdcg;
        newNdcgTotal += newNdcg;
        // Top-1/Top-3 matches
        const oldTop = d.candidates.slice(0, 1);
        const newTop = scored.slice(0, 1);
        if (oldTop.some(c => c.accepted))
            oldTop1++;
        if (newTop.some(c => c.accepted))
            newTop1++;
        const oldTop3Cands = d.candidates.slice(0, 3);
        const newTop3Cands = scored.slice(0, 3);
        if (oldTop3Cands.some(c => c.accepted))
            oldTop3++;
        if (newTop3Cands.some(c => c.accepted))
            newTop3++;
        // Acceptance: did the top candidate get accepted?
        if (d.candidates[0]?.accepted)
            oldAccept++;
        if (scored[0]?.accepted)
            newAccept++;
    }
    const n = decisions.length || 1;
    return {
        ndcg: newNdcgTotal / n,
        top1Lift: (newTop1 - oldTop1) / n,
        top3Lift: (newTop3 - oldTop3) / n,
        acceptanceLift: (newAccept - oldAccept) / n,
    };
}
/**
 * Deployment gate: new ranker must have Acceptance Lift > 0.
 */
function deploymentGate(metrics) {
    if (metrics.acceptanceLift <= 0) {
        return { passed: false, reason: `Acceptance Lift ${(metrics.acceptanceLift * 100).toFixed(1)}% ≤ 0 — rejected` };
    }
    if (metrics.ndcg < 0.3) {
        return { passed: false, reason: `NDCG ${(metrics.ndcg * 100).toFixed(1)}% < 30% — ranking quality insufficient` };
    }
    return { passed: true, reason: `All gates passed. Lift: ${(metrics.acceptanceLift * 100).toFixed(1)}%, NDCG: ${(metrics.ndcg * 100).toFixed(1)}%` };
}
function printRankingMetrics(metrics) {
    console.log("\n─── Off-Policy Ranking Evaluation ───");
    console.log(`  NDCG:              ${(metrics.ndcg * 100).toFixed(1)}%`);
    console.log(`  Top-1 Lift:        ${(metrics.top1Lift > 0 ? "+" : "")}${(metrics.top1Lift * 100).toFixed(1)}%`);
    console.log(`  Top-3 Lift:        ${(metrics.top3Lift > 0 ? "+" : "")}${(metrics.top3Lift * 100).toFixed(1)}%`);
    console.log(`  Acceptance Lift:   ${(metrics.acceptanceLift > 0 ? "+" : "")}${(metrics.acceptanceLift * 100).toFixed(1)}%`);
    const gate = deploymentGate(metrics);
    console.log(`\n  Gate: ${gate.passed ? "✅ PASS" : "❌ FAIL"} — ${gate.reason}`);
    console.log();
}
// ═══════════════════════════════════════════════════════════════
// P4.3: Contextual Reward Features
// ═══════════════════════════════════════════════════════════════
const KNOWN_GOALS = [
    "safely write", "authenticate", "logout", "query database",
    "extract IR", "validate action", "emit code", "record session",
];
const KNOWN_PROTOCOLS = ["FileProtocol", "AuthProtocol", "DBProtocol", "IRProtocol"];
const KNOWN_VIOLATIONS = ["resource_leak", "missing_prerequisite", "illegal_state_transition"];
/**
 * Extend base 7-d features with one-hot contextual features.
 * Total: 7 + 8 + 4 + 3 = 22 features.
 */
function buildContextualFeatures(baseFeatures, goal, protocol, violationType) {
    const features = [...baseFeatures];
    // One-hot goal encoding (8 dims)
    for (const g of KNOWN_GOALS) {
        features.push(goal.toLowerCase().includes(g.toLowerCase()) ? 1.0 : 0.0);
    }
    // One-hot protocol encoding (4 dims)
    for (const p of KNOWN_PROTOCOLS) {
        features.push(protocol === p ? 1.0 : 0.0);
    }
    // One-hot violation encoding (3 dims)
    for (const v of KNOWN_VIOLATIONS) {
        features.push(violationType === v ? 1.0 : 0.0);
    }
    return features;
}
/** ContextualRewardModel: logistic regression on 22-d features. */
class ContextualRewardModel {
    constructor(weights, bias) {
        this.weights = weights || new Array(ContextualRewardModel.FEATURE_DIM).fill(0);
        this.bias = bias || 0;
        this.trained = weights !== undefined;
    }
    get isTrained() { return this.trained; }
    score(features) {
        return sigmoid(dot(this.weights, features) + this.bias);
    }
    static train(examples, learningRate = 0.01, epochs = 100) {
        if (examples.length < 20)
            return new ContextualRewardModel();
        const dim = ContextualRewardModel.FEATURE_DIM;
        let w = new Array(dim).fill(0).map(() => (Math.random() - 0.5) * 0.1);
        let b = 0.0;
        for (let epoch = 0; epoch < epochs; epoch++) {
            const shuffled = [...examples].sort(() => Math.random() - 0.5);
            for (const ex of shuffled) {
                // Build contextual features
                const ctx = buildContextualFeatures(ex.features, ex.goal, ex.protocol, ex.violationType);
                const z = dot(w, ctx) + b;
                const p = sigmoid(z);
                const error = p - (ex.success ? 1 : 0);
                for (let i = 0; i < dim; i++) {
                    w[i] -= learningRate * error * ctx[i];
                }
                b -= learningRate * error;
            }
        }
        return new ContextualRewardModel(w, b);
    }
    featureImportance() {
        const baseNames = ["safety", "histSR", "actCount", "latCost", "audit", "accept", "execOk"];
        const allNames = [...baseNames, ...KNOWN_GOALS.map(g => `goal:${g}`), ...KNOWN_PROTOCOLS.map(p => `proto:${p}`), ...KNOWN_VIOLATIONS.map(v => `viol:${v}`)];
        const absW = this.weights.map(Math.abs);
        const total = absW.reduce((s, v) => s + v, 1);
        return allNames.map((name, i) => ({ name, weight: this.weights[i], importance: absW[i] / total }))
            .sort((a, b) => b.importance - a.importance);
    }
}
exports.ContextualRewardModel = ContextualRewardModel;
ContextualRewardModel.FEATURE_DIM = 22;
// ═══════════════════════════════════════════════════════════════
// Full Pipeline
// ═══════════════════════════════════════════════════════════════
function printRewardSystemReport(datasetSize, pairwiseSamples, rankingMetrics) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P4 Reward System Report                          ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`  Reward Dataset:     ${datasetSize} examples`);
    console.log(`  Pairwise Samples:   ${pairwiseSamples} pairs`);
    console.log();
    printRankingMetrics(rankingMetrics);
}
