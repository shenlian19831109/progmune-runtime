// @progmune-generated session=sess_1780829008753_zc4p5 timestamp=2026-06-07T10:43:31.537Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { checkLedgerConsistency } from "./ssg-validator";
import type { StateTransition } from "./runtime-types";
import type { Map } from "./ssg-validator";

export function main() {
  const sessions = getAllSessions();
  const consistencyResult = checkLedgerConsistency(sessions, sessions, sessions);
  return consistencyResult;
}
main();
