/**
 * P7: Unified Asset Promotion Pipeline
 *
 * Every asset in Progmune — whether a Knowledge Unit or a Verification Rule —
 * follows the same lifecycle. One governance model, one promotion engine.
 *
 * Lifecycle:
 *   Evidence → Candidate → Observed → Validated → Stable → Deprecated → Archived
 *
 * This REPLACES the two separate lifecycles:
 *   - Knowledge lifecycle (knowledge-evolution.ts)
 *   - Rule lifecycle (verification-intelligence.ts)
 *
 * With ONE unified pipeline. Like GitHub PRs — assets are reviewed, merged, promoted.
 *
 * Core principles:
 *   1. Observed ≠ Protocol. Observed patterns are Candidates, not Rules.
 *   2. Frequency determines Confidence, NOT Importance.
 *   3. Promotion requires evidence gates, not just counts.
 *   4. Review happens on Candidates before they become Stable Assets.
 */

import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Asset Lifecycle Stages
// ═══════════════════════════════════════════════════════════════

export type AssetStage =
  | "evidence"      // Raw observation — seen in sequences
  | "hypothesis"    // Pattern recognized — "these look like Resource Release"
  | "candidate"     // Formalized candidate — worth reviewing
  | "observed"      // Cross-repo validated — pattern is real
  | "validated"     // RFC-aligned OR human-reviewed — trusted
  | "deployment"    // Deployed to staging/production — real-world validated
  | "stable"        // No regressions in deployment — production
  | "deprecated"    // Superseded or confidence dropped
  | "archived";     // No longer referenced — historical record

export const STAGE_ORDER: Record<AssetStage, number> = {
  evidence: 0,
  hypothesis: 1,
  candidate: 2,
  observed: 3,
  validated: 4,
  deployment: 5,
  stable: 6,
  deprecated: 7,
  archived: 8,
};

export const STAGE_LABELS: Record<AssetStage, string> = {
  evidence:   "Evidence",
  hypothesis: "Hypothesis",
  candidate:  "Candidate",
  observed:   "Observed",
  validated:  "Validated",
  deployment: "Deployment",
  stable:     "Stable",
  deprecated: "Deprecated",
  archived:   "Archived",
};

// ═══════════════════════════════════════════════════════════════
// Asset Types
// ═══════════════════════════════════════════════════════════════

export type AssetKind = "knowledge_unit" | "verification_rule";

export interface AssetEvidence {
  /** Source repo(s) where this was observed. */
  repos: string[];
  /** RFC references (if any). */
  rfcRefs: string[];
  /** Number of sequences supporting this asset. */
  sequenceCount: number;
  /** Cross-repo count (unique repos). */
  crossRepoCount: number;
  /** First observed timestamp. */
  firstSeen: string;
  /** Last observed timestamp. */
  lastSeen: string;
}

export interface PromotionEvent {
  from: AssetStage;
  to: AssetStage;
  timestamp: string;
  reason: string;
  /** Who or what triggered this promotion. */
  triggeredBy: "auto" | "human" | "system";
  reviewer?: string;
}

export interface UnifiedAsset {
  id: string;
  kind: AssetKind;
  name: string;
  /** Protocol domain (TLS, SSH, HTTP, File, etc.) */
  domain: string;
  stage: AssetStage;
  /** Confidence: 0–1, calibrated by evidence */
  confidence: number;
  /** Importance: 0–1, NOT frequency — semantic significance */
  importance: number;
  evidence: AssetEvidence;
  /** Full promotion history. */
  history: PromotionEvent[];
  /** When created. */
  createdAt: string;
  /** When last modified. */
  updatedAt: string;
  /** Human-readable description. */
  description: string;
  /** Asset-specific payload (rule definition or knowledge unit data). */
  payload?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// Promotion Gates
// ═══════════════════════════════════════════════════════════════

/**
 * Promotion gate: checks whether an asset qualifies for the next stage.
 * Each gate is a predicate that returns {passed, reason}.
 */
export type PromotionGate = (asset: UnifiedAsset) => { passed: boolean; reason: string };

export const PROMOTION_GATES: Record<string, PromotionGate> = {
  /** Evidence → Candidate: requires ≥2 sequence observations */
  "evidence→candidate": (a) => ({
    passed: a.evidence.sequenceCount >= 2,
    reason: a.evidence.sequenceCount >= 2
      ? `Observed in ${a.evidence.sequenceCount} sequences`
      : `Only ${a.evidence.sequenceCount} sequences — need ≥2`,
  }),

  /** Evidence → Hypothesis: ≥3 sequences OR ≥2 repos with similar pattern */
  "evidence→hypothesis": (a) => ({
    passed: a.evidence.sequenceCount >= 3 || a.evidence.crossRepoCount >= 2,
    reason: a.evidence.sequenceCount >= 3
      ? `Pattern observed in ${a.evidence.sequenceCount} sequences`
      : a.evidence.crossRepoCount >= 2
        ? `Pattern observed across ${a.evidence.crossRepoCount} repos`
        : `Only ${a.evidence.sequenceCount} sequences — need ≥3 for hypothesis`,
  }),

  /** Hypothesis → Candidate: hypothesis formalized with clear semantic role */
  "hypothesis→candidate": (a) => ({
    passed: a.evidence.sequenceCount >= 5 && a.evidence.crossRepoCount >= 1,
    reason: a.evidence.sequenceCount >= 5
      ? `Formalized candidate: ${a.evidence.sequenceCount} sequences, ${a.evidence.crossRepoCount} repos`
      : `Need ≥5 sequences to formalize candidate`,
  }),

  /** Candidate → Observed: cross-repo evidence ≥2 */
  "candidate→observed": (a) => ({
    passed: a.evidence.crossRepoCount >= 2,
    reason: a.evidence.crossRepoCount >= 2
      ? `Validated across ${a.evidence.crossRepoCount} repos`
      : `Only ${a.evidence.crossRepoCount} repos — need ≥2`,
  }),

  /** Observed → Validated: RFC alignment OR human review */
  "observed→validated": (a) => ({
    passed: a.evidence.rfcRefs.length > 0 || a.history.some(e => e.triggeredBy === "human"),
    reason: a.evidence.rfcRefs.length > 0
      ? `Aligned with RFC ${a.evidence.rfcRefs.join(", ")}`
      : a.history.some(e => e.triggeredBy === "human")
        ? "Human-reviewed"
        : "Needs RFC alignment or human review",
  }),

  /** Validated → Deployment: ready for real-world validation */
  "validated→deployment": (a) => ({
    passed: a.confidence >= 0.70 && a.evidence.crossRepoCount >= 2,
    reason: a.confidence >= 0.70
      ? `Ready for deployment validation: ${(a.confidence*100).toFixed(0)}% confidence, ${a.evidence.crossRepoCount} repos`
      : `Confidence ${(a.confidence*100).toFixed(0)}% < 70% — not ready for deployment`,
  }),

  /** Deployment → Stable: deployed + FP rate acceptable + no regressions */
  "deployment→stable": (a) => ({
    passed: a.confidence >= 0.80,
    reason: a.confidence >= 0.80
      ? `Production-validated: confidence ${(a.confidence*100).toFixed(0)}% ≥ 80%`
      : `Confidence ${(a.confidence*100).toFixed(0)}% < 80% — deployment didn't confirm`,
  }),

  /** Stable → Deprecated: superseded OR confidence dropped below 40% */
  "stable→deprecated": (a) => ({
    passed: a.confidence < 0.40,
    reason: a.confidence < 0.40
      ? `Confidence dropped to ${(a.confidence*100).toFixed(0)}%`
      : `Confidence still ${(a.confidence*100).toFixed(0)}% — above deprecation threshold`,
  }),

  /** Deprecated → Archived: no active references for 90 days */
  "deprecated→archived": (a) => {
    const lastSeen = new Date(a.evidence.lastSeen).getTime();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    const inactive = Date.now() - lastSeen > ninetyDays;
    return {
      passed: inactive,
      reason: inactive ? "Inactive for >90 days" : "Still referenced",
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// Promotion Engine
// ═══════════════════════════════════════════════════════════════

export class AssetPromotionEngine {
  private assets: Map<string, UnifiedAsset> = new Map();

  /**
   * Register a new observation as Evidence.
   * If the asset doesn't exist, creates it at "evidence" stage.
   * If it exists, updates evidence counts.
   */
  observe(params: {
    name: string;
    kind: AssetKind;
    domain: string;
    repo: string;
    rfcRefs?: string[];
    sequenceCount?: number;
    description?: string;
    payload?: unknown;
  }): UnifiedAsset {
    const id = `${params.kind}:${params.domain}:${params.name}`;
    let asset = this.assets.get(id);

    if (!asset) {
      asset = {
        id,
        kind: params.kind,
        name: params.name,
        domain: params.domain,
        stage: "evidence",
        confidence: 0.1,
        importance: this.estimateImportance(params.name, params.kind),
        evidence: {
          repos: [params.repo],
          rfcRefs: params.rfcRefs || [],
          sequenceCount: params.sequenceCount || 1,
          crossRepoCount: 1,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
        history: [{
          from: "evidence",
          to: "evidence",
          timestamp: new Date().toISOString(),
          reason: `First observed in ${params.repo}`,
          triggeredBy: "auto",
        }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: params.description || `${params.kind}: ${params.name}`,
        payload: params.payload,
      };
    } else {
      // Update evidence
      if (!asset.evidence.repos.includes(params.repo)) {
        asset.evidence.repos.push(params.repo);
        asset.evidence.crossRepoCount = asset.evidence.repos.length;
      }
      asset.evidence.sequenceCount += (params.sequenceCount || 1);
      asset.evidence.lastSeen = new Date().toISOString();

      // Merge RFC refs
      for (const rfc of (params.rfcRefs || [])) {
        if (!asset.evidence.rfcRefs.includes(rfc)) {
          asset.evidence.rfcRefs.push(rfc);
        }
      }
    }

    // Try auto-promotion
    this.tryPromote(asset, "auto");

    this.assets.set(id, asset);
    return asset;
  }

  /**
   * Try to promote an asset to the next stage.
   * Returns the new stage if promotion succeeded, null otherwise.
   */
  promote(
    assetId: string,
    triggeredBy: "auto" | "human" | "system" = "human",
    reviewer?: string
  ): { promoted: boolean; from: AssetStage; to: AssetStage; reason: string } {
    const asset = this.assets.get(assetId);
    if (!asset) return { promoted: false, from: "evidence", to: "evidence", reason: "Asset not found" };

    return this.tryPromote(asset, triggeredBy, reviewer);
  }

  /**
   * Get the next stage in the lifecycle.
   */
  getNextStage(current: AssetStage): AssetStage | null {
    const stages: AssetStage[] = ["evidence", "candidate", "observed", "validated", "stable", "deprecated", "archived"];
    const idx = stages.indexOf(current);
    if (idx < 0 || idx >= stages.length - 1) return null;
    return stages[idx + 1];
  }

  /**
   * Get all assets at a given stage.
   */
  getByStage(stage: AssetStage): UnifiedAsset[] {
    return [...this.assets.values()].filter(a => a.stage === stage);
  }

  /**
   * Get all assets of a given kind.
   */
  getByKind(kind: AssetKind): UnifiedAsset[] {
    return [...this.assets.values()].filter(a => a.kind === kind);
  }

  /**
   * Get promotion candidates — assets at "candidate" stage ready for review.
   */
  getReviewCandidates(): UnifiedAsset[] {
    return this.getByStage("candidate");
  }

  /**
   * Get stable assets — production-ready.
   */
  getStableAssets(): UnifiedAsset[] {
    return this.getByStage("stable");
  }

  /**
   * Pipeline stats.
   */
  getStats(): {
    total: number;
    byStage: Record<AssetStage, number>;
    byKind: Record<AssetKind, number>;
    reviewCandidates: number;
    stableAssets: number;
  } {
    const byStage: Record<string, number> = {};
    const byKind: Record<string, number> = {};

    for (const a of this.assets.values()) {
      byStage[a.stage] = (byStage[a.stage] || 0) + 1;
      byKind[a.kind] = (byKind[a.kind] || 0) + 1;
    }

    return {
      total: this.assets.size,
      byStage: byStage as Record<AssetStage, number>,
      byKind: byKind as Record<AssetKind, number>,
      reviewCandidates: this.getReviewCandidates().length,
      stableAssets: this.getStableAssets().length,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════════════════════

  private tryPromote(
    asset: UnifiedAsset,
    triggeredBy: "auto" | "human" | "system",
    reviewer?: string
  ): { promoted: boolean; from: AssetStage; to: AssetStage; reason: string } {
    const originalStage = asset.stage;
    let anyPromoted = false;
    let lastReason = "";

    // Chain: keep promoting until a gate fails
    while (true) {
      const currentStage = asset.stage;
      const nextStage = this.getNextStage(currentStage);

      if (!nextStage) break;

      // Auto-promotion stops at deployment (requires real deployment data)
      if (triggeredBy === "auto" && STAGE_ORDER[nextStage] > STAGE_ORDER.deployment) {
        break;
      }

      const gateKey = `${currentStage}→${nextStage}`;
      const gate = PROMOTION_GATES[gateKey];
      if (!gate) break;

      const { passed, reason } = gate(asset);
      lastReason = reason;

      // Human promotion bypasses the RFC/review gate (observed→validated only)
      const isHumanReviewGate = gateKey === "observed→validated" && triggeredBy === "human";
      const effectivePassed = isHumanReviewGate ? true : passed;

      if (effectivePassed) {
        const from = asset.stage;
        asset.stage = nextStage;
        asset.updatedAt = new Date().toISOString();
        asset.history.push({
          from, to: nextStage,
          timestamp: new Date().toISOString(),
          reason, triggeredBy, reviewer,
        });
        this.assets.set(asset.id, asset);
        anyPromoted = true;
      } else {
        break; // Gate failed — stop chaining
      }
    }

    if (anyPromoted) {
      return { promoted: true, from: originalStage, to: asset.stage, reason: lastReason };
    }
    return { promoted: false, from: originalStage, to: originalStage, reason: lastReason || "No promotions applied" };
  }

  /**
   * Estimate importance — NOT frequency. Semantic significance.
   *
   * Rules that manage resources (init/open/close/free) are more important
   * than utility functions (memcpy/strlen) regardless of frequency.
   */
  private estimateImportance(name: string, kind: AssetKind): number {
    const fn = name.toLowerCase();

    // Resource management functions = high importance
    if (/^(init_|create_|open_|close_|free_|destroy_|release_|acquire_)/i.test(fn)) {
      return 0.9;
    }

    // Protocol entry/exit points = high importance
    if (/_(init|cleanup|start|stop|begin|end|setup|teardown)$/i.test(fn)) {
      return 0.85;
    }

    // Verification rules = medium importance
    if (kind === "verification_rule") return 0.6;

    // Knowledge units = medium-high importance
    if (kind === "knowledge_unit") return 0.7;

    return 0.4;
  }
}

// ═══════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════

let _engine: AssetPromotionEngine | null = null;

export function getAssetPromotionEngine(): AssetPromotionEngine {
  if (!_engine) _engine = new AssetPromotionEngine();
  return _engine;
}

// ═══════════════════════════════════════════════════════════════
// Report Formatter
// ═══════════════════════════════════════════════════════════════

export function formatPipelineReport(engine?: AssetPromotionEngine): string {
  const e = engine || getAssetPromotionEngine();
  const stats = e.getStats();
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║     Unified Asset Promotion Pipeline                         ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Total Assets: ${String(stats.total).padStart(5)}  |  Review Candidates: ${String(stats.reviewCandidates).padStart(3)}  |  Stable: ${String(stats.stableAssets).padStart(3)}                    ║`);
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Pipeline visualization
  const stages: AssetStage[] = ["evidence", "candidate", "observed", "validated", "stable", "deprecated", "archived"];
  const maxCount = Math.max(1, ...stages.map(s => stats.byStage[s] || 0));

  lines.push("── Pipeline ──");
  for (const stage of stages) {
    const count = stats.byStage[stage] || 0;
    const bar = "█".repeat(Math.max(1, Math.round(count / maxCount * 30)));
    const label = STAGE_LABELS[stage].padEnd(12);
    lines.push(`  ${label} ${String(count).padStart(3)} ${bar}`);
  }
  lines.push("");

  // By kind
  lines.push("── By Asset Kind ──");
  for (const [kind, count] of Object.entries(stats.byKind)) {
    lines.push(`  ${kind}: ${count}`);
  }
  lines.push("");

  // Review candidates
  const candidates = e.getReviewCandidates();
  if (candidates.length > 0) {
    lines.push("── Review Candidates (ready for promotion) ──");
    for (const c of candidates.slice(0, 10)) {
      const next = e.getNextStage(c.stage);
      lines.push(`  📝 ${c.name.padEnd(35)} ${c.stage} → ${next || "?"} (${c.evidence.crossRepoCount} repos, conf=${(c.confidence*100).toFixed(0)}%)`);
    }
    lines.push("");
  }

  // Stable assets
  const stable = e.getStableAssets();
  if (stable.length > 0) {
    lines.push("── Stable Assets (production) ──");
    for (const s of stable) {
      const rfc = s.evidence.rfcRefs.length > 0 ? `RFC ${s.evidence.rfcRefs.join(",")}` : "no RFC";
      lines.push(`  ✅ ${s.name.padEnd(35)} ${s.domain} | ${rfc} | ${s.evidence.crossRepoCount} repos`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
