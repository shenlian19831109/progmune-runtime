/**
 * CI/CD output formatter — compact one-line summary for pipeline logs.
 *
 * Format: [PROGMUNE] <DECISION> score=<N> violations=<N> coverage=<N%> <LEVEL>
 */

import type { TrustDecision } from "../types";

export function formatTrustCI(decision: TrustDecision): string {
  const { overall, summary, dimensions } = decision;
  const mc = overall.mappingCoverage;

  const parts: string[] = [
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
export function ciExitCode(decision: TrustDecision): number {
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
