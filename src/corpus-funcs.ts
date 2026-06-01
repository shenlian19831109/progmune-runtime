// @progmune-generated session=sess_1780304669698_6xltd timestamp=2026-06-01T09:04:31.394Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 447 functions, 17 protocol rules
import { extractIR } from "./extract-ir";
import { validateAction } from "./validator";
import type { Action } from "./validator";

export function main() {
  const ir = extractIR("defaultStr");
  const validated = validateAction(ir, 0);
  return validated;
}
main();
