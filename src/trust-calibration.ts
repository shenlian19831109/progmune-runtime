/**
 * P6: Trust Calibration — Explainable Confidence
 *
 * Every verification decision carries a confidence score.
 * This module decomposes that score into its evidence components.
 *
 * Not: "confidence = 85%"
 * But:  "85% because:
 *          RFC 8446 alignment (+30%)
 *          3 repos validated (+25%)
 *          FP history clean (+20%)
 *          Rule specificity high (+10%)
 *        "
 *
 * Architecture:
 *   Confidence = Σ(evidence_weight × evidence_strength) / Σ(weights)
 *
 * Evidence sources:
 *   1. RFC_ALIGNMENT     — Does this rule trace to a standard?
 *   2. REPO_VALIDATION   — How many repos support this rule?
 *   3. FP_HISTORY        — Is this rule's FP rate low?
 *   4. RULE_SPECIFICITY  — How specific are the pre/post conditions?
 *   5. REPAIR_VERIFIED   — Has the repair been validated?
 *   6. DEPLOYMENT_OBS    — Has this been observed in real deployments?
 *   7. HUMAN_REVIEWED    — Has a human approved this rule?
 */

import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type EvidenceSource =
  | "RFC_ALIGNMENT"
  | "REPO_VALIDATION"
  | "FP_HISTORY"
  | "RULE_SPECIFICITY"
  | "REPAIR_VERIFIED"
  | "DEPLOYMENT_OBS"
  | "HUMAN_REVIEWED";

export interface EvidenceComponent {
  source: EvidenceSource;
  label: string;
  weight: number;       // 0–1: how important is this evidence?
  strength: number;     // 0–1: how strong is this evidence for this rule?
  contribution: number; // weight × strength
  detail: string;       // human-readable explanation
  references: string[]; // RFC numbers, repo names, etc.
}

export interface ConfidenceTree {
  ruleName: string;
  protocol: string;
  totalConfidence: number;
  components: EvidenceComponent[];
  summary: string;
  /** The "why" — a human-readable chain of evidence. */
  explanation: string[];
  /** What would increase confidence? */
  improvementSuggestions: string[];
}

// ═══════════════════════════════════════════════════════════════
// Trust Calibrator
// ═══════════════════════════════════════════════════════════════

export class TrustCalibrator {
  /**
   * Decompose a confidence score into its evidence components.
   *
   * This is the "explain why" behind every verification decision.
   */
  explainConfidence(params: {
    ruleName: string;
    protocol: string;
    rfcRefs?: string[];
    validatedRepos?: string[];
    fpCount?: number;
    tpCount?: number;
    rulePreStates?: string[];
    rulePostStates?: string[];
    repairVerified?: boolean;
    deploymentObservations?: number;
    humanReviewed?: boolean;
  }): ConfidenceTree {
    const components: EvidenceComponent[] = [];

    // 1. RFC Alignment (weight: 0.25)
    const rfcRefs = params.rfcRefs || [];
    const rfcStrength = rfcRefs.length > 0
      ? Math.min(1.0, rfcRefs.length * 0.5)
      : 0;
    components.push({
      source: "RFC_ALIGNMENT",
      label: "RFC Alignment",
      weight: 0.25,
      strength: rfcStrength,
      contribution: 0.25 * rfcStrength,
      detail: rfcRefs.length > 0
        ? `Traces to ${rfcRefs.map(r => `RFC ${r}`).join(", ")}`
        : "No RFC reference — rule is empirically derived",
      references: rfcRefs,
    });

    // 2. Repo Validation (weight: 0.20)
    const repos = params.validatedRepos || [];
    const repoStrength = Math.min(1.0, repos.length / 5); // 5 repos = full strength
    components.push({
      source: "REPO_VALIDATION",
      label: "Repository Validation",
      weight: 0.20,
      strength: repoStrength,
      contribution: 0.20 * repoStrength,
      detail: repos.length > 0
        ? `Validated across ${repos.length} repos: ${repos.join(", ")}`
        : "Not yet validated across repositories",
      references: repos,
    });

    // 3. FP History (weight: 0.20)
    const fpCount = params.fpCount || 0;
    const tpCount = params.tpCount || 0;
    const total = fpCount + tpCount;
    const fpRate = total > 0 ? fpCount / total : 0;
    const fpStrength = total === 0 ? 0.5 // No data = neutral
      : fpRate === 0 ? 1.0 // Perfect
      : fpRate < 0.1 ? 0.8
      : fpRate < 0.3 ? 0.5
      : fpRate < 0.5 ? 0.3
      : 0.1;

    components.push({
      source: "FP_HISTORY",
      label: "False Positive History",
      weight: 0.20,
      strength: fpStrength,
      contribution: 0.20 * fpStrength,
      detail: total === 0
        ? "No alert history yet — confidence is neutral"
        : fpRate === 0
          ? `Perfect: ${tpCount} TP, 0 FP`
          : `${fpCount} FP / ${total} total alerts (${(fpRate * 100).toFixed(0)}% FP rate)`,
      references: [],
    });

    // 4. Rule Specificity (weight: 0.15)
    const preCount = (params.rulePreStates || []).length;
    const postCount = (params.rulePostStates || []).length;
    const specificityStrength = preCount + postCount >= 4 ? 1.0
      : preCount + postCount >= 2 ? 0.7
      : 0.3;
    components.push({
      source: "RULE_SPECIFICITY",
      label: "Rule Specificity",
      weight: 0.15,
      strength: specificityStrength,
      contribution: 0.15 * specificityStrength,
      detail: `${preCount} pre-states + ${postCount} post-states — ${specificityStrength >= 0.7 ? "well-specified" : "broad match"}`,
      references: [],
    });

    // 5. Repair Verified (weight: 0.10)
    const repairStrength = params.repairVerified ? 1.0 : 0;
    components.push({
      source: "REPAIR_VERIFIED",
      label: "Repair Verified",
      weight: 0.10,
      strength: repairStrength,
      contribution: 0.10 * repairStrength,
      detail: params.repairVerified
        ? "Automatic repair has been tested and verified"
        : "Repair not yet validated for this rule",
      references: [],
    });

    // 6. Deployment Observations (weight: 0.05)
    const deployObs = params.deploymentObservations || 0;
    const deployStrength = Math.min(1.0, deployObs / 100);
    components.push({
      source: "DEPLOYMENT_OBS",
      label: "Deployment Observations",
      weight: 0.05,
      strength: deployStrength,
      contribution: 0.05 * deployStrength,
      detail: deployObs > 0
        ? `Observed in ${deployObs} production deployments`
        : "No production deployment data yet",
      references: [],
    });

    // 7. Human Reviewed (weight: 0.05)
    const humanStrength = params.humanReviewed ? 1.0 : 0;
    components.push({
      source: "HUMAN_REVIEWED",
      label: "Human Reviewed",
      weight: 0.05,
      strength: humanStrength,
      contribution: 0.05 * humanStrength,
      detail: params.humanReviewed
        ? "Reviewed and approved by a human expert"
        : "Not yet human-reviewed",
      references: [],
    });

    // Calculate total confidence
    const totalWeight = components.reduce((s, c) => s + c.weight, 0);
    const totalConfidence = components.reduce((s, c) => s + c.contribution, 0) / totalWeight;

    // Build explanation chain
    const explanation = components
      .filter(c => c.strength > 0)
      .sort((a, b) => b.contribution - a.contribution)
      .map(c => `  ${c.label}: ${c.detail}`);

    // Improvement suggestions
    const suggestions: string[] = [];
    if (rfcStrength === 0) suggestions.push("Link rule to an RFC standard");
    if (repoStrength < 0.6) suggestions.push(`Validate on ${Math.max(0, 5 - repos.length)} more repos`);
    if (fpRate >= 0.3) suggestions.push("Investigate and reduce false positive rate");
    if (specificityStrength < 0.7) suggestions.push("Add more specific pre/post states to narrow the rule");
    if (!params.repairVerified) suggestions.push("Validate automatic repair for this rule");
    if (deployObs < 10) suggestions.push("Collect production deployment observations");
    if (!params.humanReviewed) suggestions.push("Submit for human expert review");

    return {
      ruleName: params.ruleName,
      protocol: params.protocol,
      totalConfidence,
      components,
      summary: `Confidence ${(totalConfidence * 100).toFixed(0)}% — ${explanation.length} evidence sources`,
      explanation,
      improvementSuggestions: suggestions,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════

let _calibrator: TrustCalibrator | null = null;

export function getTrustCalibrator(): TrustCalibrator {
  if (!_calibrator) _calibrator = new TrustCalibrator();
  return _calibrator;
}

// ═══════════════════════════════════════════════════════════════
// Report Formatter
// ═══════════════════════════════════════════════════════════════

export function formatConfidenceTree(tree: ConfidenceTree): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║     Trust Calibration — Explainable Confidence                ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Rule: ${tree.protocol}:${tree.ruleName}`.padEnd(63) + "║");
  lines.push(`║  Confidence: ${(tree.totalConfidence * 100).toFixed(0)}%`.padEnd(63) + "║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Evidence breakdown
  lines.push("── Evidence Breakdown ──");
  lines.push("┌─────────────────────────┬────────┬──────────┬──────────────────────────────────┐");
  lines.push("│ Evidence Source         │ Weight │ Strength │ Detail                           │");
  lines.push("├─────────────────────────┼────────┼──────────┼──────────────────────────────────┤");

  const sorted = [...tree.components].sort((a, b) => b.contribution - a.contribution);
  for (const c of sorted) {
    const bar = "█".repeat(Math.round(c.strength * 10)) + "░".repeat(10 - Math.round(c.strength * 10));
    const detail = c.detail.slice(0, 32);
    lines.push(`│ ${c.label.padEnd(23)} │  ${(c.weight * 100).toFixed(0).padStart(2)}%  │ ${bar} │ ${detail.padEnd(32)} │`);
  }

  lines.push("└─────────────────────────┴────────┴──────────┴──────────────────────────────────┘");
  lines.push("");

  // Explanation chain
  lines.push("── Why This Confidence? ──");
  if (tree.explanation.length === 0) {
    lines.push("  No evidence available yet.");
  } else {
    for (const e of tree.explanation) {
      lines.push(e);
    }
  }
  lines.push("");

  // Improvement suggestions
  if (tree.improvementSuggestions.length > 0) {
    lines.push("── To Increase Confidence ──");
    for (const s of tree.improvementSuggestions) {
      lines.push(`  • ${s}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CLI Demo
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const calibrator = new TrustCalibrator();

  // Demo: TLS Handshake rule
  const tls = calibrator.explainConfidence({
    ruleName: "tls_handshake",
    protocol: "TLS",
    rfcRefs: ["8446"],
    validatedRepos: ["curl", "nginx", "openssl"],
    fpCount: 2,
    tpCount: 18,
    rulePreStates: ["TLS_INIT", "CIPHER_NEGOTIATED"],
    rulePostStates: ["HANDSHAKE_COMPLETE", "SESSION_ESTABLISHED"],
    repairVerified: true,
    deploymentObservations: 45,
    humanReviewed: true,
  });

  console.log(formatConfidenceTree(tls));

  // Demo: Low-confidence rule
  const low = calibrator.explainConfidence({
    ruleName: "unknown_pattern",
    protocol: "CustomProtocol",
    rfcRefs: [],
    validatedRepos: ["test-only"],
    fpCount: 15,
    tpCount: 3,
    rulePreStates: [],
    rulePostStates: ["SOME_STATE"],
    repairVerified: false,
    deploymentObservations: 0,
    humanReviewed: false,
  });

  console.log(formatConfidenceTree(low));
}
