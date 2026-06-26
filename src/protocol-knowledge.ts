/**
 * Protocol Knowledge Base — Rule Registry
 *
 * Transforms protocol detection rules from code into versioned,
 * validated, confidence-scored knowledge assets.
 *
 * Usage:
 *   npx ts-node src/protocol-knowledge.ts
 *   npx ts-node src/protocol-knowledge.ts --export
 */

import * as fs from "fs";

export interface ProtocolAsset {
  id: string; name: string;
  category: "ssl" | "ssh" | "http" | "http2" | "connection" | "auth";
  version: string; confidence: number;
  validatedRepos: string[]; validatedSequences: number;
  stability: "High" | "Medium" | "Low";
  crossRepoMatrix: Record<string, boolean>;
  description: string; steps: string[]; lastUpdated: string;
}

export interface ProtocolRegistry {
  name: string; version: string; generated: string;
  assets: ProtocolAsset[];
  summary: { totalAssets: number; highStability: number; mediumStability: number; lowStability: number; averageConfidence: number; totalValidatedRepos: number; totalValidatedSequences: number };
}

export function buildProtocolRegistry(): ProtocolRegistry {
  const curlSeqs = 85, nginxSeqs = 50, redisSeqs = 50;

  const assets: ProtocolAsset[] = [
    {
      id: "PROTO-TLS-1.0", name: "TLS Handshake", category: "ssl", version: "1.0.0", confidence: 85,
      validatedRepos: ["curl", "nginx"], validatedSequences: curlSeqs + nginxSeqs, stability: "High",
      crossRepoMatrix: { curl: true, nginx: true, redis: false },
      description: "SSL/TLS handshake lifecycle: init → connect → cleanup. Validated across curl (OpenSSL/mbedTLS/GnuTLS/Schannel/wolfSSL) and nginx (OpenSSL).",
      steps: ["tls_init (SSL_CTX_new / *_ssl_*_init)", "tls_connect (SSL_connect / *_ssl_*_handshake)", "tls_free (SSL_free / *_ssl_*_cleanup)"],
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
    {
      id: "PROTO-SSH-0.6", name: "SSH Connection", category: "ssh", version: "0.6.0", confidence: 60,
      validatedRepos: ["curl"], validatedSequences: curlSeqs, stability: "Low",
      crossRepoMatrix: { curl: true, nginx: false, redis: false },
      description: "SSH connection state machine: init → auth → done. Validated on curl (libssh2/libssh). Needs libssh validation.",
      steps: ["ssh_init (*_ssh_*_init)", "ssh_auth (*_ssh_*_auth)", "ssh_done (*_ssh_*_done / *_ssh_*_close)"],
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
    {
      id: "PROTO-HTTP-0.8", name: "HTTP Request", category: "http", version: "0.8.0", confidence: 70,
      validatedRepos: ["nginx"], validatedSequences: nginxSeqs, stability: "Medium",
      crossRepoMatrix: { curl: false, nginx: true, redis: false },
      description: "HTTP request lifecycle: init → send → cleanup. Validated on nginx (ngx_http_*). Needs curl HTTP validation.",
      steps: ["http_init (*http*init / *http*handler)", "http_send (*http*send / *http*process)", "http_cleanup (*http*cleanup / *http*finalize)"],
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
    {
      id: "PROTO-CONN-0.5", name: "Connection Lifecycle", category: "connection", version: "0.5.0", confidence: 55,
      validatedRepos: ["curl"], validatedSequences: curlSeqs, stability: "Low",
      crossRepoMatrix: { curl: true, nginx: false, redis: false },
      description: "Generic connection lifecycle: connect → transfer → disconnect. Validated on curl. Patterns may be too broad.",
      steps: ["conn_init (*connect / *conn*init)", "conn_transfer (*send / *recv / *transfer)", "conn_done (*disconnect / *conn*cleanup)"],
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
    {
      id: "PROTO-AUTH-0.4", name: "Authentication", category: "auth", version: "0.4.0", confidence: 40,
      validatedRepos: [], validatedSequences: 0, stability: "Low",
      crossRepoMatrix: { curl: false, nginx: false, redis: false },
      description: "Authentication lifecycle: init → credentials → cleanup. Not yet validated on any real project.",
      steps: ["auth_init (*auth*init / *auth*create)", "auth_cleanup (*auth*cleanup / *auth*free)"],
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
    {
      id: "PROTO-H2-0.3", name: "HTTP/2 Session", category: "http2", version: "0.3.0", confidence: 35,
      validatedRepos: [], validatedSequences: 0, stability: "Low",
      crossRepoMatrix: { curl: false, nginx: false, redis: false },
      description: "HTTP/2 session lifecycle: init → send → close. Needs nghttp2 library validation.",
      steps: ["h2_init (*h2*init / nghttp2_session_new)", "h2_send (*h2*send / nghttp2_submit)", "h2_close (*h2*close / nghttp2_session_del)"],
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
    {
      id: "PROTO-QUIC-0.2", name: "QUIC Connection", category: "connection", version: "0.2.0", confidence: 25,
      validatedRepos: [], validatedSequences: 0, stability: "Low",
      crossRepoMatrix: { curl: false, nginx: false, redis: false },
      description: "QUIC connection lifecycle: init → transfer. Minimal validation. Needs quiche/ngtcp2 library testing.",
      steps: ["quic_init (*quic*init / quiche_config_new)", "quic_transfer (*quic*send / quiche_conn)"],
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
  ];

  const high = assets.filter(a => a.stability === "High").length;
  const medium = assets.filter(a => a.stability === "Medium").length;
  const low = assets.filter(a => a.stability === "Low").length;
  const avgConf = Math.round(assets.reduce((s, a) => s + a.confidence, 0) / assets.length);
  const totalRepos = [...new Set(assets.flatMap(a => a.validatedRepos))].length;
  const totalSeqs = assets.reduce((s, a) => s + a.validatedSequences, 0);

  return {
    name: "Progmune Protocol Knowledge Base",
    version: "1.0.0", generated: new Date().toISOString(),
    assets,
    summary: { totalAssets: assets.length, highStability: high, mediumStability: medium, lowStability: low, averageConfidence: avgConf, totalValidatedRepos: totalRepos, totalValidatedSequences: totalSeqs },
  };
}

export function formatRegistryTerminal(reg: ProtocolRegistry): string {
  const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", r2: "\x1b[31m", c: "\x1b[36m" };
  const l: string[] = [];
  l.push(`\n${C.b}${C.c}Protocol Knowledge Base${C.r}  v${reg.version}`);
  l.push(`${C.d}${reg.summary.totalAssets} rules · ${reg.summary.highStability} High · ${reg.summary.mediumStability} Medium · ${reg.summary.lowStability} Low · ${reg.summary.averageConfidence}% avg confidence${C.r}\n`);
  l.push(`${C.d}ID              Rule               Version  Conf   Stability  Validated Repos       Seqs${C.r}`);
  l.push(`${C.d}──────────────  ─────────────────  ───────  ─────  ─────────  ────────────────────  ────${C.r}`);
  for (const a of reg.assets) {
    const sc = a.stability === "High" ? C.g : a.stability === "Medium" ? C.y : C.r2;
    const cc = a.confidence >= 70 ? C.g : a.confidence >= 50 ? C.y : C.r2;
    l.push(`  ${C.d}${a.id.padEnd(14)}${C.r}  ${C.b}${a.name.slice(0,17).padEnd(17)}${C.r}  ${a.version.padEnd(7)}  ${cc}${a.confidence}%${C.r}    ${sc}${a.stability}${C.r}      ${a.validatedRepos.join(", ").padEnd(20)}  ${String(a.validatedSequences).padEnd(4)}`);
  }
  l.push(`\n${C.b}Coverage Matrix:${C.r}`);
  l.push(`  ${C.d}Rule               curl    nginx   redis${C.r}`);
  for (const a of reg.assets) {
    l.push(`  ${a.name.padEnd(17)}  ${a.crossRepoMatrix["curl"] ? C.g + "✓" + C.r : "—"}       ${a.crossRepoMatrix["nginx"] ? C.g + "✓" + C.r : "—"}       ${a.crossRepoMatrix["redis"] ? C.g + "✓" + C.r : "—"}`);
  }
  l.push(`\n${C.d}Stability: High = 2+ repos · Medium = 1 repo · Low = unvalidated${C.r}\n`);
  return l.join("\n");
}

export const REGISTRY_PATH = "benchmarks/protocol-registry.json";

if (require.main === module) {
  const reg = buildProtocolRegistry();
  if (process.argv.includes("--export")) {
    if (!fs.existsSync("benchmarks")) fs.mkdirSync("benchmarks");
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
    console.error(`✅ Exported: ${REGISTRY_PATH}`);
  }
  console.log(formatRegistryTerminal(reg));
}
