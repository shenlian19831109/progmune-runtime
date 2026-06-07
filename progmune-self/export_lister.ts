// @progmune-generated session=sess_1780829168698_dikvb timestamp=2026-06-07T10:46:11.615Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getExportedDeclarations } from "./ir-utils";
import { extractIRWithTypes } from "./extract-ir";

export function main() {
  const exported = getExportedDeclarations();
  const ir = extractIRWithTypes(exported);
  return ir;
}
main();
