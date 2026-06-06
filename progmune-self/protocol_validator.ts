import { formatAnomalyReport } from "./semantic-trace";
import { validateProtocolWithTransitions } from "./planner";
// @progmune-generated session=sess_1780732037720_3xj6r timestamp=2026-06-06T07:47:21.938Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { checkLedgerConsistency } from "./ssg-validator";
import type { StateTransition } from "./runtime-types";

export function main(actions: Action, protocols: FunctionProtocol, namespaceInitialStates: Map<string, string>) {
  const validationResult = validateProtocolWithTransitions(actions, protocols, namespaceInitialStates);
  const consistencyResult = checkLedgerConsistency("validationResult.transitions", validationResult, validationResult);
  const report = formatAnomalyReport(validationResult);
  return report;
}
