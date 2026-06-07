// @progmune-generated session=sess_1780751612918_4b4ih timestamp=2026-06-06T13:13:36.517Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { selectCapabilityChains } from "./strategy-planner";
import type { FunctionInfo } from "./extract-ir";

export function main() {
  const chains = selectCapabilityChains("select the best capability chain for an intent without calling LLM", "[]", 1, "[]");
  return chains;
}
main();
