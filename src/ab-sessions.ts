// @progmune-generated session=sess_1780304728089_wjcf8 timestamp=2026-06-01T09:05:29.923Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 453 functions, 17 protocol rules
import { getAllSessions, getAntibodyStats } from "./failure-corpus";

export function main() {
  const sessions = getAllSessions();
  const stats = getAntibodyStats();
  return stats;
}
main();
