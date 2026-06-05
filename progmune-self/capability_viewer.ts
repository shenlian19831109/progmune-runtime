// @progmune-generated session=sess_1780672488852_6bywn timestamp=2026-06-05T15:14:53.485Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadIR, countExported } from "../src/ir-utils";
import { buildCompactFuncList } from "../src/planner-prompts";

export function main() {
  const allFuncs = loadIR();
  const exported = allFuncs.filter((f: any) => f.exported);
  const catalog = buildCompactFuncList(exported, allFuncs);
  return { total: allFuncs.length, exported: countExported(allFuncs), catalog };
}
main();
