/**
 * Phase 11: Policy Engine Module
 *
 * Public API for deployment gating and policy enforcement.
 */

export { evaluatePolicy } from "./engine";
export { DEFAULT_POLICY } from "./types";
export type { PolicyContext } from "./engine";
export type { PolicyRule, PolicyResult, RuleViolation, RuleSeverity, RuleType } from "./types";
