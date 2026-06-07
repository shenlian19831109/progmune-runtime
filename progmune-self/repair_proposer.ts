// @progmune-generated session=sess_1780829058458_ca7zw timestamp=2026-06-07T10:44:21.527Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { suggestInvariantRepair } from "./repair-proposal";
import type { LedgerConsistencyViolation } from "./ssg-validator";
import type { StateTransition } from "./runtime-types";
import type { Map } from "./repair-proposal";

export function main(violation: LedgerConsistencyViolation, ledger: StateTransition[], namespaceInitialStates: Map<string, string>) {
  const repairProposals = suggestInvariantRepair(violation, ledger, namespaceInitialStates);
  return repairProposals;
}
