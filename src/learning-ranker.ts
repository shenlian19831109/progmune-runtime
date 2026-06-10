/**
 * P2.6: Learning Ranker — Feedback-Weighted Ranking
 *
 * Wraps a base Ranker and adjusts scores using real acceptance data
 * from the TelemetryIndex. This is the first self-improving loop:
 *
 *   Planner → Feedback → Telemetry → LearningRanker → Better Ranking
 *
 * Architecture:
 *   LearningRanker WRAPS Ranker (does not implement it).
 *   Base Ranker handles protocolSafety / performance / auditability.
 *   LearningRanker adds feedback correction on top.
 *
 * Evolution path:
 *   HeuristicRanker (P3) → LearningRanker (P2.6) → RewardModelRanker (P4)
 */

import type { RepairCandidate, CandidateFeatures } from "./repair-types";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import { createLinearRanker } from "./repair-ranker";
import type { CandidateRanker } from "./repair-types";

// ═══════════════════════════════════════════════════════════════
// Ranked Candidate
// ═══════════════════════════════════════════════════════════════

export interface RankedCandidate extends RepairCandidate {
  /** Composite score after feedback correction. */
  score: number;
  /** Acceptance rate from telemetry (0-1, 0.5 if no data). */
  acceptance: number;
  /** Effective reward: 0.5 * acceptance + 0.5 * executionSuccess. */
  effectiveReward: number;
  /** Raw base score before feedback correction. */
  baseScore: number;
}

// ═══════════════════════════════════════════════════════════════
// Learning Ranker
// ═══════════════════════════════════════════════════════════════

export interface LearningRankerConfig {
  /** Weight of the base heuristic score. */
  baseWeight: number;
  /** Weight of the telemetry feedback signal. */
  feedbackWeight: number;
  /** Minimum samples before trusting telemetry data. */
  minSamples: number;
}

const DEFAULT_CONFIG: LearningRankerConfig = {
  baseWeight: 0.7,
  feedbackWeight: 0.3,
  minSamples: 5,
};

/**
 * LearningRanker wraps a base CandidateRanker and applies
 * feedback correction from the TelemetryIndex.
 *
 * Usage:
 *   const base = createLinearRanker();
 *   const learner = new LearningRanker(base, telemetry);
 *   const ranked = learner.rank(candidates, features, ctx);
 */
export class LearningRanker {
  private base: CandidateRanker;
  private telemetry: PlannerTelemetry;
  private config: LearningRankerConfig;

  constructor(
    baseRanker: CandidateRanker,
    telemetry: PlannerTelemetry,
    config?: Partial<LearningRankerConfig>
  ) {
    this.base = baseRanker;
    this.telemetry = telemetry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Rank candidates by base heuristic score, then adjust
   * using acceptance data from the telemetry index.
   *
   * @param candidates  Repair candidates to rank
   * @param features    Feature vectors (same index as candidates)
   * @param ctx         Search context (for protocol/violationType)
   */
  rank(
    candidates: RepairCandidate[],
    features: CandidateFeatures[],
    ctx: { protocol: string; violationType?: string }
  ): RankedCandidate[] {
    // 1. Score with base ranker
    const baseScores = features.map(f => this.base.score(f));

    // 2. Adjust with telemetry feedback
    const ranked: RankedCandidate[] = candidates.map((c, i) => {
      const fp = this.fingerprintFor(c, ctx);
      const acceptance = this.telemetry.getCandidateAcceptance(
        fp, this.config.minSamples
      );
      const effectiveReward = this.telemetry.getCandidateReward(
        fp, this.config.minSamples
      );
      const baseScore = baseScores[i];
      const adjustedScore =
        baseScore * this.config.baseWeight +
        effectiveReward * this.config.feedbackWeight;

      return {
        ...c,
        score: adjustedScore,
        acceptance,
        effectiveReward,
        baseScore,
      };
    });

    // 3. Sort by adjusted score descending
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  /**
   * Single-candidate score (used by backwards-compat code).
   */
  score(
    candidate: RepairCandidate,
    features: CandidateFeatures,
    ctx: { protocol: string; violationType?: string }
  ): number {
    const fp = this.fingerprintFor(candidate, ctx);
    const baseScore = this.base.score(features);
    const effectiveReward = this.telemetry.getCandidateReward(
      fp, this.config.minSamples
    );
    return (
      baseScore * this.config.baseWeight +
      effectiveReward * this.config.feedbackWeight
    );
  }

  /** Compute the v2 fingerprint for a candidate. */
  private fingerprintFor(
    candidate: RepairCandidate,
    ctx: { protocol: string; violationType?: string }
  ): string {
    const actions = candidate.actions
      .filter(a => a.kind === "call")
      .map(a => (a as { function: string }).function);
    return candidateFingerprint(ctx.protocol, actions, ctx.violationType);
  }
}

// ═══════════════════════════════════════════════════════════════
// Convenience factory
// ═══════════════════════════════════════════════════════════════

/**
 * Create a fully wired learning ranker:
 *   LinearRanker (base) + TelemetryIndex (feedback) = LearningRanker
 */
export function createLearningRanker(
  telemetry: PlannerTelemetry,
  config?: Partial<LearningRankerConfig>
): LearningRanker {
  return new LearningRanker(createLinearRanker(), telemetry, config);
}
