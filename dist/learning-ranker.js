"use strict";
/**
 * P2.6: Learning Ranker — Feedback-Weighted Ranking
 *
 * Wraps a base Ranker and adjusts scores using real acceptance data
 * from the TelemetryIndex. This is the first self-improving loop:
 *
 *   Planner → Feedback → Telemetry → LearningRanker → Better Ranking
 *
 * Architecture:
 *   LearningRanker WRAPS Ranker (does not implement it).
 *   Base Ranker handles protocolSafety / performance / auditability.
 *   LearningRanker adds feedback correction on top.
 *
 * Evolution path:
 *   HeuristicRanker (P3) → LearningRanker (P2.6) → RewardModelRanker (P4)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LearningRanker = void 0;
exports.createLearningRanker = createLearningRanker;
const planner_telemetry_1 = require("./planner-telemetry");
const repair_ranker_1 = require("./repair-ranker");
const DEFAULT_CONFIG = {
    baseWeight: 0.7,
    feedbackWeight: 0.3,
    minSamples: 5,
};
/**
 * LearningRanker wraps a base CandidateRanker and applies
 * feedback correction from the TelemetryIndex.
 *
 * Usage:
 *   const base = createLinearRanker();
 *   const learner = new LearningRanker(base, telemetry);
 *   const ranked = learner.rank(candidates, features, ctx);
 */
class LearningRanker {
    constructor(baseRanker, telemetry, config, rewardModel, modelWeight = 0.5) {
        this.base = baseRanker;
        this.telemetry = telemetry;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.rewardModel = rewardModel;
        this.modelWeight = modelWeight;
    }
    /**
     * Rank candidates by base heuristic score, then adjust
     * using acceptance data from the telemetry index.
     *
     * @param candidates  Repair candidates to rank
     * @param features    Feature vectors (same index as candidates)
     * @param ctx         Search context (for protocol/violationType)
     */
    rank(candidates, features, ctx) {
        // 1. Score with base ranker
        const baseScores = features.map(f => this.base.score(f));
        // 2. Adjust with telemetry feedback + reward model (if available)
        const ranked = candidates.map((c, i) => {
            const fp = this.fingerprintFor(c, ctx);
            const acceptance = this.telemetry.getCandidateAcceptance(fp, this.config.minSamples);
            const effectiveReward = this.telemetry.getCandidateReward(fp, this.config.minSamples);
            const baseScore = baseScores[i];
            let adjustedScore;
            if (this.rewardModel && this.rewardModel.isTrained) {
                // Reward model: blend base + telemetry + model prediction
                const acceptTotal = acceptance;
                const execTotal = this.telemetry.getCandidateStats(fp);
                const execRate = (execTotal.executionSuccess + execTotal.executionFailure) > 0
                    ? execTotal.executionSuccess / (execTotal.executionSuccess + execTotal.executionFailure) : 0.5;
                const modelScore = this.rewardModel.score(features[i], { acceptanceRate: acceptTotal, executionSuccessRate: execRate });
                adjustedScore =
                    baseScore * this.config.baseWeight * 0.5 +
                        effectiveReward * this.config.feedbackWeight * 0.3 +
                        modelScore * this.modelWeight;
            }
            else {
                // Fallback: base + telemetry feedback only
                adjustedScore =
                    baseScore * this.config.baseWeight +
                        effectiveReward * this.config.feedbackWeight;
            }
            return {
                ...c,
                score: adjustedScore,
                acceptance,
                effectiveReward,
                baseScore,
            };
        });
        // 3. Sort by adjusted score descending
        ranked.sort((a, b) => b.score - a.score);
        return ranked;
    }
    /**
     * Single-candidate score (used by backwards-compat code).
     */
    score(candidate, features, ctx) {
        const fp = this.fingerprintFor(candidate, ctx);
        const baseScore = this.base.score(features);
        const effectiveReward = this.telemetry.getCandidateReward(fp, this.config.minSamples);
        return (baseScore * this.config.baseWeight +
            effectiveReward * this.config.feedbackWeight);
    }
    /**
     * Record a single feedback event for incremental learning.
     * Convenience method for integration tests and CLI usage.
     */
    onFeedback(event) {
        const fp = this.fingerprintFor({ id: event.candidateId, source: "protocol", actions: event.fixPath.map(fn => ({ kind: "call", function: fn, args: [] })), explanation: "" }, { protocol: "default", violationType: undefined });
        if (event.accepted) {
            this.telemetry.recordFeedback(event.candidateId, {
                decision: "accepted",
                executionResult: { success: event.accepted, violations: [] },
                timestamp: Date.now(),
            });
        }
    }
    /** Compute the v2 fingerprint for a candidate. */
    fingerprintFor(candidate, ctx) {
        const actions = candidate.actions
            .filter(a => a.kind === "call")
            .map(a => a.function);
        return (0, planner_telemetry_1.candidateFingerprint)(ctx.protocol, actions, ctx.violationType);
    }
}
exports.LearningRanker = LearningRanker;
// ═══════════════════════════════════════════════════════════════
// Convenience factory
// ═══════════════════════════════════════════════════════════════
/**
 * Create a fully wired learning ranker:
 *   LinearRanker (base) + TelemetryIndex (feedback) = LearningRanker
 */
function createLearningRanker(baseRankerOrTelemetry, telemetryOrConfig, compatConfig) {
    // Backward compat: createLearningRanker(baseRanker, telemetry, config)
    if (telemetryOrConfig instanceof planner_telemetry_1.PlannerTelemetry) {
        const base = baseRankerOrTelemetry;
        const telemetry = telemetryOrConfig;
        // Map learningRate/feedbackWindow to baseWeight/feedbackWeight/minSamples
        const config = {};
        if (compatConfig?.learningRate !== undefined)
            config.feedbackWeight = compatConfig.learningRate;
        if (compatConfig?.feedbackWindow !== undefined)
            config.minSamples = compatConfig.feedbackWindow;
        return new LearningRanker(base, telemetry, { ...config, ...compatConfig });
    }
    // New API: createLearningRanker(telemetry, config)
    return new LearningRanker((0, repair_ranker_1.createLinearRanker)(), baseRankerOrTelemetry, telemetryOrConfig);
}
