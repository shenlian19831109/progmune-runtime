// @progmune-generated session=sess_1780295661722_bghvs timestamp=2026-06-01T06:34:24.035Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 409 functions, 17 protocol rules
import { getAllSessions, getAllFailures } from "./failure-corpus";
import { findRootBranch, findChildBranches } from "./branch-ledger";
import type { Branch, Map } from "./branch-ledger";

export function main() {
  const sessions = getAllSessions();
  const failures = getAllFailures();
  const rootBranch = findRootBranch(failures);
  const repairBranches = findChildBranches(rootBranch, failures);
  return repairBranches;
}
main();
