// @progmune-generated session=sess_1780828821698_d2uyh timestamp=2026-06-07T10:40:24.246Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getExportedDeclarations } from "./ir-utils";
import { extractIRWithTypes } from "./extract-ir";

export function main() {
  const declarations = getExportedDeclarations();
  const irWithTypes = extractIRWithTypes(declarations);
  return irWithTypes;
}
main();
