import { getSessionTransitions } from "./obs-web";
// @progmune-generated session=sess_1780829069665_9ecy3 timestamp=2026-06-07T10:44:33.006Z
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
