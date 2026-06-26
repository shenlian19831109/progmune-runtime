/**
 * Protocol State Machine Detector
 *
 * Detects violations in protocol state machine sequences.
 * Unlike the Resource Lifecycle Detector (which checks acquire/release pairs),
 * this checks that required protocol steps appear in the correct order.
 *
 * Example:
 *   Expected:  init → connect → authenticate → transfer → close
 *   Detected:  init → connect → transfer (missing authenticate + close)
 *   → Violation: protocol incomplete
 */

// ═══════════════════════════════════════════════════════════════
// Protocol State Machine Definitions
// ═══════════════════════════════════════════════════════════════

interface ProtocolStep {
  pattern: RegExp;
  label: string;
  required: boolean;  // If true, missing this step = violation
}

interface ProtocolDefinition {
  name: string;
  category: string;
  steps: ProtocolStep[];
  /** Minimum required steps that must be present (as fraction of total) */
  minCompleteness: number;
}

const PROTOCOLS: ProtocolDefinition[] = [
  // ── SSH State Machine ──
  {
    name: "SSH Connection",
    category: "ssh",
    minCompleteness: 0.7,
    steps: [
      { pattern: /\b(ssh_state_init|ssh.*_init|ssh_setup)\b/i, label: "ssh_init", required: true },
      { pattern: /\b(ssh.*startup|ssh_state_startup)\b/i, label: "ssh_startup", required: true },
      { pattern: /\b(ssh.*hostkey|ssh_state_hostkey)\b/i, label: "ssh_hostkey", required: true },
      { pattern: /\b(ssh.*auth|ssh_state_authlist|ssh_state_auth)\b/i, label: "ssh_auth", required: true },
      { pattern: /\b(ssh.*pkey|ssh_state_pkey|ssh.*key)\b/i, label: "ssh_key", required: false },
      { pattern: /\b(ssh.*done|ssh.*finish|ssh.*close|ssh.*cleanup)\b/i, label: "ssh_done", required: true },
    ],
  },

  // ── SSL/TLS Handshake (OpenSSL, mbedTLS, GnuTLS, Schannel, wolfSSL, BearSSL) ──
  {
    name: "TLS Handshake",
    category: "ssl",
    minCompleteness: 0.5,
    steps: [
      // Init phase (any SSL library)
      { pattern: /\b(SSL_CTX_new|ssl_ctx_new|ossl_init|ssl_init|ssl_setup|mbedtls_ssl_config_init|gnutls_init|gtls_client_init|schannel_connect_step1|wolfSSL_CTX_new|wolfSSL_init|Curl_ssl_cf_get_primary_config)\b/i, label: "tls_init", required: true },
      // Config phase
      { pattern: /\b(SSL_CTX_set_verify|ssl_set_verify|ssl_config|mbedtls_ssl_config_defaults|gnutls_certificate_allocate|schannel_connect_step2|wolfSSL_CTX_set_verify|Curl_ssl_cf_get_config)\b/i, label: "tls_config", required: false },
      // Connect/handshake phase
      { pattern: /\b(SSL_connect|ssl_connect|ssl_handshake|ssl_do_handshake|mbedtls_ssl_handshake|gnutls_handshake|schannel_handshake|wolfSSL_connect)\b/i, label: "tls_connect", required: true },
      // Verify phase
      { pattern: /\b(SSL_get_verify|ssl_verify|ssl_check|mbedtls_ssl_get_verify|gnutls_certificate_verify|Curl_gtls_verifyserver|ossl_certchain)\b/i, label: "tls_verify", required: false },
      // Cleanup
      { pattern: /\b(SSL_free|ssl_free|SSL_CTX_free|ssl_cleanup|ssl_shutdown|mbedtls_ssl_free|gnutls_deinit|schannel_cleanup|wolfSSL_free|wolfSSL_CTX_free)\b/i, label: "tls_free", required: true },
    ],
  },

  // ── HTTP Transfer ──
  {
    name: "HTTP Transfer",
    category: "http",
    minCompleteness: 0.6,
    steps: [
      { pattern: /\b(curl_easy_init|http_init|transfer_init)\b/i, label: "http_init", required: true },
      { pattern: /\b(curl_easy_setopt|setopt|http_setup)\b/i, label: "http_setup", required: false },
      { pattern: /\b(curl_easy_perform|perform|transfer_exec|send_request)\b/i, label: "http_perform", required: true },
      { pattern: /\b(curl_easy_getinfo|getinfo|http_response)\b/i, label: "http_response", required: false },
      { pattern: /\b(curl_easy_cleanup|curl_easy_reset|http_cleanup|transfer_done)\b/i, label: "http_cleanup", required: true },
    ],
  },

  // ── Multi Handle ──
  {
    name: "Multi Handle Lifecycle",
    category: "multi",
    minCompleteness: 0.6,
    steps: [
      { pattern: /\b(curl_multi_init|multi_init)\b/i, label: "multi_init", required: true },
      { pattern: /\b(curl_multi_add_handle|multi_add)\b/i, label: "multi_add", required: true },
      { pattern: /\b(curl_multi_perform|multi_perform|multi_runsingle)\b/i, label: "multi_perform", required: true },
      { pattern: /\b(curl_multi_remove_handle|multi_remove|curl_multi_cleanup)\b/i, label: "multi_cleanup", required: true },
    ],
  },

  // ── Connection Lifecycle ──
  {
    name: "Connection Lifecycle",
    category: "connection",
    minCompleteness: 0.5,
    steps: [
      { pattern: /\b(Curl_connect|connect_to|do_connect|start_connect)\b/i, label: "connect", required: true },
      { pattern: /\b(Curl_setup_transfer|setup_transfer|transfer_setup)\b/i, label: "transfer_setup", required: false },
      { pattern: /\b(Curl_readwrite|transfer|readwrite|send_recv)\b/i, label: "transfer", required: true },
      { pattern: /\b(Curl_done|transfer_done|done|Curl_disconnect|disconnect)\b/i, label: "done", required: true },
    ],
  },

  // ── Auth/NTLM ──
  {
    name: "NTLM Authentication",
    category: "auth",
    minCompleteness: 0.6,
    steps: [
      { pattern: /\b(Curl_auth_create_ntlm|ntlm_init|auth_init)\b/i, label: "auth_init", required: true },
      { pattern: /\b(Curl_creds_user|creds_user|get_user)\b/i, label: "auth_user", required: false },
      { pattern: /\b(Curl_creds_passwd|creds_passwd|get_pass)\b/i, label: "auth_pass", required: false },
      { pattern: /\b(Curl_auth_decode|auth_decode|auth_verify)\b/i, label: "auth_decode", required: true },
    ],
  },

  // ── HTTP/2 Session ──
  {
    name: "HTTP/2 Session",
    category: "http2",
    minCompleteness: 0.6,
    steps: [
      { pattern: /\b(nghttp2_session_new|h2_session_init|http2_init)\b/i, label: "h2_init", required: true },
      { pattern: /\b(nghttp2_submit|h2_submit|http2_request)\b/i, label: "h2_request", required: false },
      { pattern: /\b(nghttp2_session_send|h2_send|http2_send)\b/i, label: "h2_send", required: true },
      { pattern: /\b(nghttp2_session_del|h2_close|http2_free)\b/i, label: "h2_close", required: true },
    ],
  },

  // ── GnuTLS Handshake ──
  {
    name: "GnuTLS Handshake",
    category: "ssl",
    minCompleteness: 0.5,
    steps: [
      { pattern: /\b(gtls_client_init|gnutls_init|Curl_gtls_shared_creds_create)\b/i, label: "gtls_init", required: true },
      { pattern: /\b(gnutls_certificate_get_peers|gnutls_cipher_get|Curl_gtls_verifyserver)\b/i, label: "gtls_verify", required: false },
      { pattern: /\b(gtls_verify_cert|Curl_ssl_init_certinfo|Curl_extract_certinfo)\b/i, label: "gtls_cert", required: true },
    ],
  },

  // ── QUIC/vQUIC Connection ──
  {
    name: "QUIC Connection",
    category: "connection",
    minCompleteness: 0.5,
    steps: [
      { pattern: /\b(vquic_ctx_init|quiche_config_new|cf_quiche_ctx_open)\b/i, label: "quic_init", required: true },
      { pattern: /\b(quiche_config_set|quiche_config_enable|cf_quiche_connect)\b/i, label: "quic_config", required: false },
      { pattern: /\b(quiche_conn_send|quiche_conn_recv|quic_send)\b/i, label: "quic_transfer", required: true },
    ],
  },

  // ── SPNEGO Auth ──
  {
    name: "SPNEGO Authentication",
    category: "auth",
    minCompleteness: 0.5,
    steps: [
      { pattern: /\b(Curl_auth_decode_spnego|spnego_init|QuerySecurityPackageInfo)\b/i, label: "spnego_init", required: true },
      { pattern: /\b(Curl_auth_build_spn|Curl_creds_sasl_service|Curl_creds_has_sasl_service)\b/i, label: "spnego_spn", required: false },
      { pattern: /\b(Curl_auth_cleanup_spnego|FreeContextBuffer|DeleteSecurityContext)\b/i, label: "spnego_cleanup", required: true },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// Detection
// ═══════════════════════════════════════════════════════════════

export interface ProtocolViolation {
  protocol: string;
  category: string;
  type: "missing_step" | "wrong_order" | "incomplete";
  missing: string[];
  detail: string;
}

export function detectProtocolViolations(calls: string[]): ProtocolViolation[] {
  const violations: ProtocolViolation[] = [];

  for (const proto of PROTOCOLS) {
    // Match each step against the call sequence
    const matched: Array<{ label: string; index: number; required: boolean }> = [];

    for (let ci = 0; ci < calls.length; ci++) {
      for (const step of proto.steps) {
        if (step.pattern.test(calls[ci])) {
          // Only record first match of each step
          if (!matched.some(m => m.label === step.label)) {
            matched.push({ label: step.label, index: ci, required: step.required });
          }
          break; // Each call matches at most one step
        }
      }
    }

    if (matched.length < 2) continue; // Need at least 2 steps to confirm protocol is present

    // Check completeness
    const requiredSteps = proto.steps.filter(s => s.required);
    const matchedRequired = matched.filter(m => m.required);
    const completeness = matchedRequired.length / requiredSteps.length;

    // Check: missing required steps
    const missing: string[] = [];
    for (const rs of requiredSteps) {
      if (!matchedRequired.some(m => m.label === rs.label)) {
        missing.push(rs.label);
      }
    }

    if (missing.length > 0) {
      violations.push({
        protocol: proto.name,
        category: proto.category,
        type: "missing_step",
        missing,
        detail: `${proto.name} missing: ${missing.join(", ")}. Found: ${matched.map(m => m.label).join(" → ")}`,
      });
      continue;
    }

    // Check: step ordering
    const indices = matched.map(m => m.index);
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] < indices[i - 1]) {
        violations.push({
          protocol: proto.name,
          category: proto.category,
          type: "wrong_order",
          missing: [],
          detail: `${proto.name}: ${matched[i].label} appears before ${matched[i-1].label} (expected order: ${proto.steps.map(s => s.label).join(" → ")})`,
        });
        break; // One ordering violation per protocol
      }
    }

    // Check: overall completeness below threshold
    if (completeness < proto.minCompleteness && violations.length === 0) {
      const found = matched.map(m => m.label);
      violations.push({
        protocol: proto.name,
        category: proto.category,
        type: "incomplete",
        missing: proto.steps.filter(s => s.required && !found.includes(s.label)).map(s => s.label),
        detail: `${proto.name}: ${(completeness * 100).toFixed(0)}% complete (min ${(proto.minCompleteness * 100).toFixed(0)}%). Found: ${found.join(" → ")}`,
      });
    }
  }

  return violations;
}

/**
 * Validate a call sequence against protocol state machine definitions.
 */
export function validateProtocolState(calls: string[]): {
  valid: boolean;
  violations: ProtocolViolation[];
  matchedProtocols: string[];
  detail: string;
} {
  const violations = detectProtocolViolations(calls);
  const matchedProtocols = [...new Set(violations.map(v => v.protocol))];

  let detail: string;
  if (violations.length === 0) {
    detail = "Protocol state complete";
  } else {
    detail = violations.map(v => v.detail).join("; ");
  }

  return {
    valid: violations.length === 0,
    violations,
    matchedProtocols,
    detail,
  };
}

// ═══════════════════════════════════════════════════════════════
// Combined Detector (Resource + Protocol)
// ═══════════════════════════════════════════════════════════════

export function validateCombined(calls: string[], enclosingFuncName?: string): {
  valid: boolean;
  resourceViolations: ReturnType<typeof import("./resource-detector").validateResourceLifecycle>["violations"];
  protocolViolations: ProtocolViolation[];
  detail: string;
} {
  const { validateResourceLifecycle } = require("./resource-detector");
  const resResult = validateResourceLifecycle(calls, enclosingFuncName);
  const protoResult = validateProtocolState(calls);

  const allViolations = [...resResult.violations, ...protoResult.violations];

  return {
    valid: allViolations.length === 0,
    resourceViolations: resResult.violations,
    protocolViolations: protoResult.violations,
    detail: allViolations.map(v => "detail" in v ? (v as any).detail : v.detail).join("; ") || "All checks passed",
  };
}

// ═══════════════════════════════════════════════════════════════
// CLI — Combined Precision Report
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const args = process.argv.slice(2);
  const repoPath = path.resolve(args.find(a => !a.startsWith("--")) || ".");
  const baseDir = path.dirname(repoPath);
  const repoName = path.basename(repoPath);
  const seqFile = path.join(baseDir, `${repoName}-sequences.json`);
  const labelFile = path.join(baseDir, `${repoName}-labels.json`);
  const mode = args.includes("--protocol") ? "protocol" : args.includes("--resource") ? "resource" : "combined";

  if (!fs.existsSync(seqFile) || !fs.existsSync(labelFile)) {
    console.error(`❌ Files not found: ${seqFile}, ${labelFile}`);
    process.exit(1);
  }

  const seqData = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const labelData = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  const sequences = seqData.sequences || seqData;
  const labels = labelData.labels || labelData;

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const mismatches: any[] = [];

  for (const seq of sequences) {
    const idx = sequences.indexOf(seq);
    const expected = labels[idx];
    if (!expected || expected === "s" || expected === "skip") continue;

    const funcName = seq.function || "";

    let detected: "clean" | "violation";
    let detail = "";

    if (mode === "resource") {
      const { validateResourceLifecycle } = require("./resource-detector");
      const r = validateResourceLifecycle(seq.calls || [], funcName);
      detected = r.valid ? "clean" : "violation";
      detail = r.detail;
    } else if (mode === "protocol") {
      const r = validateProtocolState(seq.calls || []);
      detected = r.valid ? "clean" : "violation";
      detail = r.detail;
    } else {
      // combined
      const r = validateCombined(seq.calls || [], funcName);
      detected = r.valid ? "clean" : "violation";
      detail = r.detail;
    }

    if (expected === "violation" && detected === "violation") tp++;
    else if (expected === "clean" && detected === "violation") fp++;
    else if (expected === "clean" && detected === "clean") tn++;
    else if (expected === "violation" && detected === "clean") fn++;

    if (expected !== detected) {
      mismatches.push({ idx, fn: funcName, expected, detected, calls: (seq.calls||[]).slice(0,5), detail });
    }
  }

  const total = tp + fp + tn + fn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
  const color = (v: number) => v >= 0.7 ? C.green : v >= 0.5 ? C.yellow : C.red;

  const modeLabel = mode === "resource" ? "Resource Lifecycle" : mode === "protocol" ? "Protocol State Machine" : "Combined (Resource + Protocol)";

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}${modeLabel} — ${repoName}${C.reset}${" ".repeat(Math.max(0,30-modeLabel.length-repoName.length))}${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════╝${C.reset}\n`);
  console.log(`  Samples:    ${total}`);
  console.log(`  TP: ${C.green}${tp}${C.reset}  FP: ${C.red}${fp}${C.reset}  TN: ${C.green}${tn}${C.reset}  FN: ${C.red}${fn}${C.reset}\n`);
  console.log(`  Precision:  ${color(precision)}${pct(precision)}${C.reset}`);
  console.log(`  Recall:     ${color(recall)}${pct(recall)}${C.reset}`);
  console.log(`  F1:         ${color(f1)}${pct(f1)}${C.reset}\n`);

  if (mismatches.length > 0) {
    console.log(`  ${C.yellow}Details:${C.reset}`);
    for (const m of mismatches.slice(0, 15)) {
      const icon = m.expected === "violation" ? `${C.red}FN${C.reset}` : `${C.yellow}FP${C.reset}`;
      console.log(`    ${icon} [${m.idx}] ${m.expected}→${m.detected}  ${(m.calls||[]).join(" → ")}`);
      if (m.detail) console.log(`       ${C.dim}${m.detail.slice(0, 100)}${C.reset}`);
    }
  }

  console.log(`\n  Rating: ${f1 >= 0.7 ? C.green+"GOOD" : f1 >= 0.5 ? C.yellow+"FAIR" : C.red+"NEEDS IMPROVEMENT"}${C.reset}\n`);
}
