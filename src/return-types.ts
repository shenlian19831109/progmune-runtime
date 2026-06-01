// @progmune-generated session=sess_1780304853802_3cv4d timestamp=2026-06-01T09:07:35.483Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 457 functions, 17 protocol rules
import { extractIR, getReturnType } from "./extract-ir";
import { validateAction } from "./validator";
import type { Action } from "./validator";
import type { FunctionDeclaration } from "./extract-ir";

export function main() {
  const ir = extractIR("defaultStr");
  const validated = validateAction(ir, 0);
  const retType = getReturnType(ir);
  return retType;
}
main();
