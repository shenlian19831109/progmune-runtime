// @progmune-generated session=sess_1780304698066_5ln4i timestamp=2026-06-01T09:05:00.142Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 450 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { findViolations } from "./ssg-validator";
import type { StateTransition } from "./ssg-validator";

export function main() {
  const sessions = getAllSessions();
  const violations = findViolations(sessions);
}
main();
