"use strict";
/**
 * P2: Repair Ranker — Feature Extraction & Linear Ranking
 *
 * FeatureExtractor: RepairCandidate → CandidateFeatures
 * LinearRanker:    CandidateFeatures[] → ranked RepairCandidate[]
 *
 * Default weights (P3 — manual):
 *   score = 0.4 * protocolSafety + 0.3 * historicalSuccessRate
 *         + 0.2 * performance + 0.1 * auditability
 *
 * Future P4: swap LinearRanker for RewardModelRanker — same interface.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFeatures = extractFeatures;
exports.createLinearRanker = createLinearRanker;
exports.rankCandidates = rankCandidates;
/**
 * Extract a feature vector from a repair candidate.
 *
 * All features are in [0, 1] range where possible, so the Ranker
 * can combine them with simple linear weights.
 */
function extractFeatures(candidate, ctx, corpusStats) {
    const actionCount = candidate.actions.length;
    const maxActions = corpusStats?.maxActions || Math.max(actionCount, 8);
    // ── protocolSafety ──
    // Candidates that satisfy more constraints are safer.
    // Shorter paths are inherently safer (fewer things can go wrong).
    const safetyFromLength = 1.0 - actionCount / 10;
    const constraintMatch = ctx.constraints.length > 0
        ? ctx.constraints.filter(c => c.type === "safety" || c.type === "security").length
            / Math.max(1, ctx.constraints.length)
        : 0.5;
    const protocolSafety = Math.max(0, Math.min(1, safetyFromLength * 0.6 + constraintMatch * 0.4));
    // ── historicalSuccessRate ──
    // From corpus strategy metadata, or 0 if not available.
    const historicalSuccessRate = candidate.metadata?.historicalSuccessRate || 0;
    // ── actionCount ──
    // Raw count — used by rankPerformance.
    // ── latencyCost ──
    // Inverted: more actions = higher latency cost.
    const latencyCost = Math.min(1, actionCount / maxActions);
    // ── auditability ──
    // Shorter paths are easier to audit.
    const auditability = Math.max(0, 1.0 - actionCount / maxActions);
    // ── corpusEvidence ──
    const corpusEvidence = candidate.metadata?.corpusEvidenceCount || 0;
    // ── goalMatch (P7.3) ──
    // Candidates from goal-template matching get a 1.0 boost.
    // Cross-protocol and frontier candidates get a 0.3 partial boost
    // since they still represent structured protocol knowledge.
    const metaSource = candidate.metadata?.source;
    const goalMatch = metaSource === "goal-template" ? 1.0
        : metaSource === "cross-protocol" ? 0.3
            : 0.0;
    return {
        protocolSafety,
        historicalSuccessRate,
        actionCount,
        latencyCost,
        auditability,
        corpusEvidence,
        source: candidate.source,
        goalMatch,
    };
}
// ═══════════════════════════════════════════════════════════════
// Linear Ranker
// ═══════════════════════════════════════════════════════════════
/** Default P3 manual weights. Tune these from corpus data. */
const DEFAULT_WEIGHTS = {
    safety: 0.30,
    successRate: 0.15,
    performance: 0.10,
    auditability: 0.10,
    goalMatch: 0.35, // P7.3: boost goal-template candidates heavily
};
/**
 * Create a linear ranker with configurable weights.
 *
 * Usage:
 *   const ranker = createLinearRanker();                    // defaults
 *   const ranker = createLinearRanker({ safety: 0.5 });     // safety-first
 */
function createLinearRanker(weights) {
    const w = { ...DEFAULT_WEIGHTS, ...weights };
    /** Compute performance from features: fewer actions = better. */
    function performanceScore(f) {
        return 1.0 - Math.min(1, f.actionCount / Math.max(1, f.actionCount + 3));
    }
    /** Compute the weighted overall score. */
    function overallScore(f) {
        return (w.safety * f.protocolSafety +
            w.successRate * f.historicalSuccessRate +
            w.performance * performanceScore(f) +
            w.auditability * f.auditability +
            w.goalMatch * (f.goalMatch || 0));
    }
    /** Zip candidates with features and sort by a scoring function. */
    function rankBy(candidates, features, scoreFn) {
        const paired = candidates.map((c, i) => ({
            candidate: c,
            score: scoreFn(features[i]),
        }));
        paired.sort((a, b) => b.score - a.score);
        return paired.map(p => p.candidate);
    }
    return {
        score(features) {
            return overallScore(features);
        },
        rankSafety(candidates, features) {
            return rankBy(candidates, features, f => f.protocolSafety);
        },
        rankPerformance(candidates, features) {
            return rankBy(candidates, features, f => performanceScore(f));
        },
        rankAuditability(candidates, features) {
            return rankBy(candidates, features, f => f.auditability);
        },
        rankOverall(candidates, features) {
            return rankBy(candidates, features, f => overallScore(f));
        },
    };
}
// ═══════════════════════════════════════════════════════════════
// Convenience: rankCandidates
// ═══════════════════════════════════════════════════════════════
/**
 * Rank candidates using the linear ranker in one call.
 * Convenience wrapper around extractFeatures + createLinearRanker.
 */
function rankCandidates(candidates, ctx, mode = "overall") {
    const maxActions = Math.max(...candidates.map(c => c.actions.length), 8);
    const features = candidates.map(c => extractFeatures(c, ctx, { maxActions }));
    const ranker = createLinearRanker();
    const ranked = ranker.rankOverall(candidates, features);
    // Assign rank fields
    return ranked.map((c, i) => ({ ...c, rank: i + 1 }));
}
