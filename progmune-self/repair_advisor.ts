// @progmune-generated session=sess_1780689072002_tphq7 timestamp=2026-06-05T19:51:23.521Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { suggestRepairs, getMinimalFixSet, generateRepairSummary } from "./repair-proposal";
import type { ConstraintViolation, StateTransition } from "./runtime-types";
import type { FunctionProtocol } from "./ssg-validator";
import type { RepairProposal, Map } from "./repair-proposal";

export function main(violations: ConstraintViolation, ir: any, protocols: FunctionProtocol, proposals: RepairProposal, ledger: StateTransition, namespaceInitialStates: Map<string, string>) {
  const repairProposals = suggestRepairs(violations, ir, protocols);
  const minimalProposals = getMinimalFixSet(proposals);
  const summary = generateRepairSummary(ledger, ir, protocols, namespaceInitialStates);
  return { repairProposals, minimalProposals, summary };
}
