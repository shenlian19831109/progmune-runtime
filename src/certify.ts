/**
 * Phase 9: AI Code Certificate
 *
 * The minimal closed-loop product: certify that a file was AI-generated
 * and passed protocol security verification.
 *
 * Usage:
 *   progmune certify <file.ts>
 *
 * Output: a human-readable certificate suitable for audit, compliance,
 * and regulatory evidence.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ── Types ──

export interface Certificate {
  file: string;
  generatedBy: string;
  sessionId: string;
  validated: boolean;
  validator: string;
  plsbVersion: string;
  plsbCoverage: string;
  plsbRecall: number;
  fingerprint: string;
  timestamp: string;
  transitions: number;
  validTransitions: number;
  violations: number;
  provenanceIntact: boolean;
  /** Confidence in the verification conclusion.
   *  high:   PLSB Gold matched + fingerprint verified + ledger consistent
   *  medium: Validated but limited PLSB coverage or no fingerprint
   *  low:    Fallback/degraded generation or no session data */
  confidence: "high" | "medium" | "low";
  degraded: boolean;
}

// ── Core ──

export function certify(filePath: string): Certificate {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  // 1. Parse @progmune-generated marker (first 5 lines)
  const content = fs.readFileSync(absPath, "utf-8");
  const head = content.split("\n").slice(0, 5).join("\n");
  const markerMatch = head.match(
    /@progmune-generated\s+session=(\S+)(?:\s+timestamp=(\S+))?(?:\s+ruleHash=(\S+))?/
  );

  if (!markerMatch) {
    throw new Error(
      `No @progmune-generated marker found in ${filePath}.\n` +
      `This file was not generated through Progmune's immune pipeline.`
    );
  }

  const sessionId = markerMatch[1];
  const markerTimestamp = markerMatch[2];

  // 2. Load session from corpus
  const { getAllSessions } = require("./failure-corpus");
  const sessions: any[] = getAllSessions();
  const session = sessions.find(
    (s: any) => s.sessionId === sessionId || s.sessionId?.startsWith(sessionId)
  );

  // 3. Collect transitions
  let allTransitions: any[] = [];
  let generatedBy = "AI (Progmune)";
  if (session) {
    for (const a of session.attempts || []) {
      allTransitions = allTransitions.concat(a.transitions || []);
      if (a.plannerSeed && !a.plannerSeed.includes("fallback")) {
        generatedBy = "AI (LLM via Progmune)";
      }
    }
  }

  // 4. Check ledger consistency
  let validated = false;
  let violations = 0;
  try {
    if (session && allTransitions.length > 0) {
      const { checkLedgerConsistency } = require("./ssg-validator");
      const { getNsInit } = require("./protocol-registry");
      const result = checkLedgerConsistency(allTransitions, getNsInit());
      validated = result.consistent;
      violations = (result.violations || []).length;
    } else if (session) {
      validated = true; // No transitions = no violations possible
    }
  } catch {
    validated = false;
  }

  // 5. Verify fingerprint
  let fingerprint = "";
  let provenanceIntact = true;
  try {
    const { verifyFingerprint } = require("./ledger-registry");
    const fp = verifyFingerprint(sessionId, allTransitions);
    fingerprint = fp.stored?.ledgerHash || fp.stored?.ledgerHash || "";
    if (!fingerprint) {
      const { getFingerprint } = require("./ledger-registry");
      const fp2 = getFingerprint(sessionId);
      fingerprint = fp2?.ledgerHash || "";
    }
    provenanceIntact = !fp.tampered;
  } catch {
    // No fingerprint — still valid, just unregistered
  }

  // 6. PLSB coverage
  let plsbVersion = "1.0";
  let plsbCoverage = "unknown";
  let plsbRecall = 0;
  try {
    const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("./plsb-benchmark");
    const benchmark = buildPLSB();
    plsbVersion = benchmark.version || "1.0";
    plsbRecall = benchmark.metadata?.recall || 0;
    const taxonomy = PROTOCOL_WEAKNESS_TAXONOMY as any[];
    const byPLS = benchmark.metadata?.byPLS || {};
    const covered = taxonomy.filter((t: any) => (byPLS[t.id] || 0) > 0).length;
    plsbCoverage = `${covered}/${taxonomy.length}`;
  } catch {
    // PLSB not available
  }

  // 7. Detect degraded generation
  let degraded = false;
  if (session) {
    degraded = session.attempts?.some(
      (a: any) => a.plannerSeed?.includes("fallback") || a.outcome === "constraint_violation"
    ) || false;
  }

  // 8. Compute confidence
  const confidence = computeConfidence({
    validated,
    hasFingerprint: !!fingerprint && !fingerprint.includes("pending"),
    provenanceIntact,
    hasSession: !!session,
    hasTransitions: allTransitions.length > 0,
    plsbRecall,
    degraded,
    violations,
  });

  // 9. Determine validator
  let validator = "SSG Protocol Verification";
  if (validated && fingerprint && !fingerprint.includes("pending")) {
    validator += " + Ledger Fingerprint";
  }
  if (degraded) {
    validator += " (fallback — reduced reliability)";
  }

  const validTrans = allTransitions.filter((t: any) => t.valid !== false).length;

  return {
    file: absPath,
    generatedBy,
    sessionId,
    validated,
    validator,
    plsbVersion,
    plsbCoverage,
    plsbRecall,
    fingerprint: fingerprint || "(pending — run 'npm run check')",
    timestamp: markerTimestamp || new Date().toISOString(),
    transitions: allTransitions.length,
    validTransitions: validTrans,
    violations,
    provenanceIntact,
    confidence,
    degraded,
  };
}

// ── Confidence computation ──

interface ConfidenceInput {
  validated: boolean;
  hasFingerprint: boolean;
  provenanceIntact: boolean;
  hasSession: boolean;
  hasTransitions: boolean;
  plsbRecall: number;
  degraded: boolean;
  violations: number;
}

function computeConfidence(input: ConfidenceInput): "high" | "medium" | "low" {
  // LOW: degraded generation or no session data at all
  if (input.degraded) return "low";
  if (!input.hasSession) return "low";

  // If no transitions to check, can't be high confidence
  if (!input.hasTransitions) return "medium";

  // HIGH requires: validated + fingerprint intact + provenance intact + PLSB recall >= 0.7
  if (
    input.validated &&
    input.hasFingerprint &&
    input.provenanceIntact &&
    input.plsbRecall >= 0.7 &&
    input.violations === 0
  ) {
    return "high";
  }

  // MEDIUM: validated but missing some signals
  if (input.validated) return "medium";

  // Failed validation → low
  return "low";
}

// ── Formatter ──

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

const W = 52;

export function formatCertificate(cert: Certificate): string {
  const validatedIcon = cert.validated
    ? `${C.green}✅ PASS${C.reset}`
    : `${C.red}❌ FAIL${C.reset}`;
  const provenanceIcon = cert.provenanceIntact
    ? `${C.green}✅ INTACT${C.reset}`
    : `${C.yellow}⚠️  CHANGED${C.reset}`;

  // Confidence display
  const confColor = cert.confidence === "high" ? C.green
    : cert.confidence === "medium" ? C.yellow : C.red;
  const confIcon = cert.confidence === "high" ? "🟢 HIGH"
    : cert.confidence === "medium" ? "🟡 MEDIUM"
    : "🔴 LOW";
  const confNote = cert.confidence === "high"
    ? "Fully verified — suitable for audit evidence"
    : cert.confidence === "medium"
    ? "Verified with limited coverage — recommend human review"
    : "Degraded or unverified — human review required";

  const boxTop = `${C.bold}${C.cyan}╔${"═".repeat(W)}╗${C.reset}`;
  const boxMid = `${C.bold}${C.cyan}╠${"═".repeat(W)}╣${C.reset}`;
  const boxBot = `${C.bold}${C.cyan}╚${"═".repeat(W)}╝${C.reset}`;
  const boxV = `${C.bold}${C.cyan}║${C.reset}`;

  const row = (label: string, value: string) => {
    const valStr = String(value);
    const pad = Math.max(0, W - 17 - valStr.length);
    return `${boxV} ${C.bold}${label.padEnd(14)}${C.reset}${valStr}${" ".repeat(pad)}${boxV}`;
  };

  const title = "AI Code Certificate";
  const subtitle = "Progmune Runtime — Program Immune System";

  const lines = [
    "",
    boxTop,
    `${boxV}${C.bold}${C.cyan}  ${title}${C.reset}${" ".repeat(Math.max(0, W - title.length - 3))}${boxV}`,
    `${boxV}  ${C.dim}${subtitle}${C.reset}${" ".repeat(Math.max(0, W - subtitle.length - 3))}${boxV}`,
    boxMid,
    row("File", path.basename(cert.file)),
    row("Generated by", cert.generatedBy),
    row("Session", cert.sessionId.slice(0, W - 17)),
    boxMid,
    row("Validated", validatedIcon),
    row("Confidence", `${confColor}${confIcon}${C.reset}`),
    row("Validator", cert.validator.slice(0, W - 17)),
    row("Transitions", `${cert.validTransitions}/${cert.transitions} valid`),
    row("Violations",   cert.violations > 0 ? `${C.red}${cert.violations}${C.reset}` : "0"),
    row("PLSB", `v${cert.plsbVersion} (${cert.plsbCoverage} categories, recall ${(cert.plsbRecall * 100).toFixed(0)}%)`),
    boxMid,
    row("Fingerprint", cert.fingerprint.slice(0, W - 17)),
    row("Provenance", provenanceIcon),
    boxMid,
    row("Timestamp", cert.timestamp.slice(0, W - 17)),
    boxBot,
    "",
    `  ${confColor}${confNote}${C.reset}`,
    "",
    cert.degraded
      ? `  ${C.yellow}⚠️  This session used fallback generation — review code carefully.${C.reset}\n`
      : "",
    `  ${C.dim}Replay: npx ts-node src/ledger/cli.ts replay ${cert.sessionId.slice(0, 24)}${C.reset}`,
    `  ${C.dim}Report: npm run governance${C.reset}`,
    "",
  ];

  return lines.join("\n");
}

// ── CLI Entry ──

if (require.main === module) {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath || args.includes("--help") || args.includes("-h")) {
    console.log(`
Progmune AI Code Certificate

Usage:
  npx ts-node src/certify.ts <file.ts>
  npx ts-node src/certify.ts --json <file.ts>

Examples:
  npx ts-node src/certify.ts src/server.ts
  npx ts-node src/certify.ts --json src/server.ts > certificate.json
    `);
    process.exit(0);
  }

  const useJson = args.includes("--json");

  try {
    const cert = certify(filePath);
    if (useJson) {
      console.log(JSON.stringify(cert, null, 2));
    } else {
      console.log(formatCertificate(cert));
    }
  } catch (e: any) {
    console.error(`\n${C.red}❌ ${e.message}${C.reset}\n`);
    process.exit(1);
  }
}
