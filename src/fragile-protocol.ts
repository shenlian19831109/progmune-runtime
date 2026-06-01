// @progmune-generated session=sess_1780295072433_6rten timestamp=2026-06-01T06:24:34.107Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 401 functions, 17 protocol rules
import { getFailureGenome, getTopFailurePatterns } from "./failure-corpus";

export function main() {
  const genome = getFailureGenome();
  const patterns = getTopFailurePatterns(0);
  return patterns;
}
main();
