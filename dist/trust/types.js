"use strict";
/**
 * Phase 1: AI Trust Decision Model — Type Definitions
 *
 * Self-contained type system for the Trust Decision Engine.
 * Does NOT modify or depend on existing types in src/policy/types.ts
 * or src/audit/types.ts. The Trust Engine maps from those types into
 * these types during evaluation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECISION_THRESHOLDS = exports.DEFAULT_GOVERNANCE_DEDUCTIONS = exports.DEFAULT_COVERAGE_MAX_SCORES = exports.DEFAULT_PROTOCOL_WEIGHTS = exports.DEFAULT_SEVERITY_DEDUCTIONS = exports.DEFAULT_DIMENSION_WEIGHTS = exports.TRUST_VIOLATION_REQUIRED_FIELDS = void 0;
/** The 7 required fields for explainability completeness */
exports.TRUST_VIOLATION_REQUIRED_FIELDS = [
    "severity",
    "rule_id",
    "file",
    "function",
    "evidence",
    "why",
    "fix",
    "policy_ref",
];
// ── Default Dimension Weights (from design doc) ──
exports.DEFAULT_DIMENSION_WEIGHTS = {
    policyCompliance: 0.35,
    protocolSafety: 0.30,
    verificationCoverage: 0.20,
    governanceIntegrity: 0.15,
    evolutionStability: 0.00, // N/A in v1
};
// ── Default Severity Deductions (from design doc) ──
exports.DEFAULT_SEVERITY_DEDUCTIONS = {
    critical: 40,
    high: 20,
    medium: 8,
    low: 2,
};
// ── Default Protocol Weights ──
exports.DEFAULT_PROTOCOL_WEIGHTS = {
    authentication: 0.25,
    authorization: 0.20,
    payment: 0.20,
    data_integrity: 0.20,
    ledger: 0.15,
};
// ── Default Verification Coverage Max Scores ──
exports.DEFAULT_COVERAGE_MAX_SCORES = {
    typescriptTypeCheck: 25,
    ssgRules: 30,
    ledgerInvariant: 20,
    coverage: 15,
    failureGenome: 10,
};
// ── Default Governance Integrity Deductions ──
exports.DEFAULT_GOVERNANCE_DEDUCTIONS = {
    hashMismatch: 50,
    ledgerMissing: 30,
    chainBroken: 20,
    auditIncomplete: 10,
};
// ── Decision Thresholds ──
exports.DECISION_THRESHOLDS = {
    approved: 80,
    needsReview: 60,
    // below 60 = BLOCKED
    criticalLock: 59, // max score when critical violation exists
};
