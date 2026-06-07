// @progmune-generated session=sess_1780751526871_3px7j timestamp=2026-06-06T13:12:09.852Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getExportedDeclarations } from "./ir-utils";
import { extractIRWithTypes } from "./extract-ir";

export function main() {
  const exported = getExportedDeclarations();
  const ir = extractIRWithTypes(exported);
  return ir;
}
main();
