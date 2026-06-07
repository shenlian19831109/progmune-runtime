// @progmune-generated session=sess_1780831441474_5cbr9 timestamp=2026-06-07T11:24:11.317Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureGenome } from "./failure-corpus";
import { computeHealthScore, formatHealthLevel } from "./health-utils";

export function main() {
  const genome = getFailureGenome();
  const healthScore = computeHealthScore(genome, [object Object]);
  const report = formatHealthLevel(healthScore);
  return report;
}
main();
