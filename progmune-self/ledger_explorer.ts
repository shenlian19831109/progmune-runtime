// @progmune-generated session=sess_1780732001453_7suhj timestamp=2026-06-06T07:46:44.508Z
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
