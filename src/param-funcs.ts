// @progmune-generated session=sess_1780295741901_n4mgu timestamp=2026-06-01T06:35:44.653Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 413 functions, 17 protocol rules
import { extractIR } from "./extract-ir";
import { listAllStates } from "./ssg-validator";
import type { StateTransition } from "./ssg-validator";

export function main() {
  const ir = extractIR("defaultStr");
  const states = listAllStates(ir);
  return states;
}
main();
