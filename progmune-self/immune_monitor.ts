// @progmune-generated session=sess_1780689033516_7xe05 timestamp=2026-06-05T19:50:37.106Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAntibodyStats } from "./failure-corpus";
import { computeImmuneMetrics } from "./immune-metrics";
import { computeHealthScore, formatHealthLevel } from "./health-utils";

export function main() {
  const stats = getAntibodyStats();
  const metrics = computeImmuneMetrics();
  const score = computeHealthScore(metrics, stats);
  const status = formatHealthLevel(score);
  return status;
}
main();
