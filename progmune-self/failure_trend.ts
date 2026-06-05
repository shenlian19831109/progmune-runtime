// @progmune-generated session=sess_1780672477049_8he7z timestamp=2026-06-05T15:14:41.415Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureGenome, getTopFailurePatterns } from "./failure-corpus";
import { formatFailureStats } from "./failure-collector";

export function main() {
  const genome = getFailureGenome();
  const patterns = getTopFailurePatterns(0);
  const report = formatFailureStats();
  return report;
}
main();
