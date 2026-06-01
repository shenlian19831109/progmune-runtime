// @progmune-generated session=sess_1780302863285_gklo3 timestamp=2026-06-01T08:34:25.035Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 427 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { findRootBranch, describeBranchTree } from "./branch-ledger";
import type { Branch, Map } from "./branch-ledger";

export function main() {
  const sessions = getAllSessions();
  const root = findRootBranch(sessions);
  const desc = describeBranchTree(root, {} as Map<string, Branch>, "default");
  return desc;
}
main();
