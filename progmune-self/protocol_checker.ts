import { formatStateTransitions } from "./semantic-trace";
// @progmune-generated session=sess_1780751448780_jrlfh timestamp=2026-06-06T13:10:52.920Z
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
