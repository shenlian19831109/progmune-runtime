// @progmune-generated session=sess_1780343673382_7ucqe timestamp=2026-06-01T19:54:34.915Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 391 functions, 17 protocol rules
import { verifyAllFingerprints } from "./ledger-registry";
import { getAllSessions } from "./failure-corpus";
import { listAllStates } from "./ssg-validator";
import type { StateTransition } from "./ssg-validator";

export function main() {
  const summary = verifyAllFingerprints("defaultStr");
  const sessions = getAllSessions();
  const states = listAllStates(sessions);
  return sessions;
}
main();
