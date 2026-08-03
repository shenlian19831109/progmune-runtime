/**
 * Phase 1: AI Trust Decision Model — Type Definitions
 *
 * Self-contained type system for the Trust Decision Engine.
 * Does NOT modify or depend on existing types in src/policy/types.ts
 * or src/audit/types.ts. The Trust Engine maps from those types into
 * these types during evaluation.
 */

// ── Core Enums ──

export type TrustDecisionValue = "APPROVED" | "NEEDS_REVIEW" | "BLOCKED";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNCERTAIN";
export type ViolationSeverity = "critical" | "high" | "medium" | "low";
export type ExplainabilityStatus = "EXPLAINABLE" | "UNCERTAIN";

// ── Input ──

export interface TrustCheckInput {
  project: string;
  commit: string;
  branch?: string;
  policy?: string;
  context?: {
    language?: string;
    previousCommit?: string;
    baseBranch?: string;
  };
}

export interface TrustEvaluationContext {
  projectPath: string;
  projectName: string;
  commit: string;
  branch?: string;
  policyName?: string;
  language?: string;
  previousCommit?: string;
}

// ── 6-Tuple Evidence Violation ──

export interface TrustViolation {
  severity: ViolationSeverity;
  rule_id: string;
  file: string;
  function: string;
  message: string;
  evidence: string;
  why: string;
  fix: string;
  policy_ref: string;
}

/** The 7 required fields for explainability completeness */
export const TRUST_VIOLATION_REQUIRED_FIELDS: (keyof TrustViolation)[] = [
  "severity",
  "rule_id",
  "file",
  "function",
  "evidence",
  "why",
  "fix",
  "policy_ref",
];

// ── Overall Output ──

export interface TrustDecision {
  project: string;
  commit: string;
  timestamp: string;
  engineVersion: string;

  overall: {
    score: number;
    decision: TrustDecisionValue;
    confidence: ConfidenceLevel;
    /** Phase 1: Coverage-based confidence (computed, not labeled) */
    coverageConfidence?: {
      score: number;
      margin: number;
      level: "HIGH" | "MEDIUM" | "LOW";
      summary: string;
    };
    /** Phase 4: Semantic mapping coverage (API→domain hit rate) */
    mappingCoverage?: {
      /** % of APIs mapped to a known domain (not util/noise) */
      rate: number;
      /** Number of APIs resolved via prefix lookup */
      lookupHits: number;
      /** Number of APIs resolved via LLM fallback */
      llmHits: number;
      /** Total APIs mapped */
      totalApis: number;
      /** Assessment: GOOD (>70%), ADEQUATE (40-70%), LOW (<40%) */
      level: "GOOD" | "ADEQUATE" | "LOW";
      /** Phase 5: Number of sequences enriched via call graph propagation */
      propagatedDomains?: number;
      /** Phase 5: Whether IR-based call graph was available */
      graphAvailable?: boolean;
    };
  };

  dimensions: TrustDimensions;
  violations: TrustViolation[];
  /** Phase 3: Structured reasoning chains for each violation */
  violationTraces?: Array<{
    rule_id: string;
    file: string;
    function: string;
    steps: Array<{
      step: number;
      label: string;
      action: string;
      preState: string;
      explanation: string;
    }>;
    fixPath: string[];
    estimatedReadingTimeMinutes: number;
  }>;
  summary: SeveritySummary;
  auditTrail: AuditTrail;
}

// ── Dimension Results ──

export interface TrustDimensions {
  policyCompliance: DimensionScore;
  protocolSafety: ProtocolSafetyScore;
  verificationCoverage: VerificationCoverageScore;
  governanceIntegrity: DimensionScore;
  explainability: ExplainabilityResult;
  evolutionStability: UnavailableDimension;
}

export interface DimensionScore {
  score: number;
  weight: number;
  confidence: Exclude<ConfidenceLevel, "UNCERTAIN">;
  violations?: TrustViolation[];
}

export interface ProtocolSafetyScore extends DimensionScore {
  details: Record<string, ProtocolDetail>;
}

export interface ProtocolDetail {
  score: number;
  violations: number;
  weight: number;
}

export interface VerificationCoverageScore extends DimensionScore {
  details: Record<string, CoverageDetail>;
}

export interface CoverageDetail {
  score: number;
  max: number;
}

export interface ExplainabilityResult {
  status: ExplainabilityStatus;
  violationsChecked: number;
  violationsComplete: number;
  missingFields?: Array<{ index: number; missing: string[] }>;
}

export interface UnavailableDimension {
  score: null;
  weight: number;
  status: "UNAVAILABLE";
  reason: string;
}

// ── Auxiliary ──

export interface SeveritySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface AuditTrail {
  commit: string;
  policy: string;
  policyVersion: string;
  engineVersion: string;
  generatedAt: string;
  reproducible: boolean;
  checkId: string;
}

// ── Default Dimension Weights (from design doc) ──

export const DEFAULT_DIMENSION_WEIGHTS = {
  policyCompliance: 0.35,
  protocolSafety: 0.30,
  verificationCoverage: 0.20,
  governanceIntegrity: 0.15,
  evolutionStability: 0.00, // N/A in v1
} as const;

// ── Default Severity Deductions (from design doc) ──

export const DEFAULT_SEVERITY_DEDUCTIONS: Record<ViolationSeverity, number> = {
  critical: 40,
  high: 20,
  medium: 8,
  low: 2,
};

// ── Default Protocol Weights ──

export const DEFAULT_PROTOCOL_WEIGHTS: Record<string, number> = {
  authentication: 0.25,
  authorization: 0.20,
  payment: 0.20,
  data_integrity: 0.20,
  ledger: 0.15,
};

// ── Default Verification Coverage Max Scores ──

export const DEFAULT_COVERAGE_MAX_SCORES: Record<string, number> = {
  typescriptTypeCheck: 25,
  ssgRules: 30,
  ledgerInvariant: 20,
  coverage: 15,
  failureGenome: 10,
};

// ── Default Governance Integrity Deductions ──

export const DEFAULT_GOVERNANCE_DEDUCTIONS: Record<string, number> = {
  hashMismatch: 50,
  ledgerMissing: 30,
  chainBroken: 20,
  auditIncomplete: 10,
};

// ── Decision Thresholds ──

export const DECISION_THRESHOLDS = {
  approved: 80,
  needsReview: 60,
  // below 60 = BLOCKED
  criticalLock: 59, // max score when critical violation exists
} as const;
