/**
 * Phase 12: Governance Dashboard
 *
 * CEO/CISO-ready web dashboard for AI Code Governance.
 * Shows the 4 key metrics, risk level, and recent activity.
 *
 * Usage:
 *   npx ts-node src/governance-dashboard.ts
 *   PROGMUNE_DASH_PORT=3200 npx ts-node src/governance-dashboard.ts
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";

const PORT = parseInt(process.env.PROGMUNE_DASH_PORT || "3200", 10);

// ═══════════════════════════════════════════════════════════════
// Data API
// ═══════════════════════════════════════════════════════════════

function getDashboardData(): any {
  const { getAllSessions, getAntibodyStats } = require("./failure-corpus");
  const { verifyAllFingerprints } = require("./ledger-registry");
  const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("./plsb-benchmark");

  const sessions = getAllSessions();
  const fpSummary = verifyAllFingerprints();
  const abStats = getAntibodyStats();
  const benchmark = buildPLSB();
  const taxonomy = PROTOCOL_WEAKNESS_TAXONOMY as any[];
  const byPLS = benchmark.metadata?.byPLS || {};

  // Per-session analysis
  let validated = 0;
  let failed = 0;
  let tampered = 0;
  let totalTransitions = 0;

  for (const s of sessions) {
    let trans: any[] = [];
    for (const a of s.attempts || []) trans = trans.concat(a.transitions || []);
    totalTransitions += trans.length;

    const hasViolations = (s.attempts || []).some(
      (a: any) => (a.violations || []).length > 0
    );
    if (hasViolations) failed++;
    else validated++;
  }

  tampered = fpSummary.tampered || 0;

  // Risk level
  const total = sessions.length;
  let riskLevel = "PASS";
  let riskColor = "#22c55e";
  if (tampered > 0) {
    riskLevel = "FAIL";
    riskColor = "#ef4444";
  } else if (total > 0 && validated / total < 0.85) {
    riskLevel = "WARN";
    riskColor = "#f59e0b";
  } else if (failed > total * 0.1) {
    riskLevel = "WARN";
    riskColor = "#f59e0b";
  }

  // PLSB
  const covered = taxonomy.filter((t: any) => (byPLS[t.id] || 0) > 0).length;

  // Recent sessions
  const recent = sessions
    .filter((s: any) => s.attempts?.length > 0)
    .slice(-10)
    .reverse()
    .map((s: any) => {
      let trans = 0;
      let viols = 0;
      for (const a of s.attempts || []) {
        trans += (a.transitions || []).length;
        viols += (a.violations || []).length;
      }
      return {
        sessionId: s.sessionId?.slice(0, 24),
        intent: (s.intent || "").slice(0, 50),
        transitions: trans,
        violations: viols,
        outcome: viols === 0 ? "pass" : "violation",
      };
    });

  return {
    timestamp: new Date().toISOString(),
    risk: { level: riskLevel, color: riskColor },
    assets: {
      total: total,
      validated: validated,
      failed: failed,
      tampered: tampered,
    },
    transitions: totalTransitions,
    fingerprints: {
      total: fpSummary.total || 0,
      verified: fpSummary.valid || 0,
      tampered: fpSummary.tampered || 0,
    },
    antibodies: {
      totalHits: abStats.totalHits || 0,
      fastPath: abStats.fastPathHits || 0,
      llmSaved: abStats.totalLLMCallsSaved || 0,
      tokensSaved: abStats.totalTokensSaved || 0,
    },
    plsb: {
      version: benchmark.version || "1.0",
      entries: benchmark.metadata?.total || 0,
      categoriesCovered: covered,
      categoriesTotal: taxonomy.length,
      recall: ((benchmark.metadata?.recall || 0) * 100).toFixed(0),
    },
    recent,
  };
}

// ═══════════════════════════════════════════════════════════════
// HTML Template
// ═══════════════════════════════════════════════════════════════

function renderHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="30">
<title>Progmune Governance Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:#0a0a0a;color:#d4d4d4;min-height:100vh
}
.header{
  background:#111;border-bottom:1px solid #222;padding:16px 24px;
  display:flex;justify-content:space-between;align-items:center
}
.header h1{font-size:18px;font-weight:600;color:#fff}
.header .sub{font-size:12px;color:#666}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px;max-width:1200px;margin:0 auto}
.metric{
  background:#111;border:1px solid #222;border-radius:8px;padding:20px;
  text-align:center
}
.metric .value{font-size:36px;font-weight:700;line-height:1.2}
.metric .label{font-size:12px;color:#666;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px}
.risk-banner{
  max-width:1200px;margin:0 auto;padding:0 24px 16px;
  display:flex;justify-content:center
}
.risk-badge{
  padding:12px 32px;border-radius:8px;font-size:16px;font-weight:700;
  text-align:center;min-width:300px
}
.section{max-width:1200px;margin:0 auto;padding:0 24px 24px}
.section h2{font-size:14px;color:#888;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card{
  background:#111;border:1px solid #222;border-radius:8px;padding:16px
}
.card .title{font-size:12px;color:#666;margin-bottom:8px;text-transform:uppercase}
.card .big{font-size:24px;font-weight:600;color:#fff}
.card .detail{font-size:12px;color:#888;margin-top:4px}
table{width:100%;border-collapse:collapse}
table th{text-align:left;font-size:11px;color:#666;padding:8px 12px;border-bottom:1px solid #222}
table td{font-size:13px;padding:8px 12px;border-bottom:1px solid #111}
table tr:hover td{background:#151515}
.tag{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.tag-pass{background:#052e16;color:#22c55e}
.tag-fail{background:#450a0a;color:#ef4444}
.footer{text-align:center;padding:24px;color:#444;font-size:11px}
.bar{height:6px;border-radius:3px;background:#222;margin-top:8px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px;transition:width .3s}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>Progmune Governance</h1>
    <div class="sub">AI Code Governance Dashboard</div>
  </div>
  <div class="sub" id="time">—</div>
</div>
<div id="app">Loading...</div>
<div class="footer">
  Progmune Runtime — AI Generated Software Governance
  &nbsp;·&nbsp;
  <a href="https://github.com/shenlian19831109/progmune-runtime" style="color:#666">GitHub</a>
</div>
<script>
async function load() {
  try {
    const r = await fetch('/api/dashboard');
    const d = await r.json();
    render(d);
  } catch(e) {
    document.getElementById('app').innerHTML =
      '<div style="text-align:center;padding:60px;color:#ef4444">⚠️ Unable to load dashboard data</div>';
  }
}

function render(d) {
  document.getElementById('time').textContent =
    new Date(d.timestamp).toLocaleString();

  const pct = d.assets.total > 0
    ? Math.round(d.assets.validated / d.assets.total * 100) : 0;

  const html = '<div class="risk-banner">' +
    '<div class="risk-badge" style="background:'+d.risk.color+'15;color:'+d.risk.color+';border:1px solid '+d.risk.color+'40">' +
    'Risk Level: <strong>' + d.risk.level + '</strong>' +
    '</div></div>' +

    '<div class="grid">' +
    metric(d.assets.total, 'AI Assets', '#fff', 'Total AI-generated code files tracked') +
    metric(d.assets.validated, 'Verified', '#22c55e', pct+'% validation rate') +
    metric(d.assets.failed, 'Failed', '#f59e0b', d.assets.failed + ' files with violations') +
    metric(d.assets.tampered, 'Tampered', '#ef4444', d.assets.tampered + ' broken provenance chains') +
    '</div>' +

    '<div class="section"><h2>System Overview</h2><div class="cards">' +
    card('Fingerprints', d.fingerprints.verified + ' / ' + d.fingerprints.total,
      d.fingerprints.tampered + ' tampered',
      (d.fingerprints.total > 0 ? Math.round(d.fingerprints.verified/d.fingerprints.total*100) : 0) + '%') +
    card('PLSB Coverage', d.plsb.categoriesCovered + ' / ' + d.plsb.categoriesTotal,
      d.plsb.entries + ' entries · recall ' + d.plsb.recall + '%',
      Math.round(d.plsb.categoriesCovered/d.plsb.categoriesTotal*100) + '%') +
    card('Immune System', d.antibodies.totalHits + ' hits',
      d.antibodies.llmSaved + ' LLM calls · ' + (d.antibodies.tokensSaved||0).toLocaleString() + ' tokens saved',
      (d.antibodies.totalHits > 0 ? Math.round(d.antibodies.fastPath/d.antibodies.totalHits*100) : 0) + '% fast-path') +
    '</div></div>' +

    '<div class="section"><h2>Recent Activity</h2>' +
    '<table><tr><th>Session</th><th>Intent</th><th>Transitions</th><th>Status</th></tr>' +
    d.recent.map(s =>
      '<tr>' +
      '<td style="font-family:monospace;font-size:11px">' + esc(s.sessionId) + '</td>' +
      '<td>' + esc(s.intent) + '</td>' +
      '<td>' + s.transitions + '</td>' +
      '<td><span class="tag '+(s.outcome==='pass'?'tag-pass':'tag-fail')+'">' +
      (s.outcome==='pass' ? '✓ PASS' : '✗ '+s.violations+' violations') +
      '</span></td></tr>'
    ).join('') +
    '</table></div>';

  document.getElementById('app').innerHTML = html;
}

function metric(value, label, color, detail) {
  return '<div class="metric">' +
    '<div class="value" style="color:'+color+'">' + value.toLocaleString() + '</div>' +
    '<div class="label">' + label + '</div>' +
    '<div style="font-size:11px;color:#555;margin-top:4px">' + detail + '</div>' +
    '</div>';
}

function card(title, big, detail, pct) {
  return '<div class="card">' +
    '<div class="title">' + title + '</div>' +
    '<div class="big">' + big + '</div>' +
    '<div class="detail">' + detail + '</div>' +
    '<div class="bar"><div class="bar-fill" style="width:'+pct+';background:#333"></div></div>' +
    '</div>';
}

function esc(s) { const d=document.createElement('div');d.textContent=s||'';return d.innerHTML }

load();
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
  const url = req.url || "/";

  // API: dashboard data
  if (url === "/api/dashboard") {
    try {
      const data = getDashboardData();
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(data));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // HTML: dashboard page
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderHTML());
});

server.listen(PORT, () => {
  console.error(`\n  Governance Dashboard: http://localhost:${PORT}\n`);
});
