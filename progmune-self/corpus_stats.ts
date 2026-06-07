// @progmune-generated session=sess_1780828958194_8hsm1 timestamp=2026-06-07T10:42:41.624Z
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
