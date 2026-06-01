// @progmune-generated session=sess_1780302781316_3112t timestamp=2026-06-01T08:33:04.337Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 422 functions, 17 protocol rules
import { getFailureGenome, getTopFailurePatterns } from "./failure-corpus";

export function main() {
  const genome = getFailureGenome();
  const top = getTopFailurePatterns(0);
  return top;
}
main();
