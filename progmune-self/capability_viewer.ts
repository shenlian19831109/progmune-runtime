// @progmune-generated session=sess_1780672488852_6bywn timestamp=2026-06-05T15:14:53.485Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { buildCompactFuncList } from "./planner-prompts";

export function main() {
  const declarations = getExportedDeclarations();
  const catalog = buildCompactFuncList(declarations, declarations);
  return catalog;
}
main();
