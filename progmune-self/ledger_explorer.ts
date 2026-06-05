// @progmune-generated session=sess_1780683089130_3c2wp timestamp=2026-06-05T18:11:32.447Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { countSessionLedgers } from "./health-utils";
import { countSessionsWithViolations } from "./ledger-utils";

export function main() {
  const sessions = getAllSessions();
  const ledgerCounts = countSessionLedgers(sessions);
  const violationCount = countSessionsWithViolations(sessions);
  return violationCount;
}
main();
