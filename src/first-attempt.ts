// @progmune-generated session=sess_1780304387308_ssb1m timestamp=2026-06-01T08:59:48.984Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 436 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { findViolations } from "./ssg-validator";
import type { StateTransition } from "./ssg-validator";

export function main() {
  const sessions = getAllSessions();
  const violations = findViolations(sessions);
  return violations;
}
main();
