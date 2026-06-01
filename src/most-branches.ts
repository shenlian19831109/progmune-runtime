// @progmune-generated session=sess_1780304404841_paru6 timestamp=2026-06-01T09:00:06.657Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 438 functions, 17 protocol rules
import { getExecutionMetrics } from "./execute";
import { getAllSessions } from "./failure-corpus";
import { findChildBranches } from "./branch-ledger";
import type { Branch, Map } from "./branch-ledger";

export function main() {
  const metrics = getExecutionMetrics();
  const sessions = getAllSessions();
  const branches = findChildBranches(metrics, {} as Map<string, Branch>);
  return branches;
}
main();
