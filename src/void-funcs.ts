// @progmune-generated session=sess_1780295093317_9ccza timestamp=2026-06-01T06:24:54.794Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 402 functions, 17 protocol rules
import { extractIR, getReturnType } from "./extract-ir";
import { validateAction } from "./validator";
import type { Action } from "./validator";
import type { FunctionDeclaration } from "./extract-ir";

export function main() {
  const ir = extractIR("defaultStr");
  const valid = validateAction(ir, 0);
  const retType = getReturnType(ir);
}
main();
