// @progmune-generated session=sess_1780294440939_s2rg6 timestamp=2026-06-01T06:14:02.427Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 383 functions, 17 protocol rules
import { getAllSessions } from "./failure-corpus";
import { formatSessionSummary } from "./semantic-trace";

export function main() {
  const sessions = getAllSessions();
  const summary = formatSessionSummary(sessions);
  return summary;
}
main();
