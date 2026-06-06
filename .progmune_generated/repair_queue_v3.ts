// @progmune-generated session=sess_1780728257321_sq7rz timestamp=2026-06-06T06:44:34.525Z
// Generated with IR constraint: 554 functions
import { getAllSessions } from "./failure-corpus";
import { countSessionsWithViolations } from "./ledger-utils";
import { countResolved } from "./session-utils";
import { suggestRepairs, generateRepairSummary } from "./repair-proposal";
import type { ConstraintViolation, StateTransition } from "./runtime-types";
import type { FunctionProtocol } from "./ssg-validator";
import type { Map } from "./repair-proposal";

export function main(violations: ConstraintViolation, ir: any, protocols: FunctionProtocol, ledger: StateTransition, namespaceInitialStates: Map<string, string>) {
  const sessions = getAllSessions();
  const violationCount = countSessionsWithViolations([]);
  const resolutionCount = countResolved([]);
  const repairProposals = suggestRepairs(violations, ir, protocols);
  const repairSummary = generateRepairSummary(ledger, ir, protocols, namespaceInitialStates);
  return { sessions, violationCount, resolutionCount, repairProposals, repairSummary };
}
