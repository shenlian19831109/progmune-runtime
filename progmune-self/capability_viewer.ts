import { buildCapabilityGraph } from "./strategy-planner";
// @progmune-generated session=sess_1780683112548_6zo5u timestamp=2026-06-05T18:11:56.155Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getExportedDeclarations } from "./ir-utils";
import { selectCapabilityChains, formatChainHint } from "./strategy-planner";
import type { FunctionInfo } from "./extract-ir";
import type { CapabilityChain } from "./strategy-planner";

export function main() {
  const declarations = getExportedDeclarations();
  const graph = buildCapabilityGraph(declarations);
  const chains = selectCapabilityChains("export capability catalog", declarations, 5);
  const hint = formatChainHint(chains);
  return hint;
}
main();
