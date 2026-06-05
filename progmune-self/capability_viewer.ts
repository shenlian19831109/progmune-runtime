import { buildCapabilityGraph } from "./strategy-planner";
// @progmune-generated session=sess_1780689047148_ulnlx timestamp=2026-06-05T19:50:50.301Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getExportedDeclarations } from "./ir-utils";
import { formatChainHint } from "./strategy-planner";
import type { CapabilityChain } from "./strategy-planner";

export function main() {
  const declarations = getExportedDeclarations();
  const graph = buildCapabilityGraph(declarations);
  const catalog = formatChainHint(graph);
  return catalog;
}
main();
