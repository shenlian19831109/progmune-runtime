// @progmune-generated session=sess_1780828944149_og7nn timestamp=2026-06-07T10:42:28.725Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllFailures, getFailuresBySVL } from "./failure-corpus";
import { formatFailureStats } from "./failure-collector";
import type { SVL } from "./failure-corpus";

export function main() {
  const failures = getAllFailures();
  const svlFailures = getFailuresBySVL(failures);
  const report = formatFailureStats();
  return report;
}
main();
