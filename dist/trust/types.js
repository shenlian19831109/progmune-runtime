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
exports.DECISION_THRESHOLDS = exports.DEFAULT_GOVERNANCE_DEDUCTIONS = exports.DEFAULT_COVERAGE_MAX_SCORES = exports.DEFAULT_PROTOCOL_WEIGHTS = exports.DEFAULT_SEVERITY_DEDUCTIONS = exports.DEFAULT_DIMENSION_WEIGHTS = exports.OBSERVATION_RATE_FLOOR = exports.SECURITY_PROTOCOL_FLOOR = exports.SECURITY_PROTOCOLS = exports.TRUST_VIOLATION_REQUIRED_FIELDS = void 0;
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
// ── Decision Gates（§53 / R97） ──
//
// 背景（immich + nocodb 实测）：authentication 子协议 0 分（21 条 / 586 条违规）、
// coverageConfidence 0% LOW、mappingCoverage 4%~8% LOW —— 三项独立的
// 「我们其实没看到什么」指标全部触底，输出却仍是 83 / APPROVED / HIGH。
// 根因是聚合层只有「分数 → 档位」一条路径，没有任何**下限**与**观察度门槛**。
/** 安全相关协议：这些维度出现塌方时，不得给出「通过」结论 */
exports.SECURITY_PROTOCOLS = [
    "authentication",
    "authorization",
    "data_integrity",
];
/** 安全协议分数下限：任一条已观察的安全协议低于此分 ⇒ decision 不得为 APPROVED */
exports.SECURITY_PROTOCOL_FLOOR = 50;
/** 观察度门槛：coverage / mapping 命中率低于此值 ⇒ 视为「没看清楚」 */
exports.OBSERVATION_RATE_FLOOR = 0.3;
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
