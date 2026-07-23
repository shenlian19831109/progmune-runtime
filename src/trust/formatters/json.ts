/**
 * Phase 1: Trust Report — JSON Formatter
 *
 * Machine-readable output for CI/CD pipelines.
 */

import type { TrustDecision } from "../types";

export function formatTrustJSON(decision: TrustDecision, pretty?: boolean): string {
  return JSON.stringify(decision, null, pretty !== false ? 2 : 0);
}
