/**
 * Phase 1: Explainability Binary Gate
 *
 * Checks every TrustViolation for complete 6-tuple evidence.
 * If ANY violation is missing ANY required field → UNCERTAIN.
 *
 * This is a GATE, not a scored dimension. An unexplainable Trust Score
 * is inherently untrustworthy and must be flagged rather than averaged in.
 */

import type {
  TrustViolation,
  ExplainabilityResult,
  ExplainabilityStatus,
} from "./types";
import { TRUST_VIOLATION_REQUIRED_FIELDS } from "./types";

// ── Main Entry Point ──

/**
 * Binary gate: validates ALL violations have complete 6-tuple evidence.
 *
 * The 7 required fields (from the design doc):
 *   severity, rule_id, file, function, evidence, why, fix, policy_ref
 *
 * @returns EXPLAINABLE if all violations are complete, UNCERTAIN otherwise
 */
export function checkExplainability(
  violations: TrustViolation[]
): ExplainabilityResult {
  // Vacuous truth: no violations = explainable
  if (!violations || violations.length === 0) {
    return {
      status: "EXPLAINABLE",
      violationsChecked: 0,
      violationsComplete: 0,
    };
  }

  const missingFields: Array<{ index: number; missing: string[] }> = [];
  let violationsComplete = 0;

  for (let i = 0; i < violations.length; i++) {
    const v = violations[i];
    const missing = getMissingFields(v);

    if (missing.length === 0) {
      violationsComplete++;
    } else {
      missingFields.push({ index: i, missing });
    }
  }

  const status: ExplainabilityStatus =
    missingFields.length === 0 ? "EXPLAINABLE" : "UNCERTAIN";

  return {
    status,
    violationsChecked: violations.length,
    violationsComplete,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
  };
}

// ── Helpers ──

/**
 * Returns the list of required fields that are missing or empty in a violation.
 */
function getMissingFields(v: TrustViolation): string[] {
  const missing: string[] = [];

  for (const field of TRUST_VIOLATION_REQUIRED_FIELDS) {
    const value = v[field];
    if (value === undefined || value === null) {
      missing.push(field);
    } else if (typeof value === "string" && value.trim() === "") {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Type guard: checks if a partial violation object satisfies the full
 * TrustViolation interface (all required fields present and non-empty).
 */
export function assertSixTuple(v: Partial<TrustViolation>): v is TrustViolation {
  if (!v) return false;
  return getMissingFields(v as TrustViolation).length === 0;
}

/**
 * Convenience: quickly check if a single violation is complete.
 */
export function isViolationComplete(v: TrustViolation): boolean {
  return getMissingFields(v).length === 0;
}
