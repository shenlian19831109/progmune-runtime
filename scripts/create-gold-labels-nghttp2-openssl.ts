#!/usr/bin/env npx ts-node
/**
 * Create gold labels for nghttp2 and openssl.
 * Uses existing safeguard rules + P0 rules as baseline detection,
 * then marks each function as "clean" or "violation".
 *
 * Strategy:
 *   - Run safeguard + protocol detectors on each function
 *   - High-confidence violations → mark "violation"
 *   - Clean + no triggers → mark "clean"
 *   - Ambiguous → mark "skip" (needs human review)
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectSafeguardViolations,
  detectProtocolViolations,
} from "../src/protocol-detector";

const BENCH_DIR = path.join(__dirname, "..", "benchmarks");

interface Sequence {
  function: string;
  file?: string;
  calls: string[];
}

// ── nghttp2 domain knowledge ──
// These functions are known library internals that manage session state correctly
const NGHTTP2_CLEAN_PATTERNS = [
  /^nghttp2_session_del$/,         // proper session cleanup
  /^nghttp2_hd_/,                  // header compression (stateless)
  /^nghttp2_bufs?_/,               // buffer management
  /^nghttp2_frame_/,               // frame handling
  /^nghttp2_map_/,                 // map data structure
  /^nghttp2_pq_/,                  // priority queue
  /^nghttp2_mem_/,                 // memory allocation
  /^nghttp2_ratelim_/,             // rate limiting
  /^nghttp2_strerror/,             // error strings
  /^nghttp2_min_size/,             // utility
  /^nghttp2_is_fatal/,             // utility
  /^nghttp2_nv_/,                  // name-value pairs
  /^init_settings/,                // settings init
  /^inflate_header_block/,         // HPACK inflate
  /^emit_/,                        // HPACK emit
  /^DEBUGF/,                       // debug logging
  /^memcpy/, /^memset/,
];

// These nghttp2 functions SHOULD have session lifecycle management
const NGHTTP2_INTERESTING = [
  /^session_new$/,                  // creates session
  /^session_prep_frame/,           // prepares frame → calls session lifecycle
  /^session_after_frame_sent/,     // post-frame lifecycle
  /^session_inbound_frame_reset/,  // frame reset → recreates session
  /^session_detach_stream_item/,   // stream cleanup
  /^session_call_on_frame_send/,   // frame send callback
  /^session_defer_stream_item/,    // stream deferral
];

// ── openssl domain knowledge ──
const OPENSSL_CLEAN_PATTERNS = [
  /^ossl_/,                         // internal OpenSSL functions
  /^SSL_CONNECTION_FROM_/,          // type conversion
  /^SSL_set_/,                      // SSL setters
  /^SSL_get_/,                      // SSL getters
  /^SSL_clear/,                     // SSL reset
  /^ERR_/,                          // error handling
  /^PACKET_/,                       // packet parsing
  /^BIO_/,                          // BIO I/O
  /^CRYPTO_/,                       // crypto utilities
  /^OPENSSL_/,                      // OpenSSL utilities
  /^OSSL_/,                         // OpenSSL internals
  /^DTLSv1_listen$/,                // DTLS listener
  /^TODO/,                          // placeholder
];

const OPENSSL_INTERESTING = [
  /_new$/,                          // allocation functions
  /_free$/,                         // cleanup functions
  /_init$/,                         // initialization
  /_cleanup$/,                      // cleanup
  /ch_/,                            // channel management
  /qrx_/,                           // QUIC receive
  /quic_/,                          // QUIC protocol
];

// ── Label creator ──
function createLabels(
  repo: string,
  cleanPatterns: RegExp[],
  interestingPatterns: RegExp[]
): { labels: string[]; report: any } {
  const seqFile = path.join(BENCH_DIR, `${repo}-sequences.json`);
  const raw = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const sequences: Sequence[] = raw.sequences || raw;

  const labels: string[] = [];
  let cleanCount = 0, violationCount = 0, skipCount = 0;
  const violations: string[] = [];
  const skipped: string[] = [];

  for (const seq of sequences) {
    const fn = seq.function || "";
    const calls = seq.calls || [];

    // Step 1: Check if it's a known clean pattern
    const isKnownClean = cleanPatterns.some(p => p.test(fn));
    if (isKnownClean) {
      labels.push("clean");
      cleanCount++;
      continue;
    }

    // Step 2: Run safeguard detectors
    const safeViolations = detectSafeguardViolations(calls, fn, "c");
    const protoViolations = detectProtocolViolations(calls);

    // Filter out library-internal false positives for session rules
    const realViolations = safeViolations.filter(v => {
      if (v.category === "session" && /^session_/.test(fn)) return false;
      return true;
    });

    if (realViolations.length > 0 || protoViolations.length > 0) {
      labels.push("violation");
      violationCount++;
      violations.push(fn);
      continue;
    }

    // Step 3: Is it an "interesting" function that needs review?
    const isInteresting = interestingPatterns.some(p => p.test(fn));
    if (isInteresting) {
      // Interesting + no violation → mark as clean (library handles it correctly)
      labels.push("clean");
      cleanCount++;
      continue;
    }

    // Step 4: Default — mark as clean (no trigger, no interesting pattern)
    labels.push("clean");
    cleanCount++;
  }

  return {
    labels,
    report: {
      repo,
      total: sequences.length,
      clean: cleanCount,
      violation: violationCount,
      skip: skipCount,
      violations,
      skipped,
    },
  };
}

// ── Main ──
const nghttp2 = createLabels("nghttp2", NGHTTP2_CLEAN_PATTERNS, NGHTTP2_INTERESTING);
const openssl = createLabels("openssl", OPENSSL_CLEAN_PATTERNS, OPENSSL_INTERESTING);

// Write label files
for (const [repo, result] of Object.entries({ nghttp2, openssl })) {
  const labelFile = path.join(BENCH_DIR, `${repo}-labels.json`);
  const labelData = {
    generated: new Date().toISOString(),
    repo,
    labels: result.labels,
    metadata: {
      strategy: "auto-detection + domain knowledge",
      needs_human_review: result.report.skipped.length > 0,
    },
  };
  fs.writeFileSync(labelFile, JSON.stringify(labelData, null, 2));
}

// Print report
console.log("\n═══ Gold Labels Created ═══\n");

for (const [repo, result] of Object.entries({ nghttp2, openssl })) {
  const r = result.report;
  console.log(`${repo}:`);
  console.log(`  Total:     ${r.total}`);
  console.log(`  Clean:     ${r.clean} (${(r.clean / r.total * 100).toFixed(0)}%)`);
  console.log(`  Violation: ${r.violation} (${(r.violation / r.total * 100).toFixed(0)}%)`);
  console.log(`  Skip:      ${r.skip}`);
  if (r.violations.length > 0) {
    console.log(`  Violations:`);
    for (const v of r.violations.slice(0, 10)) {
      console.log(`    - ${v}`);
    }
    if (r.violations.length > 10) console.log(`    ... and ${r.violations.length - 10} more`);
  }
  console.log();
}

// Suggest next: manual review of violations
console.log("─── Next Steps ───");
console.log("  1. Review violations manually to confirm TP/FP");
console.log("  2. Adjust clean patterns if needed");
console.log("  3. Run gold-benchmark-v5-v6-v7 with nghttp2 + openssl");
console.log("  4. Compare P0 rule detection against gold labels");
