/**
 * Phase 9: Governance Report Builder
 *
 * Aggregates data from the corpus, fingerprints, PLSB benchmark,
 * and immune system into a single GovernanceReport.
 *
 * Pure aggregation — no new verification logic.
 * All data already exists in .progmune_corpus/ and benchmarks/.
 */

import * as crypto from "crypto";
import type {
  GovernanceReport,
  GovernanceMetadata,
  SessionsSection,
  SSVSection,
  PLSBSection,
  ProvenanceSection,
  AntibodiesSection,
  GovernanceVerdict,
  GovernanceRecommendation,
  SessionVerdict,
} from "./types";

interface BuildOptions {
  fast?: boolean;       // skip PLSB benchmark (expensive)
  sessionId?: string;   // scope to a single session
}

// ── Main Entry Point ──

export function buildGovernanceReport(
  projectPath: string,
  options: BuildOptions = {}
): GovernanceReport {
  const metadata = buildMetadata(projectPath);
  const sessions = buildSessions(options.sessionId);
  const ssv = buildSSV(sessions, options);
  const plsb = options.fast ? emptyPLSB() : buildPLSBFromBenchmark();
  const provenance = buildProvenance();
  const antibodies = buildAntibodies();
  const recommendations = generateRecommendations(sessions, ssv, provenance, plsb);
  const verdict = computeVerdict(sessions, ssv, provenance, recommendations);

  return {
    metadata,
    sessions,
    ssv,
    plsb,
    provenance,
    antibodies,
    verdict,
    recommendations,
  };
}

// ── Metadata ──

function buildMetadata(projectPath: string): GovernanceMetadata {
  return {
    generator: "progmune-runtime",
    version: "3.2.0",
    timestamp: new Date().toISOString(),
    projectId: crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 16),
    validator: "SSG + Ledger + PLSB",
  };
}

// ── Sessions ──

function buildSessions(sessionId?: string): SessionsSection {
  const { getAllSessions } = require("../failure-corpus");
  const sessions: any[] = getAllSessions();

  let filtered = sessions;
  if (sessionId) {
    filtered = sessions.filter(
      (s: any) => s.sessionId === sessionId || s.sessionId?.startsWith(sessionId)
    );
  }

  const details: SessionVerdict[] = [];
  for (const s of filtered) {
    let trans: any[] = [];
    // Collect transitions from attempts
    for (const a of s.attempts || []) {
      trans = trans.concat(a.transitions || []);
    }

    // Check ledger consistency
    let consistencyPassed = false;
    let violations = 0;
    try {
      const { checkLedgerConsistency } = require("../ssg-validator");
      const { getNsInit } = require("../protocol-registry");
      const result = checkLedgerConsistency(trans, getNsInit());
      consistencyPassed = result.consistent;
      violations = (result.violations || []).length;
    } catch { /* best-effort */ }

    // Verify fingerprint
    let fingerprintVerified = false;
    let fingerprintTampered = false;
    try {
      const { verifyFingerprint } = require("../ledger-registry");
      const fp = verifyFingerprint(s.sessionId, trans);
      fingerprintVerified = fp.valid;
      fingerprintTampered = fp.tampered;
    } catch { /* best-effort */ }

    const validTrans = trans.filter((t: any) => t.valid !== false).length;

    details.push({
      sessionId: s.sessionId || "unknown",
      intent: s.intent || "",
      transitionCount: trans.length,
      validTransitions: validTrans,
      invalidTransitions: trans.length - validTrans,
      fingerprintVerified,
      fingerprintTampered,
      consistencyPassed,
      violations,
    });
  }

  const verified = details.filter((d) => d.fingerprintVerified).length;
  const compromised = details.filter((d) => d.fingerprintTampered).length;

  return { total: filtered.length, verified, compromised, details };
}

// ── SSV (Semantic State Verification) ──

function buildSSV(
  sessions: SessionsSection,
  _options: BuildOptions
): SSVSection {
  let totalChecks = 0;
  let passed = 0;
  let failed = 0;
  const byCategory: Record<string, { total: number; passed: number; failed: number }> = {};
  const allViolations: any[] = [];

  for (const d of sessions.details) {
    totalChecks++;
    if (d.consistencyPassed) {
      passed++;
    } else {
      failed++;
    }

    // Category is "ledger" — all violations are ledger consistency
    const cat = "ledger";
    if (!byCategory[cat]) byCategory[cat] = { total: 0, passed: 0, failed: 0 };
    byCategory[cat].total++;
    if (d.consistencyPassed) {
      byCategory[cat].passed++;
    } else {
      byCategory[cat].failed++;
    }
  }

  return { totalChecks, passed, failed, byCategory, violations: allViolations };
}

// ── PLSB ──

function buildPLSBFromBenchmark(): PLSBSection {
  try {
    const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("../plsb-benchmark");
    const benchmark = buildPLSB();
    const taxonomyIds = PROTOCOL_WEAKNESS_TAXONOMY.map((t: any) => t.id);
    const matched = new Set(Object.keys(benchmark.metadata?.byPLS || {}));
    const matchedCategories = taxonomyIds.filter((id: string) => matched.has(id));
    const unmatchedCategories = taxonomyIds.filter((id: string) => !matched.has(id));

    return {
      version: benchmark.version || "1.0",
      totalEntries: benchmark.metadata?.total || 0,
      verifiedEntries: benchmark.metadata?.verified || 0,
      coverage: matchedCategories.length / (taxonomyIds.length || 1),
      recall: benchmark.metadata?.recall || 0,
      precision: benchmark.metadata?.precision || 0,
      matchedCategories,
      unmatchedCategories,
    };
  } catch {
    return emptyPLSB();
  }
}

function emptyPLSB(): PLSBSection {
  return {
    version: "1.0",
    totalEntries: 0,
    verifiedEntries: 0,
    coverage: 0,
    recall: 0,
    precision: 0,
    matchedCategories: [],
    unmatchedCategories: [],
  };
}

// ── Provenance ──

function buildProvenance(): ProvenanceSection {
  try {
    const { verifyAllFingerprints } = require("../ledger-registry");
    const summary = verifyAllFingerprints();
    return {
      totalFingerprints: summary.total || 0,
      verified: summary.valid || 0,
      tampered: summary.tampered || 0,
      notFound: summary.notFound || 0,
    };
  } catch {
    return { totalFingerprints: 0, verified: 0, tampered: 0, notFound: 0 };
  }
}

// ── Antibodies ──

function buildAntibodies(): AntibodiesSection {
  try {
    const { getAntibodyStats } = require("../failure-corpus");
    const stats = getAntibodyStats();
    return {
      totalHits: stats.totalHits || 0,
      fastPathHits: stats.fastPathHits || 0,
      llmCallsSaved: stats.totalLLMCallsSaved || 0,
      tokensSaved: stats.totalTokensSaved || 0,
      topSignatures: (stats.topSignatures || []).slice(0, 5).map((s: any) => typeof s === "string" ? s : s.signature || "").filter(Boolean),
      byLevel: stats.byLevel || {},
    };
  } catch {
    return {
      totalHits: 0, fastPathHits: 0, llmCallsSaved: 0, tokensSaved: 0,
      topSignatures: [], byLevel: {},
    };
  }
}

// ── Recommendations ──

function generateRecommendations(
  sessions: SessionsSection,
  ssv: SSVSection,
  provenance: ProvenanceSection,
  plsb: PLSBSection
): GovernanceRecommendation[] {
  const recs: GovernanceRecommendation[] = [];

  if (provenance.tampered > 0) {
    recs.push({
      severity: "critical",
      category: "provenance",
      message: `${provenance.tampered} fingerprint(s) show tampered hashes.`,
      action: `Run 'progmune_check' and review .progmune_corpus/fingerprints/ for tampered sessions.`,
    });
  }

  if (ssv.failed > 0) {
    recs.push({
      severity: "critical",
      category: "ssv",
      message: `${ssv.failed} session(s) have ledger consistency violations.`,
      action: `Run 'progmune_repair(sessionId="...")' to generate fix proposals for each failed session.`,
    });
  }

  if (sessions.total > 0 && sessions.verified / sessions.total < 0.8) {
    recs.push({
      severity: "high",
      category: "coverage",
      message: `Only ${sessions.verified}/${sessions.total} sessions verified.`,
      action: `Run 'npm run check' to register missing fingerprints.`,
    });
  }

  if (provenance.notFound > 0) {
    recs.push({
      severity: "medium",
      category: "provenance",
      message: `${provenance.notFound} fingerprint(s) reference missing session files.`,
      action: `Fingerprints without sessions can be manually reviewed or removed from .progmune_corpus/fingerprints/.`,
    });
  }

  if (plsb.coverage < 0.7) {
    recs.push({
      severity: "medium",
      category: "plsb",
      message: `PLSB coverage is ${(plsb.coverage * 100).toFixed(0)}% — ${plsb.unmatchedCategories.length} categories uncovered: ${plsb.unmatchedCategories.join(", ")}.`,
      action: `Add protocol rules for uncovered PLS categories to improve detection coverage.`,
    });
  }

  return recs;
}

// ── Verdict ──

function computeVerdict(
  sessions: SessionsSection,
  ssv: SSVSection,
  provenance: ProvenanceSection,
  recommendations: GovernanceRecommendation[]
): GovernanceVerdict {
  const hasCritical = recommendations.some((r) => r.severity === "critical");

  if (provenance.tampered > 0) return "FAIL";
  if (ssv.failed > 0) return "FAIL";
  if (hasCritical) return "FAIL";

  if (sessions.total > 0 && sessions.verified / sessions.total < 0.8) return "WARN";

  return "PASS";
}
