// @progmune-generated session=sess_1780750696004_oyt6o timestamp=2026-06-06T12:58:18.760Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getExportedDeclarations } from "./ir-utils";
import { extractIRWithTypes } from "./extract-ir";

export function main() {
  const declarations = getExportedDeclarations();
  const irWithTypes = extractIRWithTypes(declarations);
  return irWithTypes;
}
main();
