// @progmune-generated session=sess_1780751576389_pt699 timestamp=2026-06-06T13:12:58.918Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { countResolved } from "./session-utils";

export function main() {
  const sessions = getAllSessions();
  const resolved = countResolved(sessions);
  return resolved;
}
main();
