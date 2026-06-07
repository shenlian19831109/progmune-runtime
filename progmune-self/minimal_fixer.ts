// @progmune-generated session=sess_1780829093177_3f4f7 timestamp=2026-06-07T10:44:55.952Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { getMinimalFixSet } from "./repair-proposal";
import type { RepairProposal } from "./repair-proposal";

export function main() {
  const sessions = getAllSessions();
  const fixes = getMinimalFixSet(sessions);
  return fixes;
}
main();
