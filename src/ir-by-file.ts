// @progmune-generated session=sess_1780295506230_pzg9t timestamp=2026-06-01T06:31:48.245Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 406 functions, 17 protocol rules
import { extractIR } from "./extract-ir";
import { validateAction } from "./validator";
import { correctFunctionNames } from "./planner";
import type { Action } from "./validator";
import type { Action } from "./planner";

export function main() {
  const ir = extractIR("defaultStr");
  const validated = validateAction(ir, 0);
  const counts = correctFunctionNames(ir, {} as any[]);
  return counts;
}
main();
