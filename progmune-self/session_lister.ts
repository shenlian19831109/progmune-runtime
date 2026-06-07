// @progmune-generated session=sess_1780829234063_6eqb9 timestamp=2026-06-07T10:47:17.630Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { countResolved } from "./session-utils";

export function main() {
  const sessions = getAllSessions();
  const resolved = countResolved(sessions);
  return resolved;
}
main();
