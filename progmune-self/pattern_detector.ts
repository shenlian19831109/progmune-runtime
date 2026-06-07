// @progmune-generated session=sess_1780828969870_24yak timestamp=2026-06-07T10:42:53.576Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getTopFailurePatterns, getAllSessions, getLearnedPatterns } from "./failure-corpus";

export function main(limit: number) {
  const patterns = getTopFailurePatterns(limit);
  const sessions = getAllSessions();
  const learned = getLearnedPatterns();
  return learned;
}
