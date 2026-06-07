import { formatAnomalyReport } from "./semantic-trace";
// @progmune-generated session=sess_1780750660826_ayv9k timestamp=2026-06-06T12:57:44.586Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureGenome, getTopFailurePatterns } from "./failure-corpus";

export function main() {
  const genome = getFailureGenome();
  const patterns = getTopFailurePatterns(10);
  const report = formatAnomalyReport(genome);
  return report;
}
main();
