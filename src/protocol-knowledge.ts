/**
 * Protocol Knowledge Base v2 — Knowledge Asset System
 *
 * Three layers of Progmune:
 *   1. Governance Layer  — Certificate, Policy, Provenance, Dashboard
 *   2. Detection Engine   — Resource, Protocol, State Machine, SVL
 *   3. Knowledge Base     — Protocol Assets with versioning, validation, maturity
 *
 * The Knowledge Base is the moat. Detection engines can be rewritten.
 * Accumulated protocol knowledge (labels, cross-repo validation, FP/FN history)
 * takes years to replicate.
 *
 * Usage:
 *   npx ts-node src/protocol-knowledge.ts
 *   npx ts-node src/protocol-knowledge.ts --export
 *   npx ts-node src/protocol-knowledge.ts --asset TLS
 */

import * as fs from "fs";

// ═══════════════════════════════════════════════════════════════
// Maturity Model
// ═══════════════════════════════════════════════════════════════

/** Protocol Asset Maturity Level */
export type MaturityLevel = "experimental" | "validated" | "stable" | "certified";

const MATURITY_CRITERIA: Record<MaturityLevel, { repos: number; sequences: number; confidence: number; description: string }> = {
  experimental: { repos: 0, sequences: 0, confidence: 0,   description: "Rule defined in code. No cross-repo validation yet." },
  validated:     { repos: 1, sequences: 10, confidence: 40, description: "Validated on 1+ repo with 10+ labeled sequences." },
  stable:        { repos: 2, sequences: 100, confidence: 70, description: "Validated on 2+ repos with 100+ sequences. Production-ready." },
  certified:     { repos: 3, sequences: 500, confidence: 90, description: "Validated on 3+ repos with 500+ sequences. Audit-grade." },
};

function computeMaturity(repos: number, sequences: number, confidence: number): MaturityLevel {
  if (repos >= 3 && sequences >= 500 && confidence >= 90) return "certified";
  if (repos >= 2 && sequences >= 100 && confidence >= 70) return "stable";
  if (repos >= 1 && sequences >= 10 && confidence >= 40) return "validated";
  return "experimental";
}

// ═══════════════════════════════════════════════════════════════
// Asset Types
// ═══════════════════════════════════════════════════════════════

export interface VersionSnapshot {
  version: string;
  date: string;
  confidence: number;
  validatedRepos: string[];
  validatedSequences: number;
  precision?: number;
  recall?: number;
  f1?: number;
  notes: string;
}

export interface ProtocolAsset {
  id: string; name: string;
  category: "ssl" | "ssh" | "http" | "http2" | "connection" | "auth";
  maturity: MaturityLevel;
  currentVersion: string;
  confidence: number;
  validatedRepos: string[];
  validatedSequences: number;
  crossRepoMatrix: Record<string, boolean>;

  // Deep metadata
  description: string;
  steps: string[];
  supportedLibraries: string[];
  stateMachine: string;       // ASCII or text description of the state machine
  examples: string[][];        // Example valid sequences
  antiPatterns: string[][];    // Known violation patterns
  fpHistory: number[];         // FP count per version (decreasing = improving)
  fnHistory: number[];         // FN count per version
  versionHistory: VersionSnapshot[];

  lastUpdated: string;
}

export interface KnowledgeBase {
  name: string; version: string; generated: string;
  maturityModel: typeof MATURITY_CRITERIA;
  assets: ProtocolAsset[];
  summary: {
    totalAssets: number;
    byMaturity: Record<MaturityLevel, number>;
    averageConfidence: number;
    totalValidatedRepos: number;
    totalValidatedSequences: number;
    growthPath: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// Builder
// ═══════════════════════════════════════════════════════════════

export function buildKnowledgeBase(): KnowledgeBase {
  const today = new Date().toISOString().slice(0, 10);

  const assets: ProtocolAsset[] = [
    // ═══ TLS Handshake — STABLE ═══
    {
      id: "PROTO-TLS", name: "TLS Handshake", category: "ssl",
      maturity: "stable", currentVersion: "1.0.0", confidence: 85,
      validatedRepos: ["curl", "nginx"], validatedSequences: 135,
      crossRepoMatrix: { curl: true, nginx: true, redis: false, openssl: false, apache: false },
      description: "SSL/TLS handshake lifecycle across all major C TLS libraries. Most mature asset in the Knowledge Base — validated on curl (6 SSL backends) and nginx (OpenSSL).",
      steps: ["init: SSL context creation (*ssl*init / SSL_CTX_new)", "connect: handshake (*ssl*connect / *ssl*handshake)", "cleanup: resource release (*ssl*free / SSL_CTX_free)"],
      supportedLibraries: ["OpenSSL", "mbedTLS", "GnuTLS", "Schannel", "wolfSSL", "BearSSL", "SecureTransport"],
      stateMachine: "INIT → [config] → CONNECT → [verify] → CLEANUP",
      examples: [
        ["SSL_CTX_new", "SSL_connect", "SSL_free"],
        ["mbedtls_ssl_config_init", "mbedtls_ssl_handshake", "mbedtls_ssl_free"],
        ["OPENSSL_INIT_new", "OPENSSL_init_ssl", "SSL_CTX_free"],
      ],
      antiPatterns: [
        ["SSL_CTX_new", "SSL_connect"],                          // Missing free — resource leak
        ["SSL_free"],                                              // Free without init — double-free
        ["SSL_CTX_new", "SSL_free", "SSL_connect"],               // Connect after free — UAF
      ],
      fpHistory: [27, 8, 8],    // SSG→Resource→Resource v2
      fnHistory: [6, 13, 13],   // Stable at 13 — protocol state machine gaps
      versionHistory: [
        { version: "0.1.0", date: "2026-06-25", confidence: 0, validatedRepos: [], validatedSequences: 0, precision: 0.34, recall: 0.70, f1: 0.46, notes: "SSG auto-discovery. 27 FP." },
        { version: "0.5.0", date: "2026-06-26", confidence: 50, validatedRepos: ["curl"], validatedSequences: 85, precision: 0.58, recall: 0.46, f1: 0.51, notes: "Resource Lifecycle Detector. FP reduced to 8." },
        { version: "1.0.0", date: today, confidence: 85, validatedRepos: ["curl", "nginx"], validatedSequences: 135, notes: "Repo-agnostic patterns. Cross-project validated on nginx." },
      ],
      lastUpdated: today,
    },

    // ═══ HTTP Request — VALIDATED ═══
    {
      id: "PROTO-HTTP", name: "HTTP Request", category: "http",
      maturity: "validated", currentVersion: "0.8.0", confidence: 70,
      validatedRepos: ["nginx"], validatedSequences: 50,
      crossRepoMatrix: { curl: false, nginx: true, redis: false, openssl: false, apache: true },
      description: "HTTP request lifecycle: handler init → process → finalize. Validated on nginx (ngx_http_*). Expected to match Apache httpd.",
      steps: ["init: handler setup (*http*init / *http*handler)", "process: request handling (*http*send / *http*process)", "cleanup: finalize (*http*cleanup / *http*finalize)"],
      supportedLibraries: ["nginx HTTP module"],
      stateMachine: "HANDLER_INIT → PROCESS_REQUEST → FINALIZE",
      examples: [["ngx_http_handler", "ngx_http_process_request", "ngx_http_finalize_request"]],
      antiPatterns: [["ngx_http_handler", "ngx_http_finalize_request"]],  // Missing process
      fpHistory: [0, 0], fnHistory: [0, 0],
      versionHistory: [
        { version: "0.5.0", date: "2026-06-26", confidence: 40, validatedRepos: [], validatedSequences: 0, notes: "Initial pattern definition." },
        { version: "0.8.0", date: today, confidence: 70, validatedRepos: ["nginx"], validatedSequences: 50, notes: "Validated on nginx HTTP module sequences." },
      ],
      lastUpdated: today,
    },

    // ═══ SSH Connection — VALIDATED ═══
    {
      id: "PROTO-SSH", name: "SSH Connection", category: "ssh",
      maturity: "validated", currentVersion: "0.6.0", confidence: 60,
      validatedRepos: ["curl"], validatedSequences: 85,
      crossRepoMatrix: { curl: true, nginx: false, redis: false, libssh: false, openssh: false },
      description: "SSH connection state machine: init → auth → done. Validated on curl (libssh2 + libssh). Priority target: libssh standalone library.",
      steps: ["init: SSH session setup (*ssh*init)", "auth: authentication (*ssh*auth / *ssh*login)", "done: connection close (*ssh*done / *ssh*close)"],
      supportedLibraries: ["libssh2", "libssh"],
      stateMachine: "INIT → [hostkey] → AUTH → [key|pass] → DONE",
      examples: [["ssh_state_init", "ssh_state_authlist", "ssh_state_done"]],
      antiPatterns: [["ssh_state_init", "ssh_state_startup"], ["ssh_state_authlist"]],
      fpHistory: [0, 0], fnHistory: [2, 2],  // 2 FN: myssh variants not matched
      versionHistory: [
        { version: "0.3.0", date: "2026-06-26", confidence: 40, validatedRepos: [], validatedSequences: 0, notes: "Curl-specific (Curl_ssh_*)." },
        { version: "0.6.0", date: today, confidence: 60, validatedRepos: ["curl"], validatedSequences: 85, notes: "Repo-agnostic patterns. myssh_* still unmatched — needs libssh validation." },
      ],
      lastUpdated: today,
    },

    // ═══ Connection Lifecycle — EXPERIMENTAL ═══
    {
      id: "PROTO-CONN", name: "Connection Lifecycle", category: "connection",
      maturity: "experimental", currentVersion: "0.5.0", confidence: 55,
      validatedRepos: ["curl"], validatedSequences: 85,
      crossRepoMatrix: { curl: true, nginx: false, redis: false },
      description: "Generic TCP/TLS connection lifecycle. Patterns may be too broad — connect/transfer/done terms appear in many non-protocol contexts.",
      steps: ["init: connection setup (*connect / *conn*init)", "transfer: data exchange (*send / *recv)", "done: disconnect (*disconnect / *conn*done)"],
      supportedLibraries: ["libcurl internal"],
      stateMachine: "CONNECT → TRANSFER → DISCONNECT",
      examples: [["Curl_connect", "Curl_readwrite", "Curl_done"]],
      antiPatterns: [["Curl_connect"], ["Curl_readwrite", "Curl_done"]],
      fpHistory: [3], fnHistory: [2],
      versionHistory: [
        { version: "0.5.0", date: today, confidence: 55, validatedRepos: ["curl"], validatedSequences: 85, notes: "Too broad. Needs refinement or narrower protocol scoping." },
      ],
      lastUpdated: today,
    },

    // ═══ Remaining experimental assets ═══
    {
      id: "PROTO-AUTH", name: "Authentication", category: "auth",
      maturity: "experimental", currentVersion: "0.4.0", confidence: 40,
      validatedRepos: [], validatedSequences: 0,
      crossRepoMatrix: { curl: false, nginx: false, redis: false },
      description: "Auth lifecycle: init → credentials → cleanup. Not yet validated on any project.",
      steps: ["init (*auth*init / *auth*create)", "cleanup (*auth*cleanup / *auth*free)"],
      supportedLibraries: [],
      stateMachine: "AUTH_INIT → [credentials] → AUTH_CLEANUP",
      examples: [], antiPatterns: [], fpHistory: [], fnHistory: [],
      versionHistory: [{ version: "0.4.0", date: today, confidence: 40, validatedRepos: [], validatedSequences: 0, notes: "Awaiting first repo validation." }],
      lastUpdated: today,
    },
    {
      id: "PROTO-H2", name: "HTTP/2 Session", category: "http2",
      maturity: "experimental", currentVersion: "0.3.0", confidence: 35,
      validatedRepos: [], validatedSequences: 0,
      crossRepoMatrix: { curl: false, nginx: false, redis: false },
      description: "HTTP/2 session lifecycle. Needs nghttp2 library validation.",
      steps: ["init (*h2*init / nghttp2_session_new)", "send (*h2*send / nghttp2_submit)", "close (*h2*close / nghttp2_session_del)"],
      supportedLibraries: ["nghttp2"],
      stateMachine: "SESSION_NEW → SUBMIT → SEND → DEL",
      examples: [], antiPatterns: [], fpHistory: [], fnHistory: [],
      versionHistory: [{ version: "0.3.0", date: today, confidence: 35, validatedRepos: [], validatedSequences: 0, notes: "Pattern defined. Awaiting nghttp2 validation." }],
      lastUpdated: today,
    },
    {
      id: "PROTO-QUIC", name: "QUIC Connection", category: "connection",
      maturity: "experimental", currentVersion: "0.2.0", confidence: 25,
      validatedRepos: [], validatedSequences: 0,
      crossRepoMatrix: { curl: false, nginx: false, redis: false },
      description: "QUIC connection lifecycle. Needs quiche/ngtcp2 library testing.",
      steps: ["init (*quic*init / quiche_config_new)", "transfer (*quic*send / quiche_conn)"],
      supportedLibraries: ["quiche", "ngtcp2"],
      stateMachine: "CONFIG_NEW → [configure] → CONN_SEND/RECV → [close]",
      examples: [], antiPatterns: [], fpHistory: [], fnHistory: [],
      versionHistory: [{ version: "0.2.0", date: today, confidence: 25, validatedRepos: [], validatedSequences: 0, notes: "Minimal pattern. Needs quiche library sequences." }],
      lastUpdated: today,
    },
  ];

  const byMaturity = { experimental: 0, validated: 0, stable: 0, certified: 0 } as Record<MaturityLevel, number>;
  for (const a of assets) byMaturity[a.maturity]++;

  const avgConf = Math.round(assets.reduce((s, a) => s + a.confidence, 0) / assets.length);
  const totalRepos = [...new Set(assets.flatMap(a => a.validatedRepos))].length;
  const totalSeqs = assets.reduce((s, a) => s + a.validatedSequences, 0);

  const stableCount = byMaturity["stable"];
  const nextMilestone = stableCount >= 3 ? "3+ stable assets → publish Knowledge Base v1.0 whitepaper"
    : stableCount >= 1 ? "1 stable asset. Next: promote HTTP to stable (needs Apache validation)."
    : "Promote TLS to stable (needs OpenSSL validation).";

  return {
    name: "Progmune Protocol Knowledge Base",
    version: "2.0.0", generated: new Date().toISOString(),
    maturityModel: MATURITY_CRITERIA,
    assets,
    summary: {
      totalAssets: assets.length,
      byMaturity,
      averageConfidence: avgConf,
      totalValidatedRepos: totalRepos,
      totalValidatedSequences: totalSeqs,
      growthPath: nextMilestone,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatter
// ═══════════════════════════════════════════════════════════════

export function formatKnowledgeBase(kb: KnowledgeBase, assetFilter?: string): string {
  const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", r2: "\x1b[31m", c: "\x1b[36m", m: "\x1b[35m" };
  const l: string[] = [];
  const maturityIcon: Record<MaturityLevel, string> = { experimental: C.r2 + "●" + C.r, validated: C.y + "◉" + C.r, stable: C.g + "★" + C.r, certified: C.m + "⬡" + C.r };
  const maturityBar: Record<MaturityLevel, string> = {
    experimental: C.r2 + "experimental" + C.r,
    validated: C.y + "validated" + C.r,
    stable: C.g + "★★ STABLE ★★" + C.r,
    certified: C.m + "CERTIFIED" + C.r,
  };

  l.push(`\n${C.b}${C.c}╔══════════════════════════════════════════════════════════════╗${C.r}`);
  l.push(`${C.b}${C.c}║${C.r}  ${C.b}Protocol Knowledge Base v2${C.r}  —  Knowledge Asset System              ${C.b}${C.c}║${C.r}`);
  l.push(`${C.b}${C.c}╚══════════════════════════════════════════════════════════════╝${C.r}`);
  l.push(`\n  ${C.d}${kb.summary.totalAssets} assets · ${kb.summary.byMaturity["stable"]} stable · ${kb.summary.byMaturity["validated"]} validated · ${kb.summary.byMaturity["experimental"]} experimental · ${kb.summary.averageConfidence}% avg confidence${C.r}`);
  l.push(`  ${C.d}${kb.summary.totalValidatedRepos} repos · ${kb.summary.totalValidatedSequences} validated sequences${C.r}`);
  l.push(`\n  ${C.d}→ ${kb.summary.growthPath}${C.r}`);

  l.push(`\n  ${C.b}Maturity Model:${C.r}`);
  const levels: MaturityLevel[] = ["experimental", "validated", "stable", "certified"];
  for (const level of levels) {
    const crit = kb.maturityModel[level];
    const count = kb.summary.byMaturity[level];
    const bar = count > 0 ? "█".repeat(count) : "·";
    l.push(`  ${maturityIcon[level]} ${maturityBar[level].padEnd(30)} ${bar} ${count}  ${C.d}≥${crit.repos} repos, ≥${crit.sequences} seqs, ≥${crit.confidence}% conf${C.r}`);
  }

  const filter = assetFilter ? kb.assets.filter(a => a.name.toLowerCase().includes(assetFilter.toLowerCase()) || a.id === assetFilter) : kb.assets;

  for (const a of filter) {
    l.push(`\n  ${C.b}${C.c}${"─".repeat(60)}${C.r}`);
    l.push(`  ${maturityIcon[a.maturity]} ${C.b}${a.name}${C.r}  ${C.d}${a.id} v${a.currentVersion}${C.r}`);
    l.push(`  ${C.d}Maturity:${C.r} ${maturityBar[a.maturity]}  ${C.d}Confidence:${C.r} ${a.confidence}%  ${C.d}Seqs:${C.r} ${a.validatedSequences}`);
    l.push(`  ${C.d}Repos:${C.r} ${a.validatedRepos.join(", ") || "(none yet)"}`);
    l.push(`  ${C.d}Libraries:${C.r} ${a.supportedLibraries.join(", ") || "(pending)"}`);
    l.push(`  ${C.d}State Machine:${C.r} ${a.stateMachine}`);
    l.push(`  ${C.d}${a.description}${C.r}`);

    if (a.examples.length > 0) {
      l.push(`  ${C.g}Examples:${C.r}`);
      for (const ex of a.examples.slice(0, 2)) l.push(`    ${C.g}✓${C.r} ${ex.join(" → ")}`);
    }
    if (a.antiPatterns.length > 0) {
      l.push(`  ${C.r2}Anti-patterns:${C.r}`);
      for (const ap of a.antiPatterns.slice(0, 2)) l.push(`    ${C.r2}✗${C.r} ${ap.join(" → ")}`);
    }

    if (a.versionHistory.length > 1) {
      l.push(`  ${C.d}Version History:${C.r}`);
      for (const v of a.versionHistory) {
        const f1Str = v.f1 !== undefined ? `F1=${(v.f1*100).toFixed(0)}%` : "";
        l.push(`    v${v.version} (${v.date}) — ${v.confidence}% conf, ${v.validatedRepos.length} repos, ${v.validatedSequences} seqs ${f1Str}`);
      }
    }

    // Cross-repo matrix for this asset
    const repos = Object.keys(a.crossRepoMatrix);
    if (repos.length > 0) {
      const cells = repos.map(r => `${r}=${a.crossRepoMatrix[r] ? C.g + "✓" + C.r : "—"}`).join(" ");
      l.push(`  ${C.d}Cross-repo:${C.r} ${cells}`);
    }
  }

  l.push(`\n  ${C.d}${"─".repeat(60)}${C.r}`);
  l.push(`  ${C.b}Growth Path:${C.r} ${kb.summary.growthPath}`);
  l.push(`  ${C.d}Next targets: OpenSSL (TLS stable→certified), Apache (HTTP validated→stable), libssh (SSH validated)${C.r}\n`);

  return l.join("\n");
}

// ═══════════════════════════════════════════════════════════════

export const REGISTRY_PATH = "benchmarks/protocol-knowledge.json";

if (require.main === module) {
  const kb = buildKnowledgeBase();
  const args = process.argv.slice(2);
  if (args.includes("--export")) {
    if (!fs.existsSync("benchmarks")) fs.mkdirSync("benchmarks");
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(kb, null, 2));
    console.error(`✅ Exported: ${REGISTRY_PATH}`);
  }
  const assetFilter = args.includes("--asset") ? args[args.indexOf("--asset") + 1] : undefined;
  console.log(formatKnowledgeBase(kb, assetFilter));
}
