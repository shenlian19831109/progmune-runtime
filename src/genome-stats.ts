// @progmune-generated session=sess_1780289524436_6mq0y timestamp=2026-06-01T04:52:06.341Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 381 functions, 17 protocol rules
import { extractIR } from "./extract-ir";
import { getFailureGenome } from "./failure-corpus";

export function main() {
  const ir = extractIR("defaultStr");
  const genome = getFailureGenome();
  return genome;
}
main();
