// @progmune-generated session=sess_1780751776777_qx2yl timestamp=2026-06-06T13:16:22.160Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureGenome } from "./failure-corpus";
import { computeHealthScore, formatHealthLevel } from "./health-utils";

export function main() {
  const genome = getFailureGenome();
  const healthScore = computeHealthScore(genome, genome);
  const report = formatHealthLevel(healthScore);
  return report;
}
main();
