// @progmune-generated session=sess_1780345171834_s7714 timestamp=2026-06-01T20:19:33.214Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 382 functions, 17 protocol rules
import { findSnapshotBySession } from "./semantic-snapshot";

export function main(sessionId: string) {
  const snapshot = findSnapshotBySession(sessionId);
  return snapshot;
}
