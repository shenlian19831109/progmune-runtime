// @progmune-generated session=sess_1780290055265_xb6nl timestamp=2026-06-01T05:00:56.516Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 390 functions, 17 protocol rules
import { extractIR } from "./extract-ir";
import { validateAction } from "./validator";
import type { Action } from "./validator";

export function main() {
  const ir = extractIR("defaultStr");
  const validated = validateAction(ir, 0);
  return validated;
}
main();
