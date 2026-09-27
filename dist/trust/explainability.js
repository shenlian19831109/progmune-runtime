"use strict";
/**
 * Phase 1: Explainability Binary Gate
 *
 * Checks every TrustViolation for complete 6-tuple evidence.
 * If ANY violation is missing ANY required field → UNCERTAIN.
 *
 * This is a GATE, not a scored dimension. An unexplainable Trust Score
 * is inherently untrustworthy and must be flagged rather than averaged in.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkExplainability = checkExplainability;
exports.assertSixTuple = assertSixTuple;
exports.isViolationComplete = isViolationComplete;
const types_1 = require("./types");
// ── Main Entry Point ──
/**
 * Binary gate: validates ALL violations have complete 6-tuple evidence.
 *
 * The 7 required fields (from the design doc):
 *   severity, rule_id, file, function, evidence, why, fix, policy_ref
 *
 * @returns EXPLAINABLE if all violations are complete, UNCERTAIN otherwise
 */
function checkExplainability(violations) {
    // Vacuous truth: no violations = explainable
    if (!violations || violations.length === 0) {
        return {
            status: "EXPLAINABLE",
            violationsChecked: 0,
            violationsComplete: 0,
        };
    }
    const missingFields = [];
    let violationsComplete = 0;
    for (let i = 0; i < violations.length; i++) {
        const v = violations[i];
        const missing = getMissingFields(v);
        if (missing.length === 0) {
            violationsComplete++;
        }
        else {
            missingFields.push({ index: i, missing });
        }
    }
    const status = missingFields.length === 0 ? "EXPLAINABLE" : "UNCERTAIN";
    return {
        status,
        violationsChecked: violations.length,
        violationsComplete,
        missingFields: missingFields.length > 0 ? missingFields : undefined,
    };
}
// ── Helpers ──
/**
 * Returns the list of required fields that are missing or empty in a violation.
 */
function getMissingFields(v) {
    const missing = [];
    for (const field of types_1.TRUST_VIOLATION_REQUIRED_FIELDS) {
        const value = v[field];
        if (value === undefined || value === null) {
            missing.push(field);
        }
        else if (typeof value === "string" && value.trim() === "") {
            missing.push(field);
        }
    }
    return missing;
}
/**
 * Type guard: checks if a partial violation object satisfies the full
 * TrustViolation interface (all required fields present and non-empty).
 */
function assertSixTuple(v) {
    if (!v)
        return false;
    return getMissingFields(v).length === 0;
}
/**
 * Convenience: quickly check if a single violation is complete.
 */
function isViolationComplete(v) {
    return getMissingFields(v).length === 0;
}
