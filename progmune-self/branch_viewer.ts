import { formatSessionTimeline } from "./semantic-trace";
// @progmune-generated session=sess_1780751366888_rlvkk timestamp=2026-06-06T13:09:32.168Z
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
