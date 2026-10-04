/**
 * Phase 1: Trust Score Calculator
 *
 * Pure functions implementing the weighted scoring formulas,
 * decision mapping, and confidence determination from the
 * AI Trust Decision Model v1 design doc.
 *
 * All functions are PURE — no side effects, no I/O.
 */

import type {
  TrustViolation,
  ViolationSeverity,
  TrustDecisionValue,
  ConfidenceLevel,
  DimensionScore,
  ProtocolSafetyScore,
  ProtocolDetail,
  VerificationCoverageScore,
  CoverageDetail,
  ExplainabilityStatus,
  DecisionGates,
} from "./types";
import {
  DEFAULT_DIMENSION_WEIGHTS,
  DEFAULT_SEVERITY_DEDUCTIONS,
  DEFAULT_PROTOCOL_WEIGHTS,
  DEFAULT_COVERAGE_MAX_SCORES,
  DEFAULT_GOVERNANCE_DEDUCTIONS,
  DECISION_THRESHOLDS,
  SECURITY_PROTOCOLS,
  SECURITY_PROTOCOL_FLOOR,
} from "./types";

// ═══════════════════════════════════════════════
//  1. Policy Compliance (35%)
// ═══════════════════════════════════════════════

/**
 * Score = max(0, 100 - sum of severity deductions)
 *
 * Critical violation forces score ≤ DECISION_THRESHOLDS.criticalLock (59).
 */
export function scorePolicyCompliance(
  violations: TrustViolation[],
  deductions?: Record<ViolationSeverity, number>
): { score: number; hasCritical: boolean } {
  const weights = deductions || DEFAULT_SEVERITY_DEDUCTIONS;
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
    score = Math.min(score, DECISION_THRESHOLDS.criticalLock);
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
export function scoreProtocolSafety(
  violations: TrustViolation[],
  protocolWeights?: Record<string, number>
): ProtocolSafetyScore {
  const weights = protocolWeights || DEFAULT_PROTOCOL_WEIGHTS;
  const protocolNames = Object.keys(weights);

  // Group violations by protocol category (rule_id prefix before "_")
  const byProtocol: Record<string, TrustViolation[]> = {};
  for (const v of violations) {
    const protocol = extractProtocol(v);
    if (!byProtocol[protocol]) byProtocol[protocol] = [];
    byProtocol[protocol].push(v);
  }

  // Score each protocol
  const details: Record<string, ProtocolDetail> = {};
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

  // ── 观察度（§53 / R97）：0 条违规的协议不是「查过且干净」，而是「没看到东西」 ──
  // 此前这里写的是 `d.score <= 100`（字面恒真）⇒ 5/5 ⇒ 永远 HIGH。
  // 后果：authentication 0 分、其余 4 个协议零观察，整维度仍报 confidence HIGH，
  // 进而让 overall confidence = HIGH。改成按**真的产出过观察**的协议计数。
  const observedProtocols = protocolNames.filter(
    (n) => (byProtocol[n] || []).length > 0
  );
  const blindProtocols = protocolNames.filter(
    (n) => (byProtocol[n] || []).length === 0
  );
  const confidenceRatio = protocolNames.length > 0
    ? observedProtocols.length / protocolNames.length
    : 1;
  const confidence = mapDimensionConfidence(confidenceRatio);

  // Collect only protocol-related violations for evidence
  const protocolViolations = violations.filter((v) =>
    protocolNames.includes(extractProtocol(v))
  );

  return {
    score,
    weight: DEFAULT_DIMENSION_WEIGHTS.protocolSafety,
    confidence,
    details,
    violations: protocolViolations,
    observedProtocols,
    blindProtocols,
  };
}

/**
 * Extract protocol category from a violation's rule_id.
 * Rules: "AUTH_*" → authentication, "AUTHZ_*" → authorization,
 *        "PAY_*" → payment, "DATA_*" → data_integrity,
 *        "LEDGER_*" → ledger
 * Falls back to "authentication" as default.
 */
function extractProtocol(v: TrustViolation): string {
  const prefix = v.rule_id.split("_")[0]?.toLowerCase() || "";
  const mapping: Record<string, string> = {
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
export function scoreVerificationCoverage(
  data: Partial<Record<string, number>>
): VerificationCoverageScore {
  const maxScores = DEFAULT_COVERAGE_MAX_SCORES;
  const details: Record<string, CoverageDetail> = {};
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
    } else {
      // Data unavailable → 0 for this sub-check
      details[name] = { score: 0, max };
    }
  }

  const confidenceRatio = totalChecks > 0 ? hasData / totalChecks : 0;
  const confidence = mapDimensionConfidence(confidenceRatio);

  return {
    score: Math.min(totalScore, 100),
    weight: DEFAULT_DIMENSION_WEIGHTS.verificationCoverage,
    confidence,
    details,
  };
}

// ═══════════════════════════════════════════════
//  4. Governance Integrity (15%)
// ═══════════════════════════════════════════════

export interface GovernanceDefect {
  type: string;
}

/**
 * Score = 100 - sum of defect deductions.
 */
export function scoreGovernanceIntegrity(
  defects: GovernanceDefect[],
  deductions?: Record<string, number>
): DimensionScore {
  const weights = deductions || DEFAULT_GOVERNANCE_DEDUCTIONS;
  let totalDeduction = 0;

  for (const d of defects) {
    totalDeduction += weights[d.type] || 0;
  }

  const score = Math.max(0, 100 - totalDeduction);

  return {
    score,
    weight: DEFAULT_DIMENSION_WEIGHTS.governanceIntegrity,
    confidence: "HIGH", // Governance data is always available from ledger
  };
}

// ═══════════════════════════════════════════════
//  5. Overall Score
// ═══════════════════════════════════════════════

export interface DimensionInput {
  score: number;
  weight: number;
}

/**
 * Overall = Σ(score × weight) for all active dimensions.
 * Only dimensions with weight > 0 are included.
 */
export function calculateOverallScore(dimensions: DimensionInput[]): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const d of dimensions) {
    const safeScore = Number.isNaN(d.score) ? 0 : d.score;
    weightedSum += safeScore * d.weight;
    totalWeight += d.weight;
  }

  if (totalWeight <= 0) return 0;
  const result = Math.round(weightedSum / totalWeight);
  return Number.isNaN(result) ? 0 : result;
}

// ═══════════════════════════════════════════════
//  6. Decision Mapping
// ═══════════════════════════════════════════════

/**
 * 计算决策封顶门禁（§53 / R97）。纯函数，只依赖已算好的维度结果。
 *
 * 只回答两个问题：
 *   ① 「有没有一条**我们确实看过**的安全维度塌了」——有 ⇒ 不许说通过。
 *   ② 「覆盖率测出来是不是真的很低」——**仅在可测时**才问；不可测 ⇒ 不适用（R98）。
 *
 * ⚠ 两者都不**扣分**：没有观察就没有扣分依据（扣分也是臆造）。
 *   它们只作用于 decision 上限与 confidence，这正是「ABSENCE ≠ evidence of
 *   absence」在聚合层应有的落地形态。
 *
 * ⚠ 语义映射命中率（mappingCoverage）**故意不作为门禁**：实测 9 个真实 TS 项目
 *   的取值范围是 1%~21%（中位 ~9%），没有任何一个够得到 30%。拿它当门槛就等于
 *   宣布「TS 项目永不放行」——那是常数不是判据，而且阈值会变成从数据里挑出来的
 *   数字（R86）。它只出现在输出里供人看，不参与决策。
 */
export function evaluateDecisionGates(input: {
  protocolSafety: ProtocolSafetyScore;
  /** 覆盖率等级；仅当 coverageApplicable 为真时才用作门禁 */
  coverageLevel?: string;
  /** 覆盖率是否可测（项目有没有 protocols.json） */
  coverageApplicable?: boolean;
}): DecisionGates {
  const reasons: string[] = [];

  // ① 安全维度下限 —— 只对「有观察」的协议生效（0 条违规的盲区不参与，避免臆造）
  const breachedProtocols = (SECURITY_PROTOCOLS as readonly string[])
    .filter((p) => input.protocolSafety.observedProtocols.includes(p))
    .map((p) => ({
      protocol: p,
      score: input.protocolSafety.details[p]?.score ?? 100,
    }))
    .filter((d) => d.score < SECURITY_PROTOCOL_FLOOR);

  for (const b of breachedProtocols) {
    reasons.push(
      `安全维度 ${b.protocol} 得分 ${b.score} < ${SECURITY_PROTOCOL_FLOOR}（已观察，非盲区）——不得输出 APPROVED`
    );
  }

  // ② 覆盖率门槛 —— 只在**可测**时生效
  let observationIncomplete = false;
  if (input.coverageLevel === "LOW") {
    if (input.coverageApplicable) {
      observationIncomplete = true;
      reasons.push("覆盖率置信度 LOW（已测得）——本次扫描不足以支撑「通过」结论");
    } else {
      // 不适用：没有 protocols.json ⇒ 0% 是「没得测」，不是「测得低」。
      // 若在此处当成 LOW 处理，门禁会对所有未接入协议定义的项目 100% 触发
      // ⇒ 连「0 违规、auth=100」的项目也被封顶（实测 6/6）。这是常数不是判据。
      reasons.push(
        "覆盖率不可测（项目无 protocols.json）——按「不适用」处理，不作门禁（R98）"
      );
    }
  }

  return {
    securityFloorBreach: breachedProtocols.length > 0,
    breachedProtocols,
    observationIncomplete,
    reasons,
  };
}

/**
 * Maps score + gates → APPROVED / NEEDS_REVIEW / BLOCKED.
 *
 * Rules:
 *   - Critical violation → BLOCKED (overrides score)
 *   - Score < 60 → BLOCKED
 *   - 60 ≤ Score < 80 → NEEDS_REVIEW
 *   - Score ≥ 80 → APPROVED
 *   - 安全维度下限被击穿 ⇒ 上限 NEEDS_REVIEW（§53/R97）
 *   - 观察度不足 ⇒ 上限 NEEDS_REVIEW（§53/R97）
 *   - Explainability UNCERTAIN → degrade one level
 *
 * ⚠ 封顶（cap）不是降级（degrade）：封顶只阻止「说通过」，不会把 BLOCKED 抬上来，
 *   也不会把 NEEDS_REVIEW 打成 BLOCKED —— 避免为了修「虚高」而过冲成「虚低」。
 */
export function determineDecision(
  overallScore: number,
  hasCriticalViolation: boolean,
  explainabilityStatus: ExplainabilityStatus,
  gates?: DecisionGates
): TrustDecisionValue {
  // Hard gate: critical = BLOCKED regardless of score
  if (hasCriticalViolation) {
    return "BLOCKED";
  }

  // Base decision from score
  let decision: TrustDecisionValue;
  if (overallScore >= DECISION_THRESHOLDS.approved) {
    decision = "APPROVED";
  } else if (overallScore >= DECISION_THRESHOLDS.needsReview) {
    decision = "NEEDS_REVIEW";
  } else {
    decision = "BLOCKED";
  }

  // ── §53 / R97：封顶 ──
  // 背景：immich（auth 0 分 / coverage 0% / mapping 8%）与 nocodb
  // （auth 0 分 / 586 条 / mapping 4%）都拿到了 83 / APPROVED / HIGH。
  // 「分数够高」不等于「可以说通过」——前提是我们确实看过、且看过的维度没塌。
  if (
    gates &&
    (gates.securityFloorBreach || gates.observationIncomplete) &&
    decision === "APPROVED"
  ) {
    decision = "NEEDS_REVIEW";
  }

  // Explainability degrade: drop one level
  if (explainabilityStatus === "UNCERTAIN") {
    if (decision === "APPROVED") return "NEEDS_REVIEW";
    if (decision === "NEEDS_REVIEW") return "BLOCKED";
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
export function determineConfidence(
  dimConfidences: Array<Exclude<ConfidenceLevel, "UNCERTAIN">>,
  explainabilityStatus: ExplainabilityStatus,
  /**
   * §53 / R97：观察度不足时，置信度**封顶**为 MEDIUM。
   *
   * 背景：immich 的 coverageConfidence 是 0% ±25% LOW，而 overall confidence
   * 仍是 HIGH —— 四个维度的 confidence 里没有一项接了覆盖率这条线。
   * 代码里甚至已经写了「本次扫描是废票，不得据此得出『干净』结论」，
   * 但没有任何一行消费它。**声明与实现分离**是这里真正的缺陷。
   */
  observationIncomplete?: boolean
): ConfidenceLevel {
  // Explainability gate overrides everything
  if (explainabilityStatus === "UNCERTAIN") {
    return "UNCERTAIN";
  }

  const lowCount = dimConfidences.filter((c) => c === "LOW").length;
  const mediumCount = dimConfidences.filter((c) => c === "MEDIUM").length;

  if (lowCount > 0) return "LOW";
  if (mediumCount >= 2) return "MEDIUM";
  if (mediumCount === 1) return "MEDIUM"; // Even one medium drags confidence

  // 观察度不足 ⇒ 即便各维度都报 HIGH，也不得给出 HIGH
  if (observationIncomplete) return "MEDIUM";
  return "HIGH";
}

// ═══════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════

/**
 * Map a 0-1 ratio to a dimension-level confidence.
 * ≥ 0.8 → HIGH, 0.6-0.8 → MEDIUM, < 0.6 → LOW
 */
function mapDimensionConfidence(ratio: number): Exclude<ConfidenceLevel, "UNCERTAIN"> {
  if (ratio >= 0.8) return "HIGH";
  if (ratio >= 0.6) return "MEDIUM";
  return "LOW";
}

/**
 * Count violations by severity.
 */
export function countViolationsBySeverity(
  violations: TrustViolation[]
): { critical: number; high: number; medium: number; low: number; total: number } {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, total: violations.length };
  for (const v of violations) {
    if (v.severity in counts) {
      counts[v.severity as keyof typeof counts]++;
    }
  }
  return counts;
}
