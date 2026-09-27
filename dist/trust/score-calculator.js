"use strict";
/**
 * Phase 1: Trust Score Calculator
 *
 * Pure functions implementing the weighted scoring formulas,
 * decision mapping, and confidence determination from the
 * AI Trust Decision Model v1 design doc.
 *
 * All functions are PURE — no side effects, no I/O.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scorePolicyCompliance = scorePolicyCompliance;
exports.scoreProtocolSafety = scoreProtocolSafety;
exports.scoreVerificationCoverage = scoreVerificationCoverage;
exports.scoreGovernanceIntegrity = scoreGovernanceIntegrity;
exports.calculateOverallScore = calculateOverallScore;
exports.determineDecision = determineDecision;
exports.determineConfidence = determineConfidence;
exports.countViolationsBySeverity = countViolationsBySeverity;
const types_1 = require("./types");
// ═══════════════════════════════════════════════
//  1. Policy Compliance (35%)
// ═══════════════════════════════════════════════
/**
 * Score = max(0, 100 - sum of severity deductions)
 *
 * Critical violation forces score ≤ DECISION_THRESHOLDS.criticalLock (59).
 */
function scorePolicyCompliance(violations, deductions) {
    const weights = deductions || types_1.DEFAULT_SEVERITY_DEDUCTIONS;
    let totalDeduction = 0;
    let hasCritical = false;
    for (const v of violations) {
        if (v.severity === "critical") {
            hasCritical = true;
        }
        totalDeduction += weights[v.severity] || 0;
    }
    let score = Math.max(0, 100 - totalDeduction);
    // Hard gate: critical → lock to ≤ 59
    if (hasCritical) {
        score = Math.min(score, types_1.DECISION_THRESHOLDS.criticalLock);
    }
    return { score, hasCritical };
}
// ═══════════════════════════════════════════════
//  2. Protocol Safety (30%)
// ═══════════════════════════════════════════════
/**
 * Each protocol is scored internally by severity (same deduction logic).
 * Final score = weighted average across protocols.
 */
function scoreProtocolSafety(violations, protocolWeights) {
    const weights = protocolWeights || types_1.DEFAULT_PROTOCOL_WEIGHTS;
    const protocolNames = Object.keys(weights);
    // Group violations by protocol category (rule_id prefix before "_")
    const byProtocol = {};
    for (const v of violations) {
        const protocol = extractProtocol(v);
        if (!byProtocol[protocol])
            byProtocol[protocol] = [];
        byProtocol[protocol].push(v);
    }
    // Score each protocol
    const details = {};
    for (const name of protocolNames) {
        const protViolations = byProtocol[name] || [];
        const { score: rawScore } = scorePolicyCompliance(protViolations);
        details[name] = {
            score: rawScore,
            violations: protViolations.length,
            weight: weights[name] || 0,
        };
    }
    // Weighted average: Σ(score × weight) / Σ(weight)
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [name, detail] of Object.entries(details)) {
        weightedSum += detail.score * detail.weight;
        totalWeight += detail.weight;
    }
    const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 100;
    // Determine confidence for this dimension
    // A protocol is considered "checked" if it was evaluated (score < 100 found issues,
    // or score = 100 with no violations means we checked and it passed clean)
    const protocolsChecked = Object.values(details).filter((d) => d.score <= 100 // all protocols are always evaluated
    ).length;
    const confidenceRatio = protocolNames.length > 0
        ? Math.min(1, protocolsChecked / protocolNames.length)
        : 1;
    const confidence = mapDimensionConfidence(confidenceRatio);
    // Collect only protocol-related violations for evidence
    const protocolViolations = violations.filter((v) => protocolNames.includes(extractProtocol(v)));
    return {
        score,
        weight: types_1.DEFAULT_DIMENSION_WEIGHTS.protocolSafety,
        confidence,
        details,
        violations: protocolViolations,
    };
}
/**
 * Extract protocol category from a violation's rule_id.
 * Rules: "AUTH_*" → authentication, "AUTHZ_*" → authorization,
 *        "PAY_*" → payment, "DATA_*" → data_integrity,
 *        "LEDGER_*" → ledger
 * Falls back to "authentication" as default.
 */
function extractProtocol(v) {
    const prefix = v.rule_id.split("_")[0]?.toLowerCase() || "";
    const mapping = {
        auth: "authentication",
        authz: "authorization",
        pay: "payment",
        data: "data_integrity",
        ledger: "ledger",
        txn: "payment",
        integrity: "data_integrity",
    };
    return mapping[prefix] || "authentication";
}
// ═══════════════════════════════════════════════
//  3. Verification Coverage (20%)
// ═══════════════════════════════════════════════
/**
 * Score = sum of sub-scores (max 100).
 * Each sub-check has a max score defined in DEFAULT_COVERAGE_MAX_SCORES.
 */
function scoreVerificationCoverage(data) {
    const maxScores = types_1.DEFAULT_COVERAGE_MAX_SCORES;
    const details = {};
    let totalScore = 0;
    let hasData = 0;
    let totalChecks = 0;
    for (const [name, max] of Object.entries(maxScores)) {
        const value = data[name];
        totalChecks++;
        if (value !== undefined && !Number.isNaN(value)) {
            hasData++;
            const capped = Math.min(value, max);
            details[name] = { score: capped, max };
            totalScore += capped;
        }
        else {
            // Data unavailable → 0 for this sub-check
            details[name] = { score: 0, max };
        }
    }
    const confidenceRatio = totalChecks > 0 ? hasData / totalChecks : 0;
    const confidence = mapDimensionConfidence(confidenceRatio);
    return {
        score: Math.min(totalScore, 100),
        weight: types_1.DEFAULT_DIMENSION_WEIGHTS.verificationCoverage,
        confidence,
        details,
    };
}
/**
 * Score = 100 - sum of defect deductions.
 */
function scoreGovernanceIntegrity(defects, deductions) {
    const weights = deductions || types_1.DEFAULT_GOVERNANCE_DEDUCTIONS;
    let totalDeduction = 0;
    for (const d of defects) {
        totalDeduction += weights[d.type] || 0;
    }
    const score = Math.max(0, 100 - totalDeduction);
    return {
        score,
        weight: types_1.DEFAULT_DIMENSION_WEIGHTS.governanceIntegrity,
        confidence: "HIGH", // Governance data is always available from ledger
    };
}
/**
 * Overall = Σ(score × weight) for all active dimensions.
 * Only dimensions with weight > 0 are included.
 */
function calculateOverallScore(dimensions) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const d of dimensions) {
        const safeScore = Number.isNaN(d.score) ? 0 : d.score;
        weightedSum += safeScore * d.weight;
        totalWeight += d.weight;
    }
    if (totalWeight <= 0)
        return 0;
    const result = Math.round(weightedSum / totalWeight);
    return Number.isNaN(result) ? 0 : result;
}
// ═══════════════════════════════════════════════
//  6. Decision Mapping
// ═══════════════════════════════════════════════
/**
 * Maps score + gates → APPROVED / NEEDS_REVIEW / BLOCKED.
 *
 * Rules:
 *   - Critical violation → BLOCKED (overrides score)
 *   - Score < 60 → BLOCKED
 *   - 60 ≤ Score < 80 → NEEDS_REVIEW
 *   - Score ≥ 80 → APPROVED
 *   - Explainability UNCERTAIN → degrade one level
 */
function determineDecision(overallScore, hasCriticalViolation, explainabilityStatus) {
    // Hard gate: critical = BLOCKED regardless of score
    if (hasCriticalViolation) {
        return "BLOCKED";
    }
    // Base decision from score
    let decision;
    if (overallScore >= types_1.DECISION_THRESHOLDS.approved) {
        decision = "APPROVED";
    }
    else if (overallScore >= types_1.DECISION_THRESHOLDS.needsReview) {
        decision = "NEEDS_REVIEW";
    }
    else {
        decision = "BLOCKED";
    }
    // Explainability degrade: drop one level
    if (explainabilityStatus === "UNCERTAIN") {
        if (decision === "APPROVED")
            return "NEEDS_REVIEW";
        if (decision === "NEEDS_REVIEW")
            return "BLOCKED";
        // Already BLOCKED, stays BLOCKED
    }
    return decision;
}
// ═══════════════════════════════════════════════
//  7. Confidence Determination
// ═══════════════════════════════════════════════
/**
 * Maps dimension confidence levels → Overall Confidence.
 *
 * Rules:
 *   - Explainability UNCERTAIN → overall UNCERTAIN
 *   - Any dimension LOW → overall LOW
 *   - 2+ dimensions MEDIUM → overall MEDIUM
 *   - All HIGH → overall HIGH
 */
function determineConfidence(dimConfidences, explainabilityStatus) {
    // Explainability gate overrides everything
    if (explainabilityStatus === "UNCERTAIN") {
        return "UNCERTAIN";
    }
    const lowCount = dimConfidences.filter((c) => c === "LOW").length;
    const mediumCount = dimConfidences.filter((c) => c === "MEDIUM").length;
    if (lowCount > 0)
        return "LOW";
    if (mediumCount >= 2)
        return "MEDIUM";
    if (mediumCount === 1)
        return "MEDIUM"; // Even one medium drags confidence
    return "HIGH";
}
// ═══════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════
/**
 * Map a 0-1 ratio to a dimension-level confidence.
 * ≥ 0.8 → HIGH, 0.6-0.8 → MEDIUM, < 0.6 → LOW
 */
function mapDimensionConfidence(ratio) {
    if (ratio >= 0.8)
        return "HIGH";
    if (ratio >= 0.6)
        return "MEDIUM";
    return "LOW";
}
/**
 * Count violations by severity.
 */
function countViolationsBySeverity(violations) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, total: violations.length };
    for (const v of violations) {
        if (v.severity in counts) {
            counts[v.severity]++;
        }
    }
    return counts;
}
