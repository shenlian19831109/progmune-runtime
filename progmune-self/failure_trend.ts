// @progmune-generated session=sess_1780683076681_3vwh1 timestamp=2026-06-05T18:11:20.199Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureGenome, getTopFailurePatterns } from "./failure-corpus";
import { formatFailureStats } from "./failure-collector";

export function main() {
  const genome = getFailureGenome();
  const patterns = getTopFailurePatterns(10);
  const report = formatFailureStats();
  return report;
}
main();
