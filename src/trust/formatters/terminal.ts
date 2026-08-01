/**
 * Phase 1: Trust Report — Terminal Formatter
 *
 * Produces a human-readable Trust Report following the
 * AI Trust Decision Model v1 template (design doc §7).
 */

import type { TrustDecision } from "../types";

// ANSI escape codes (matching src/audit/formatters/terminal.ts style)
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

const BOX_H = "─";
const BOX_V = "│";
const BOX_TL = "╔";
const BOX_TR = "╗";
const BOX_BL = "╚";
const BOX_BR = "╝";
const BOX_ML = "╠";
const BOX_MR = "╣";

function colorScore(score: number): string {
  if (score >= 80) return `${GREEN}${score}${RESET}`;
  if (score >= 60) return `${YELLOW}${score}${RESET}`;
  return `${RED}${score}${RESET}`;
}

function decisionEmoji(decision: string): string {
  switch (decision) {
    case "APPROVED": return `${GREEN}✅ APPROVED${RESET}`;
    case "NEEDS_REVIEW": return `${YELLOW}⚠️  NEEDS_REVIEW${RESET}`;
    case "BLOCKED": return `${RED}❌ BLOCKED${RESET}`;
    default: return decision;
  }
}

function confidenceLabel(confidence: string): string {
  switch (confidence) {
    case "HIGH": return `${GREEN}HIGH${RESET}`;
    case "MEDIUM": return `${YELLOW}MEDIUM${RESET}`;
    case "LOW": return `${RED}LOW${RESET}`;
    case "UNCERTAIN": return `${RED}UNCERTAIN${RESET}`;
    default: return confidence;
  }
}

export function formatTrustTerminal(decision: TrustDecision): string {
  const { overall, dimensions, violations, violationTraces, summary, auditTrail } = decision;
  const w = 68; // wider box for coverage data

  const lines: string[] = [];

  // Header
  lines.push(`${BOLD}${BOX_TL}${BOX_H.repeat(w - 2)}${BOX_TR}${RESET}`);
  lines.push(`${BOLD}${BOX_V}${RESET}  ${BOLD}Progmune Trust Report${RESET}${" ".repeat(w - 27)}${BOX_V}`);
  lines.push(`${BOLD}${BOX_ML}${BOX_H.repeat(w - 2)}${BOX_MR}${RESET}`);

  // Overall
  const scoreStr = colorScore(overall.score);
  const scoreLabel = overall.score >= 80 ? "HEALTHY" : overall.score >= 60 ? "CAUTION" : "AT RISK";
  const scoreColor = overall.score >= 80 ? GREEN : overall.score >= 60 ? YELLOW : RED;
  lines.push(`${BOX_V}  ${BOLD}Overall Trust Score  ${scoreStr} / 100           ${scoreColor}${scoreLabel}${RESET}  ${BOX_V}`);
  lines.push(`${BOX_V}  ${BOLD}Decision             ${decisionEmoji(overall.decision)}${" ".repeat(Math.max(0, 14 - overall.decision.length))}         ${BOX_V}`);
  lines.push(`${BOX_V}  ${BOLD}Confidence           ${confidenceLabel(overall.confidence)}${" ".repeat(24)}${BOX_V}`);

  // Phase 1: Coverage-based confidence (quantified)
  if (overall.coverageConfidence) {
    const cc = overall.coverageConfidence;
    const ccColor = cc.level === "HIGH" ? GREEN : cc.level === "MEDIUM" ? YELLOW : RED;
    lines.push(`${BOX_V}${" ".repeat(w - 2)}${BOX_V}`);
    lines.push(`${BOX_V}  ${BOLD}Coverage Confidence${RESET}  ${ccColor}${cc.score}%${RESET} ${DIM}±${cc.margin}%${RESET}   ${ccColor}${cc.level}${RESET}${" ".repeat(Math.max(0, w - 48))}${BOX_V}`);
    lines.push(`${BOX_V}  ${DIM}${cc.summary.slice(0, w - 5)}${RESET}`);
  }

  lines.push(`${BOX_V}${" ".repeat(w - 2)}${BOX_V}`);

  // Key Findings
  lines.push(`${BOX_ML}${BOX_H.repeat(w - 2)}${BOX_MR}`);
  lines.push(`${BOX_V}  ${BOLD}Key Findings${RESET}${" ".repeat(w - 17)}${BOX_V}`);
  lines.push(`${BOX_V}${" ".repeat(w - 2)}${BOX_V}`);

  if (summary.critical > 0) {
    lines.push(`${BOX_V}  ${RED}❌  ${summary.critical} Critical policy violation(s)${RESET}${" ".repeat(Math.max(0, w - 38))}${BOX_V}`);
  } else {
    lines.push(`${BOX_V}  ${GREEN}✅  0 Critical policy violations${RESET}${" ".repeat(w - 36)}${BOX_V}`);
  }

  if (dimensions.protocolSafety.score >= 90) {
    lines.push(`${BOX_V}  ${GREEN}✅  Protocol safety verified${RESET}${" ".repeat(w - 31)}${BOX_V}`);
  } else if (dimensions.protocolSafety.score >= 70) {
    lines.push(`${BOX_V}  ${YELLOW}⚠️   Protocol safety — issues detected${RESET}${" ".repeat(w - 41)}${BOX_V}`);
  } else {
    lines.push(`${BOX_V}  ${RED}❌  Protocol safety degraded${RESET}${" ".repeat(w - 30)}${BOX_V}`);
  }

  if (dimensions.governanceIntegrity.score >= 95) {
    lines.push(`${BOX_V}  ${GREEN}✅  Governance chain complete${RESET}${" ".repeat(w - 31)}${BOX_V}`);
  } else {
    lines.push(`${BOX_V}  ${RED}❌  Governance integrity issues${RESET}${" ".repeat(w - 34)}${BOX_V}`);
  }

  if (summary.high > 0 || summary.medium > 0) {
    lines.push(`${BOX_V}  ${YELLOW}⚠️   ${summary.high} High, ${summary.medium} Medium severity issue(s) require attention${RESET}${" ".repeat(Math.max(0, w - 62))}${BOX_V}`);
  }

  lines.push(`${BOX_V}${" ".repeat(w - 2)}${BOX_V}`);

  // Evidence section
  if (violations.length > 0) {
    lines.push(`${BOX_ML}${BOX_H.repeat(w - 2)}${BOX_MR}`);
    lines.push(`${BOX_V}  ${BOLD}Evidence${RESET}${" ".repeat(w - 13)}${BOX_V}`);
    lines.push(`${BOX_V}${" ".repeat(w - 2)}${BOX_V}`);

    for (let vi = 0; vi < Math.min(violations.length, 10); vi++) {
      const v = violations[vi];
      const trace = violationTraces?.[vi];

      const sevIcon = v.severity === "critical" ? "❌" : v.severity === "high" ? "⚠️ " : v.severity === "medium" ? "●" : "○";
      const sevColor = v.severity === "critical" ? RED : v.severity === "high" ? YELLOW : CYAN;
      lines.push(`${BOX_V}  ${sevColor}${sevIcon} ${v.rule_id.padEnd(12).slice(0, 12)}${RESET} ${BOLD}${v.severity.toUpperCase()}${RESET}`);
      lines.push(`${BOX_V}  ${DIM}${v.message.slice(0, w - 5)}${RESET}`);
      lines.push(`${BOX_V}  ${DIM}Evidence: ${v.evidence.slice(0, w - 14)}${RESET}`);

      // Phase 3: Violation trace (reasoning chain)
      if (trace && trace.steps.length > 0) {
        const violStep = trace.steps.find((s: any) => s.label && s.action);
        if (violStep) {
          lines.push(`${BOX_V}  ${DIM}Trace:   ${violStep.action} → ${violStep.preState} → ${violStep.explanation.slice(0, 30)}${RESET}`);
        }
        if (trace.fixPath.length > 0) {
          lines.push(`${BOX_V}  ${DIM}Fix:     ${trace.fixPath.join(" → ").slice(0, w - 13)}${RESET}`);
        }
        if (trace.estimatedReadingTimeMinutes) {
          lines.push(`${BOX_V}  ${DIM}Reading: ~${trace.estimatedReadingTimeMinutes}min${RESET}`);
        }
      } else {
        lines.push(`${BOX_V}  ${DIM}Fix:     ${v.fix.slice(0, w - 13)}${RESET}`);
      }
      lines.push(`${BOX_V}  ${DIM}Policy:  ${v.policy_ref}${RESET}`);
      lines.push(`${BOX_V}${" ".repeat(w - 2)}${BOX_V}`);
    }

    if (violations.length > 10) {
      lines.push(`${BOX_V}  ${DIM}... and ${violations.length - 10} more violation(s)${RESET}${" ".repeat(Math.max(0, w - 32))}${BOX_V}`);
      lines.push(`${BOX_V}${" ".repeat(w - 2)}${BOX_V}`);
    }
  }

  // Audit Trail
  lines.push(`${BOX_ML}${BOX_H.repeat(w - 2)}${BOX_MR}`);
  lines.push(`${BOX_V}  ${BOLD}Audit Trail${RESET}${" ".repeat(w - 16)}${BOX_V}`);
  lines.push(`${BOX_V}${" ".repeat(w - 2)}${BOX_V}`);
  lines.push(`${BOX_V}  Commit          ${auditTrail.commit.slice(0, 24).padEnd(24)} ${BOX_V}`);
  lines.push(`${BOX_V}  Policy Version   ${auditTrail.policyVersion.padEnd(24)} ${BOX_V}`);
  lines.push(`${BOX_V}  Engine Version   ${auditTrail.engineVersion.padEnd(24)} ${BOX_V}`);
  lines.push(`${BOX_V}  Generated At     ${auditTrail.generatedAt.slice(0, 19).padEnd(24)} ${BOX_V}`);
  lines.push(`${BOX_V}  Reproducible     ${auditTrail.reproducible ? "Yes" : "No"}                        ${BOX_V}`);
  lines.push(`${BOLD}${BOX_BL}${BOX_H.repeat(w - 2)}${BOX_BR}${RESET}`);

  return lines.join("\n") + "\n";
}
