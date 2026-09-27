"use strict";
/**
 * Phase 1: Trust Module — Public API
 *
 * Re-exports all public types and functions from the Trust Engine.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECISION_THRESHOLDS = exports.DEFAULT_GOVERNANCE_DEDUCTIONS = exports.DEFAULT_COVERAGE_MAX_SCORES = exports.DEFAULT_PROTOCOL_WEIGHTS = exports.DEFAULT_SEVERITY_DEDUCTIONS = exports.DEFAULT_DIMENSION_WEIGHTS = exports.TRUST_VIOLATION_REQUIRED_FIELDS = exports.formatTrustJSON = exports.formatTrustTerminal = exports.countViolationsBySeverity = exports.determineConfidence = exports.determineDecision = exports.calculateOverallScore = exports.scoreGovernanceIntegrity = exports.scoreVerificationCoverage = exports.scoreProtocolSafety = exports.scorePolicyCompliance = exports.isViolationComplete = exports.assertSixTuple = exports.checkExplainability = exports.evaluateTrust = void 0;
// Engine
var engine_1 = require("./engine");
Object.defineProperty(exports, "evaluateTrust", { enumerable: true, get: function () { return engine_1.evaluateTrust; } });
// Explainability
var explainability_1 = require("./explainability");
Object.defineProperty(exports, "checkExplainability", { enumerable: true, get: function () { return explainability_1.checkExplainability; } });
Object.defineProperty(exports, "assertSixTuple", { enumerable: true, get: function () { return explainability_1.assertSixTuple; } });
Object.defineProperty(exports, "isViolationComplete", { enumerable: true, get: function () { return explainability_1.isViolationComplete; } });
// Score Calculator
var score_calculator_1 = require("./score-calculator");
Object.defineProperty(exports, "scorePolicyCompliance", { enumerable: true, get: function () { return score_calculator_1.scorePolicyCompliance; } });
Object.defineProperty(exports, "scoreProtocolSafety", { enumerable: true, get: function () { return score_calculator_1.scoreProtocolSafety; } });
Object.defineProperty(exports, "scoreVerificationCoverage", { enumerable: true, get: function () { return score_calculator_1.scoreVerificationCoverage; } });
Object.defineProperty(exports, "scoreGovernanceIntegrity", { enumerable: true, get: function () { return score_calculator_1.scoreGovernanceIntegrity; } });
Object.defineProperty(exports, "calculateOverallScore", { enumerable: true, get: function () { return score_calculator_1.calculateOverallScore; } });
Object.defineProperty(exports, "determineDecision", { enumerable: true, get: function () { return score_calculator_1.determineDecision; } });
Object.defineProperty(exports, "determineConfidence", { enumerable: true, get: function () { return score_calculator_1.determineConfidence; } });
Object.defineProperty(exports, "countViolationsBySeverity", { enumerable: true, get: function () { return score_calculator_1.countViolationsBySeverity; } });
// Formatters
var terminal_1 = require("./formatters/terminal");
Object.defineProperty(exports, "formatTrustTerminal", { enumerable: true, get: function () { return terminal_1.formatTrustTerminal; } });
var json_1 = require("./formatters/json");
Object.defineProperty(exports, "formatTrustJSON", { enumerable: true, get: function () { return json_1.formatTrustJSON; } });
var types_1 = require("./types");
Object.defineProperty(exports, "TRUST_VIOLATION_REQUIRED_FIELDS", { enumerable: true, get: function () { return types_1.TRUST_VIOLATION_REQUIRED_FIELDS; } });
Object.defineProperty(exports, "DEFAULT_DIMENSION_WEIGHTS", { enumerable: true, get: function () { return types_1.DEFAULT_DIMENSION_WEIGHTS; } });
Object.defineProperty(exports, "DEFAULT_SEVERITY_DEDUCTIONS", { enumerable: true, get: function () { return types_1.DEFAULT_SEVERITY_DEDUCTIONS; } });
Object.defineProperty(exports, "DEFAULT_PROTOCOL_WEIGHTS", { enumerable: true, get: function () { return types_1.DEFAULT_PROTOCOL_WEIGHTS; } });
Object.defineProperty(exports, "DEFAULT_COVERAGE_MAX_SCORES", { enumerable: true, get: function () { return types_1.DEFAULT_COVERAGE_MAX_SCORES; } });
Object.defineProperty(exports, "DEFAULT_GOVERNANCE_DEDUCTIONS", { enumerable: true, get: function () { return types_1.DEFAULT_GOVERNANCE_DEDUCTIONS; } });
Object.defineProperty(exports, "DECISION_THRESHOLDS", { enumerable: true, get: function () { return types_1.DECISION_THRESHOLDS; } });
