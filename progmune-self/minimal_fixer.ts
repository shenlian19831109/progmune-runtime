// @progmune-generated session=sess_1780751432384_l67ho timestamp=2026-06-06T13:10:36.512Z
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
