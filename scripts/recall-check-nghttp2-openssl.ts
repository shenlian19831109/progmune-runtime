#!/usr/bin/env npx ts-node
/**
 * Recall Check: Run detectors on nghttp2 + openssl to find potential TPs.
 * Uses full safeguard + protocol detection with excludePatterns active.
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectSafeguardViolations,
  detectProtocolViolations,
  SafeguardViolation,
  ProtocolViolation,
} from "../src/protocol-detector";

const BENCH_DIR = path.join(__dirname, "..", "benchmarks");

interface Finding {
  fn: string;
  file?: string;
  calls: string[];
  safeguards: string[];
  protocols: string[];
}

// ── Known FP patterns to skip in output ──
const SKIP_FN_PATTERNS = [
  /^nghttp2_/,          // all nghttp2 public API
  /^session_/,          // all nghttp2 session internals
  /^hd_/,               // HPACK internals
  /^ossl_/,             // OpenSSL internals
  /^SSL_/,              // OpenSSL SSL API
  /^BIO_/,              // OpenSSL BIO
  /^PACKET_/,           // OpenSSL packet
  /^ERR_/,              // OpenSSL error
  /^CRYPTO_/,           // OpenSSL crypto
  /^OSSL_/,             // OpenSSL internals
  /^OPENSSL_/,          // OpenSSL internals
  /^qrx_/, /^qtx_/,    // QUIC internals
  /^ch_/,               // channel internals
  /^depack_/, /^demux_/, // demux internals
  /^DEBUGF/, /^TODO/,
];

function isSkipFn(fn: string): boolean {
  return SKIP_FN_PATTERNS.some(p => p.test(fn));
}

function analyzeRepo(repo: string): Finding[] {
  const seqFile = path.join(BENCH_DIR, `${repo}-sequences.json`);
  const data = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const seqs: Array<{ function?: string; file?: string; calls?: string[] }> = data.sequences || data;

  const findings: Finding[] = [];

  for (const seq of seqs) {
    const fn = seq.function || "";
    const file = seq.file || "";
    const calls = seq.calls || [];

    // Skip known library internals
    if (isSkipFn(fn)) continue;

    const safeViolations = detectSafeguardViolations(calls, fn, "c");
    const protoViolations = detectProtocolViolations(calls);

    // Filter out violations already handled by excludePatterns
    // (these won't appear anyway, but double-check)
    const realSafe = safeViolations.filter((v: SafeguardViolation) => {
      // Additional per-function filtering
      if (v.category === "session" && /^session_/.test(fn)) return false;
      if (v.category === "api_gateway" && /block/i.test(fn)) return false;
      return true;
    });

    if (realSafe.length > 0 || protoViolations.length > 0) {
      findings.push({
        fn,
        file,
        calls: calls.slice(0, 8),
        safeguards: realSafe.map((v: SafeguardViolation) => `${v.rule} [${v.category}]`),
        protocols: protoViolations.map((v: ProtocolViolation) => `${v.protocol}: ${v.detail}`),
      });
    }
  }

  return findings;
}

// ── Main ──
console.log("\n═══ C Recall Verification: nghttp2 + openssl ═══\n");
console.log("Goal: Find any True Positives beyond library-internal noise.\n");

for (const repo of ["nghttp2", "openssl"]) {
  const findings = analyzeRepo(repo);

  console.log(`─── ${repo} ───`);
  console.log(`  Non-library functions checked`);

  if (findings.length === 0) {
    console.log(`  ✅ 0 violations — all-clean gold labels confirmed\n`);
    continue;
  }

  console.log(`  Violations found: ${findings.length}\n`);

  for (const f of findings) {
    console.log(`  📋 ${f.fn}${f.file ? ` (${f.file})` : ""}`);
    console.log(`     calls: ${f.calls.join(", ")}`);
    for (const s of f.safeguards) {
      console.log(`     🛡️  ${s}`);
    }
    for (const p of f.protocols) {
      console.log(`     🔗 ${p}`);
    }

    // Manual classification hints
    const fnLower = f.fn.toLowerCase();
    const hasCleanup = f.calls.some((c: string) => /free|del|cleanup|destroy|close|release/i.test(c));
    const hasInit = f.calls.some((c: string) => /init|new|create|alloc|open/i.test(c));
    const isOrchestrator = !/^(cf_|tunnel_|stream_|item_|buf)/.test(f.fn);

    let verdict = "?";
    if (hasInit && !hasCleanup) verdict = "🔴 POTENTIAL TP (init without cleanup)";
    else if (hasInit && hasCleanup) verdict = "🟢 LIKELY FP (has both init + cleanup)";
    else verdict = "🟡 NEEDS REVIEW";

    console.log(`     → ${verdict} | init=${hasInit} cleanup=${hasCleanup} orchestrator=${isOrchestrator}`);
    console.log();
  }

  // Summary
  const potentialTPs = findings.filter(f => {
    const hasInit = f.calls.some((c: string) => /init|new|create|alloc|open/i.test(c));
    const hasCleanup = f.calls.some((c: string) => /free|del|cleanup|destroy|close|release/i.test(c));
    return hasInit && !hasCleanup;
  });

  console.log(`  Summary: ${findings.length} violations → ${potentialTPs.length} potential TPs (init without cleanup)\n`);
}

console.log("─── Next Steps ───");
console.log("  1. Manually review 'POTENTIAL TP' findings");
console.log("  2. Check if init+cleanup pairing happens at a higher call level");
console.log("  3. Update gold labels if any confirmed TPs found");
console.log();
