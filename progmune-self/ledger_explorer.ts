// @progmune-generated session=sess_1780750672366_3z1wh timestamp=2026-06-06T12:57:56.461Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { countSessionLedgers } from "./health-utils";
import { countSessionsWithViolations } from "./ledger-utils";

export function main() {
  const sessions = getAllSessions();
  const ledgerCounts = countSessionLedgers(sessions);
  const violations = countSessionsWithViolations(sessions);
  return violations;
}
main();
