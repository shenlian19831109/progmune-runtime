import { formatSnapshotDiff } from "./semantic-trace";
// @progmune-generated session=sess_1780732064844_my3mz timestamp=2026-06-06T07:47:48.280Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { createSnapshot } from "./semantic-snapshot";

export function main(intent: string, sessionId: string) {
  const sessions = getAllSessions();
  const snap1 = createSnapshot(sessions, intent, sessionId);
  const snap2 = createSnapshot(sessions, intent, sessionId);
  const diff = formatSnapshotDiff(snap1, snap2);
  return diff;
}
