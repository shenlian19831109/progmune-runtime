// @progmune-generated session=sess_1780751496695_fnhsj timestamp=2026-06-06T13:11:42.128Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { extractIR } from "./extract-ir";
import { countExported } from "./ir-utils";

export function main(projectRoot: string) {
  const ir = extractIR(projectRoot);
  const count = countExported(ir);
  return count;
}
