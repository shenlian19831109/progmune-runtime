// @progmune-generated session=sess_1780303076541_l2oug timestamp=2026-06-01T08:37:57.804Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 430 functions, 17 protocol rules
import { getExecutionMetrics } from "./execute";
import { getAllSessions } from "./failure-corpus";

export function main() {
  const metrics = getExecutionMetrics();
  const sessions = getAllSessions();
  return sessions;
}
main();
