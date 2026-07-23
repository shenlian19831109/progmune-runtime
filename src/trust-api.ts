/**
 * Phase 1: Trust API Server
 *
 * Standalone HTTP REST API for the AI Trust Decision Engine.
 * Primary endpoint: POST /trust/check
 *
 * Port: PROGMUNE_TRUST_PORT (default 3301)
 * Auth: PROGMUNE_TRUST_API_KEY (optional)
 *
 * Usage:
 *   npx ts-node src/trust-api.ts
 *   PROGMUNE_TRUST_PORT=3301 npx ts-node src/trust-api.ts
 */

import * as http from "http";
import * as path from "path";

const PORT = parseInt(process.env.PROGMUNE_TRUST_PORT || "3301", 10);
const API_KEY = process.env.PROGMUNE_TRUST_API_KEY || "";
const RATE_LIMIT = parseInt(process.env.PROGMUNE_TRUST_RATE_LIMIT || "100", 10);
const RATE_WINDOW = parseInt(process.env.PROGMUNE_TRUST_RATE_WINDOW || "3600000", 10);

// Rate limiting
const rateMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  if (!API_KEY) return true;
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function json(res: http.ServerResponse, data: any, status: number = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
}

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// ═══════════════════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const url = req.url || "/";
  const ip = getClientIp(req);

  // ── Health ──
  if (url === "/health" && req.method === "GET") {
    json(res, {
      status: "healthy",
      service: "progmune-trust-api",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // ── Trust Check ──
  if (url === "/trust/check" && req.method === "POST") {
    // API key auth
    if (API_KEY) {
      const auth = req.headers["authorization"] || "";
      if (!auth.includes(API_KEY)) {
        json(res, { error: "Unauthorized — invalid or missing API key" }, 401);
        return;
      }
    }

    // Rate limit
    if (!checkRateLimit(ip)) {
      json(res, { error: "Rate limit exceeded" }, 429);
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const input = JSON.parse(body);

        if (!input.project) {
          json(res, { error: "Missing required field: project" }, 400);
          return;
        }

        const { evaluateTrust } = require("./trust");
        const decision = evaluateTrust({
          projectPath: input.project,
          projectName: path.basename(input.project),
          commit: input.commit || "unknown",
          branch: input.branch,
          policyName: input.policy,
          language: input.context?.language,
          previousCommit: input.context?.previousCommit,
        });

        json(res, decision);
      } catch (e: any) {
        json(res, {
          error: `Trust evaluation failed: ${e.message}`,
          timestamp: new Date().toISOString(),
        }, 500);
      }
    });
    return;
  }

  // ── 404 ──
  json(res, {
    error: "Not Found",
    availableEndpoints: [
      "POST /trust/check",
      "GET /health",
    ],
  }, 404);
});

server.listen(PORT, () => {
  console.log(`🔒 Progmune Trust API server running on http://localhost:${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`     POST /trust/check  — Evaluate trust for a project`);
  console.log(`     GET  /health       — Service health check`);
  if (API_KEY) console.log(`   API key auth: enabled`);
  console.log("");
});

export { server };
