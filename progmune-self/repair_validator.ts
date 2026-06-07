// @progmune-generated session=sess_1780751417118_h91vr timestamp=2026-06-06T13:10:21.566Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { validateProposal } from "./repair-proposal";
import type { RepairProposal, Map } from "./repair-proposal";
import type { StateTransition } from "./runtime-types";

export function main(proposal: RepairProposal, ledger: StateTransition[], namespaceInitialStates: Map<string, string>) {
  const validationResult = validateProposal(proposal, ledger, namespaceInitialStates);
  return validationResult;
}
