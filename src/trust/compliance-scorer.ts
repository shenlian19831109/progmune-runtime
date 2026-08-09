/**
 * Compliance Scoring Engine
 *
 * Upgrades Progmune's verification from binary (violation/clean) to
 * multi-dimensional continuous scores (0-1 per protocol dimension).
 *
 * The insight: SSG rules already encode what "perfect compliance" looks like.
 * We just need to measure distance from that perfect state, dimension by
 * dimension, instead of returning a single pass/fail.
 *
 * This is the first step toward a reward model — proving that continuous
 * compliance scores are actionable for AI code generators.
 *
 * No ML. Pure rule-based scoring using existing PROTOCOLS + SAFEGUARD_RULES.
 */

// ── Types ──

export interface DimensionScore {
  /** Protocol dimension name */
  dimension: string;
  /** 0-1 score: how close to perfect compliance */
  score: number;
  /** Maximum possible score for this dimension */
  maxScore: number;
  /** What's right */
  strengths: string[];
  /** What's missing or wrong */
  gaps: string[];
  /** Specific fix suggestions */
  fixes: string[];
}

export interface ComplianceScore {
  /** 0-1 overall compliance score */
  overall: number;
  /** Per-dimension breakdown */
  dimensions: DimensionScore[];
  /** The weakest dimension — fix this first */
  weakestDimension: string;
  /** The most impactful fix */
  topFix: string;
  /** Full suggested call sequence for this function context */
  suggestedSequence: string[];
  /** Existing calls that are already correct */
  presentCalls: string[];
  /** Missing calls that should be added */
  missingCalls: string[];
}

// ── Protocol Dimensions ──

interface ProtocolDimension {
  id: string;
  label: string;
  /** Function patterns that trigger this dimension being relevant */
  triggers: RegExp[];
  /** Required call patterns (ordered steps in the protocol) */
  requiredSteps: { pattern: RegExp; label: string; description: string }[];
  /** Good patterns that boost the score */
  bonusPatterns: { pattern: RegExp; label: string; description: string }[];
  /** Weight in overall score */
  weight: number;
}

/**
 * Protocol dimensions — mirrors the SSG PROTOCOLS but expressed as
 * scorable dimensions rather than binary checks.
 */
const DIMENSIONS: ProtocolDimension[] = [
  {
    id: "auth",
    label: "认证与授权",
    weight: 0.30,
    triggers: [
      /login|register|signin|signup|authenticate|auth|token|session|password|credential/i,
    ],
    requiredSteps: [
      { pattern: /\b(login|signin|authenticate|getSessionUser|requirePermission|verifyToken|validateSession)\b/i, label: "auth_check", description: "身份验证" },
      { pattern: /\b(requirePermission|hasPermission|checkAccess|hasRole|adminCheck|isAuthorized)\b/i, label: "authz_check", description: "权限检查" },
      { pattern: /\b(logout|destroySession|revokeToken|endSession|invalidate)\b/i, label: "auth_cleanup", description: "会话清理" },
    ],
    bonusPatterns: [
      { pattern: /\b(bcrypt|argon2|scrypt|pbkdf2|hashPassword|compare)\b/i, label: "secure_hash", description: "安全哈希" },
      { pattern: /\b(rateLimit|rate_limit|throttle|maxAttempts|loginLimiter)\b/i, label: "rate_limit", description: "速率限制" },
      { pattern: /\b(2fa|twoFactor|mfa|otp|verifyCode|totp)\b/i, label: "mfa", description: "多因素认证" },
    ],
  },
  {
    id: "tls",
    label: "TLS/加密",
    weight: 0.15,
    triggers: [
      /ssl|tls|https|cert|certificate|encrypt|decrypt|createServer/i,
    ],
    requiredSteps: [
      { pattern: /\b(ssl|tls|cert|https|createSecureContext|credentials)\b/i, label: "tls_config", description: "TLS 配置" },
      { pattern: /\b(ssl.*free|ssl.*cleanup|close.*ssl|disconnect)\b/i, label: "tls_cleanup", description: "TLS 清理" },
    ],
    bonusPatterns: [
      { pattern: /\b(helmet|csp|hsts|secure.*header)\b/i, label: "security_headers", description: "安全响应头" },
    ],
  },
  {
    id: "payment",
    label: "支付安全",
    weight: 0.20,
    triggers: [
      /payment|pay|checkout|refund|charge|transaction|order.*create|order.*process/i,
    ],
    requiredSteps: [
      { pattern: /\b(verifyOrder|getOrder|checkOrder|findOrder|orderExists)\b/i, label: "order_check", description: "订单验证" },
      { pattern: /\b(payment.*intent|pay.*create|create.*payment|initiate.*payment)\b/i, label: "pay_init", description: "支付发起" },
      { pattern: /\b(verify.*sign|check.*sign|webhook.*secret|hmac|signature)\b/i, label: "sig_check", description: "签名验证" },
      { pattern: /\b(capture.*payment|confirm.*order|payment.*done|payment.*success)\b/i, label: "pay_complete", description: "支付完成" },
    ],
    bonusPatterns: [
      { pattern: /\b(idempotent|retry|rollback|compensat)\b/i, label: "idempotency", description: "幂等性" },
    ],
  },
  {
    id: "data_integrity",
    label: "数据完整性",
    weight: 0.15,
    triggers: [
      /create|update|delete|insert|modify|save|write|mutate/i,
    ],
    requiredSteps: [
      { pattern: /\b(validate|sanitize|check|verify|schema|zod|yup|joi)\b/i, label: "input_check", description: "输入校验" },
      { pattern: /\b(audit|log.*change|change.*log|track.*change|record.*mutation)\b/i, label: "audit_trail", description: "审计追踪" },
    ],
    bonusPatterns: [
      { pattern: /\b(transaction|rollback|commit)\b/i, label: "transaction", description: "事务保护" },
      { pattern: /\b(parameterize|prepared.*statement|%s|\$1)\b/i, label: "sql_safe", description: "SQL 安全" },
    ],
  },
  {
    id: "resource",
    label: "资源管理",
    weight: 0.10,
    triggers: [
      /file|socket|connection|pool|stream|buffer|handle|upload|download/i,
    ],
    requiredSteps: [
      { pattern: /\b(open|create|init|connect|start)\b/i, label: "resource_init", description: "资源获取" },
      { pattern: /\b(close|free|cleanup|destroy|disconnect|release|end)\b/i, label: "resource_free", description: "资源释放" },
    ],
    bonusPatterns: [
      { pattern: /\b(try.*finally|defer|using|RAII)\b/i, label: "cleanup_guarantee", description: "清理保证" },
    ],
  },
  {
    id: "session",
    label: "会话管理",
    weight: 0.10,
    triggers: [
      /session|token|jwt|cookie|bearer/i,
    ],
    requiredSteps: [
      { pattern: /\b(session.*create|create.*session|session.*init|token.*generate|jwt.*sign)\b/i, label: "sess_create", description: "会话创建" },
      { pattern: /\b(session.*check|session.*valid|validate.*session|verify.*token|token.*check)\b/i, label: "sess_validate", description: "会话验证" },
      { pattern: /\b(session.*destroy|session.*delete|token.*revoke|session.*expire|session.*timeout)\b/i, label: "sess_destroy", description: "会话销毁" },
    ],
    bonusPatterns: [
      { pattern: /\b(httpOnly|secure.*cookie|sameSite|csrf)\b/i, label: "secure_cookie", description: "安全Cookie" },
    ],
  },
];

// ── Scoring Logic ──

/**
 * Score a function call sequence against all protocol dimensions.
 *
 * @param calls - Array of function call names in order
 * @param functionPurpose - Optional function purpose for context (e.g., "退款处理", "用户注册")
 * @returns ComplianceScore with per-dimension breakdown
 */
export function scoreCompliance(
  calls: string[],
  functionPurpose?: string
): ComplianceScore {
  const dimensions: DimensionScore[] = [];
  const allCallText = calls.join(" ");
  const purposeText = functionPurpose || "";

  for (const dim of DIMENSIONS) {
    // Check if this dimension is relevant
    const isRelevant =
      dim.triggers.some((t) => t.test(allCallText)) ||
      dim.triggers.some((t) => t.test(purposeText));

    if (!isRelevant && calls.length > 0) {
      // Skip irrelevant dimensions — don't penalize what doesn't apply
      dimensions.push({
        dimension: dim.id,
        score: 1.0,
        maxScore: 1.0,
        strengths: ["N/A — 不适用"],
        gaps: [],
        fixes: [],
      });
      continue;
    }

    // Score required steps: what % are present?
    const requiredResults = dim.requiredSteps.map((step) => ({
      ...step,
      present: step.pattern.test(allCallText),
    }));
    const requiredScore =
      dim.requiredSteps.length > 0
        ? requiredResults.filter((r) => r.present).length / dim.requiredSteps.length
        : 1.0;

    // Score bonus patterns: each present adds 0.1 to the ceiling
    const bonusHits = dim.bonusPatterns.filter((b) => b.pattern.test(allCallText));
    const bonusBoost = Math.min(bonusHits.length * 0.1, 0.2); // cap at +0.2

    // Calculate strengths and gaps
    const strengths: string[] = [
      ...requiredResults.filter((r) => r.present).map((r) => r.description),
      ...bonusHits.map((b) => b.description),
    ];
    const gaps = [
      ...requiredResults.filter((r) => !r.present).map((r) => r.description),
    ];

    // Generate fixes for missing steps
    const fixes = requiredResults
      .filter((r) => !r.present)
      .map((r) => `添加 ${r.label}: ${r.description}`);

    // Final score: required completion + bonus boost, clamped to [0, 1]
    const rawScore = Math.min(requiredScore + bonusBoost, 1.0);

    dimensions.push({
      dimension: dim.id,
      score: Math.round(rawScore * 100) / 100,
      maxScore: 1.0,
      strengths: strengths.length > 0 ? strengths : ["无"],
      gaps,
      fixes,
    });
  }

  // Calculate overall score (weighted average of relevant dimensions)
  const relevantDims = dimensions.filter((d) => d.score < 1.0 || d.strengths[0] !== "N/A — 不适用");
  const weights = DIMENSIONS.map((d) => d.weight);
  const weightsMap = new Map(DIMENSIONS.map((d, i) => [d.id, weights[i] ?? 0]));

  let overall = 0;
  let totalWeight = 0;
  for (const dim of dimensions) {
    const w = weightsMap.get(dim.dimension) || 0.1;
    // Only count relevant dimensions in the weighted average
    if (dim.strengths[0] !== "N/A — 不适用") {
      overall += dim.score * w;
      totalWeight += w;
    }
  }
  overall = totalWeight > 0 ? overall / totalWeight : 1.0;
  overall = Math.round(overall * 100) / 100;

  // Find weakest dimension
  const scoredDims = dimensions.filter((d) => d.strengths[0] !== "N/A — 不适用");
  const weakest = scoredDims.length > 0
    ? scoredDims.reduce((min, d) => (d.score < min.score ? d : min), scoredDims[0])
    : null;

  // Find top fix (from the weakest dimension)
  const topFix = weakest?.fixes[0] || "无需修复";

  // Build suggested sequence: existing present calls + missing calls
  const presentCalls = calls.filter((c) => {
    for (const dim of DIMENSIONS) {
      for (const step of dim.requiredSteps) {
        if (step.pattern.test(c)) return true;
      }
    }
    return false;
  });
  const missingCalls = weakest?.fixes.map((f) => f.replace("添加 ", "")) || [];

  return {
    overall,
    dimensions,
    weakestDimension: weakest?.dimension || "all_clear",
    topFix,
    suggestedSequence: [
      ...presentCalls,
      ...missingCalls.map((m) => `[需添加] ${m}`),
    ],
    presentCalls,
    missingCalls,
  };
}

/**
 * Score a specific function for compliance given its purpose.
 * Convenience wrapper for scoring a single function context.
 */
export function scoreFunction(
  functionName: string,
  calls: string[],
  purpose?: string
): ComplianceScore {
  const allCalls = [functionName, ...calls];
  return scoreCompliance(allCalls, purpose);
}

/**
 * Format a compliance score as a human-readable report.
 */
export function formatComplianceReport(score: ComplianceScore): string {
  const lines: string[] = [
    "═══════════════════════════════════════",
    "  Progmune Compliance Score",
    "═══════════════════════════════════════",
    "",
    `  Overall: ${renderScoreBar(score.overall)} ${(score.overall * 100).toFixed(0)}%`,
    `  Weakest: ${score.weakestDimension}`,
    `  Top Fix: ${score.topFix}`,
    "",
    "  Dimensions:",
  ];

  for (const dim of score.dimensions) {
    const bar = renderScoreBar(dim.score);
    lines.push(`  ${bar} ${dim.dimension.padEnd(16)} ${(dim.score * 100).toFixed(0)}%`);
    if (dim.gaps.length > 0) {
      lines.push(`     ⚠️  缺失: ${dim.gaps.join(", ")}`);
    }
    if (dim.fixes.length > 0) {
      lines.push(`     🔧 ${dim.fixes.join("; ")}`);
    }
  }

  if (score.missingCalls.length > 0) {
    lines.push("");
    lines.push("  建议添加的调用:");
    for (const c of score.missingCalls) {
      lines.push(`    → ${c}`);
    }
  }

  return lines.join("\n");
}

function renderScoreBar(score: number): string {
  if (score >= 0.9) return "🟢";
  if (score >= 0.7) return "🟡";
  if (score >= 0.5) return "🟠";
  return "🔴";
}
