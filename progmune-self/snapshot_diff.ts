import { formatSnapshotDiff } from "./semantic-trace";
// @progmune-generated session=sess_1780750732328_2smum timestamp=2026-06-06T12:58:55.588Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { createSnapshot } from "./semantic-snapshot";

export function main(intent: string, sessionId: string, snapIdA: string, snapIdB: string) {
  const sessions = getAllSessions();
  const snap1 = createSnapshot(sessions, intent, sessionId);
  const diff = formatSnapshotDiff(snapIdA, snapIdB);
  return diff;
}
