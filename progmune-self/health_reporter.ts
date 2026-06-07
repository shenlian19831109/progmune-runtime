// @progmune-generated session=sess_1780751643779_nk7gm timestamp=2026-06-06T13:14:07.823Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { computeHealthScore, formatHealthLevel } from "./health-utils";

export function main(failureGenome: any, antibodyStats: any) {
  const healthScore = computeHealthScore(failureGenome, antibodyStats);
  const status = formatHealthLevel(healthScore);
  return status;
}
