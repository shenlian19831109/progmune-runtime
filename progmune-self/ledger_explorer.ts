// @progmune-generated session=sess_1780828796028_mecy3 timestamp=2026-06-07T10:39:59.249Z
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
