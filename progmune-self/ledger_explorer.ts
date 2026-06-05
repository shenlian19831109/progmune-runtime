// @progmune-generated session=sess_1780689019907_ocbug timestamp=2026-06-05T19:50:24.454Z
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
