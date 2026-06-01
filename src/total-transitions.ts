// @progmune-generated session=sess_1780304640736_nx7eo timestamp=2026-06-01T09:04:03.943Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 444 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { getSessionTransitions } from "./obs-web";

export function main() {
  const sessions = getAllSessions();
  const ledger = getLedger();
  const transitions = getSessionTransitions(sessions);
}
main();
