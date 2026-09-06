/**
 * P7.5: Unified Decision Engine — the "operating system kernel" of Progmune.
 *
 * All decisions in the system — verification, promotion, repair, policy —
 * are driven by ONE engine with ONE consistent model.
 *
 * The three core concepts:
 *   1. Verification Asset — the data (knowledge, rules, benchmarks, protocols)
 *   2. Promotion Pipeline — the lifecycle (evidence → candidate → ... → stable)
 *   3. Decision Engine   — the kernel (this file)
 *
 * Everything else is just an Asset Type.
 *
 * Decision model:
 *   Input:  Asset + Context → Decision { action, confidence, reason, provenance }
 *   Output: BLOCK/WARN/ALLOW | promote/demote/hold | fix/retry/rollback | accept/reject
 *
 * Importance is COMPUTED, not configured:
 *   Importance = 0.4×Impact + 0.25×Universality + 0.35×Criticality
 * （加权平均，权重之和为 1；Impact 权重最高——安全影响优先于
 *  出现广度。审计修复 2026-09-06：原注释写乘积公式，与实现矛盾）
 */

import type { UnifiedAsset, AssetStage, AssetKind } from "./asset-promotion";

// ═══════════════════════════════════════════════════════════════
// Decision Types
// ═══════════════════════════════════════════════════════════════

export type DecisionKind =
  | "verification"   // Should we alert on this code?
  | "promotion"      // Should this asset be promoted?
  | "repair"         // Should we fix this violation?
  | "policy"         // Should we enforce this rule?
  | "deployment"     // Is this asset ready for production?

export type VerificationAction = "BLOCK" | "WARN" | "ALLOW" | "SUPPRESS";
export type PromotionAction = "promote" | "demote" | "hold";
export type RepairAction = "fix" | "retry" | "rollback" | "report";
export type PolicyAction = "enforce" | "warn" | "skip";
export type DeploymentAction = "deploy" | "hold" | "rollback";

export type DecisionAction =
  | VerificationAction
  | PromotionAction
  | RepairAction
  | PolicyAction
  | DeploymentAction;

/** Provenance — why was this decision made? */
export interface DecisionProvenance {
  /** The asset(s) that informed this decision. */
  assets: string[];
  /** Evidence sources (RFC, repos, observations). */
  evidence: string[];
  /** Decision chain (previous decisions that led to this one). */
  chain: string[];
  /** Who or what made the decision. */
  decider: "system" | "human" | "auto";
  /** When. */
  timestamp: string;
}

/** A single unified decision. */
export interface Decision {
  id: string;
  kind: DecisionKind;
  action: DecisionAction;
  /** 0–1: how confident are we in this decision? */
  confidence: number;
  /** Human-readable reason. */
  reason: string;
  /** Full provenance chain. */
  provenance: DecisionProvenance;
  /** Recommendations for next steps. */
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════
// Importance Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Impact: how severe are the consequences of getting this wrong?
 *
 *   1.0 = security/critical (TLS Finished, password verify)
 *   0.7 = resource management (file close, memory free)
 *   0.4 = correctness (data validation, type checking)
 *   0.1 = informational (logging, formatting)
 */
function computeImpact(asset: UnifiedAsset): number {
  const domain = asset.domain.toLowerCase();
  const name = asset.name.toLowerCase();

  // Security-critical
  if (domain === "tls" || domain === "ssl" || domain === "auth" ||
      /tls|ssl|auth|encrypt|decrypt|verify|cert|key|token|password/i.test(name)) {
    return 1.0;
  }

  // Resource management
  if (/close|free|destroy|release|cleanup|disconnect|logout/i.test(name)) {
    return 0.7;
  }

  // Correctness
  if (/validate|check|assert|verify|compare|match/i.test(name)) {
    return 0.4;
  }

  // Informational
  return 0.1;
}

/**
 * Universality: how broadly does this apply across codebases?
 *
 *   1.0 = universal (memory management, error handling)
 *   0.7 = common (HTTP, file I/O, auth)
 *   0.4 = domain-specific (TLS, SSH, DB protocols)
 *   0.1 = repo-specific (custom internal patterns)
 */
function computeUniversality(asset: UnifiedAsset): number {
  const crossRepo = asset.evidence.crossRepoCount;

  if (crossRepo >= 5) return 1.0;
  if (crossRepo >= 3) return 0.7;
  if (crossRepo >= 2) return 0.4;
  return 0.1;
}

/**
 * Criticality: how essential is this to correct program behavior?
 *
 *   1.0 = program fails without this (init, close, free)
 *   0.7 = security/privacy risk (auth, encrypt)
 *   0.4 = correctness risk (validate, check)
 *   0.1 = quality risk (style, format)
 */
function computeCriticality(asset: UnifiedAsset): number {
  const name = asset.name.toLowerCase();

  // Program fails without this
  if (/^(init_|create_|open_|close_|free_|destroy_)/i.test(name) ||
      /_(init|cleanup|setup|teardown)$/i.test(name)) {
    return 1.0;
  }

  // Security risk
  if (/auth|encrypt|decrypt|token|password|verify|ssl|tls/i.test(name)) {
    return 0.7;
  }

  // Correctness risk
  if (/validate|check|assert|enforce|policy/i.test(name)) {
    return 0.4;
  }

  return 0.1;
}

/**
 * Compute Importance from Impact × Universality × Criticality.
 * This is NOT configured — it's derived from evidence and semantics.
 */
export function computeImportance(asset: UnifiedAsset): number {
  const impact = computeImpact(asset);
  const universality = computeUniversality(asset);
  const criticality = computeCriticality(asset);

  // Weighted average (weights sum to 1): Impact is most important, Universality secondary
  return Math.round((impact * 0.4 + universality * 0.25 + criticality * 0.35) * 100);
}

// ═══════════════════════════════════════════════════════════════
// Decision Engine
// ═══════════════════════════════════════════════════════════════

/** Sprint 14: Context Segmentation — what kind of code is being verified? */
export type CodeContext = "production" | "test" | "example" | "benchmark" | "init" | "unknown";

export interface DecisionContext {
  /** Deployment environment (production, staging, test). */
  environment?: "production" | "staging" | "test";
  /** Sprint 14: what kind of code is this? */
  codeContext?: CodeContext;
  /** Has this asset been observed in deployment? */
  deploymentObservations?: number;
  /** Recent FP count for this asset. */
  recentFPs?: number;
  /** Recent TP count for this asset. */
  recentTPs?: number;
  /** Human overrides. */
  humanOverride?: DecisionAction;
}

/**
 * Sprint 14: Classify code context from function names and patterns.
 *
 * Production code gets strict thresholds.
 * Test/example/benchmark code gets relaxed thresholds.
 * Enterprises only care about Production FP.
 */
export function classifyCodeContext(functions: string[]): CodeContext {
  const all = functions.join(" ").toLowerCase();

  // Test patterns
  if (/test|_test|testing|mock|stub|fake|assert|expect/i.test(all)) return "test";

  // Example patterns
  if (/example|demo|sample|tutorial|showcase/i.test(all)) return "example";

  // Benchmark patterns
  if (/bench|benchmark|perf|performance|stress|soak|load/i.test(all)) return "benchmark";

  // Init/setup patterns
  if (/^(init_|setup|config|bootstrap|startup)/i.test(all)) return "init";

  return "production";
}

/** Sprint 14: Per-context confidence thresholds. */
const CONTEXT_THRESHOLDS: Record<CodeContext, { block: number; warn: number; allow: number }> = {
  production:  { block: 0.80, warn: 0.60, allow: 0.40 },
  test:        { block: 0.95, warn: 0.85, allow: 0.70 },
  example:     { block: 0.95, warn: 0.85, allow: 0.70 },
  benchmark:   { block: 0.90, warn: 0.80, allow: 0.60 },
  init:        { block: 0.85, warn: 0.70, allow: 0.50 },
  unknown:     { block: 0.80, warn: 0.60, allow: 0.40 },
};

export class DecisionEngine {
  private history: Decision[] = [];

  /**
   * Make a verification decision: should we alert?
   */
  decideVerification(asset: UnifiedAsset, context: DecisionContext = {}): Decision {
    const importance = computeImportance(asset);
    const fpRate = (context.recentFPs || 0) / Math.max(1, (context.recentFPs || 0) + (context.recentTPs || 0));

    // Confidence = asset confidence × (1 - FP rate) × environment factor
    let envFactor = 1.0;
    if (context.environment === "production") envFactor = 0.7;  // More conservative in prod
    if (context.environment === "test") envFactor = 1.0;

    const confidence = asset.confidence * (1 - fpRate) * envFactor;

    // Sprint 14: Context-aware thresholds
    const ctx = context.codeContext || "production";
    const thresholds = CONTEXT_THRESHOLDS[ctx];

    let action: VerificationAction;
    if (confidence >= thresholds.block) action = "BLOCK";
    else if (confidence >= thresholds.warn) action = "WARN";
    else if (confidence >= thresholds.allow) action = "ALLOW";
    else action = "SUPPRESS";

    // Importance override: high-importance assets alert even at lower confidence
    if (importance >= 70 && action === "ALLOW") action = "WARN";
    if (importance >= 85 && action === "WARN") action = "BLOCK";

    return this.recordDecision({
      kind: "verification",
      action,
      confidence,
      reason: action === "BLOCK"
        ? `High-confidence violation (${(confidence*100).toFixed(0)}%, importance ${importance})`
        : action === "SUPPRESS"
          ? `Low confidence (${(confidence*100).toFixed(0)}%), ${context.recentFPs || 0} recent FPs`
          : `Moderate confidence (${(confidence*100).toFixed(0)}%) — ${action}`,
      provenance: {
        assets: [asset.id],
        evidence: [
          ...asset.evidence.rfcRefs.map(r => `RFC ${r}`),
          ...asset.evidence.repos,
          `importance=${importance}`,
        ],
        chain: [],
        decider: "system",
        timestamp: new Date().toISOString(),
      },
      recommendations: action === "SUPPRESS"
        ? ["Add RFC reference to increase confidence", "Validate across more repos"]
        : action === "WARN"
          ? ["Review manually before blocking", "Check deployment observations"]
          : [],
    });
  }

  /**
   * Make a promotion decision: should this asset move to the next stage?
   */
  decidePromotion(asset: UnifiedAsset, context: DecisionContext = {}): Decision {
    const importance = computeImportance(asset);
    const hasDeployment = (context.deploymentObservations || 0) > 0;

    // Promotion confidence depends on:
    // 1. Asset evidence strength (cross-repo, RFC, sequence count)
    // 2. Importance (high-importance assets are promoted faster)
    // 3. Deployment observations (real-world validation)

    let confidence = asset.confidence;

    // Deployment bonus: real-world observation significantly boosts confidence
    if (hasDeployment) confidence = Math.min(1.0, confidence + 0.15);

    // Importance bonus: high-importance assets get promotion priority
    if (importance >= 70) confidence = Math.min(1.0, confidence + 0.05);

    let action: PromotionAction;
    if (confidence >= 0.80 && hasDeployment) action = "promote";
    else if (confidence >= 0.60) action = "promote";
    else if (confidence >= 0.30) action = "hold";
    else action = "demote";

    return this.recordDecision({
      kind: "promotion",
      action,
      confidence,
      reason: action === "promote"
        ? `Ready for promotion: ${asset.evidence.crossRepoCount} repos, importance ${importance}${hasDeployment ? ", deployment-validated" : ""}`
        : action === "hold"
          ? `Holding at ${asset.stage}: need more evidence${!hasDeployment ? " (no deployment data)" : ""}`
          : `Demoting: confidence ${(confidence*100).toFixed(0)}% below threshold`,
      provenance: {
        assets: [asset.id],
        evidence: [
          `${asset.evidence.crossRepoCount} repos`,
          `${asset.evidence.sequenceCount} sequences`,
          ...asset.evidence.rfcRefs.map(r => `RFC ${r}`),
          hasDeployment ? `${context.deploymentObservations} deployments` : "no deployment data",
        ],
        chain: asset.history.map(h => `${h.from}→${h.to}: ${h.reason}`),
        decider: "system",
        timestamp: new Date().toISOString(),
      },
      recommendations: !hasDeployment
        ? ["Deploy to staging for real-world validation", "Collect production observations"]
        : action === "hold"
          ? ["Add cross-repo evidence", "Seek human review"]
          : [],
    });
  }

  /**
   * Make a repair decision: should we fix this, retry, or rollback?
   */
  decideRepair(asset: UnifiedAsset, context: DecisionContext = {}): Decision {
    const importance = computeImportance(asset);

    // Repair is only worth attempting for high-importance assets
    // AND when confidence is high enough
    let action: RepairAction;
    let confidence = asset.confidence;

    if (importance >= 70 && confidence >= 0.60) {
      action = "fix";
    } else if (importance >= 50 && confidence >= 0.40) {
      action = "retry";
    } else if (context.environment === "production") {
      action = "rollback";
    } else {
      action = "report";
    }

    if (context.humanOverride) {
      action = context.humanOverride as RepairAction;
    }

    return this.recordDecision({
      kind: "repair",
      action,
      confidence,
      reason: action === "fix"
        ? `Auto-repair recommended: importance ${importance}, confidence ${(confidence*100).toFixed(0)}%`
        : action === "rollback"
          ? `Rollback: too risky for production (importance ${importance}, confidence ${(confidence*100).toFixed(0)}%)`
          : `Report-only: insufficient confidence for auto-repair`,
      provenance: {
        assets: [asset.id],
        evidence: [`importance=${importance}`, `confidence=${(confidence*100).toFixed(0)}%`],
        chain: [],
        decider: context.humanOverride ? "human" : "system",
        timestamp: new Date().toISOString(),
      },
      recommendations: action === "fix"
        ? ["Apply fix and re-verify", "Record outcome for learning"]
        : action === "report"
          ? ["Flag for human review", "Collect more evidence before auto-repair"]
          : [],
    });
  }

  /**
   * Make a deployment decision: is this asset ready for production?
   */
  decideDeployment(asset: UnifiedAsset, context: DecisionContext = {}): Decision {
    const importance = computeImportance(asset);

    // Deployment requires:
    // 1. Asset at "validated" stage or higher
    // 2. Deployment observations (staging OK)
    // 3. Acceptable FP rate (< 30% in staging)

    const stageOk = ["validated", "stable"].includes(asset.stage);
    const hasDeployment = (context.deploymentObservations || 0) > 0;
    const fpRate = (context.recentFPs || 0) / Math.max(1, (context.recentFPs || 0) + (context.recentTPs || 0));
    const fpOk = fpRate < 0.30;

    let action: DeploymentAction;
    let confidence = asset.confidence;

    if (stageOk && hasDeployment && fpOk) {
      action = "deploy";
      confidence = Math.min(1.0, confidence + 0.1);
    } else if (stageOk && !hasDeployment) {
      action = "hold";
    } else if (!fpOk) {
      action = "rollback";
    } else {
      action = "hold";
    }

    return this.recordDecision({
      kind: "deployment",
      action,
      confidence,
      reason: action === "deploy"
        ? `Production-ready: stage=${asset.stage}, ${context.deploymentObservations} deployments, FP rate ${(fpRate*100).toFixed(0)}%`
        : action === "hold"
          ? !hasDeployment ? "Needs staging deployment first" : "Not ready for production"
          : `Rollback: FP rate ${(fpRate*100).toFixed(0)}% exceeds 30% threshold`,
      provenance: {
        assets: [asset.id],
        evidence: [
          `stage=${asset.stage}`,
          `deployments=${context.deploymentObservations || 0}`,
          `FP rate=${(fpRate*100).toFixed(0)}%`,
        ],
        chain: asset.history.map(h => `${h.from}→${h.to}`),
        decider: "system",
        timestamp: new Date().toISOString(),
      },
      recommendations: !hasDeployment
        ? ["Deploy to staging environment", "Collect FP/TP metrics"]
        : !fpOk
          ? ["Investigate FP sources", "Suppress noisy rules before re-deploying"]
          : [],
    });
  }

  /**
   * Get full decision history for provenance tracking.
   */
  getHistory(): Decision[] {
    return [...this.history];
  }

  /**
   * Get decision history for a specific asset.
   */
  getAssetDecisions(assetId: string): Decision[] {
    return this.history.filter(d => d.provenance.assets.includes(assetId));
  }

  private recordDecision(partial: Omit<Decision, "id">): Decision {
    const id = `DEC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const decision: Decision = { id, ...partial };
    this.history.push(decision);
    return decision;
  }
}

// ═══════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════

let _decisionEngine: DecisionEngine | null = null;

export function getDecisionEngine(): DecisionEngine {
  if (!_decisionEngine) _decisionEngine = new DecisionEngine();
  return _decisionEngine;
}
