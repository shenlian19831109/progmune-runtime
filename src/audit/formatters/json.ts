/**
 * Phase 9: JSON Formatter
 *
 * Machine-readable governance report output.
 */

import type { GovernanceReport } from "../types";

export function formatAsJSON(report: GovernanceReport, compress = false): string {
  return JSON.stringify(report, null, compress ? 0 : 2);
}
