// @progmune-generated session=sess_1780751157495_xtnxp timestamp=2026-06-06T13:06:02.990Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions, getFailureGenome } from "./failure-corpus";
import { countTotalTransitions } from "./ledger-utils";

export function main() {
  const sessions = getAllSessions();
  const totalTransitions = countTotalTransitions(sessions);
  const genome = getFailureGenome();
  return genome;
}
main();
