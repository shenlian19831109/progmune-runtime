// @progmune-generated session=sess_1780689005233_bg4g8 timestamp=2026-06-05T19:50:09.460Z
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
