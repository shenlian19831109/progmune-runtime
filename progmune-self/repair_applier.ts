import { getSessionTransitions } from "./obs-web";
// @progmune-generated session=sess_1780751401406_rh7z7 timestamp=2026-06-06T13:10:05.358Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { applyProposalAsBranch } from "./repair-proposal";
import type { RepairProposal } from "./repair-proposal";
import type { Branch } from "./branch-ledger";
import type { StateTransition } from "./runtime-types";

export function main() {
  const sessions = getAllSessions();
  const transitions = getSessionTransitions(sessions);
  const branch = applyProposalAsBranch(transitions, transitions, transitions, transitions);
  return branch;
}
main();
