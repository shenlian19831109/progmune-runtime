"use strict";
/**
 * Phase 9: Governance Report Builder
 *
 * Aggregates data from the corpus, fingerprints, PLSB benchmark,
 * and immune system into a single GovernanceReport.
 *
 * Pure aggregation — no new verification logic.
 * All data already exists in .progmune_corpus/ and benchmarks/.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGovernanceReport = buildGovernanceReport;
const crypto = __importStar(require("crypto"));
// ── Main Entry Point ──
function buildGovernanceReport(projectPath, options = {}) {
    const metadata = buildMetadata(projectPath);
    const sessions = buildSessions(options.sessionId);
    const ssv = buildSSV(sessions, options);
    const plsb = options.fast ? emptyPLSB() : buildPLSBFromBenchmark();
    const provenance = buildProvenance();
    const antibodies = buildAntibodies();
    const business = buildBusinessSection(plsb, sessions, projectPath, options);
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
        business, // Phase 10: Business Translation
    };
}
// ── Metadata ──
function buildMetadata(projectPath) {
    return {
        generator: "progmune-runtime",
        version: "3.2.0",
        timestamp: new Date().toISOString(),
        projectId: crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 16),
        validator: "SSG + Ledger + PLSB",
    };
}
// ── Sessions ──
function buildSessions(sessionId) {
    const { getAllSessions } = require("../failure-corpus");
    const sessions = getAllSessions();
    let filtered = sessions;
    if (sessionId) {
        filtered = sessions.filter((s) => s.sessionId === sessionId || s.sessionId?.startsWith(sessionId));
    }
    const details = [];
    for (const s of filtered) {
        let trans = [];
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
        }
        catch { /* best-effort */ }
        // Verify fingerprint
        let fingerprintVerified = false;
        let fingerprintTampered = false;
        try {
            const { verifyFingerprint } = require("../ledger-registry");
            const fp = verifyFingerprint(s.sessionId, trans);
            fingerprintVerified = fp.valid;
            fingerprintTampered = fp.tampered;
        }
        catch { /* best-effort */ }
        const validTrans = trans.filter((t) => t.valid !== false).length;
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
function buildSSV(sessions, _options) {
    let totalChecks = 0;
    let passed = 0;
    let failed = 0;
    const byCategory = {};
    const allViolations = [];
    for (const d of sessions.details) {
        totalChecks++;
        if (d.consistencyPassed) {
            passed++;
        }
        else {
            failed++;
        }
        // Category is "ledger" — all violations are ledger consistency
        const cat = "ledger";
        if (!byCategory[cat])
            byCategory[cat] = { total: 0, passed: 0, failed: 0 };
        byCategory[cat].total++;
        if (d.consistencyPassed) {
            byCategory[cat].passed++;
        }
        else {
            byCategory[cat].failed++;
        }
    }
    return { totalChecks, passed, failed, byCategory, violations: allViolations };
}
// ── PLSB ──
function buildPLSBFromBenchmark() {
    try {
        const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("../plsb-benchmark");
        const benchmark = buildPLSB();
        const taxonomyIds = PROTOCOL_WEAKNESS_TAXONOMY.map((t) => t.id);
        const matched = new Set(Object.keys(benchmark.metadata?.byPLS || {}));
        const matchedCategories = taxonomyIds.filter((id) => matched.has(id));
        const unmatchedCategories = taxonomyIds.filter((id) => !matched.has(id));
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
    }
    catch {
        return emptyPLSB();
    }
}
function emptyPLSB() {
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
function buildProvenance() {
    try {
        const { verifyAllFingerprints } = require("../ledger-registry");
        const summary = verifyAllFingerprints();
        return {
            totalFingerprints: summary.total || 0,
            verified: summary.valid || 0,
            tampered: summary.tampered || 0,
            notFound: summary.notFound || 0,
        };
    }
    catch {
        return { totalFingerprints: 0, verified: 0, tampered: 0, notFound: 0 };
    }
}
// ── Antibodies ──
function buildAntibodies() {
    try {
        const { getAntibodyStats } = require("../failure-corpus");
        const stats = getAntibodyStats();
        return {
            totalHits: stats.totalHits || 0,
            fastPathHits: stats.fastPathHits || 0,
            llmCallsSaved: stats.totalLLMCallsSaved || 0,
            tokensSaved: stats.totalTokensSaved || 0,
            topSignatures: (stats.topSignatures || []).slice(0, 5).map((s) => typeof s === "string" ? s : s.signature || "").filter(Boolean),
            byLevel: stats.byLevel || {},
        };
    }
    catch {
        return {
            totalHits: 0, fastPathHits: 0, llmCallsSaved: 0, tokensSaved: 0,
            topSignatures: [], byLevel: {},
        };
    }
}
// ── Business Translation (Phase 10) ──
function buildBusinessSection(plsb, sessions, _projectPath, options) {
    if (options.business === false)
        return undefined;
    try {
        const { translateToBusinessRisks, getKnowledgeCoverage, getProtocolGraph, buildBusinessSummary, detectProjectType } = require("./business-translator");
        // Auto-detect project type for domain-specific knowledge
        const detectedType = detectProjectType(_projectPath);
        const violationsByCategory = {};
        for (const d of sessions.details) {
            if (d.violations > 0) {
                // Categorize violations (simplified)
                violationsByCategory["认证与授权"] = (violationsByCategory["认证与授权"] || 0) + d.violations;
            }
        }
        const risks = translateToBusinessRisks(plsb.matchedCategories, plsb.unmatchedCategories, violationsByCategory);
        const knowledge = getKnowledgeCoverage(detectedType);
        const protocolGraph = getProtocolGraph(detectedType);
        const summary = buildBusinessSummary(risks, knowledge, violationsByCategory, detectedType);
        return { risks, knowledgeCoverage: knowledge, protocolGraph, summary };
    }
    catch (e) {
        // Best-effort: if business translator fails, skip the section
        return undefined;
    }
}
// ── Recommendations ──
function generateRecommendations(sessions, ssv, provenance, plsb) {
    const recs = [];
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
function computeVerdict(sessions, ssv, provenance, recommendations) {
    const hasCritical = recommendations.some((r) => r.severity === "critical");
    if (provenance.tampered > 0)
        return "FAIL";
    if (ssv.failed > 0)
        return "FAIL";
    if (hasCritical)
        return "FAIL";
    if (sessions.total > 0 && sessions.verified / sessions.total < 0.8)
        return "WARN";
    return "PASS";
}
