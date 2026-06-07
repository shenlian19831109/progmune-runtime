import { fixParameterCounts } from "./planner";
// @progmune-generated session=sess_1780751515334_cvf9d timestamp=2026-06-06T13:11:58.738Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { extractIR } from "./extract-ir";

export function main(projectRoot: string) {
  const ir = extractIR(projectRoot);
  const fixed = fixParameterCounts(ir, ir);
  return fixed;
}
