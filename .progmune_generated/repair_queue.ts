// @progmune-generated session=sess_1780726386888_0tndc timestamp=2026-06-06T06:13:30.623Z
// Generated with IR constraint: 554 functions
import { getAllSessions } from "../src/failure-corpus";
import { countSessionsWithViolations } from "../src/ledger-utils";
import { countResolved } from "../src/session-utils";
import { suggestRepairs, generateRepairSummary } from "../src/repair-proposal";
import type { ConstraintViolation, StateTransition } from "../src/runtime-types";
import type { FunctionProtocol } from "../src/ssg-validator";

export function main(violations: ConstraintViolation[], ir: any, protocols: FunctionProtocol[], ledger: StateTransition, namespaceInitialStates: Map<string, string>) {
  const sessions = getAllSessions();
  const violationCount = countSessionsWithViolations([]);
  const resolutionCount = countResolved([]);
  const repairProposals = suggestRepairs(violations, ir, protocols);
  const repairSummary = generateRepairSummary(ledger, ir, protocols, namespaceInitialStates);
  return { sessions, violationCount, resolutionCount, repairProposals, repairSummary };
}
