/**
 * Phase 1: Trust Module — Public API
 *
 * Re-exports all public types and functions from the Trust Engine.
 */

// Engine
export { evaluateTrust } from "./engine";
export type { TrustEvaluationContext } from "./engine";

// Explainability
export { checkExplainability, assertSixTuple, isViolationComplete } from "./explainability";

// Score Calculator
export {
  scorePolicyCompliance,
  scoreProtocolSafety,
  scoreVerificationCoverage,
  scoreGovernanceIntegrity,
  calculateOverallScore,
  determineDecision,
  determineConfidence,
  countViolationsBySeverity,
} from "./score-calculator";
export type { GovernanceDefect } from "./score-calculator";

// Formatters
export { formatTrustTerminal } from "./formatters/terminal";
export { formatTrustJSON } from "./formatters/json";

// Types
export type {
  TrustDecision,
  TrustCheckInput,
  TrustViolation,
  TrustDecisionValue,
  ConfidenceLevel,
  ViolationSeverity,
  ExplainabilityStatus,
  TrustDimensions,
  DimensionScore,
  ProtocolSafetyScore,
  VerificationCoverageScore,
  ExplainabilityResult,
  UnavailableDimension,
  SeveritySummary,
  AuditTrail,
  ProtocolDetail,
  CoverageDetail,
} from "./types";

export {
  TRUST_VIOLATION_REQUIRED_FIELDS,
  DEFAULT_DIMENSION_WEIGHTS,
  DEFAULT_SEVERITY_DEDUCTIONS,
  DEFAULT_PROTOCOL_WEIGHTS,
  DEFAULT_COVERAGE_MAX_SCORES,
  DEFAULT_GOVERNANCE_DEDUCTIONS,
  DECISION_THRESHOLDS,
} from "./types";
