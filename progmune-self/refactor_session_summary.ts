// @progmune-generated session=sess_1780679178439_9isdd timestamp=2026-06-05T17:06:23.835Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "../src/failure-corpus";
import { countResolved } from "../src/session-utils";
import { countSessionsWithViolations } from "../src/ledger-utils";

export function main() {
  const sessions = getAllSessions();
  const resolvedCounts = countResolved(sessions);
  const violationCount = countSessionsWithViolations(sessions);
  return resolvedCounts;
}
main();
