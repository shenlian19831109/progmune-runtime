// @progmune-generated session=sess_1780302825436_ii9ik timestamp=2026-06-01T08:33:47.317Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 424 functions, 17 protocol rules
import { extractIR, extractDirectCalls } from "./extract-ir";
import { validateAction } from "./validator";
import type { Action } from "./validator";
import type { FunctionDeclaration } from "./extract-ir";

export function main() {
  const ir = extractIR("defaultStr");
  const validated = validateAction(ir, 0);
  const fileFuncs = extractDirectCalls(ir);
  return fileFuncs;
}
main();
