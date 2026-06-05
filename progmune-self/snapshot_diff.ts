import { formatSnapshotDiff } from "./semantic-trace";
// @progmune-generated session=sess_1780689097782_a28x7 timestamp=2026-06-05T19:51:42.005Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { createSnapshot } from "./semantic-snapshot";

export function main() {
  const sessions = getAllSessions();
  const snap1 = createSnapshot(sessions, "compare-snapshots", "session-001");
  const diff = formatSnapshotDiff("snap-001", snap1);
  return diff;
}
main();
