/**
 * Repair Candidate Types — P2 Counterfactual Planner Architecture
 *
 * Pluggable search strategies produce RepairCandidates.
 * FeatureExtractor computes CandidateFeatures from each candidate.
 * Ranker scores and ranks candidates by multiple dimensions.
 *
 * This separation enables P3 (manual weights) → P4 (learned Reward Model)
 * without architectural churn.
 */

import type { Action, GoalConstraint } from "./runtime-types";
import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Search Context
// ═══════════════════════════════════════════════════════════════

/** Context passed to every search strategy — what are we fixing? */
export interface SearchContext {
  protocol: string;
  currentState: string[];
  targetState: string[];
  violationType: string;
  constraints: GoalConstraint[];
  rules: Map<string, StateAnnotation>;
  /** P3.10: Natural language goal (for goal-conditioned planning). */
  goal?: string;
}

// ═══════════════════════════════════════════════════════════════
// Candidate
// ═══════════════════════════════════════════════════════════════

/**
 * A repair candidate produced by a search strategy.
 *
 * Strategies MUST NOT score candidates. Scoring is the Ranker's job.
 * The `source` field MUST be preserved — it becomes a key product metric
 * for answering: "where do the best repair plans come from?"
 */
export interface RepairCandidate {
  /** Stable unique ID for dedup and traceability. */
  id: string;
  /** Primary strategy that produced this candidate. */
  source: "corpus" | "protocol" | "antibody";
  /** The repair action sequence. */
  actions: Action[];
  /** Human-readable explanation of the fix. */
  explanation: string;
  /** Number of corpus examples supporting this path (0 if N/A). */
  evidence?: number;
  /**
   * All evidence sources that produced the same action sequence.
   * When the same repair path comes from corpus + protocol + antibody,
   * all three appear here. Single-source = [source].
   */
  evidenceSources?: string[];
  /** Strategy-specific metadata for feature extraction. */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// Features
// ═══════════════════════════════════════════════════════════════

/**
 * Feature vector extracted from a RepairCandidate.
 *
 * These features are what the Ranker learns from.
 * Future P4: a learned RewardModelRanker consumes the same interface.
 */
export interface CandidateFeatures {
  /** 0-1: how well does this path satisfy safety constraints? */
  protocolSafety: number;
  /** 0-1: historical success rate from corpus evidence. */
  historicalSuccessRate: number;
  /** Number of actions in the repair path. */
  actionCount: number;
  /** 0-1 (inverted): latency cost — more actions = higher cost. */
  latencyCost: number;
  /** 0-1: shorter paths are easier to audit. */
  auditability: number;
  /** Raw count of corpus examples supporting this path. */
  corpusEvidence: number;
  /** Which strategy produced this candidate (preserved for analytics). */
  source: "corpus" | "protocol" | "antibody";
  /** P7.3: 1.0 if this candidate came from a goal-template match (higher priority). */
  goalMatch?: number;
}

// ═══════════════════════════════════════════════════════════════
// Strategy Interface
// ═══════════════════════════════════════════════════════════════

/**
 * A search strategy produces repair candidates for a given context.
 *
 * Strategies MUST NOT score — they find, the Ranker ranks.
 * Named `CandidateSearchStrategy` to avoid collision with
 * `repair-proposal.ts`'s `RepairStrategy` type.
 */
export interface CandidateSearchStrategy {
  readonly name: string;
  search(ctx: SearchContext): RepairCandidate[];
}

// ═══════════════════════════════════════════════════════════════
// Ranker Interfaces
// ═══════════════════════════════════════════════════════════════

/**
 * Low-level scorer: feature vector → score.
 * Future P4: swap LinearRanker for RewardModelRanker — same interface.
 */
export interface Ranker {
  score(features: CandidateFeatures): number;
}

/**
 * Multi-dimensional candidate ranker.
 *
 * Supports four ranking dimensions:
 *   - rankSafety()       — safest path
 *   - rankPerformance()  — fastest path (fewest actions)
 *   - rankAuditability() — most auditable path
 *   - rankOverall()      — weighted combination
 *
 * Different users want different rankings:
 *   - Financial systems → rankSafety()
 *   - Real-time systems → rankPerformance()
 *   - Compliance teams  → rankAuditability()
 */
export interface CandidateRanker {
  score(features: CandidateFeatures): number;
  rankSafety(candidates: RepairCandidate[], features: CandidateFeatures[]): RepairCandidate[];
  rankPerformance(candidates: RepairCandidate[], features: CandidateFeatures[]): RepairCandidate[];
  rankAuditability(candidates: RepairCandidate[], features: CandidateFeatures[]): RepairCandidate[];
  rankOverall(candidates: RepairCandidate[], features: CandidateFeatures[]): RepairCandidate[];
}
