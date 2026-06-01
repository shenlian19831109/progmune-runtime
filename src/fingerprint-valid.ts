// @progmune-generated session=sess_1780292712254_h15ay timestamp=2026-06-01T05:45:13.848Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 395 functions, 17 protocol rules
import { getAllSessions, getAllFailures } from "./failure-corpus";
import { fingerprintsDir } from "./ledger-registry";

export function main() {
  const sessions = getAllSessions();
  const dir = fingerprintsDir();
  const failures = getAllFailures();
  return failures;
}
main();
