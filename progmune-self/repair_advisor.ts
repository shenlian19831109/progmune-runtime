// @progmune-generated session=sess_1780750719781_hi498 timestamp=2026-06-06T12:58:43.654Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { suggestRepairs, getMinimalFixSet, generateRepairSummary } from "./repair-proposal";
import type { ConstraintViolation, StateTransition } from "./runtime-types";
import type { FunctionProtocol } from "./ssg-validator";
import type { RepairProposal, Map } from "./repair-proposal";

export function main(violations: ConstraintViolation[], ir: any[], protocols: FunctionProtocol[], ledger: StateTransition[], namespaceInitialStates: Map<string, string>) {
  const proposals = suggestRepairs(violations, ir, protocols);
  const minimal = getMinimalFixSet(proposals);
  const summary = generateRepairSummary(ledger, ir, protocols, namespaceInitialStates);
  return summary;
}
