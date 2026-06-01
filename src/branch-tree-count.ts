// @progmune-generated session=sess_1780343627181_k5xw4 timestamp=2026-06-01T19:53:48.655Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 389 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { findRootBranch, findChildBranches } from "./branch-ledger";
import type { Branch, Map } from "./branch-ledger";

export function main() {
  const sessions = getAllSessions();
  const root = findRootBranch(sessions);
  const children = findChildBranches(root, {} as Map<string, Branch>);
  return children;
}
main();
