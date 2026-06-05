// @progmune-generated session=sess_1780681600224_e9f8s timestamp=2026-06-05T17:46:44.464Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureGenome, getTopFailurePatterns } from "./failure-corpus";

export function main() {
  const genome = getFailureGenome();
  const patterns = getTopFailurePatterns(0);
  const report = formatGenomeSummary();
  return report;
}
main();
