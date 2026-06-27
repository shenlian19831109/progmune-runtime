/**
 * Knowledge API — Protocol Knowledge Base as a Service
 *
 * REST endpoints for querying the Protocol Knowledge Base.
 * External tools and customers can consume protocol knowledge
 * without installing Progmune.
 *
 * Usage:
 *   npx ts-node src/knowledge-api.ts
 *   PROGMUNE_KB_PORT=3400 npx ts-node src/knowledge-api.ts
 *
 * Endpoints:
 *   GET /knowledge/assets              — all assets
 *   GET /knowledge/assets/:id          — single asset
 *   GET /knowledge/assets/:id/versions — version history
 *   GET /knowledge/assets/:id/evidence — evidence per repo
 *   GET /knowledge/summary             — aggregate stats
 *   GET /health                        — service health
 */

import * as http from "http";
import { buildKnowledgeBase } from "./protocol-knowledge";
import { buildEvidenceRepository } from "./evidence-repository";

const PORT = parseInt(process.env.PROGMUNE_KB_PORT || "3400", 10);

function json(res: http.ServerResponse, data: any, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    res.end(); return;
  }

  // Health
  if (url === "/health") {
    json(res, { status: "ok", service: "Progmune Knowledge API", version: "1.0.0" });
    return;
  }

  // Home
  if (url === "/" || url === "") {
    html(res, renderHome());
    return;
  }

  const kb = buildKnowledgeBase();

  // GET /knowledge/summary
  if (url === "/knowledge/summary") {
    json(res, {
      ...kb.summary,
      stableAssets: kb.units.filter(a => a.maturity === "stable").map(a => a.name),
      validatedAssets: kb.units.filter(a => a.maturity === "validated").map(a => a.name),
      generated: kb.generated,
    });
    return;
  }

  // GET /knowledge/assets
  if (url === "/knowledge/assets") {
    const summary = kb.units.map(a => ({
      id: a.id, name: a.name, category: a.category,
      version: a.currentVersion, maturity: a.maturity,
      confidence: a.confidence, validatedRepos: a.validatedRepos,
      validatedSequences: a.validatedSequences,
    }));
    json(res, { total: summary.length, assets: summary });
    return;
  }

  // GET /knowledge/assets/:id/versions
  if (url.startsWith("/knowledge/assets/") && url.endsWith("/versions")) {
    const id = url.split("/knowledge/assets/")[1]?.replace("/versions", "");
    const asset = kb.units.find(a => a.id === id);
    if (!asset) { json(res, { error: "Asset not found" }, 404); return; }
    json(res, { id: asset.id, name: asset.name, currentVersion: asset.currentVersion, history: asset.versionHistory });
    return;
  }

  // GET /knowledge/assets/:id/evidence
  if (url.startsWith("/knowledge/assets/") && url.endsWith("/evidence")) {
    const id = url.split("/knowledge/assets/")[1]?.replace("/evidence", "");
    const asset = kb.units.find(a => a.id === id);
    if (!asset) { json(res, { error: "Asset not found" }, 404); return; }
    json(res, { id: asset.id, name: asset.name, evidence: asset.evidence || [] });
    return;
  }

  // GET /knowledge/assets/:id
  if (url.startsWith("/knowledge/assets/")) {
    const id = url.split("/knowledge/assets/")[1];
    const asset = kb.units.find(a => a.id === id);
    if (!asset) { json(res, { error: "Asset not found" }, 404); return; }
    json(res, asset);
    return;
  }

  // GET /knowledge/evidence
  if (url === "/knowledge/evidence") {
    const er = buildEvidenceRepository();
    json(res, er);
    return;
  }

  // GET /knowledge/evidence/:repo
  if (url.startsWith("/knowledge/evidence/")) {
    const repo = url.split("/knowledge/evidence/")[1];
    const er = buildEvidenceRepository();
    const record = er.repos.find(r => r.repo === repo);
    if (!record) { json(res, { error: "Repo not found" }, 404); return; }
    json(res, record);
    return;
  }

  // 404
  json(res, { error: "Not found" }, 404);
});

function renderHome(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Progmune Knowledge API</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#d4d4d4;max-width:800px;margin:40px auto;padding:20px}
h1{color:#fff;font-size:22px;margin-bottom:8px}
.sub{color:#666;font-size:13px;margin-bottom:32px}
.endpoint{background:#111;border:1px solid #222;border-radius:8px;padding:14px 18px;margin-bottom:10px}
.endpoint .method{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:10px;background:#052e16;color:#22c55e}
.endpoint .path{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:14px;color:#fff}
.endpoint .desc{font-size:12px;color:#888;margin-top:4px}
pre{background:#111;border-radius:8px;padding:16px;font-size:12px;color:#a5d6ff;margin-top:16px;overflow-x:auto}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #222;font-size:11px;color:#444;text-align:center}
a{color:#60a5fa}
</style>
</head>
<body>
<h1>Progmune Knowledge API</h1>
<div class="sub">Protocol Knowledge Base as a Service — query protocol assets, evidence, and version history</div>

<div class="endpoint"><span class="method">GET</span><span class="path">/knowledge/assets</span><div class="desc">List all protocol assets (id, name, maturity, confidence, repos)</div></div>
<div class="endpoint"><span class="method">GET</span><span class="path">/knowledge/assets/:id</span><div class="desc">Full asset metadata (steps, examples, anti-patterns, state machine, evidence)</div></div>
<div class="endpoint"><span class="method">GET</span><span class="path">/knowledge/assets/:id/versions</span><div class="desc">Version history with changelog</div></div>
<div class="endpoint"><span class="method">GET</span><span class="path">/knowledge/assets/:id/evidence</span><div class="desc">Evidence per repository</div></div>
<div class="endpoint"><span class="method">GET</span><span class="path">/knowledge/summary</span><div class="desc">Aggregate stats (maturity distribution, confidence, repos, sequences)</div></div>

<h3 style="margin-top:24px;color:#fff">Example</h3>
<pre>curl http://localhost:${PORT}/knowledge/assets/PROTO-TLS

{
  "id": "PROTO-TLS",
  "name": "TLS Handshake",
  "maturity": "stable",
  "currentVersion": "1.0.0",
  "confidence": 85,
  "validatedRepos": ["curl", "nginx"],
  "evidence": [...],
  "versionHistory": [...]
}</pre>

<div class="footer">Progmune Runtime · <a href="https://github.com/shenlian19831109/progmune-runtime">GitHub</a></div>
</body>
</html>`;
}

server.listen(PORT, () => {
  console.error(`\n  Knowledge API: http://localhost:${PORT}`);
  console.error(`  Assets:        http://localhost:${PORT}/knowledge/assets`);
  console.error(`  Summary:       http://localhost:${PORT}/knowledge/summary\n`);
});
