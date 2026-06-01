// @progmune-generated session=sess_1780304396046_02voz timestamp=2026-06-01T08:59:57.745Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 437 functions, 17 protocol rules
import { getFailureGenome } from "./failure-corpus";
import { loadIR } from "./validator";

export function main() {
  const genome = getFailureGenome();
  const ir = loadIR();
  return genome;
}
main();
