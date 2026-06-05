// @progmune-generated session=sess_1780672485088_60xff timestamp=2026-06-05T15:14:48.690Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAntibodyStats, getFailureGenome } from "../src/failure-corpus";
import { computeImmuneMetrics } from "../src/immune-metrics";
import { computeHealthScore, formatHealthLevel } from "../src/health-utils";

export function main() {
  const genome = getFailureGenome();
  const antibodyStats = getAntibodyStats();
  const metrics = computeImmuneMetrics();
  const score = computeHealthScore(genome, antibodyStats);
  const status = formatHealthLevel(score);
  return { metrics, score, status };
}
main();
