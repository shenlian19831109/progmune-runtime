"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeHealthScore = computeHealthScore;
exports.formatHealthLevel = formatHealthLevel;
exports.countSessionLedgers = countSessionLedgers;
/** Compute overall immune health score from failure and antibody data.
 * @requires FAILURE_GENOME @produces HEALTH_SCORE
 * @tags health, score, immune
 */
function computeHealthScore(failureGenome, antibodyStats) {
    const totalFailures = failureGenome?.totalFailures || 0;
    const totalHits = antibodyStats?.totalHits || 0;
    const base = 100;
    const failurePenalty = Math.min(totalFailures * 2, 40);
    const antibodyBonus = Math.min(totalHits * 3, 20);
    return Math.max(0, Math.min(100, base - failurePenalty + antibodyBonus));
}
/** Format a health score as a status level.
 * @requires HEALTH_SCORE @produces HEALTH_STATUS
 * @tags health, format
 */
function formatHealthLevel(score) {
    if (score >= 90)
        return "Excellent";
    if (score >= 70)
        return "Good";
    if (score >= 50)
        return "Fair";
    return "Poor";
}
/** Validate a ledger and return pass/fail counts.
 * @requires SESSION_LIST @produces VALIDATION_COUNTS
 * @tags ledger, validation, audit
 */
function countSessionLedgers(sessions) {
    const withLedger = sessions.filter((s) => {
        return s.attempts?.some((a) => a.transitions?.length > 0);
    }).length;
    return { total: sessions.length, withLedger };
}
