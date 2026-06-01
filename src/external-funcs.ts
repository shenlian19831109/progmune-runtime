// @progmune-generated session=sess_1780294700533_6mjx3 timestamp=2026-06-01T06:18:22.148Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 391 functions, 17 protocol rules
import { extractIR, extractDirectCalls } from "./extract-ir";
import { validateAction } from "./validator";
import type { Action } from "./validator";
import type { FunctionDeclaration } from "./extract-ir";

export function main() {
  const ir = extractIR("defaultStr");
  const valid = validateAction(ir, 0);
  const externalFuncs = extractDirectCalls(ir);
  return externalFuncs;
}
main();
