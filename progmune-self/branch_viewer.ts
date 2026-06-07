import { formatSessionTimeline } from "./semantic-trace";
// @progmune-generated session=sess_1780829047896_d8sm7 timestamp=2026-06-07T10:44:10.479Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { describeBranchTree } from "./branch-ledger";

export function main() {
  const sessions = getAllSessions();
  const timeline = formatSessionTimeline(sessions);
  const tree = describeBranchTree(timeline, sessions, timeline);
  return tree;
}
main();
