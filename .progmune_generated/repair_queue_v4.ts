// @progmune-generated session=sess_1780730049984_zl2a5 timestamp=2026-06-06T07:14:15.551Z
// Generated with IR constraint: 554 functions
import { getAllSessions } from "./failure-corpus";
import { countResolved } from "./session-utils";
import { countSessionsWithViolations } from "./ledger-utils";
import { suggestRepairs } from "./repair-proposal";
import type { ConstraintViolation } from "./runtime-types";
import type { FunctionProtocol } from "./ssg-validator";

export function main(ir: any, protocols: FunctionProtocol) {
  const sessions = getAllSessions();
  const resolved = countResolved(sessions);
  const violationCount = countSessionsWithViolations(sessions);
  const repairs = suggestRepairs(violationCount, ir, protocols);
  return repairs;
}
