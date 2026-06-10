/**
 * P3.1: Data Quality Layer
 *
 * Separates raw acceptance from verified correctness.
 *
 * Risk: accepted ≠ correct, rejected ≠ wrong.
 * A user accepting a fast-but-leaky repair produces toxic training data
 * for the Reward Model. A user rejecting a correct-but-slow repair
 * deprives the system of a positive signal.
 *
 * RepairOutcome adds three independent verification signals:
 *   1. executionSucceeded  — did it actually run without errors?
 *   2. postValidationPassed — did the SSG validator accept the final state?
 *   3. regressionTestsPassed — did existing tests still pass?
 *
 * Future P4 Reward Model trains on verified outcomes, not raw acceptance.
 */

import { PlannerTelemetry } from "./planner-telemetry";

// ═══════════════════════════════════════════════════════════════
// RepairOutcome — multi-signal verification
// ═══════════════════════════════════════════════════════════════

export interface RepairOutcome {
  /** Raw user/system acceptance. */
  accepted: boolean;

  /** Did the repair execute without runtime errors? */
  executionSucceeded?: boolean;

  /** Did post-execution SSG validation pass? */
  postValidationPassed?: boolean;

  /** Did the project's regression tests pass after the repair? */
  regressionTestsPassed?: boolean;

  /** When the outcome was recorded. */
  timestamp: number;
}

export interface VerifiedOutcome extends RepairOutcome {
  /** Composite quality score 0-1. */
  qualityScore: number;
}

// ═══════════════════════════════════════════════════════════════
// Quality Scoring
// ═══════════════════════════════════════════════════════════════

/** Default weights for quality score computation. */
const DEFAULT_QUALITY_WEIGHTS = {
  execution: 0.4,   // did it run?
  validation: 0.4,  // did the SSG accept the result?
  regression: 0.2,  // did existing tests pass?
};

/**
 * Compute a quality score from a RepairOutcome.
 *
 * If verification signals are missing, the score degrades gracefully:
 *   - No execution data   → weight redistributed to validation
 *   - No validation data  → weight redistributed to execution
 *   - Neither             → 0.5 (neutral prior)
 */
export function computeQualityScore(
  outcome: RepairOutcome,
  weights?: Partial<typeof DEFAULT_QUALITY_WEIGHTS>
): number {
  const w = { ...DEFAULT_QUALITY_WEIGHTS, ...weights };

  let score = 0;
  let totalWeight = 0;

  if (outcome.executionSucceeded !== undefined) {
    score += (outcome.executionSucceeded ? 1 : 0) * w.execution;
    totalWeight += w.execution;
  }
  if (outcome.postValidationPassed !== undefined) {
    score += (outcome.postValidationPassed ? 1 : 0) * w.validation;
    totalWeight += w.validation;
  }
  if (outcome.regressionTestsPassed !== undefined) {
    score += (outcome.regressionTestsPassed ? 1 : 0) * w.regression;
    totalWeight += w.regression;
  }

  return totalWeight > 0 ? score / totalWeight : 0.5;
}

// ═══════════════════════════════════════════════════════════════
// Quality-aware reward signal
// ═══════════════════════════════════════════════════════════════

/**
 * Compute a quality-aware reward for a repair.
 *
 *   reward = accepted * 0.4 + validationPassed * 0.4 + executionSucceeded * 0.2
 *
 * This is the training signal for P4 Reward Model.
 * Raw acceptance alone is NOT sufficient — a fast-but-leaky repair
 * that users love should NOT get a high reward.
 */
export function computeRewardSignal(outcome: RepairOutcome): number {
  const accepted = outcome.accepted ? 1 : 0;
  const validation = outcome.postValidationPassed ? 1 : 0;
  const execution = outcome.executionSucceeded ? 1 : 0;
  const regression = outcome.regressionTestsPassed ? 1 : 0;

  // If validation or regression data is available, it dominates
  if (outcome.postValidationPassed !== undefined || outcome.regressionTestsPassed !== undefined) {
    return (
      accepted * 0.4 +
      validation * 0.4 +
      (execution * 0.1 + regression * 0.1)
    );
  }

  // Fallback: execution + acceptance only
  if (outcome.executionSucceeded !== undefined) {
    return accepted * 0.5 + execution * 0.5;
  }

  // Minimal: no verification data → neutral prior (avoid overfitting to raw acceptance)
  return 0.5;
}

// ═══════════════════════════════════════════════════════════════
// Quality Dashboard
// ═══════════════════════════════════════════════════════════════

export interface QualityReport {
  totalOutcomes: number;
  rawAcceptanceRate: number;
  executionSuccessRate: number;
  validationPassRate: number;
  regressionPassRate: number;
  qualityScoreAvg: number;
  /** Outcomes where acceptance ≠ execution (toxic data). */
  contradictoryOutcomes: number;
}

/**
 * Generate a quality report from telemetry data.
 * Identifies contradictory outcomes where acceptance disagrees with execution.
 */
export function generateQualityReport(
  outcomes: RepairOutcome[]
): QualityReport {
  const total = outcomes.length;
  if (total === 0) {
    return {
      totalOutcomes: 0, rawAcceptanceRate: 0, executionSuccessRate: 0,
      validationPassRate: 0, regressionPassRate: 0, qualityScoreAvg: 0,
      contradictoryOutcomes: 0,
    };
  }

  const accepted = outcomes.filter(o => o.accepted).length;
  const execOk = outcomes.filter(o => o.executionSucceeded === true).length;
  const execTotal = outcomes.filter(o => o.executionSucceeded !== undefined).length;
  const valOk = outcomes.filter(o => o.postValidationPassed === true).length;
  const valTotal = outcomes.filter(o => o.postValidationPassed !== undefined).length;
  const regOk = outcomes.filter(o => o.regressionTestsPassed === true).length;
  const regTotal = outcomes.filter(o => o.regressionTestsPassed !== undefined).length;
  const qualityScores = outcomes.map(o => computeQualityScore(o));
  const qualityAvg = qualityScores.reduce((s, v) => s + v, 0) / total;

  // Contradictory: accepted but execution failed, OR rejected but execution succeeded
  const contradictory = outcomes.filter(o =>
    o.executionSucceeded !== undefined &&
    o.accepted !== o.executionSucceeded
  ).length;

  return {
    totalOutcomes: total,
    rawAcceptanceRate: total > 0 ? accepted / total : 0,
    executionSuccessRate: execTotal > 0 ? execOk / execTotal : 0,
    validationPassRate: valTotal > 0 ? valOk / valTotal : 0,
    regressionPassRate: regTotal > 0 ? regOk / regTotal : 0,
    qualityScoreAvg: qualityAvg,
    contradictoryOutcomes: contradictory,
  };
}

export function printQualityReport(report: QualityReport): void {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   Data Quality Report                    ║");
  console.log("╚══════════════════════════════════════════╝\n");

  console.log(`Total Outcomes:       ${report.totalOutcomes}`);
  console.log(`Raw Acceptance:       ${(report.rawAcceptanceRate * 100).toFixed(1)}%`);
  console.log(`Execution Success:    ${(report.executionSuccessRate * 100).toFixed(1)}%`);
  console.log(`Validation Pass:      ${(report.validationPassRate * 100).toFixed(1)}%`);
  console.log(`Regression Pass:      ${(report.regressionPassRate * 100).toFixed(1)}%`);
  console.log(`Avg Quality Score:    ${(report.qualityScoreAvg * 100).toFixed(1)}%`);
  console.log();

  if (report.contradictoryOutcomes > 0) {
    const pct = (report.contradictoryOutcomes / report.totalOutcomes * 100).toFixed(1);
    console.log(`⚠️  Contradictory:      ${report.contradictoryOutcomes} (${pct}%)`);
    console.log("   (accepted ≠ execution result — potential data poison)");
  }
  console.log();
}
