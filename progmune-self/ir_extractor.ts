// @progmune-generated session=sess_1780829144099_talcu timestamp=2026-06-07T10:45:47.777Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { extractIR } from "./extract-ir";
import { countExported } from "./ir-utils";

export function main(projectRoot: string) {
  const ir = extractIR(projectRoot);
  const count = countExported(ir);
  return count;
}
