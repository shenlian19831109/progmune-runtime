/**
 * Governance Badge Server — embeddable SVG badges for README
 *
 * Usage:
 *   npx ts-node src/badge/badge-server.ts
 *   PROGMUNE_BADGE_PORT=3500 npx ts-node src/badge/badge-server.ts
 *
 * Badge URLs:
 *   /badge/knowledge          — Knowledge Base status
 *   /badge/protocols          — Stable protocol count
 *   /badge/coverage           — Repository coverage
 *   /badge/confidence         — Average confidence
 */

import * as http from "http";
import { buildKnowledgeBase } from "../protocol-knowledge";
import { buildEvidenceRepository } from "../evidence-repository";

const PORT = parseInt(process.env.PROGMUNE_BADGE_PORT || "3500", 10);

function svgBadge(label: string, value: string, color: string): string {
  const lw = label.length * 7 + 12;
  const vw = value.length * 7 + 12;
  const tw = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="20">
  <linearGradient id="bg" x2="0" y2="100%"><stop offset="0" stop-color="#444"/><stop offset="1" stop-color="#333"/></linearGradient>
  <rect width="${tw}" height="20" rx="3" fill="url(#bg)"/>
  <rect width="${lw}" height="20" rx="3" fill="#555"/>
  <rect x="${lw}" width="${vw}" height="20" rx="3" fill="${color}"/>
  <rect x="${lw}" width="12" height="20" fill="${color}"/>
  <text x="${lw/2}" y="14" fill="#ccc" font-family="sans-serif" font-size="10" text-anchor="middle">${label}</text>
  <text x="${lw+vw/2}" y="14" fill="#fff" font-family="sans-serif" font-size="10" text-anchor="middle" font-weight="bold">${value}</text>
</svg>`;
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const kb = buildKnowledgeBase();
  const er = buildEvidenceRepository();

  res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=300", "Access-Control-Allow-Origin": "*" });

  if (url === "/badge/knowledge") {
    res.end(svgBadge("Knowledge Base", `v${kb.version}`, "#0891b2"));
  } else if (url === "/badge/protocols") {
    const n = kb.summary.byMaturity["stable"];
    res.end(svgBadge("Protocols", `${n} stable`, n >= 3 ? "#22c55e" : "#f59e0b"));
  } else if (url === "/badge/coverage") {
    res.end(svgBadge("Repos", `${er.summary.totalRepos} validated`, "#8b5cf6"));
  } else if (url === "/badge/confidence") {
    res.end(svgBadge("Confidence", `${kb.summary.averageConfidence}%`, kb.summary.averageConfidence >= 70 ? "#22c55e" : "#f59e0b"));
  } else if (url === "/" || url === "") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><title>Progmune Badges</title><style>
body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px;background:#0a0a0a;color:#d4d4d4}
h1{color:#fff}pre{background:#111;padding:16px;border-radius:8px;font-size:12px}</style></head><body>
<h1>Progmune Governance Badges</h1>
${["knowledge","protocols","coverage","confidence"].map(b => `<p><img src="/badge/${b}"><br><pre>&lt;img src="http://localhost:${PORT}/badge/${b}"&gt;</pre></p>`).join("")}
</body></html>`);
  } else {
    res.end(svgBadge("Progmune", "Governance", "#0891b2"));
  }
});

server.listen(PORT, () => console.error(`\n  Badge Server: http://localhost:${PORT}\n`));
