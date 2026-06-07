// @progmune-generated session=sess_1780829081005_v5ivf timestamp=2026-06-07T10:44:45.082Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { validateProposal } from "./repair-proposal";
import { replayLedger } from "./deterministic-replay";
import type { RepairProposal, Map } from "./repair-proposal";
import type { StateTransition } from "./runtime-types";
import type { Map } from "./deterministic-replay";

export function main(proposal: RepairProposal, currentLedger: StateTransition, namespaceInitialStates: Map<string, string>, sessionId: string, storedRuleHash: string, storedLedgerHash: string, currentRuleHash: string) {
  const validationResult = validateProposal(proposal, currentLedger, namespaceInitialStates);
  const replayResult = replayLedger(sessionId, validationResult, storedRuleHash, storedLedgerHash, currentRuleHash, "new Map()", "new Map()");
  return replayResult;
}
