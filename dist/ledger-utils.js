"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countTotalTransitions = countTotalTransitions;
exports.formatTransitionCount = formatTransitionCount;
exports.hasViolations = hasViolations;
exports.countSessionsWithViolations = countSessionsWithViolations;
/** Count total transitions across all session ledgers.
 * @requires SESSION_LIST @produces TRANSITION_COUNT
 * @tags ledger, count, statistics
 */
function countTotalTransitions(sessions) {
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
function formatTransitionCount(count) {
    return `${count} total transitions across all sessions`;
}
/** Check if a session has any protocol violations in its attempts.
 * @requires SESSION_DATA @produces VIOLATION_CHECK
 * @tags ledger, validation
 */
function hasViolations(session) {
    return (session.attempts || []).some((a) => (a.violations || []).length > 0);
}
/** Count sessions that have violations.
 * @requires SESSION_LIST @produces VIOLATION_COUNT
 * @tags ledger, validation, statistics
 */
function countSessionsWithViolations(sessions) {
    return sessions.filter(s => hasViolations(s)).length;
}
