// @progmune-generated session=sess_1780294937806_g72xd timestamp=2026-06-01T06:22:19.487Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 397 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { formatSessionSummary } from "./semantic-trace";

export function main() {
  const sessions = getAllSessions();
  const summary = formatSessionSummary(sessions);
  return summary;
}
main();
