/** Count total transitions across all session ledgers.
 * @requires SESSION_LIST @produces TRANSITION_COUNT
 * @tags ledger, count, statistics
 */
export function countTotalTransitions(sessions: any[]): number {
  let count = 0;
  for (const s of sessions) {
    for (const a of (s.attempts || [])) {
      count += (a.transitions || []).length;
    }
  }
  return count;
}

/** Format a transition count as a summary string.
 * @requires TRANSITION_COUNT @produces FORMATTED_COUNT
 * @tags ledger, format
 */
export function formatTransitionCount(count: number): string {
  return `${count} total transitions across all sessions`;
}

/** Check if a session has any protocol violations in its attempts.
 * @requires SESSION_DATA @produces VIOLATION_CHECK
 * @tags ledger, validation
 */
export function hasViolations(session: any): boolean {
  return (session.attempts || []).some((a: any) =>
    (a.violations || []).length > 0
  );
}

/** Count sessions that have violations.
 * @requires SESSION_LIST @produces VIOLATION_COUNT
 * @tags ledger, validation, statistics
 */
export function countSessionsWithViolations(sessions: any[]): number {
  return sessions.filter(s => hasViolations(s)).length;
}
