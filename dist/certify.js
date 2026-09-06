"use strict";
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
exports.certify = certify;
exports.formatCertificate = formatCertificate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 静态导入（vitest 下 lazy require CJS 互操作不可靠——engine.ts 同款
// 陷阱，2026-08-27 DSH 修复先例；以下模块均不反向依赖 certify，无环）
const failure_corpus_1 = require("./failure-corpus");
const ssg_validator_1 = require("./ssg-validator");
const protocol_registry_1 = require("./protocol-registry");
const ledger_registry_1 = require("./ledger-registry");
const plsb_benchmark_1 = require("./plsb-benchmark");
const protocol_knowledge_1 = require("./protocol-knowledge");
// ── Core ──
function certify(filePath) {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`File not found: ${absPath}`);
    }
    // 1. Parse @progmune-generated marker (first 5 lines)
    const content = fs.readFileSync(absPath, "utf-8");
    const head = content.split("\n").slice(0, 5).join("\n");
    const markerMatch = head.match(/@progmune-generated\s+session=(\S+)(?:\s+timestamp=(\S+))?(?:\s+ruleHash=(\S+))?/);
    if (!markerMatch) {
        throw new Error(`No @progmune-generated marker found in ${filePath}.\n` +
            `This file was not generated through Progmune's immune pipeline.`);
    }
    const sessionId = markerMatch[1];
    const markerTimestamp = markerMatch[2];
    // 2. Load session from corpus
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const session = sessions.find((s) => s.sessionId === sessionId || s.sessionId?.startsWith(sessionId));
    // 3. Collect transitions
    let allTransitions = [];
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
            const result = (0, ssg_validator_1.checkLedgerConsistency)(allTransitions, (0, protocol_registry_1.getNsInit)());
            validated = result.consistent;
            violations = (result.violations || []).length;
        }
        else if (session) {
            validated = true; // No transitions = no violations possible
        }
    }
    catch {
        validated = false;
    }
    // 5. Verify fingerprint
    let fingerprint = "";
    let provenanceIntact = true;
    try {
        const fp = (0, ledger_registry_1.verifyFingerprint)(sessionId, allTransitions);
        fingerprint = fp.stored?.ledgerHash || fp.stored?.ledgerHash || "";
        if (!fingerprint) {
            const fp2 = (0, ledger_registry_1.getFingerprint)(sessionId);
            fingerprint = fp2?.ledgerHash || "";
        }
        provenanceIntact = !fp.tampered;
    }
    catch {
        // No fingerprint — still valid, just unregistered
    }
    // 6. PLSB coverage
    let plsbVersion = "1.0";
    let plsbCoverage = "unknown";
    let plsbRecall = 0;
    try {
        const benchmark = (0, plsb_benchmark_1.buildPLSB)();
        plsbVersion = benchmark.version || "1.0";
        // recall = verified/total（类型修复暴露的潜伏 bug：metadata 从未有
        // recall 字段，原写法恒为 0 → HIGH 置信度门槛永远不可达）
        plsbRecall = benchmark.metadata
            ? benchmark.metadata.verified / Math.max(1, benchmark.metadata.total)
            : 0;
        const taxonomy = plsb_benchmark_1.PROTOCOL_WEAKNESS_TAXONOMY;
        const byPLS = benchmark.metadata?.byPLS || {};
        const covered = taxonomy.filter((t) => (byPLS[t.id] || 0) > 0).length;
        plsbCoverage = `${covered}/${taxonomy.length}`;
    }
    catch {
        // PLSB not available
    }
    // 7. Detect degraded generation
    let degraded = false;
    if (session) {
        degraded = session.attempts?.some((a) => a.plannerSeed?.includes("fallback") || a.outcome === "constraint_violation") || false;
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
    const validTrans = allTransitions.filter((t) => t.valid !== false).length;
    // 10. Query Knowledge Base for matching protocol assets
    let kbVersion;
    let kbAssets;
    try {
        const kb = (0, protocol_knowledge_1.buildKnowledgeBase)();
        kbVersion = kb.version;
        const stableAssets = kb.units.filter((u) => u.maturity === "stable");
        kbAssets = stableAssets.map((u) => ({
            id: u.id, name: u.name, version: u.currentVersion,
            confidence: u.confidence, rfc: u.rfcReference,
        }));
    }
    catch { /* KB unavailable */ }
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
        kbVersion,
        kbAssets,
    };
}
function computeConfidence(input) {
    // LOW: degraded generation or no session data at all
    if (input.degraded)
        return "low";
    if (!input.hasSession)
        return "low";
    // If no transitions to check, can't be high confidence
    if (!input.hasTransitions)
        return "medium";
    // HIGH requires: validated + fingerprint intact + provenance intact + PLSB recall >= 0.7
    if (input.validated &&
        input.hasFingerprint &&
        input.provenanceIntact &&
        input.plsbRecall >= 0.7 &&
        input.violations === 0) {
        return "high";
    }
    // MEDIUM: validated but missing some signals
    if (input.validated)
        return "medium";
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
function formatCertificate(cert) {
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
    const row = (label, value) => {
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
        row("Violations", cert.violations > 0 ? `${C.red}${cert.violations}${C.reset}` : "0"),
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
        cert.kbVersion ? `  ${C.dim}Ontology: Protocol Knowledge Base v${cert.kbVersion} (${cert.kbAssets?.length || 0} stable assets)${C.reset}` : "",
        cert.kbAssets?.length ? `  ${C.dim}Assets: ${cert.kbAssets.map(a => `${a.name} v${a.version} (${a.confidence}%)`).join(", ")}${C.reset}` : "",
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
        }
        else {
            console.log(formatCertificate(cert));
        }
    }
    catch (e) {
        console.error(`\n${C.red}❌ ${e.message}${C.reset}\n`);
        process.exit(1);
    }
}
