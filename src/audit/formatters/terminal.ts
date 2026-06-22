/**
 * Phase 9: Terminal Formatter
 *
 * Human-readable governance report with ANSI color coding.
 * Pattern follows semantic-trace.ts rendering conventions.
 */

import type { GovernanceReport, GovernanceRecommendation } from "../types";

// ANSI color helpers (same palette as semantic-trace.ts)
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

const BOX_H = "─";
const BOX_V = "│";
const BOX_TL = "┌";
const BOX_TR = "┐";
const BOX_BL = "└";
const BOX_BR = "┘";

function bar(value: number, max: number, width = 20): string {
  const filled = Math.round((value / (max || 1)) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function percent(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function verdictColor(v: string): string {
  if (v === "PASS") return C.green;
  if (v === "WARN") return C.yellow;
  return C.red;
}

function severityColor(s: string): string {
  if (s === "critical") return C.red;
  if (s === "high") return C.yellow;
  if (s === "medium") return C.cyan;
  return C.dim;
}

export function formatAsTerminal(report: GovernanceReport): string {
  const { metadata, sessions, ssv, plsb, provenance, antibodies, verdict, recommendations } = report;
  const lines: string[] = [];

  // ── Header ──
  lines.push("");
  lines.push(`${C.bold}${C.cyan}${BOX_TL}${BOX_H.repeat(58)}${BOX_TR}${C.reset}`);
  lines.push(`${C.bold}${C.cyan}${BOX_V}${C.reset} ${C.bold}AI Code Governance Report${C.reset}${" ".repeat(30)}${C.bold}${C.cyan}${BOX_V}${C.reset}`);
  lines.push(`${C.bold}${C.cyan}${BOX_V}${C.reset} ${C.dim}Progmune Runtime — AI Generated Software Governance${C.reset}${" ".repeat(3)}${C.bold}${C.cyan}${BOX_V}${C.reset}`);
  lines.push(`${C.bold}${C.cyan}${BOX_BL}${BOX_H.repeat(58)}${BOX_BR}${C.reset}`);
  lines.push("");

  // ── Metadata ──
  lines.push(`${C.bold}Metadata${C.reset}`);
  lines.push(`  Generator:   ${metadata.generator} v${metadata.version}`);
  lines.push(`  Timestamp:   ${metadata.timestamp}`);
  lines.push(`  Project:     ${metadata.projectId}`);
  lines.push("");

  // ── Verdict ──
  const vc = verdictColor(verdict);
  lines.push(`${C.bold}Verdict:${C.reset} ${vc}${C.bold}${verdict}${C.reset}`);
  lines.push("");

  // ── Sessions ──
  lines.push(`${C.bold}Sessions${C.reset}`);
  lines.push(`  Total:       ${sessions.total}`);
  lines.push(`  Verified:    ${C.green}${sessions.verified}${C.reset}`);
  lines.push(`  Compromised: ${sessions.compromised > 0 ? C.red : C.green}${sessions.compromised}${C.reset}`);
  if (sessions.total > 0) {
    lines.push(`  Coverage:    ${bar(sessions.verified, sessions.total)} ${percent(sessions.verified / sessions.total)}`);
  }
  lines.push("");

  // ── SSV ──
  lines.push(`${C.bold}Semantic State Verification (SSV)${C.reset}`);
  lines.push(`  Checks: ${ssv.totalChecks} total, ${C.green}${ssv.passed} passed${C.reset}, ${ssv.failed > 0 ? C.red : ""}${ssv.failed} failed${C.reset}`);
  if (ssv.failed > 0) {
    lines.push(`  ${C.red}⚠ Ledger inconsistencies detected${C.reset}`);
  }
  lines.push("");

  // ── PLSB ──
  lines.push(`${C.bold}Protocol Lifecycle Security Benchmark (PLSB)${C.reset}`);
  lines.push(`  Version:     v${plsb.version}`);
  lines.push(`  Entries:     ${plsb.totalEntries} (${plsb.verifiedEntries} verified)`);
  lines.push(`  Coverage:    ${bar(plsb.coverage, 1)} ${percent(plsb.coverage)}`);
  lines.push(`  Recall:      ${percent(plsb.recall)}`);
  lines.push(`  Precision:   ${percent(plsb.precision)}`);
  lines.push(`  Covered:     ${plsb.matchedCategories.length > 0 ? plsb.matchedCategories.join(", ") : C.dim + "(none)" + C.reset}`);
  if (plsb.unmatchedCategories.length > 0) {
    lines.push(`  Uncovered:   ${C.yellow}${plsb.unmatchedCategories.join(", ")}${C.reset}`);
  }
  lines.push("");

  // ── Provenance ──
  lines.push(`${C.bold}Provenance (Ledger Integrity)${C.reset}`);
  lines.push(`  Fingerprints: ${provenance.totalFingerprints} total`);
  lines.push(`  Verified:     ${C.green}${provenance.verified}${C.reset}`);
  lines.push(`  Tampered:     ${provenance.tampered > 0 ? C.red : C.green}${provenance.tampered}${C.reset}`);
  lines.push(`  Not Found:    ${provenance.notFound}`);
  lines.push("");

  // ── Antibodies ──
  lines.push(`${C.bold}Immune System (Antibodies)${C.reset}`);
  lines.push(`  Hits:         ${antibodies.totalHits}`);
  lines.push(`  Fast-path:    ${antibodies.fastPathHits}`);
  lines.push(`  LLM saved:    ${antibodies.llmCallsSaved} calls, ${antibodies.tokensSaved.toLocaleString()} tokens`);
  if (antibodies.topSignatures.length > 0) {
    lines.push(`  Top patterns: ${antibodies.topSignatures.slice(0, 3).join(", ")}`);
  }
  lines.push("");

  // ── Session Details ──
  if (sessions.details.length > 0 && sessions.details.length <= 10) {
    lines.push(`${C.bold}Session Details${C.reset}`);
    for (const d of sessions.details) {
      const status = d.fingerprintTampered ? `${C.red}⚠ TAMPERED${C.reset}`
        : d.consistencyPassed ? `${C.green}✓${C.reset}`
        : `${C.yellow}⚠ VIOLATIONS${C.reset}`;
      lines.push(`  ${status} ${d.sessionId.slice(0, 24)}... | ${d.validTransitions}/${d.transitionCount} valid | intent: ${d.intent.slice(0, 40)}`);
    }
    lines.push("");
  }

  // ── Recommendations ──
  if (recommendations.length > 0) {
    lines.push(`${C.bold}Recommendations${C.reset}`);
    for (const r of recommendations) {
      const sc = severityColor(r.severity);
      lines.push(`  ${sc}[${r.severity.toUpperCase()}]${C.reset} ${r.message}`);
      lines.push(`  ${C.dim}→ ${r.action}${C.reset}`);
    }
    lines.push("");
  }

  // ── Footer ──
  lines.push(`${C.dim}${BOX_H.repeat(60)}${C.reset}`);
  lines.push(`${C.dim}Report generated by Progmune Runtime — AI Generated Software Governance${C.reset}`);
  lines.push("");

  return lines.join("\n");
}
