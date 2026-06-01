// @progmune-generated session=sess_1780346660817_bcum7 timestamp=2026-06-01T20:44:22.826Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 392 functions, 17 protocol rules
import { extractIR } from "./extract-ir";
import { validateAction } from "./validator";
import type { Action } from "./validator";

export function main() {
  const ir = extractIR("");
  const validated = validateAction(ir, 0);
  return validated;
}
main();
