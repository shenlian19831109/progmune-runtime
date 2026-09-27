"use strict";
/**
 * CI/CD output formatter — compact one-line summary for pipeline logs.
 *
 * Format: [PROGMUNE] <DECISION> score=<N> violations=<N> coverage=<N%> <LEVEL>
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTrustCI = formatTrustCI;
exports.ciExitCode = ciExitCode;
function formatTrustCI(decision) {
    const { overall, summary, dimensions } = decision;
    const mc = overall.mappingCoverage;
    const parts = [
        "[PROGMUNE]",
        overall.decision,
        `score=${overall.score}`,
        `violations=${summary.total}`,
    ];
    if (mc) {
        parts.push(`coverage=${mc.rate}%`);
    }
    parts.push(`conf=${overall.confidence}`);
    return parts.join(" ");
}
/**
 * Returns the recommended CI exit code:
 *   0 = APPROVED
 *   2 = NEEDS_REVIEW
 *   1 = BLOCKED
 */
function ciExitCode(decision) {
    switch (decision.overall.decision) {
        case "APPROVED":
            return 0;
        case "NEEDS_REVIEW":
            return 2;
        case "BLOCKED":
            return 1;
        default:
            return 3;
    }
}
