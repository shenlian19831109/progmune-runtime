/**
 * Phase 11: Policy Engine Types
 *
 * Declarative rules that gate AI-generated code from deployment.
 * Transforms governance from "report" to "enforce".
 */

export type RuleSeverity = "block" | "warn";

export type RuleType =
  | "confidence"       // Certificate confidence must meet minimum
  | "provenance"       // Provenance chain must be intact
  | "plsb_coverage"    // PLSB categories covered must meet threshold
  | "human_review"     // At least N human reviewers in accountability chain
  | "fingerprint"      // Fingerprint must exist and be verified
  | "violations";      // No SSG ledger violations allowed

export interface PolicyRule {
  type: RuleType;
  severity: RuleSeverity;
  description: string;
  /** For threshold-based rules: the minimum acceptable value */
  threshold?: number;
  /** For requirement-based rules */
  require?: number;
}

export interface RuleViolation {
  rule: PolicyRule;
  actual: string;        // What was observed
  expected: string;      // What was required
  detail?: string;
}

export interface PolicyResult {
  passed: boolean;
  verdict: "ALLOW" | "WARN" | "BLOCK";
  rules: number;
  passed_rules: number;
  failed_rules: number;
  violations: RuleViolation[];
  summary: string;
}

/** Project-level policy configuration file format */
export interface PolicyConfig {
  name?: string;
  description?: string;
  rules: PolicyRule[];
  /** Inherit default rules (true) or replace entirely (false) */
  inherit?: boolean;
}

/** Default policy — can be overridden by .progmune-policy.json */
export const DEFAULT_POLICY: PolicyRule[] = [
  {
    type: "confidence",
    severity: "block",
    description: "Certificate confidence must be medium or higher",
    threshold: 1, // 0=low, 1=medium, 2=high
  },
  {
    type: "provenance",
    severity: "block",
    description: "Provenance chain must be intact",
  },
  {
    type: "plsb_coverage",
    severity: "warn",
    description: "PLSB must cover at least 5/13 categories",
    threshold: 5,
  },
  {
    type: "human_review",
    severity: "block",
    description: "At least 1 human must be in the accountability chain",
    require: 1,
  },
  {
    type: "fingerprint",
    severity: "warn",
    description: "Fingerprint must exist and be verified",
  },
  {
    type: "violations",
    severity: "block",
    description: "No SSG ledger violations allowed",
    threshold: 0,
  },
];
