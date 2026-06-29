"use strict";
/**
 * Phase 12: Certificate HTML/PDF Renderer
 *
 * Generates a professional, auditor-ready certificate document.
 * Print-ready HTML — can be saved as PDF from any browser.
 *
 * Usage:
 *   npx ts-node src/certify-html.ts <file.ts> --output certificate.html
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
exports.generateCertificateHTML = generateCertificateHTML;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const certify_1 = require("./certify");
const engine_1 = require("./policy/engine");
// ── Main Generator ──
function generateCertificateHTML(filePath, options = {}) {
    const cert = (0, certify_1.certify)(filePath);
    // Run policy check
    let policyVerdict = "N/A";
    let policyPassed = 0;
    let policyTotal = 0;
    try {
        const { buildAccountabilityChain } = require("./ledger/accountability");
        const opts = {};
        if (options.author)
            opts.author = { id: options.author, name: options.author.split("@")[0], role: "developer" };
        if (options.reviewer)
            opts.reviewers = [{ id: options.reviewer, name: options.reviewer.split("@")[0], role: "reviewer" }];
        let acct;
        try {
            acct = buildAccountabilityChain(cert.sessionId, opts);
        }
        catch { /* no data */ }
        const ctx = {
            certificate: {
                validated: cert.validated,
                confidence: cert.confidence,
                provenanceIntact: cert.provenanceIntact,
                fingerprint: cert.fingerprint,
                violations: cert.violations,
                plsbCoverage: cert.plsbCoverage,
                plsbRecall: cert.plsbRecall,
                degraded: cert.degraded,
                sessionId: cert.sessionId,
                file: cert.file,
            },
            accountability: acct ? {
                humanEvents: acct.humanEvents,
                aiEvents: acct.aiEvents,
                automatedEvents: acct.automatedEvents,
                custodyGap: acct.custodyGap,
            } : undefined,
        };
        const policy = (0, engine_1.evaluatePolicy)(ctx);
        policyVerdict = policy.verdict;
        policyPassed = policy.passed_rules;
        policyTotal = policy.rules;
    }
    catch { /* policy unavailable */ }
    const data = { ...cert, policyVerdict, policyPassed, policyTotal };
    return renderHTML(data);
}
// ── HTML Renderer ──
function renderHTML(cert) {
    const confColor = cert.confidence === "high" ? "#22c55e"
        : cert.confidence === "medium" ? "#f59e0b" : "#ef4444";
    const verdictColor = cert.policyVerdict === "ALLOW" ? "#22c55e"
        : cert.policyVerdict === "WARN" ? "#f59e0b"
            : cert.policyVerdict === "BLOCK" ? "#ef4444" : "#6b7280";
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>AI Code Certificate — ${escapeHtml(path.basename(cert.file))}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    color: #1f2937;
    max-width: 190mm;
    margin: 0 auto;
    padding: 10mm;
  }

  .header {
    border-bottom: 3px solid #0891b2;
    padding-bottom: 4mm;
    margin-bottom: 6mm;
  }
  .header h1 { font-size: 20pt; color: #0891b2; font-weight: 700; }
  .header .subtitle { font-size: 9pt; color: #6b7280; margin-top: 1mm; }

  .verdict-badge {
    display: inline-block;
    padding: 2mm 6mm;
    border-radius: 4px;
    font-weight: 700;
    font-size: 12pt;
    margin: 3mm 0;
  }

  .section {
    margin-bottom: 5mm;
  }
  .section h2 {
    font-size: 12pt;
    color: #0891b2;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 1mm;
    margin-bottom: 3mm;
  }

  table { width: 100%; border-collapse: collapse; }
  table.info td {
    padding: 1.5mm 2mm;
    border-bottom: 1px solid #f3f4f6;
  }
  table.info td:first-child {
    font-weight: 600;
    color: #374151;
    width: 35%;
  }
  table.info td:last-child {
    color: #1f2937;
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 9pt;
  }

  .confidence { font-weight: 700; }
  .fingerprint {
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 8pt;
    background: #f9fafb;
    padding: 1mm 2mm;
    border-radius: 2px;
    word-break: break-all;
  }

  .footer {
    margin-top: 10mm;
    padding-top: 3mm;
    border-top: 1px solid #e5e7eb;
    font-size: 8pt;
    color: #9ca3af;
    text-align: center;
  }

  .verification-statement {
    background: #f0fdf4;
    border-left: 3px solid #22c55e;
    padding: 3mm 5mm;
    margin: 4mm 0;
    font-size: 9pt;
  }
  .verification-statement.warn {
    background: #fffbeb;
    border-left-color: #f59e0b;
  }
  .verification-statement.fail {
    background: #fef2f2;
    border-left-color: #ef4444;
  }

  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <h1>AI Code Certificate</h1>
  <div class="subtitle">Progmune Runtime — AI Generated Software Governance</div>
</div>

<!-- Verdict -->
<div class="verdict-badge" style="background: ${verdictColor}15; color: ${verdictColor}; border: 1px solid ${verdictColor}40;">
  ${cert.policyVerdict && cert.policyVerdict !== "N/A"
        ? `Policy: ${cert.policyVerdict} (${cert.policyPassed}/${cert.policyTotal} rules passed)`
        : "Certificate of AI Generation"}
</div>

<!-- File Info -->
<div class="section">
  <h2>File Information</h2>
  <table class="info">
    <tr><td>File</td><td>${escapeHtml(cert.file)}</td></tr>
    <tr><td>Generated By</td><td>${escapeHtml(cert.generatedBy)}</td></tr>
    <tr><td>Session ID</td><td class="fingerprint">${escapeHtml(cert.sessionId)}</td></tr>
    <tr><td>Timestamp</td><td>${escapeHtml(cert.timestamp)}</td></tr>
  </table>
</div>

<!-- Validation -->
<div class="section">
  <h2>Validation Results</h2>
  <table class="info">
    <tr><td>Protocol Validation</td><td>${cert.validated ? "✅ PASS" : "❌ FAIL"}</td></tr>
    <tr><td>Confidence</td><td class="confidence" style="color: ${confColor}">${cert.confidence.toUpperCase()}</td></tr>
    <tr><td>Validator</td><td>${escapeHtml(cert.validator)}</td></tr>
    <tr><td>Transitions</td><td>${cert.validTransitions}/${cert.transitions} valid${cert.violations > 0 ? `, ${cert.violations} violation(s)` : ""}</td></tr>
  </table>
</div>

<!-- PLSB -->
<div class="section">
  <h2>PLSB Coverage</h2>
  <table class="info">
    <tr><td>Benchmark Version</td><td>v${escapeHtml(cert.plsbVersion)}</td></tr>
    <tr><td>Categories Covered</td><td>${escapeHtml(cert.plsbCoverage)}</td></tr>
    <tr><td>Detector Recall</td><td>${(cert.plsbRecall * 100).toFixed(0)}%</td></tr>
  </table>
</div>

<!-- Provenance -->
<div class="section">
  <h2>Provenance & Integrity</h2>
  <table class="info">
    <tr><td>Fingerprint</td><td class="fingerprint">${escapeHtml(cert.fingerprint)}</td></tr>
    <tr><td>Provenance Chain</td><td>${cert.provenanceIntact ? "✅ INTACT" : "⚠️ CHANGED"}</td></tr>
  </table>
</div>

<!-- Verification Statement -->
<div class="verification-statement${cert.validated ? "" : cert.degraded ? " warn" : " fail"}">
  <strong>Verification Statement</strong><br>
  ${cert.validated
        ? `This file passed Progmune's protocol security verification (SSG + Ledger Fingerprint) with ${cert.confidence.toUpperCase()} confidence. The provenance chain is ${cert.provenanceIntact ? "intact" : "modified"}. PLSB v${cert.plsbVersion} covers ${cert.plsbCoverage} protocol weakness categories at ${(cert.plsbRecall * 100).toFixed(0)}% recall.`
        : cert.degraded
            ? `This file was generated via a fallback path with reduced reliability. Human review is recommended before deploying to production.`
            : `This file has NOT passed protocol security verification. Deployment should be blocked until violations are resolved.`}
</div>

${cert.policyVerdict && cert.policyVerdict !== "N/A" ? `
<!-- Policy Verdict -->
<div class="verification-statement${cert.policyVerdict === "ALLOW" ? "" : cert.policyVerdict === "WARN" ? " warn" : " fail"}">
  <strong>Policy Engine Verdict: ${cert.policyVerdict}</strong><br>
  ${cert.policyVerdict === "ALLOW"
        ? "All governance policies passed. This file is cleared for deployment."
        : cert.policyVerdict === "WARN"
            ? "Some policies have warnings. Review the policy report before deploying."
            : "Policy violations detected. Deployment is BLOCKED until violations are resolved."}
</div>
` : ""}

<!-- Footer -->
<div class="footer">
  <p>This certificate was generated by <strong>Progmune Runtime</strong> — AI Generated Software Governance.</p>
  <p>Certificate hash: ${hashCertificate(cert)}</p>
  <p>https://github.com/shenlian19831109/progmune-runtime | PLSB v${cert.plsbVersion}</p>
  <p class="no-print" style="margin-top: 3mm;">
    <button onclick="window.print()" style="padding: 2mm 8mm; font-size: 11pt; cursor: pointer;">
      🖨 Print to PDF
    </button>
  </p>
</div>

</body>
</html>`;
}
// ── Helpers ──
function escapeHtml(s) {
    if (!s)
        return "";
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function hashCertificate(cert) {
    const crypto = require("crypto");
    return crypto
        .createHash("sha256")
        .update(`${cert.sessionId}|${cert.fingerprint}|${cert.timestamp}|${cert.confidence}`)
        .digest("hex")
        .slice(0, 16);
}
// ── CLI ──
if (require.main === module) {
    const args = process.argv.slice(2);
    const filePath = args.find(a => !a.startsWith("--") && a.endsWith(".ts"));
    if (!filePath || args.includes("--help") || args.includes("-h")) {
        console.log(`
Certificate HTML Generator

Usage:
  npx ts-node src/certify-html.ts <file.ts> [--output <path>]

Options:
  --output <path>   Output file (default: certificate-<name>.html)
  --author <email>  Human actor for policy check
  --reviewer <email> Human reviewer

Examples:
  npx ts-node src/certify-html.ts src/server.ts
  npx ts-node src/certify-html.ts src/server.ts --output audit/cert-001.html
  npx ts-node src/certify-html.ts src/server.ts --author alice@example.com
    `);
        process.exit(0);
    }
    const outputIdx = args.indexOf("--output");
    const outputPath = outputIdx >= 0 ? args[outputIdx + 1]
        : `certificate-${path.basename(filePath, ".ts")}.html`;
    const authorIdx = args.indexOf("--author");
    const reviewerIdx = args.indexOf("--reviewer");
    const author = authorIdx >= 0 ? args[authorIdx + 1] : undefined;
    const reviewer = reviewerIdx >= 0 ? args[reviewerIdx + 1] : undefined;
    const html = generateCertificateHTML(filePath, { author, reviewer });
    const outDir = path.dirname(path.resolve(outputPath));
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputPath, html, "utf-8");
    console.log(`✅ Certificate: ${outputPath}`);
    console.log(`   Open in browser → File → Print → Save as PDF`);
}
