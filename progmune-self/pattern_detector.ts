// @progmune-generated session=sess_1780751190522_9iwfj timestamp=2026-06-06T13:06:38.798Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getTopFailurePatterns, getAllSessions, getLearnedPatterns } from "./failure-corpus";

export function main(limit: number) {
  const patterns = getTopFailurePatterns(limit);
  const sessions = getAllSessions();
  const learned = getLearnedPatterns();
  return learned;
}
