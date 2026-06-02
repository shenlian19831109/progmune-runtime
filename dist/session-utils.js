"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countResolved = countResolved;
exports.formatSessionCounts = formatSessionCounts;
/** Count resolved vs unresolved sessions in a session list.
 * @requires SESSION_LIST @produces RESOLVED_COUNT
 * @tags session, count, statistics
 */
function countResolved(sessions) {
    const resolved = sessions.filter((s) => s.resolved).length;
    return { resolved, unresolved: sessions.length - resolved, total: sessions.length };
}
/** Get a summary of session counts as a formatted string.
 * @requires RESOLVED_COUNT @produces FORMATTED_COUNT
 * @tags session, format, report
 */
function formatSessionCounts(counts) {
    return `${counts.resolved}/${counts.total} resolved, ${counts.unresolved} unresolved`;
}
