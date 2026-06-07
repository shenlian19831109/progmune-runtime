import { validateActionSchema } from "./planner";
// @progmune-generated session=sess_1780829155889_j0f9p timestamp=2026-06-07T10:46:00.084Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadIR } from "./ir-utils";

export function main(filePath: string) {
  const ir = loadIR(filePath);
  const validation = validateActionSchema(ir);
  return validation;
}
