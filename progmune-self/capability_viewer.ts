// @progmune-generated session=sess_1780732025580_z8fuu timestamp=2026-06-06T07:47:08.327Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getExportedDeclarations } from "./ir-utils";
import { extractIRWithTypes } from "./extract-ir";

export function main() {
  const declarations = getExportedDeclarations();
  const irWithTypes = extractIRWithTypes(declarations);
  return irWithTypes;
}
main();
