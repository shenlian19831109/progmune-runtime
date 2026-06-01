// @progmune-generated session=sess_1780303111646_1ww78 timestamp=2026-06-01T08:38:33.890Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 433 functions, 17 protocol rules
import { verifyAllFingerprints } from "./ledger-registry";

export function main() {
  const summary = verifyAllFingerprints("defaultStr");
  return summary;
}
main();
