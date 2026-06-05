// @progmune-generated session=sess_1780679175012_9iora timestamp=2026-06-05T17:06:18.160Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadFailures, classifyError, formatFailureStats } from "../src/failure-collector";

export function main() {
  const failures = loadFailures();
  const classified = classifyError(failures);
  const report = formatFailureStats();
  return report;
}
main();
