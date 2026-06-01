// @progmune-generated session=sess_1780304414878_nefap timestamp=2026-06-01T09:00:16.744Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 439 functions, 17 protocol rules
import { extractIR, extractDirectCalls } from "./extract-ir";
import { validateAction } from "./validator";
import type { Action } from "./validator";
import type { FunctionDeclaration } from "./extract-ir";

export function main() {
  const ir = extractIR("defaultStr");
  const validated = validateAction(ir, 0);
  const calls = extractDirectCalls(ir);
  return calls;
}
main();
