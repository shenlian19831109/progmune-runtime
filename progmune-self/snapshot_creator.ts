import { saveSemantic } from "./memory-layer";
// @progmune-generated session=sess_1780751734663_0c4ns timestamp=2026-06-06T13:15:37.206Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadIR } from "./ir-utils";

export function main(filePath: string) {
  const ir = loadIR(filePath);
  const snapshot = saveSemantic(ir);
  return snapshot;
}
