// @progmune-generated session=sess_1780294777098_qub4s timestamp=2026-06-01T06:19:38.393Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 395 functions, 17 protocol rules
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
