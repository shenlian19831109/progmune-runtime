import { formatStateTransitions } from "./semantic-trace";
// @progmune-generated session=sess_1780829104379_names timestamp=2026-06-07T10:45:07.936Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { validateActionResult } from "./validator";
import { mineRules } from "./rule-miner";
import type { Action } from "./runtime-types";

export function main(actions: Action[], session: ExecutionSession) {
  const validationResult = validateActionResult(actions);
  const minedRules = mineRules();
  const formattedTransitions = formatStateTransitions(session);
  return formattedTransitions;
}
