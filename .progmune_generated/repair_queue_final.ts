// @progmune-generated session=sess_1780730850753_314ax timestamp=2026-06-06T07:27:40.467Z
// Generated with IR constraint: 554 functions
import { getAllSessions } from "./failure-corpus";
import { countResolved } from "./session-utils";
import { countSessionsWithViolations } from "./ledger-utils";
import { suggestRepairs } from "./repair-proposal";
import type { ConstraintViolation } from "./runtime-types";
import type { FunctionProtocol } from "./ssg-validator";

export function main() {
  const sessions = getAllSessions();
  const resolved = countResolved(sessions);
  const violationCount = countSessionsWithViolations(sessions);
  const repairs = suggestRepairs(violationCount, violationCount, violationCount);
  return repairs;
}
main();
