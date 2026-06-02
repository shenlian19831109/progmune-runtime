/** Count resolved vs unresolved sessions in a session list.
 * @requires SESSION_LIST @produces RESOLVED_COUNT
 * @tags session, count, statistics
 */
export function countResolved(sessions: any[]): { resolved: number; unresolved: number; total: number } {
  const resolved = sessions.filter((s: any) => s.resolved).length;
  return { resolved, unresolved: sessions.length - resolved, total: sessions.length };
}

/** Get a summary of session counts as a formatted string.
 * @requires RESOLVED_COUNT @produces FORMATTED_COUNT
 * @tags session, format, report
 */
export function formatSessionCounts(counts: { resolved: number; unresolved: number; total: number }): string {
  return `${counts.resolved}/${counts.total} resolved, ${counts.unresolved} unresolved`;
}
