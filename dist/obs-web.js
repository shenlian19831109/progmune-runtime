"use strict";
/**
 * Semantic Observatory — Web Dashboard
 *
 * Usage:
 *   ts-node src/obs-web.ts                → start server on default port 3100
 *   ts-node src/obs-web.ts --port 8080    → custom port
 *   PROGMUNE_OBS_PORT=4000 ts-node ...    → env var override
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
const http = __importStar(require("http"));
const failure_corpus_1 = require("./failure-corpus");
const ssg_validator_1 = require("./ssg-validator");
const ledger_registry_1 = require("./ledger-registry");
const deterministic_replay_1 = require("./deterministic-replay");
const branch_ledger_1 = require("./branch-ledger");
const PORT = parseInt(process.env.PROGMUNE_OBS_PORT || process.argv[3] || "3100", 10);
// ── JSON API handlers ──
function jsonReply(res, data, code = 200) {
    res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(data));
}
const apiRoutes = {
    "/api/sessions": () => (0, failure_corpus_1.getAllSessions)(),
    "/api/genome": () => (0, failure_corpus_1.getFailureGenome)(),
    "/api/heatmap": () => (0, failure_corpus_1.getSemanticHeatmap)(),
    "/api/antibodies": () => (0, failure_corpus_1.getAntibodyStats)(),
    "/api/learned": () => (0, failure_corpus_1.getLearnedPatterns)(),
};
function handleAPI(req, res) {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const pathname = url.pathname;
    // Single session lookup: /api/sessions/sess_...
    if (pathname.startsWith("/api/sessions/")) {
        const sessionId = pathname.slice("/api/sessions/".length);
        if (sessionId) {
            const sessions = (0, failure_corpus_1.getAllSessions)();
            const session = sessions.find((s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
            if (session)
                return jsonReply(res, session);
            return jsonReply(res, { error: "not found" }, 404);
        }
    }
    // Phase 4 Ledger APIs
    if (pathname === "/api/ledger")
        return handleLedgerAPI(res, url);
    if (pathname === "/api/consistency")
        return handleConsistencyAPI(res, url);
    if (pathname === "/api/diff")
        return handleDiffAPI(res, url);
    if (pathname === "/api/replay")
        return handleReplayAPI(res, url);
    if (pathname === "/api/fingerprints")
        return jsonReply(res, (0, ledger_registry_1.getFingerprintRegistry)());
    const handler = apiRoutes[pathname];
    if (handler) {
        try {
            return jsonReply(res, handler(url));
        }
        catch (e) {
            return jsonReply(res, { error: e.message }, 500);
        }
    }
    return jsonReply(res, { error: "not found" }, 404);
}
// ── Phase 4 Ledger API handlers ──
function getSessionTransitions(session) {
    if (session.branchTree && session.branchTree.length > 0) {
        const map = (0, branch_ledger_1.buildBranchMap)(session.branchTree);
        const root = (0, branch_ledger_1.findRootBranch)(session.branchTree);
        if (root)
            return (0, branch_ledger_1.flattenBranch)(root, map);
    }
    let tx = [];
    for (const a of (session.attempts || [])) {
        tx = tx.concat(a.transitions || []);
    }
    return tx;
}
function handleLedgerAPI(res, url) {
    const sid = url.searchParams.get("sessionId");
    if (!sid)
        return jsonReply(res, { error: "missing sessionId" }, 400);
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const s = sessions.find(x => x.sessionId === sid || x.sessionId.startsWith(sid));
    if (!s)
        return jsonReply(res, { error: "session not found" }, 404);
    const tx = getSessionTransitions(s);
    const consistency = (0, ssg_validator_1.checkLedgerConsistency)(tx, new Map([["_global", "UNAUTHENTICATED"]]));
    return jsonReply(res, {
        sessionId: s.sessionId, intent: s.intent,
        transitionCount: tx.length, hash: (0, ssg_validator_1.hashLedger)(tx),
        consistency: { consistent: consistency.consistent, violationCount: consistency.violations.length },
        transitions: tx,
    });
}
function handleConsistencyAPI(res, url) {
    const sid = url.searchParams.get("sessionId");
    if (!sid)
        return jsonReply(res, { error: "missing sessionId" }, 400);
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const s = sessions.find(x => x.sessionId === sid || x.sessionId.startsWith(sid));
    if (!s)
        return jsonReply(res, { error: "session not found" }, 404);
    return jsonReply(res, (0, ssg_validator_1.checkLedgerConsistency)(getSessionTransitions(s), new Map([["_global", "UNAUTHENTICATED"]])));
}
function handleDiffAPI(res, url) {
    const aId = url.searchParams.get("sessionA"), bId = url.searchParams.get("sessionB");
    if (!aId || !bId)
        return jsonReply(res, { error: "missing sessionA or sessionB" }, 400);
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const sA = sessions.find(x => x.sessionId === aId || x.sessionId.startsWith(aId));
    const sB = sessions.find(x => x.sessionId === bId || x.sessionId.startsWith(bId));
    if (!sA || !sB)
        return jsonReply(res, { error: "session not found" }, 404);
    const diff = (0, ssg_validator_1.diffLedgers)(getSessionTransitions(sA), getSessionTransitions(sB));
    return jsonReply(res, { sessionA: { id: sA.sessionId, intent: sA.intent }, sessionB: { id: sB.sessionId, intent: sB.intent }, diff });
}
function handleReplayAPI(res, url) {
    const sid = url.searchParams.get("sessionId");
    if (!sid)
        return jsonReply(res, { error: "missing sessionId" }, 400);
    return jsonReply(res, (0, deterministic_replay_1.replaySession)(sid));
}
// ── Dashboard HTML ──
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Progmune Observatory</title>
<style>
  :root { --bg:#0d1117; --surface:#161b22; --border:#30363d; --text:#c9d1d9; --dim:#8b949e;
          --green:#3fb950; --red:#f85149; --yellow:#d2991d; --cyan:#58a6ff; --purple:#bc8cff; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif; background:var(--bg); color:var(--text); padding:24px; }
  h1 { font-size:20px; margin-bottom:20px; }
  h2 { font-size:16px; margin:24px 0 12px; color:var(--cyan); }
  .tab-bar { display:flex; gap:4px; margin-bottom:20px; flex-wrap:wrap; }
  .tab { padding:6px 16px; border:1px solid var(--border); border-radius:6px; cursor:pointer; background:var(--surface); color:var(--dim); font-size:13px; }
  .tab:hover { color:var(--text); border-color:var(--dim); }
  .tab.active { color:var(--cyan); border-color:var(--cyan); }
  .panel { display:none; }
  .panel.active { display:block; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:12px; }
  .flex { display:flex; gap:16px; flex-wrap:wrap; }
  .stat { flex:1; min-width:140px; }
  .stat .value { font-size:28px; font-weight:700; }
  .stat .label { font-size:12px; color:var(--dim); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--border); }
  th { color:var(--dim); font-weight:500; }
  .badge { display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px; font-weight:600; }
  .badge-green { background:#1a4020; color:var(--green); }
  .badge-red { background:#3d1f1f; color:var(--red); }
  .badge-yellow { background:#3d351a; color:var(--yellow); }
  .bar-wrap { background:var(--border); border-radius:4px; height:18px; overflow:hidden; min-width:60px; }
  .bar-fill { height:100%; border-radius:4px; transition:width .4s; }
  .loading { color:var(--dim); padding:40px; text-align:center; }
  pre { font-size:12px; background:var(--bg); padding:12px; border-radius:6px; overflow-x:auto; max-height:400px; }
  .timeline-step { padding:8px 0 8px 20px; border-left:2px solid var(--border); margin-left:8px; }
  .timeline-step.ok { border-color:var(--green); }
  .timeline-step.fail { border-color:var(--red); }
  .fn { color:var(--cyan); font-family:monospace; }
  .state-delta { font-size:12px; color:var(--dim); }
  .state-add { color:var(--green); }
  .state-rem { color:var(--red); }
</style>
</head>
<body>
<h1>Progmune Semantic Observatory</h1>

<div class="tab-bar">
  <button class="tab active" data-panel="overview">Overview</button>
  <button class="tab" data-panel="sessions">Sessions</button>
  <button class="tab" data-panel="genome">Genome</button>
  <button class="tab" data-panel="heatmap">Heatmap</button>
  <button class="tab" data-panel="antibodies">Antibodies</button>
  <button class="tab" data-panel="ledger">Ledger</button>
</div>

<div id="overview" class="panel active"><div class="loading">Loading...</div></div>
<div id="sessions" class="panel"><div class="loading">Loading...</div></div>
<div id="genome" class="panel"><div class="loading">Loading...</div></div>
<div id="heatmap" class="panel"><div class="loading">Loading...</div></div>
<div id="antibodies" class="panel"><div class="loading">Loading...</div></div>
<div id="ledger" class="panel"><div class="loading">Loading...</div></div>

<script>
async function fetchJSON(u) {
  const r = await fetch(u);
  return r.json();
}

async function loadOverview() {
  const [sessions, antibodies] = await Promise.all([
    fetchJSON('/api/sessions'),
    fetchJSON('/api/antibodies'),
  ]);
  const resolved = sessions.filter(s => s.resolved).length;
  const totalAttempts = sessions.reduce((n,s) => n + s.attempts.length, 0);
  const totalViolations = sessions.reduce((n,s) => n + s.attempts.reduce((m,a) => m + a.violations.length, 0), 0);

  let html = '<div class="flex">' +
    '<div class="card stat"><div class="value" style="color:var(--cyan)">' + sessions.length + '</div><div class="label">Total Sessions</div></div>' +
    '<div class="card stat"><div class="value" style="color:var(--green)">' + resolved + '</div><div class="label">Resolved</div></div>' +
    '<div class="card stat"><div class="value" style="color:var(--yellow)">' + totalAttempts + '</div><div class="label">Attempts</div></div>' +
    '<div class="card stat"><div class="value" style="color:var(--red)">' + totalViolations + '</div><div class="label">Violations</div></div>' +
    '<div class="card stat"><div class="value" style="color:var(--purple)">' + antibodies.totalLLMCallsSaved + '</div><div class="label">LLM Calls Saved</div></div>' +
    '</div>';

  if (sessions.length > 0) {
    html += '<h2>Recent Sessions</h2>';
    for (const s of sessions.slice(-5).reverse()) {
      const failed = s.attempts.filter(a => a.outcome !== "success").length;
      const icon = s.resolved ? '<span class="badge badge-green">resolved</span>' : '<span class="badge badge-red">unresolved</span>';
      html += '<div class="card"><strong>' + esc(s.intent) + '</strong> ' + icon +
        ' &nbsp;<span style="color:var(--dim)">' + failed + ' retries</span>' +
        ' <span style="float:right;color:var(--dim);font-size:12px">' + s.sessionId.slice(0,13) + '...</span></div>';
    }
  }
  document.getElementById('overview').innerHTML = html;
}

async function loadSessions() {
  const sessions = await fetchJSON('/api/sessions');
  let html = '<div class="card"><table><tr><th>Session</th><th>Intent</th><th>Attempts</th><th>Violations</th><th>Status</th></tr>';
  for (const s of sessions.reverse()) {
    const failed = s.attempts.filter(a => a.outcome !== "success").length;
    const viols = s.attempts.reduce((n,a) => n + a.violations.length, 0);
    const icon = s.resolved ? '<span class="badge badge-green">resolved</span>' : '<span class="badge badge-red">failed</span>';
    const abHit = s.attempts.some(a => a.antibodyHit) ? ' <span class="badge badge-yellow">Ab</span>' : '';
    html += '<tr><td style="font-family:monospace;font-size:11px;color:var(--dim)">' + s.sessionId.slice(0,13) + '...</td>' +
      '<td><a href="#" onclick="showSession(\'' + s.sessionId + '\');return false" style="color:var(--cyan)">' + esc(s.intent.slice(0,50)) + '</a></td>' +
      '<td>' + s.attempts.length + '</td><td>' + viols + '</td><td>' + icon + abHit + '</td></tr>';
  }
  html += '</table></div>';
  document.getElementById('sessions').innerHTML = html;
}

async function showSession(id) {
  const s = await fetchJSON('/api/sessions/' + id);
  let html = '<div class="card"><h2>' + esc(s.intent) + '</h2>';
  html += '<span style="color:var(--dim)">Session: ' + s.sessionId + ' | ';
  html += 'Resolved: ' + (s.resolved ? '<span class="badge badge-green">yes</span>' : '<span class="badge badge-red">no</span>') + '</span></div>';

  for (const a of s.attempts) {
    const icon = a.outcome === "success" ? '✅' : '❌';
    const cls = a.outcome === "success" ? 'ok' : 'fail';
    html += '<div class="card"><strong>' + icon + ' Attempt ' + a.attemptNumber + '</strong>';
    html += ' <span style="color:var(--dim)">(' + a.outcome + ')</span>';

    if (a.antibodyHit) {
      html += ' <span class="badge badge-yellow">Ab: ' + a.antibodyHit.level + ' ' + a.antibodyHit.action + '</span>';
    }

    // Action sequence
    const fns = (a.generatedActions || []).filter(x => x.kind === "call" && x.function);
    if (fns.length > 0) {
      html += '<div style="margin-top:8px">';
      for (const fn of fns) {
        html += '<span class="fn">' + esc(fn.function) + '()</span> &rarr; ';
      }
      html += '</div>';
    }

    // Transitions
    if (a.transitions && a.transitions.length > 0) {
      html += '<div style="margin-top:8px">';
      for (const t of a.transitions) {
        const gained = (t.acquired||[]).map(s => '<span class="state-add">+' + s + '</span>').join(' ');
        const lost = (t.invalidated||[]).map(s => '<span class="state-rem">-' + s + '</span>').join(' ');
        html += '<div class="timeline-step ' + (t.valid ? 'ok' : 'fail') + '">' +
          '<span class="fn">' + esc(t.function) + '()</span>' +
          ' <span class="state-delta">' + gained + ' ' + lost + '</span></div>';
      }
      html += '</div>';
    }

    // Violations
    for (const v of a.violations) {
      html += '<div style="margin-top:6px;padding:8px;background:var(--bg);border-radius:4px">';
      html += '<span class="badge badge-red">SVL-' + v.svl + '</span> ';
      html += '<span style="color:var(--dim)">' + esc(v.violatedConstraint) + '</span>: ' + esc(v.description.slice(0, 120)) + '';
      if (v.fixPath && v.fixPath.length) {
        html += '<div style="font-size:12px;color:var(--yellow);margin-top:2px">Fix: ' + v.fixPath.join(' → ') + '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
  }

  document.getElementById('sessions').innerHTML = html + '<br><a href="#" onclick="loadSessions();return false" style="color:var(--cyan)">← Back to list</a>';
}

async function loadGenome() {
  const g = await fetchJSON('/api/genome');
  if (g.totalFailures === 0) {
    document.getElementById('genome').innerHTML = '<div class="card">No failures recorded yet.</div>';
    return;
  }
  const max = Math.max(g.bySVL['SVL-1']||0, g.bySVL['SVL-2']||0, g.bySVL['SVL-3']||0, g.bySVL['SVL-4']||0) || 1;
  const bar = (n,color) => '<div class="bar-wrap"><div class="bar-fill" style="width:'+(n/max*100)+'%;background:'+color+'"></div></div>';

  let html = '<div class="flex">' +
    '<div class="card stat"><div class="value" style="color:var(--red)">'+g.totalFailures+'</div><div class="label">Total Failures</div></div>' +
    '<div class="card stat"><div class="value" style="color:var(--yellow)">'+g.averageRetriesToSuccess+'</div><div class="label">Avg Retries</div></div>' +
    '</div>';

  html += '<h2>By SVL Level</h2><div class="card"><table>';
  for (const [svl, count] of [['SVL-1',g.bySVL['SVL-1']],['SVL-2',g.bySVL['SVL-2']],['SVL-3',g.bySVL['SVL-3']],['SVL-4',g.bySVL['SVL-4']]]) {
    html += '<tr><td>'+svl+'</td><td>'+bar(count, count===max?'var(--red)':'var(--yellow)')+'</td><td>'+count+'</td></tr>';
  }
  html += '</table></div>';

  if (g.commonFixPaths.length) {
    html += '<h2>Common Repair Paths</h2><div class="card"><table>';
    for (const fp of g.commonFixPaths.slice(0,5)) {
      html += '<tr><td style="color:var(--yellow)">'+fp.fixPath.join(' → ')+'</td><td>'+fp.count+'x</td></tr>';
    }
    html += '</table></div>';
  }

  document.getElementById('genome').innerHTML = html;
}

async function loadHeatmap() {
  const h = await fetchJSON('/api/heatmap');
  let html = '';

  if (h.svlHotspots && h.svlHotspots.length) {
    const maxC = Math.max(...h.svlHotspots.map(s=>s.count),1);
    html += '<h2>SVL Hotspots</h2><div class="card"><table>';
    for (const s of h.svlHotspots) {
      const pct = s.percentage + '%';
      html += '<tr><td>'+s.svl+'</td><td><div class="bar-wrap"><div class="bar-fill" style="width:'+(s.count/maxC*100)+'%;background:var(--red)"></div></div></td><td>'+s.count+' ('+pct+')</td></tr>';
    }
    html += '</table></div>';
  }

  if (h.fragileProtocols && h.fragileProtocols.length) {
    html += '<h2>Fragile Protocols</h2><div class="card"><table>';
    for (const fp of h.fragileProtocols.slice(0,8)) {
      html += '<tr><td class="fn">'+esc(fp.function)+'()</td><td>'+fp.violationCount+'x</td><td>'+fp.svl+'</td></tr>';
    }
    html += '</table></div>';
  }

  document.getElementById('heatmap').innerHTML = html || '<div class="card">No heatmap data yet.</div>';
}

async function loadAntibodies() {
  const stats = await fetchJSON('/api/antibodies');
  let html = '<div class="flex">' +
    '<div class="card stat"><div class="value" style="color:var(--green)">'+stats.fastPathHits+'</div><div class="label">Fast-Path Hits</div></div>' +
    '<div class="card stat"><div class="value" style="color:var(--yellow)">'+stats.injectedHintHits+'</div><div class="label">Hint Injections</div></div>' +
    '<div class="card stat"><div class="value" style="color:var(--cyan)">'+stats.totalLLMCallsSaved+'</div><div class="label">LLM Calls Saved</div></div>' +
    '<div class="card stat"><div class="value" style="color:var(--purple)">'+(stats.totalTokensSaved||0).toLocaleString()+'</div><div class="label">Tokens Saved</div></div>' +
    '</div>';

  if (Object.keys(stats.byLevel).length) {
    html += '<h2>By Level</h2><div class="card"><table>';
    for (const lvl of ['ACL-4','ACL-3','ACL-2','ACL-1']) {
      const d = stats.byLevel[lvl];
      if (!d) continue;
      html += '<tr><td>'+lvl+'</td><td>'+d.hits+' hits</td><td>'+d.llmSaved+' LLM saved</td><td>'+(d.tokensSaved||0).toLocaleString()+' tokens</td></tr>';
    }
    html += '</table></div>';
  }

  document.getElementById('antibodies').innerHTML = html || '<div class="card">No antibody activity yet.</div>';
}

async function loadLedger() {
  const sessions = await fetchJSON('/api/sessions');
  // Session selector
  let html = '<div class="card"><h2>Ledger Timeline</h2>';
  html += '<select id="ledgerSession" style="background:var(--bg);color:var(--text);padding:6px;border:1px solid var(--border);border-radius:4px;margin-bottom:12px;width:100%">';
  html += '<option value="">-- Select session --</option>';
  for (const s of sessions.reverse()) {
    html += '<option value="' + s.sessionId + '">' + s.sessionId.slice(0,13) + '... — ' + esc(s.intent.slice(0,60)) + '</option>';
  }
  html += '</select>';
  html += '<div id="ledgerDetail"></div></div>';

  // Session Diff
  html += '<div class="card" style="margin-top:12px"><h2>Session Diff</h2>';
  html += '<div style="display:flex;gap:8px">';
  html += '<select id="diffSessionA" style="flex:1;background:var(--bg);color:var(--text);padding:6px;border:1px solid var(--border);border-radius:4px"><option value="">-- Session A --</option>';
  for (const s of sessions) {
    html += '<option value="' + s.sessionId + '">' + s.sessionId.slice(0,13) + '...</option>';
  }
  html += '</select>';
  html += '<select id="diffSessionB" style="flex:1;background:var(--bg);color:var(--text);padding:6px;border:1px solid var(--border);border-radius:4px"><option value="">-- Session B --</option>';
  for (const s of sessions) {
    html += '<option value="' + s.sessionId + '">' + s.sessionId.slice(0,13) + '...</option>';
  }
  html += '</select>';
  html += '<button onclick="showDiff()" style="background:var(--cyan);color:#000;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:600">Diff</button>';
  html += '</div>';
  html += '<div id="diffResult" style="margin-top:8px"></div></div>';

  document.getElementById('ledger').innerHTML = html;

  // Bind selector
  document.getElementById('ledgerSession').addEventListener('change', function() {
    if (this.value) showTimeline(this.value);
  });
}

async function showTimeline(sessionId) {
  const data = await fetchJSON('/api/ledger?sessionId=' + sessionId);
  const detail = document.getElementById('ledgerDetail');

  let html = '<div style="color:var(--dim);margin-bottom:8px">' +
    'Transitions: <strong style="color:var(--text)">' + data.transitionCount + '</strong> | ' +
    'Hash: <code style="color:var(--cyan)">' + data.hash + '</code> | ' +
    (data.consistency.consistent
      ? '<span class="badge badge-green">Consistent</span>'
      : '<span class="badge badge-red">' + data.consistency.violationCount + ' violations</span>') +
    '</div>';

  // Timeline table
  html += '<table><tr><th>#</th><th>Function</th><th>Namespace</th><th>Valid</th><th>Acquired</th><th>Invalidated</th></tr>';
  for (const t of data.transitions) {
    const validBadge = t.valid
      ? '<span class="badge badge-green">✓</span>'
      : '<span class="badge badge-red">✗</span>';
    const acquired = (t.acquired||[]).map(s => '<span style="color:var(--green)">+' + esc(s) + '</span>').join(' ') || '—';
    const invalidated = (t.invalidated||[]).map(s => '<span style="color:var(--red)">-' + esc(s) + '</span>').join(' ') || '—';
    html += '<tr>' +
      '<td style="color:var(--dim)">' + t.actionIndex + '</td>' +
      '<td><span class="fn">' + esc(t.function) + '()</span></td>' +
      '<td style="color:var(--dim)">' + esc(t.namespace) + '</td>' +
      '<td>' + validBadge + '</td>' +
      '<td style="font-size:12px">' + acquired + '</td>' +
      '<td style="font-size:12px">' + invalidated + '</td>' +
      '</tr>';
  }
  html += '</table>';

  // States before/after summary for last transition
  if (data.transitions.length > 0) {
    const last = data.transitions[data.transitions.length - 1];
    html += '<div style="margin-top:12px;font-size:12px;color:var(--dim)">';
    html += '<strong>Final State:</strong> ';
    for (const [ns, states] of Object.entries(last.statesAfter || {})) {
      html += '<span style="color:var(--cyan)">' + esc(ns) + '</span>=[<span style="color:var(--text)">' + (states as string[]).join(', ') + '</span>] ';
    }
    html += '</div>';
  }

  detail.innerHTML = html;
}

async function showDiff() {
  const a = document.getElementById('diffSessionA').value;
  const b = document.getElementById('diffSessionB').value;
  if (!a || !b) return;

  const data = await fetchJSON('/api/diff?sessionA=' + a + '&sessionB=' + b);
  const d = data.diff;
  let html = '<div style="margin-top:8px">';
  html += '<span style="color:var(--dim)">Unchanged: </span><strong>' + d.unchanged + '</strong> | ';
  html += '<span style="color:var(--yellow)">Only A: </span><strong>' + d.onlyInA + '</strong> | ';
  html += '<span style="color:var(--cyan)">Only B: </span><strong>' + d.onlyInB + '</strong> | ';
  html += '<span style="color:var(--red)">Changed: </span><strong>' + d.changed + '</strong>';
  if (d.identical) html += ' <span class="badge badge-green">Identical</span>';
  html += '</div>';
  document.getElementById('diffResult').innerHTML = html;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Tab switching
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.panel).classList.add('active');
  });
});

// Initial load
loadOverview();
loadSessions();
loadGenome();
loadHeatmap();
loadAntibodies();
loadLedger();
</script>
</body>
</html>`;
// ── HTTP Server ──
const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
        return handleAPI(req, res);
    }
    // Serve dashboard
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
});
server.listen(PORT, () => {
    console.error(`Observatory web dashboard: http://localhost:${PORT}`);
    console.error(`API endpoints:`);
    console.error(`  GET /api/sessions`);
    console.error(`  GET /api/sessions/:id`);
    console.error(`  GET /api/genome`);
    console.error(`  GET /api/heatmap`);
    console.error(`  GET /api/antibodies`);
    console.error(`  GET /api/learned`);
    console.error(`Phase 4 Ledger APIs:`);
    console.error(`  GET /api/ledger?sessionId=`);
    console.error(`  GET /api/consistency?sessionId=`);
    console.error(`  GET /api/diff?sessionA=&sessionB=`);
    console.error(`  GET /api/replay?sessionId=`);
    console.error(`  GET /api/fingerprints`);
});
