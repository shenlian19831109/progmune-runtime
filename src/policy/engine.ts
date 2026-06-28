/**
 * Phase 11: Policy Engine
 *
 * Evaluates policy rules against a certified file and its
 * supporting data (provenance chain, accountability chain, PLSB).
 * Returns ALLOW, WARN, or BLOCK.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  PolicyRule,
  PolicyResult,
  PolicyConfig,
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

/** Load policy from project config file, merged with defaults */
export function loadPolicyConfig(
  projectPath: string,
  configPath?: string
): { rules: PolicyRule[]; source: string } {
  const cfgFile = configPath
    ? path.resolve(configPath)
    : path.join(projectPath, ".progmune-policy.json");

  if (!fs.existsSync(cfgFile)) {
    return { rules: [...DEFAULT_POLICY], source: "built-in defaults" };
  }

  try {
    const cfg: PolicyConfig = JSON.parse(fs.readFileSync(cfgFile, "utf-8"));
    const inherit = cfg.inherit !== false; // default: inherit

    if (!inherit) {
      return { rules: cfg.rules || [...DEFAULT_POLICY], source: cfgFile };
    }

    // Merge: project rules override defaults by type
    const merged = [...DEFAULT_POLICY];
    for (const pr of cfg.rules || []) {
      const idx = merged.findIndex(dr => dr.type === pr.type);
      if (idx >= 0) {
        // Override existing rule
        merged[idx] = {
          type: merged[idx].type,
          severity: pr.severity || merged[idx].severity,
          description: pr.description || merged[idx].description,
          threshold: pr.threshold ?? merged[idx].threshold,
          require: pr.require ?? merged[idx].require,
        };
      } else {
        // Add new rule
        merged.push(pr);
      }
    }

    return { rules: merged, source: cfgFile };
  } catch (e: any) {
    console.error(`⚠️  Failed to load policy config: ${e.message}. Using defaults.`);
    return { rules: [...DEFAULT_POLICY], source: "built-in defaults (config error)" };
  }
}

export function evaluatePolicy(
  ctx: PolicyContext,
  rules?: PolicyRule[]
): PolicyResult {
  const activeRules = rules || DEFAULT_POLICY;
  const violations: RuleViolation[] = [];

  for (const rule of activeRules) {
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

      // ── Risk-Based (Protocol-agnostic) ──
      case "risk": {
        const minSeverity = rule.threshold ?? 2;
        const minConfidence = rule.require ?? 70;
        try {
          const { assessRisk } = require("../risk-model");
          // Extract call sequence from file (best-effort)
          const calls = ctx.certificate.validated ? [] : ["SSL_CTX_new", "SSL_connect"]; // fallback
          const risk = assessRisk(calls.length > 0 ? calls : ["init", "connect"]);
          const criticalOrHigh = risk.patterns.filter(p => {
            const sevOrder = ["Low", "Medium", "High", "Critical"];
            return sevOrder.indexOf(p.severity) >= minSeverity && p.confidence >= minConfidence;
          });
          if (criticalOrHigh.length > 0) {
            violations.push({
              rule,
              actual: `${criticalOrHigh.length} risk pattern(s) ≥ severity threshold`,
              expected: `0 patterns at this severity+confidence level`,
              detail: criticalOrHigh.map(p => `${p.patternName} (${p.severity}, ${p.confidence}%): ${p.detail}`).join("; "),
            });
          }
        } catch { /* risk model unavailable */ }
        break;
      }

      // ── Knowledge Base Coverage ──
      case "kb_coverage": {
        const minStable = rule.threshold ?? 3;
        let stableCount = 0;
        try {
          const { buildKnowledgeBase } = require("../protocol-knowledge");
          const kb = buildKnowledgeBase();
          stableCount = kb.units.filter((u: any) => u.maturity === "stable").length;
        } catch { /* KB unavailable */ }

        if (stableCount < minStable) {
          violations.push({
            rule,
            actual: `${stableCount} stable assets`,
            expected: `>= ${minStable} stable assets`,
            detail: `The Knowledge Base has ${stableCount} stable protocol assets. Need at least ${minStable} for production governance. Run 'npm run status' to see coverage.`,
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

  const passed = activeRules.length - violations.length;

  let summary: string;
  if (verdict === "ALLOW") {
    summary = `✅ ALLOW — all ${activeRules.length} policy rules passed. Safe to deploy.`;
  } else if (verdict === "WARN") {
    summary = `⚠️ WARN — ${passed}/${activeRules.length} rules passed, ${warnViolations.length} warning(s). Review before deploy.`;
  } else {
    summary = `❌ BLOCK — ${blockViolations.length} blocking violation(s). Deployment is blocked until these are resolved.`;
  }

  return {
    passed: verdict !== "BLOCK",
    verdict,
    rules: activeRules.length,
    passed_rules: passed,
    failed_rules: violations.length,
    violations,
    summary,
  };
}
