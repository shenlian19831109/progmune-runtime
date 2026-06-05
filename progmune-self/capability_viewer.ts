// @progmune-generated session=sess_1780681612038_ug50q timestamp=2026-06-05T17:46:56.178Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { buildCompactFuncList } from "./planner-prompts";

export function main() {
  const declarations = getExportedDeclarations();
  const catalog = buildCompactFuncList(declarations, declarations);
  return catalog;
}
main();
