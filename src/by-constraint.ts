// @progmune-generated session=sess_1780295683671_1crp9 timestamp=2026-06-01T06:34:45.061Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 410 functions, 17 protocol rules
import { getFailureGenome, getAllFailures } from "./failure-corpus";
import { findViolations } from "./ssg-validator";
import type { StateTransition } from "./ssg-validator";

export function main() {
  const genome = getFailureGenome();
  const failures = getAllFailures();
  const violations = findViolations(failures);
  return genome;
}
main();
