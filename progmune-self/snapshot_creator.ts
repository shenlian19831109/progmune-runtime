import { saveSemantic } from "./memory-layer";
// @progmune-generated session=sess_1780831367988_5xbq1 timestamp=2026-06-07T11:22:51.640Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadIR } from "./ir-utils";

export function main(filePath: string) {
  const ir = loadIR(filePath);
  const result = saveSemantic(ir);
  return result;
}
