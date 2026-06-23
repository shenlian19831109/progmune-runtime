/**
 * Phase 11: Policy Engine
 *
 * Evaluates policy rules against a certified file and its
 * supporting data (provenance chain, accountability chain, PLSB).
 * Returns ALLOW, WARN, or BLOCK.
 */

import type {
  PolicyRule,
  PolicyResult,
  RuleViolation,
} from "./types";
import { DEFAULT_POLICY } from "./types";

export interface PolicyContext {
  /** From certify() */
  certificate: {
    validated: boolean;
    confidence: "high" | "medium" | "low";
    provenanceIntact: boolean;
    fingerprint: string;
    violations: number;
    plsbCoverage: string;   // "X/Y"
    plsbRecall: number;
    degraded: boolean;
    sessionId: string;
    file: string;
  };
  /** From buildAccountabilityChain() */
  accountability?: {
    humanEvents: number;
    aiEvents: number;
    automatedEvents: number;
    custodyGap: boolean;
  };
}

function confidenceToNumber(c: string): number {
  if (c === "high") return 2;
  if (c === "medium") return 1;
  return 0;
}

function parsePlsbCovered(coverage: string): number {
  const m = coverage.match(/^(\d+)\//);
  return m ? parseInt(m[1], 10) : 0;
}

export function evaluatePolicy(
  ctx: PolicyContext,
  rules: PolicyRule[] = DEFAULT_POLICY
): PolicyResult {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    switch (rule.type) {
      // ── Confidence ──
      case "confidence": {
        const minLevel = rule.threshold ?? 1; // default: medium
        const actual = confidenceToNumber(ctx.certificate.confidence);
        if (actual < minLevel || ctx.certificate.degraded) {
          violations.push({
            rule,
            actual: ctx.certificate.degraded ? "degraded" : ctx.certificate.confidence,
            expected: `confidence >= ${minLevel === 2 ? "high" : "medium"}`,
            detail: ctx.certificate.degraded
              ? "This file was generated via a fallback/degraded path — reliability is reduced."
              : `Confidence is ${ctx.certificate.confidence}. Recommend re-generating with full validation.`,
          });
        }
        break;
      }

      // ── Provenance ──
      case "provenance": {
        if (!ctx.certificate.provenanceIntact) {
          violations.push({
            rule,
            actual: "broken",
            expected: "intact",
            detail: `Provenance chain for session ${ctx.certificate.sessionId} is broken — the ledger fingerprint has changed since generation.`,
          });
        }
        break;
      }

      // ── PLSB Coverage ──
      case "plsb_coverage": {
        const minCovered = rule.threshold ?? 5;
        const covered = parsePlsbCovered(ctx.certificate.plsbCoverage);
        if (covered < minCovered) {
          violations.push({
            rule,
            actual: `${covered} categories covered`,
            expected: `>= ${minCovered} categories`,
            detail: `PLSB covers ${ctx.certificate.plsbCoverage} categories. Add protocol rules for uncovered weakness types.`,
          });
        }
        break;
      }

      // ── Human Review ──
      case "human_review": {
        const minHumans = rule.require ?? 1;
        const humans = ctx.accountability?.humanEvents ?? 0;
        if (humans < minHumans) {
          violations.push({
            rule,
            actual: `${humans} human(s) in chain`,
            expected: `>= ${minHumans} human reviewer(s)`,
            detail: ctx.accountability?.custodyGap
              ? "Custody gaps detected — actor identities could not be verified."
              : "No human reviewer found in the accountability chain. Use --author, --reviewer flags.",
          });
        }
        break;
      }

      // ── Fingerprint ──
      case "fingerprint": {
        if (!ctx.certificate.fingerprint || ctx.certificate.fingerprint.includes("pending")) {
          violations.push({
            rule,
            actual: "no fingerprint",
            expected: "fingerprint registered",
            detail: "Run 'npm run check' to register missing fingerprints.",
          });
        }
        break;
      }

      // ── Violations ──
      case "violations": {
        const maxViolations = rule.threshold ?? 0;
        if (ctx.certificate.violations > maxViolations) {
          violations.push({
            rule,
            actual: `${ctx.certificate.violations} SSG violation(s)`,
            expected: `<= ${maxViolations}`,
            detail: `Ledger consistency check found ${ctx.certificate.violations} violation(s). Run 'progmune_repair' to fix.`,
          });
        }
        break;
      }
    }
  }

  // ── Compute verdict ──
  const blockViolations = violations.filter((v) => v.rule.severity === "block");
  const warnViolations = violations.filter((v) => v.rule.severity === "warn");

  let verdict: PolicyResult["verdict"];
  if (blockViolations.length > 0) {
    verdict = "BLOCK";
  } else if (warnViolations.length > 0) {
    verdict = "WARN";
  } else {
    verdict = "ALLOW";
  }

  const passed = rules.length - violations.length;

  let summary: string;
  if (verdict === "ALLOW") {
    summary = `✅ ALLOW — all ${rules.length} policy rules passed. Safe to deploy.`;
  } else if (verdict === "WARN") {
    summary = `⚠️ WARN — ${passed}/${rules.length} rules passed, ${warnViolations.length} warning(s). Review before deploy.`;
  } else {
    summary = `❌ BLOCK — ${blockViolations.length} blocking violation(s). Deployment is blocked until these are resolved.`;
  }

  return {
    passed: verdict !== "BLOCK",
    verdict,
    rules: rules.length,
    passed_rules: passed,
    failed_rules: violations.length,
    violations,
    summary,
  };
}
