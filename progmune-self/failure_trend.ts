// @progmune-generated session=sess_1780672477049_8he7z timestamp=2026-06-05T15:14:41.415Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureGenome, getTopFailurePatterns } from "../src/failure-corpus";
import { formatFailureStats } from "../src/failure-collector";

export function main() {
  const genome = getFailureGenome();
  const patterns = getTopFailurePatterns(10);
  const report = formatFailureStats();
  return { totalFailures: genome.totalFailures, topPatterns: patterns.length, report };
}
main();
