// @progmune-generated session=sess_1780672481559_8raxm timestamp=2026-06-05T15:14:44.868Z
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
