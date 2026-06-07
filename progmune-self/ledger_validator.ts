// @progmune-generated session=sess_1780751288906_gdtwk timestamp=2026-06-06T13:08:16.058Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { checkLedgerConsistency } from "./ssg-validator";
import type { StateTransition } from "./runtime-types";
import type { Map } from "./ssg-validator";

export function main() {
  const sessions = getAllSessions();
  const result = checkLedgerConsistency(sessions, sessions, sessions);
  return result;
}
main();
