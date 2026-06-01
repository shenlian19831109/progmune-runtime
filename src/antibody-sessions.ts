// @progmune-generated session=sess_1780289900984_pzm4g timestamp=2026-06-01T04:58:22.665Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 385 functions, 17 protocol rules
import { getAllSessions, getAntibodyStats } from "./failure-corpus";

export function main() {
  const sessions = getAllSessions();
  const stats = getAntibodyStats();
  return stats;
}
main();
