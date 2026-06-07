import { replaySession } from "./deterministic-replay";
// @progmune-generated session=sess_1780751329203_eo5yp timestamp=2026-06-06T13:08:57.717Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllSessions } from "./failure-corpus";
import { replayWithDetail } from "./deterministic-replay";
import type { StateTransition } from "./runtime-types";

export function main() {
  const sessions = getAllSessions();
  const replayResult = replaySession(sessions, sessions, sessions);
  const detail = replayWithDetail(replayResult, replayResult, replayResult);
  return detail;
}
main();
