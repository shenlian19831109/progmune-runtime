import { formatAnomalyReport } from "./semantic-trace";
import { validateProtocolWithTransitions } from "./planner";
// @progmune-generated session=sess_1780750707636_rpql8 timestamp=2026-06-06T12:58:31.759Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { checkLedgerConsistency } from "./ssg-validator";
import type { StateTransition } from "./runtime-types";

export function main(actions: Action, protocols: FunctionProtocol, namespaceInitialStates: Map<string, string>) {
  const validationResult = validateProtocolWithTransitions(actions, protocols, namespaceInitialStates);
  const consistencyResult = checkLedgerConsistency("validationResult.transitions", "validationResult.namespaceInitialStates", "validationResult.protocolRules");
  const report = formatAnomalyReport(consistencyResult);
  return report;
}
