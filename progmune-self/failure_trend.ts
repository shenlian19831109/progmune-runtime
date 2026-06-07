import { formatAnomalyReport } from "./semantic-trace";
// @progmune-generated session=sess_1780828781852_goexp timestamp=2026-06-07T10:39:46.553Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureGenome, getTopFailurePatterns } from "./failure-corpus";

export function main() {
  const genome = getFailureGenome();
  const patterns = getTopFailurePatterns(10);
  const report = formatAnomalyReport(genome);
  return report;
}
main();
