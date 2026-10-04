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
  /** C 注解建议（采纳生死线）——仅 C 项目生成（加性字段，TS/Python undefined） */
  annotationSuggestions?: import("../annotation-suggest").AnnotationSuggestion[];

  overall: {
    score: number;
    decision: TrustDecisionValue;
    confidence: ConfidenceLevel;
    /**
     * §53 / R97：决策门禁 —— 为什么这个 decision 被封顶/没被封顶。
     *
     * ⚠ 出现 `reasons` 非空即代表「分数够高」但「不许说通过」。
     *   消费方（CI / MCP / patrol）应据此拦截，不要只看 score。
     */
    decisionGates?: DecisionGates;
    /** Phase 1: Coverage-based confidence (computed, not labeled) */
    coverageConfidence?: {
      score: number;
      margin: number;
      level: "HIGH" | "MEDIUM" | "LOW";
      summary: string;
      /**
       * §53：本指标是否可测。false = 项目没有 protocols.json（或 IR 提取失败），
       * 此时 score=0 代表「没得测」，**不得**当作「测得低」用作门禁（R98）。
       */
      applicable?: boolean;
    };
    /** 2026-09-22：IR 提取失败警告——结果基于空/残缺 IR，不可信。
     *  出现即代表本次扫描是废票（如 python3 提取器被 OOM 杀后
     *  静默降级为 0 违规）。消费方应据此拦截「假干净」结论。 */
    extractionWarning?: string;
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
    /** SSG State Machine coverage: how many calls matched protocol rules */
    ssgCoverage?: {
      sequencesValidated: number;
      totalCalls: number;
      matchedCalls: number;
      ssgViolations: number;
      summary: string;
    };
    /** 2026-10-02（§49.15 方案 b）：排序后的 safeguard 告警流——证据流，
     *  不进判定（decision/score 不受影响）。groups=按族分组（推荐形态，
     *  组间按先验、组内按语义分），topRanked=全局平铺（minPerRule=1 保底）。
     *  每族先验来自 fp-gold 标注（DEFAULT_RULE_PRIOR），换项目可用 learnPrior
     *  重估；排序不删告警（§49.16），输出条数 == 输入条数。 */
    safeguardAlerts?: {
      total: number;
      groups: Array<{
        rule: string;
        prior: number;
        count: number;
        alerts: Array<{
          alert: Record<string, unknown>;
          score: number;
          prior: number;
          semantic: number;
          reasons: string[];
        }>;
      }>;
      topRanked: Array<{
        alert: Record<string, unknown>;
        score: number;
        prior: number;
        semantic: number;
        reasons: string[];
      }>;
    };
    /** Express framework adapter coverage */
    expressCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** NestJS framework adapter coverage */
    nestjsCoverage?: {
      controllers: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** FastAPI framework adapter coverage */
    fastapiCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** Django framework adapter coverage */
    djangoCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** Flask framework adapter coverage */
    flaskCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** Fastify framework adapter coverage */
    fastifyCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** Next.js framework adapter coverage */
    nextjsCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** Koa framework adapter coverage */
    koaCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** Hapi framework adapter coverage */
    hapiCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** Gin framework adapter coverage */
    ginCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
    };
    /** Fiber framework adapter coverage */
    fiberCoverage?: {
      appsDetected: number;
      totalRoutes: number;
      filesScanned: number;
      issuesFound: number;
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
  /**
   * 本次扫描**有过观察**的协议（至少产出过 1 条违规）。
   * 与 blindProtocols 互斥且并集为全部协议名。
   */
  observedProtocols: string[];
  /**
   * 本次扫描**完全没看到东西**的协议（0 条违规）。
   *
   * ⚠ 语义声明：0 条违规 ≠ 「查过且干净」，也可能只是**这条线路没接线**
   * （见 R94：48 条 SAFEGUARD_RULES 里 15 条是 python-only，在 TS 上 never fires）。
   * 列出来是为了让下游**不许把盲区当满分凭据**，而不是为了给它们打低分
   * （没有观察 ⇒ 没有扣分依据，扣分同样是臆造）。
   */
  blindProtocols: string[];
}

export interface ProtocolDetail {
  score: number;
  violations: number;
  weight: number;
}

// ── Decision Gates（§53 / R97） ──
//
// 背景（immich + nocodb 实测）：authentication 子协议 0 分（21 条 / 586 条违规）、
// coverageConfidence 0% LOW、mappingCoverage 4%~8% LOW —— 三项独立的
// 「我们其实没看到什么」指标全部触底，输出却仍是 83 / APPROVED / HIGH。
// 根因是聚合层只有「分数 → 档位」一条路径，没有任何**下限**与**观察度门槛**。

/** 安全相关协议：这些维度出现塌方时，不得给出「通过」结论 */
export const SECURITY_PROTOCOLS = [
  "authentication",
  "authorization",
  "data_integrity",
] as const;

/** 安全协议分数下限：任一条已观察的安全协议低于此分 ⇒ decision 不得为 APPROVED */
export const SECURITY_PROTOCOL_FLOOR = 50;

/** 观察度门槛：coverage / mapping 命中率低于此值 ⇒ 视为「没看清楚」 */
export const OBSERVATION_RATE_FLOOR = 0.3;

export interface DecisionGates {
  /** 至少一条**已观察**的安全协议低于 SECURITY_PROTOCOL_FLOOR */
  securityFloorBreach: boolean;
  /** 触发下限的协议名 + 分数（可复核对账） */
  breachedProtocols: Array<{ protocol: string; score: number }>;
  /** 观察度不足（coverage 或 mapping 低于门槛 / level 为 LOW） */
  observationIncomplete: boolean;
  /** 人类可读的封顶理由（会进入输出，供复核） */
  reasons: string[];
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
