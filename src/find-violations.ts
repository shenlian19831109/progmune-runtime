// @progmune-generated session=sess_1780295036730_lj1bt timestamp=2026-06-01T06:23:58.536Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 399 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { loadProtocols } from "./semantic-trace";
import { findViolations } from "./ssg-validator";
import type { StateTransition } from "./ssg-validator";

export function main() {
  const sessions = getAllSessions();
  const protocols = loadProtocols("default");
  const violations = findViolations(sessions);
  return violations;
}
main();
