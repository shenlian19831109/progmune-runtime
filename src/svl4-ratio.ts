// @progmune-generated session=sess_1780304717192_j2wfa timestamp=2026-06-01T09:05:19.091Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 452 functions, 17 protocol rules
import { getFailureGenome, getFailuresBySVL } from "./failure-corpus";
import type { SVL } from "./failure-corpus";

export function main() {
  const genome = getFailureGenome();
  const svl4 = getFailuresBySVL({} as SVL);
  return "$genome.totalFailures > 0 ? $svl4.length / $genome.totalFailures : 0";
}
main();
