// @progmune-generated session=sess_1780295433138_flbms timestamp=2026-06-01T06:30:35.045Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 403 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { getSessionTransitions } from "./obs-web";

export function main() {
  const sessions = getAllSessions();
  const transitions = getSessionTransitions(sessions);
}
main();
