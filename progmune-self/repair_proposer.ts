// @progmune-generated session=sess_1780751385902_ptv86 timestamp=2026-06-06T13:09:50.127Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { suggestInvariantRepair } from "./repair-proposal";
import type { LedgerConsistencyViolation } from "./ssg-validator";
import type { StateTransition } from "./runtime-types";
import type { Map } from "./repair-proposal";

export function main(violation: LedgerConsistencyViolation, ledger: StateTransition[], namespaceInitialStates: Map<string, string>) {
  const repairProposals = suggestInvariantRepair(violation, ledger, namespaceInitialStates);
  return repairProposals;
}
