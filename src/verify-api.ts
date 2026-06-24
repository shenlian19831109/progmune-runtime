/**
 * Phase 12: External Verification API
 *
 * Standalone REST API for third-party certificate verification.
 * Auditors and regulators can verify AI code certificates
 * without installing Progmune — pure HTTP.
 *
 * Endpoints:
 *   GET  /verify/:sessionId              — full verification bundle
 *   GET  /verify/:sessionId/certificate  — certificate only
 *   GET  /verify/:sessionId/chain        — hash chain (independent verification)
 *   GET  /verify/:sessionId/policy       — policy check result
 *   POST /verify                         — submit certificate JSON for verification
 *   GET  /health                         — service health
 *
 * Usage:
 *   npx ts-node src/verify-api.ts
 *   PROGMUNE_VERIFY_PORT=3300 npx ts-node src/verify-api.ts
 */

import * as http from "http";

const PORT = parseInt(process.env.PROGMUNE_VERIFY_PORT || "3300", 10);

// ═══════════════════════════════════════════════════════════════
// Verification Engine
// ═══════════════════════════════════════════════════════════════

interface VerificationBundle {
  verified: boolean;
  sessionId: string;
  certificate: any;
  provenance: any;
  accountability: any;
  policy: any;
  hashChain: string[];
  chainRoot: string;
  verifiedAt: string;
  tampered: boolean;
  detail: string;
}

function getVerificationBundle(sessionId: string): VerificationBundle | { error: string } {
  // 1. Load session
  const { getAllSessions } = require("./failure-corpus");
  const sessions: any[] = getAllSessions();
  const session = sessions.find(
    (s: any) => s.sessionId === sessionId || s.sessionId?.startsWith(sessionId)
  );

  if (!session) {
    return { error: `Session not found: ${sessionId}` };
  }

  // 2. Build provenance chain
  let provenance: any;
  let hashChain: string[] = [];
  try {
    const { buildProvenanceChain } = require("./ledger/chain-builder");
    provenance = buildProvenanceChain(sessionId);
    hashChain = provenance.events.map((e: any) => e.hash);
  } catch (e: any) {
    return { error: `Provenance chain error: ${e.message}` };
  }

  // 3. Build accountability chain
  let accountability: any;
  try {
    const { buildAccountabilityChain, verifyAccountabilityChain } = require("./ledger/accountability");
    accountability = buildAccountabilityChain(sessionId);
    // Verify chain integrity
    const acctVerify = verifyAccountabilityChain(accountability);
    accountability._verified = acctVerify.valid;
    accountability._signedCount = acctVerify.signedCount;
    accountability._unsignedCount = acctVerify.unsignedCount;
  } catch { /* accountability unavailable */ }

  // 4. Check ledger consistency
  let ledgerConsistent = false;
  let violations = 0;
  let allTransitions: any[] = [];
  try {
    for (const a of session.attempts || []) {
      allTransitions = allTransitions.concat(a.transitions || []);
    }
    if (allTransitions.length > 0) {
      const { checkLedgerConsistency } = require("./ssg-validator");
      const { getNsInit } = require("./protocol-registry");
      const result = checkLedgerConsistency(allTransitions, getNsInit());
      ledgerConsistent = result.consistent;
      violations = (result.violations || []).length;
    } else {
      ledgerConsistent = true;
    }
  } catch { /* skip */ }

  // 5. Verify fingerprint
  let fingerprintVerified = false;
  let fingerprintTampered = false;
  let fingerprintHash = "";
  try {
    const { verifyFingerprint } = require("./ledger-registry");
    const fp = verifyFingerprint(sessionId, allTransitions);
    fingerprintVerified = fp.valid;
    fingerprintTampered = fp.tampered;
    fingerprintHash = fp.stored?.ledgerHash || "";
  } catch { /* no fingerprint */ }

  // 6. Build certificate
  let certificate: any;
  try {
    // Create a minimal cert from session data
    certificate = {
      sessionId: session.sessionId,
      intent: session.intent || "",
      validated: ledgerConsistent,
      fingerprintVerified,
      fingerprintHash,
      transitions: allTransitions.length,
      validTransitions: allTransitions.filter((t: any) => t.valid !== false).length,
      violations,
      timestamp: session.endedAt
        ? new Date(session.endedAt).toISOString()
        : new Date().toISOString(),
    };
  } catch { /* skip */ }

  // 7. Compute overall tampered status
  const tampered = fingerprintTampered || provenance.integrity === "broken";
  const verified = !tampered && ledgerConsistent && fingerprintVerified;

  return {
    verified,
    sessionId: session.sessionId,
    certificate,
    provenance: {
      integrity: provenance.integrity,
      chainHash: provenance.chainHash,
      totalTransitions: provenance.totalTransitions,
      validTransitions: provenance.validTransitions,
      invalidTransitions: provenance.invalidTransitions,
      repairCount: provenance.repairCount,
    },
    accountability: accountability ? {
      totalEvents: accountability.totalEvents,
      humanEvents: accountability.humanEvents,
      aiEvents: accountability.aiEvents,
      automatedEvents: accountability.automatedEvents,
      custodyGap: accountability.custodyGap,
      chainHash: accountability.chainHash,
      _verified: accountability._verified,
      _signedCount: accountability._signedCount,
      _unsignedCount: accountability._unsignedCount,
    } : null,
    policy: {
      ledgerConsistent,
      fingerprintVerified,
      fingerprintTampered,
      violations,
    },
    hashChain,
    chainRoot: provenance.chainHash,
    verifiedAt: new Date().toISOString(),
    tampered,
    detail: tampered
      ? "⚠️  Tampering detected — fingerprint mismatch or provenance chain broken."
      : verified
      ? "✅ Verified — certificate is authentic and the code provenance is intact."
      : "⚠️  Verification incomplete — some checks could not be performed. Manual review recommended.",
  };
}

// ═══════════════════════════════════════════════════════════════
// HTTP Server
// ═══════════════════════════════════════════════════════════════

function json(res: http.ServerResponse, data: any, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data, null, 2));
}

function html(res: http.ServerResponse, body: string, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Health
  if (url === "/health") {
    json(res, { status: "ok", service: "Progmune Verification API", version: "1.0.0" });
    return;
  }

  // Home page
  if (url === "/" || url === "") {
    html(res, renderHomePage());
    return;
  }

  // POST /verify — submit certificate JSON for verification
  if (url === "/verify" && method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const submitted = JSON.parse(body);
        const sessionId = submitted.sessionId || submitted.session_id;
        if (!sessionId) {
          json(res, { error: "Missing sessionId or session_id in request body" }, 400);
          return;
        }
        const bundle = getVerificationBundle(sessionId);
        if ("error" in bundle) {
          json(res, bundle, 404);
          return;
        }
        // Cross-check submitted data against stored data
        bundle.certificate._crossCheck = {
          fingerprintMatch: submitted.fingerprint === bundle.certificate.fingerprintHash,
          chainRootMatch: submitted.chainRoot === bundle.chainRoot,
        };
        json(res, bundle);
      } catch (e: any) {
        json(res, { error: `Invalid JSON: ${e.message}` }, 400);
      }
    });
    return;
  }

  // GET /verify/:sessionId/chain
  if (url.startsWith("/verify/") && url.endsWith("/chain")) {
    const sessionId = url.split("/verify/")[1]?.replace("/chain", "");
    const bundle = getVerificationBundle(sessionId);
    if ("error" in bundle) { json(res, bundle, 404); return; }
    json(res, {
      sessionId: bundle.sessionId,
      chainRoot: bundle.chainRoot,
      events: bundle.hashChain.map((hash, i) => ({
        index: i,
        hash,
        prevHash: i > 0 ? bundle.hashChain[i - 1] : "(genesis)",
      })),
      tampered: bundle.tampered,
      verifiedAt: bundle.verifiedAt,
    });
    return;
  }

  // GET /verify/:sessionId/certificate
  if (url.startsWith("/verify/") && url.endsWith("/certificate")) {
    const sessionId = url.split("/verify/")[1]?.replace("/certificate", "");
    const bundle = getVerificationBundle(sessionId);
    if ("error" in bundle) { json(res, bundle, 404); return; }
    json(res, bundle.certificate);
    return;
  }

  // GET /verify/:sessionId/policy
  if (url.startsWith("/verify/") && url.endsWith("/policy")) {
    const sessionId = url.split("/verify/")[1]?.replace("/policy", "");
    const bundle = getVerificationBundle(sessionId);
    if ("error" in bundle) { json(res, bundle, 404); return; }
    json(res, bundle.policy);
    return;
  }

  // GET /verify/:sessionId
  if (url.startsWith("/verify/")) {
    const sessionId = url.split("/verify/")[1];
    const bundle = getVerificationBundle(sessionId);
    if ("error" in bundle) { json(res, bundle, 404); return; }
    json(res, bundle);
    return;
  }

  // 404
  json(res, { error: "Not found" }, 404);
});

// ═══════════════════════════════════════════════════════════════
// Home Page
// ═══════════════════════════════════════════════════════════════

function renderHomePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Progmune Verification API</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#d4d4d4;max-width:720px;margin:40px auto;padding:20px}
h1{color:#fff;font-size:20px;margin-bottom:8px}
.sub{color:#666;font-size:13px;margin-bottom:32px}
.endpoint{background:#111;border:1px solid #222;border-radius:8px;padding:16px;margin-bottom:12px}
.endpoint .method{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:8px}
.method.get{background:#052e16;color:#22c55e}
.method.post{background:#1e3a5f;color:#60a5fa}
.endpoint .path{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;color:#fff}
.endpoint .desc{font-size:12px;color:#888;margin-top:6px}
pre{background:#111;border-radius:8px;padding:16px;overflow-x:auto;font-size:12px;margin-top:8px;color:#a5d6ff}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #222;font-size:11px;color:#444;text-align:center}
a{color:#60a5fa}
</style>
</head>
<body>
<h1>Progmune Verification API</h1>
<div class="sub">Independent AI Code Certificate Verification — no installation required</div>

<div class="endpoint">
  <span class="method get">GET</span>
  <span class="path">/verify/:sessionId</span>
  <div class="desc">Full verification bundle — certificate + provenance + accountability + hash chain</div>
</div>

<div class="endpoint">
  <span class="method get">GET</span>
  <span class="path">/verify/:sessionId/chain</span>
  <div class="desc">Hash chain only — for independent cryptographic verification</div>
</div>

<div class="endpoint">
  <span class="method get">GET</span>
  <span class="path">/verify/:sessionId/certificate</span>
  <div class="desc">Certificate data only</div>
</div>

<div class="endpoint">
  <span class="method post">POST</span>
  <span class="path">/verify</span>
  <div class="desc">Submit certificate JSON for cross-check verification against stored data</div>
</div>

<div class="endpoint">
  <span class="method get">GET</span>
  <span class="path">/health</span>
  <div class="desc">Service health check</div>
</div>

<h3 style="margin-top:24px;color:#fff">Example</h3>
<pre>curl https://progmune.io/verify/sess_1780064610038_5va68

{
  "verified": true,
  "sessionId": "sess_1780064610038_5va68",
  "tampered": false,
  "chainRoot": "8cec46ccc8b0e2cb",
  "hashChain": ["88a2...", "25b7...", "d5f6..."],
  "detail": "✅ Verified — certificate is authentic"
}</pre>

<div class="footer">
  Progmune Runtime — AI Generated Software Governance
  · <a href="https://github.com/shenlian19831109/progmune-runtime">GitHub</a>
</div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════

server.listen(PORT, () => {
  console.error(`\n  Verification API: http://localhost:${PORT}`);
  console.error(`  Health:           http://localhost:${PORT}/health`);
  console.error(`  Verify session:   http://localhost:${PORT}/verify/<sessionId>\n`);
});
