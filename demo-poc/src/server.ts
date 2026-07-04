/**
 * Server module — AI-generated HTTP server with TLS.
 *
 * Protocol: HTTP Request + TLS (Progmune WARN/BLOCK coverage)
 *
 * AI-generated. Verified by Progmune before production deployment.
 *
 * @progmune-generated
 */

import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { loginFlow, registerUser, insecureQuickLogin } from "./auth";
import { safeReadFile, readFileWithoutClose } from "./files";

// ── TLS Config ──

/**
 * Load TLS certificate and key.
 * @protocol tls pre_states=[] post_states=["TLS_CONFIGURED"]
 */
function loadTLSConfig(): { cert: Buffer; key: Buffer } {
  const certPath = path.resolve(__dirname, "..", "certs", "server.crt");
  const keyPath = path.resolve(__dirname, "..", "certs", "server.key");

  // Generate self-signed cert if not exists
  if (!fs.existsSync(certPath)) {
    console.log("[TLS] Self-signed certificates would be generated here.");
    console.log("[TLS] In production, use real certificates.");
  }

  return {
    cert: Buffer.from("PLACEHOLDER_CERT"),
    key: Buffer.from("PLACEHOLDER_KEY"),
  };
}

// ── Request Handler ──

function handleRequest(req: https.IncomingMessage, res: https.ServerResponse): void {
  const url = req.url || "/";

  // Route: POST /login
  if (url === "/login" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { username, password } = JSON.parse(body);
        const session = loginFlow(username, password);
        if (session) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ token: session.token, expiresAt: session.expiresAt }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid credentials" }));
        }
      } catch {
        res.writeHead(400);
        res.end("Bad request");
      }
    });
    return;
  }

  // Route: GET /files/:name
  if (url.startsWith("/files/") && req.method === "GET") {
    const filename = url.replace("/files/", "");
    try {
      const content = safeReadFile(filename);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("File not found");
    }
    return;
  }

  // Route: GET /health
  if (url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", verified: "progmune" }));
    return;
  }

  // Default
  res.writeHead(404);
  res.end("Not found");
}

// ── Server Startup ──

const PORT = parseInt(process.env.PORT || "3443", 10);

export function startServer(): https.Server {
  const tls = loadTLSConfig();
  const server = https.createServer({ cert: tls.cert, key: tls.key }, handleRequest);

  server.listen(PORT, () => {
    console.log(`[Server] AI-generated API running on https://localhost:${PORT}`);
    console.log(`[Server] Verified by Progmune — TLS + Auth + File protocols enforced`);
    console.log(`[Server] Endpoints:`);
    console.log(`  POST /login        — Authentication flow`);
    console.log(`  GET  /files/:name  — File operations`);
    console.log(`  GET  /health       — Health check`);
  });

  return server;
}

// ── Demo: register test user ──

if (require.main === module) {
  registerUser("admin", "demo-password-123");
  console.log("[Demo] Registered test user: admin");
  startServer();
  console.log("[Demo] Server started. Press Ctrl+C to stop.");
}
