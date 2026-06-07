// @progmune-generated session=sess_1780751133480_ni8so timestamp=2026-06-06T13:05:40.461Z
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
