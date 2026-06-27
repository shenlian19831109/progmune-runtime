/**
 * Protocol State Machine Detector v2 — Repo-Agnostic
 *
 * All protocol patterns use \w* prefix/suffix patterns to match
 * any project's naming conventions (curl, nginx, redis, any C project).
 */

interface ProtocolStep { pattern: RegExp; label: string; required: boolean; }
interface ProtocolDefinition { name: string; category: string; steps: ProtocolStep[]; minCompleteness: number; }

const PROTOCOLS: ProtocolDefinition[] = [
  {
    name: "TLS Handshake", category: "ssl", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*ssl\w*init|\w*SSL\w*new|\w*ssl\w*create|\w*ssl\w*setup|\w*tls\w*init|\w*TLS\w*new|\w*ssl_cf_get_primary|\w*OPENSSL_init)\b/i, label: "tls_init", required: true },
      { pattern: /\b(\w*ssl\w*connect|\w*ssl\w*handshake|\w*tls\w*connect|\w*tls\w*handshake|\w*SSL_do_handshake)\b/i, label: "tls_connect", required: true },
      { pattern: /\b(\w*ssl\w*free|\w*SSL\w*cleanup|\w*ssl\w*shutdown|\w*tls\w*free|\w*SSL_CTX_free)\b/i, label: "tls_free", required: true },
    ],
  },
  {
    name: "SSH Connection", category: "ssh", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*ssh\w*init|ssh\w*setup|\w*ssh_state_init)\b/i, label: "ssh_init", required: true },
      { pattern: /\b(\w*ssh\w*auth|\w*ssh\w*login|\w*ssh\w*cred)\b/i, label: "ssh_auth", required: true },
      { pattern: /\b(\w*ssh\w*done|\w*ssh\w*close|\w*ssh\w*cleanup|\w*ssh\w*error|\w*ssh\w*finish)\b/i, label: "ssh_done", required: true },
    ],
  },
  {
    name: "HTTP Request", category: "http", minCompleteness: 0.5,
    steps: [
      // init: handler setup, hook registration (nginx + Apache + curl)
      { pattern: /\b(\w*http\w*init|\w*http\w*create|\w*http\w*setup|\w*http\w*handler|\w*hook_handler|\w*hook_pre_config|curl_easy_init)\b/i, label: "http_init", required: true },
      // process: request handling (all naming conventions)
      { pattern: /\b(\w*http\w*perform|\w*http\w*send|\w*http\w*request|\w*http\w*process|\w*process_request|\w*run_method|curl_easy_perform|\w*http\w*response|ap_pass_brigade)\b/i, label: "http_send", required: true },
      // cleanup: finalize (all naming conventions)
      { pattern: /\b(\w*http\w*cleanup|\w*http\w*free|\w*http\w*close|\w*http\w*done|\w*finalize_request|curl_easy_cleanup|\w*http\w*finalize|ap_remove_output_filter)\b/i, label: "http_cleanup", required: true },
    ],
  },
  {
    name: "Connection Lifecycle", category: "connection", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*connect\b|\w*do_connect|\w*start_connect|\w*conn\w*init|\w*conn\w*setup)\b/i, label: "conn_init", required: true },
      { pattern: /\b(\w*send\b|\w*recv\b|\w*readwrite|\w*transfer|\w*xfer)\b/i, label: "conn_transfer", required: true },
      { pattern: /\b(\w*disconnect|\w*done\b|\w*conn\w*cleanup|\w*close_connection|\w*conn\w*free)\b/i, label: "conn_done", required: true },
    ],
  },
  {
    name: "Authentication", category: "auth", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*auth\w*init|\w*auth\w*create|\w*auth\w*ntlm|\w*auth\w*spnego|\w*auth\w*digest|\w*auth\w*plain|\w*auth\w*login)\b/i, label: "auth_init", required: true },
      { pattern: /\b(\w*auth\w*free|\w*auth\w*cleanup|\w*auth\w*delete|FreeContextBuffer|DeleteSecurityContext)\b/i, label: "auth_cleanup", required: true },
    ],
  },
  {
    name: "HTTP/2 Session", category: "http2", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*h2\w*init|\w*http2\w*init|\w*nghttp2_session_new)\b/i, label: "h2_init", required: true },
      { pattern: /\b(\w*h2\w*send|\w*http2\w*send|\w*nghttp2_submit|\w*nghttp2_session_send)\b/i, label: "h2_send", required: true },
      { pattern: /\b(\w*h2\w*close|\w*http2\w*free|\w*nghttp2_session_del)\b/i, label: "h2_close", required: true },
    ],
  },
  {
    name: "QUIC Connection", category: "connection", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*quic\w*init|\w*quic\w*new|\w*quiche_config_new)\b/i, label: "quic_init", required: true },
      { pattern: /\b(\w*quic\w*send|\w*quic\w*recv|\w*quiche_conn)\b/i, label: "quic_transfer", required: true },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// Detection (unchanged)
// ═══════════════════════════════════════════════════════════════

export interface ProtocolViolation {
  protocol: string; category: string;
  type: "missing_step" | "wrong_order" | "incomplete";
  missing: string[]; detail: string;
  /** Concept-level explanation: which specific protocol concepts are missing */
  conceptDetail?: string;
  missingConcepts?: string[];
  foundConcepts?: string[];
}

// ── Concept Mapping (Ontology → Detector) ──

const CONCEPT_MAP: Record<string, Record<string, string[]>> = {
  "TLS Handshake": { "tls_init": ["ClientHello"], "tls_connect": ["ServerHello", "Certificate"], "tls_free": ["Finished"] },
  "SSH Connection": { "ssh_init": ["Connection"], "ssh_auth": ["Authentication"], "ssh_done": ["Channel"] },
  "HTTP Request": { "http_init": ["Request"], "http_send": ["Response"], "http_cleanup": ["Cleanup"] },
  "HTTP/2 Session": { "h2_init": ["Session Init"], "h2_send": ["Stream Submit"], "h2_close": ["Session Close"] },
};

function enrichWithConcepts(v: ProtocolViolation, matchedLabels: string[]): ProtocolViolation {
  const m = CONCEPT_MAP[v.protocol]; if (!m) return v;
  const mc: string[] = [], fc: string[] = [];
  for (const l of v.missing) { const c = m[l] || [l]; mc.push(...c); }
  for (const l of matchedLabels) { const c = m[l] || [l]; fc.push(...c); }
  v.missingConcepts = [...new Set(mc)]; v.foundConcepts = [...new Set(fc)];
  v.conceptDetail = `Missing: ${v.missingConcepts.join(", ")}. Found: ${v.foundConcepts.join(", ")}`;
  return v;
}

export function detectProtocolViolations(calls: string[]): ProtocolViolation[] {
  const violations: ProtocolViolation[] = [];
  for (const proto of PROTOCOLS) {
    const matched: Array<{ label: string; index: number; required: boolean }> = [];
    for (let ci = 0; ci < calls.length; ci++) {
      for (const step of proto.steps) {
        if (step.pattern.test(calls[ci])) {
          if (!matched.some(m => m.label === step.label)) matched.push({ label: step.label, index: ci, required: step.required });
          break;
        }
      }
    }
    if (matched.length < 2) continue;
    const requiredSteps = proto.steps.filter(s => s.required);
    const matchedRequired = matched.filter(m => m.required);
    const completeness = matchedRequired.length / requiredSteps.length;
    const missing: string[] = [];
    for (const rs of requiredSteps) {
      if (!matchedRequired.some(m => m.label === rs.label)) missing.push(rs.label);
    }
    const labels = matched.map(m => m.label);
    if (missing.length > 0) {
      violations.push(enrichWithConcepts({ protocol: proto.name, category: proto.category, type: "missing_step", missing, detail: `${proto.name} missing: ${missing.join(", ")}. Found: ${labels.join(" → ")}` }, labels));
      continue;
    }
    if (completeness < proto.minCompleteness) {
      violations.push(enrichWithConcepts({ protocol: proto.name, category: proto.category, type: "incomplete", missing: proto.steps.filter(s => s.required && !labels.includes(s.label)).map(s => s.label), detail: `${proto.name}: ${(completeness * 100).toFixed(0)}% complete. Found: ${labels.join(" → ")}` }, labels));
    }
  }
  return violations;
}

export function validateProtocolState(calls: string[]): { valid: boolean; violations: ProtocolViolation[]; matchedProtocols: string[]; detail: string } {
  const violations = detectProtocolViolations(calls);
  const matchedProtocols = [...new Set(violations.map(v => v.protocol))];
  const detail = violations.length === 0 ? "Protocol state complete" : violations.map(v => v.conceptDetail || v.detail).join("; ");
  return { valid: violations.length === 0, violations, matchedProtocols, detail };
}

export function validateCombined(calls: string[], enclosingFuncName?: string): { valid: boolean; resourceViolations: any[]; protocolViolations: ProtocolViolation[]; detail: string } {
  const { validateResourceLifecycle } = require("./resource-detector");
  const res = validateResourceLifecycle(calls, enclosingFuncName);
  const proto = validateProtocolState(calls);
  const all = [...res.violations, ...proto.violations];
  return { valid: all.length === 0, resourceViolations: res.violations, protocolViolations: proto.violations, detail: all.map((v: any) => v.detail || "").join("; ") || "All checks passed" };
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const fs = require("fs"); const path = require("path");
  const args = process.argv.slice(2);
  const repoPath = path.resolve(args.find((a: string) => !a.startsWith("--")) || ".");
  const baseDir = path.dirname(repoPath); const repoName = path.basename(repoPath);
  const seqFile = path.join(baseDir, `${repoName}-sequences.json`);
  const labelFile = path.join(baseDir, `${repoName}-labels.json`);
  const mode = args.includes("--protocol") ? "protocol" : args.includes("--resource") ? "resource" : "combined";
  if (!fs.existsSync(seqFile) || !fs.existsSync(labelFile)) { console.error("Files not found"); process.exit(1); }
  const seqData = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const labelData = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  const sequences = seqData.sequences || seqData; const labels = labelData.labels || labelData;
  let tp = 0, fp = 0, tn = 0, fn = 0; const mismatches: any[] = [];
  for (const seq of sequences) {
    const idx = sequences.indexOf(seq); const expected = labels[idx];
    if (!expected || expected === "s" || expected === "skip") continue;
    const funcName = seq.function || "";
    let detected: "clean" | "violation"; let detail = "";
    if (mode === "resource") { const r = require("./resource-detector").validateResourceLifecycle(seq.calls || [], funcName); detected = r.valid ? "clean" : "violation"; detail = r.detail; }
    else if (mode === "protocol") { const r = validateProtocolState(seq.calls || []); detected = r.valid ? "clean" : "violation"; detail = r.detail; }
    else { const r = validateCombined(seq.calls || [], funcName); detected = r.valid ? "clean" : "violation"; detail = r.detail; }
    if (expected === "violation" && detected === "violation") tp++; else if (expected === "clean" && detected === "violation") fp++; else if (expected === "clean" && detected === "clean") tn++; else if (expected === "violation" && detected === "clean") fn++;
    if (expected !== detected) mismatches.push({ idx, fn: funcName, expected, detected, calls: (seq.calls || []).slice(0, 5), detail });
  }
  const total = tp + fp + tn + fn;
  const P = tp + fp > 0 ? tp / (tp + fp) : 0; const R = tp + fn > 0 ? tp / (tp + fn) : 0;
  const F1 = P + R > 0 ? 2 * P * R / (P + R) : 0;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r2: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m" };
  const clr = (v: number) => v >= 0.7 ? C.g : v >= 0.5 ? C.y : C.r2;
  const label = mode === "resource" ? "Resource Lifecycle" : mode === "protocol" ? "Protocol State Machine" : "Combined (Resource + Protocol)";
  console.log(`\n${C.b}${C.c}╔══════════════════════════════════════════════╗${C.r}`);
  console.log(`${C.b}${C.c}║${C.r}  ${C.b}${label} — ${repoName}${C.r}${" ".repeat(Math.max(0, 30 - label.length - repoName.length))}${C.b}${C.c}║${C.r}`);
  console.log(`${C.b}${C.c}╚══════════════════════════════════════════════╝${C.r}\n`);
  console.log(`  Samples:    ${total}\n  TP: ${C.g}${tp}${C.r}  FP: ${C.r2}${fp}${C.r}  TN: ${C.g}${tn}${C.r}  FN: ${C.r2}${fn}${C.r}\n`);
  console.log(`  Precision:  ${clr(P)}${pct(P)}${C.r}\n  Recall:     ${clr(R)}${pct(R)}${C.r}\n  F1:         ${clr(F1)}${pct(F1)}${C.r}\n`);
  if (mismatches.length > 0) { console.log(`  ${C.y}Details:${C.r}`); for (const m of mismatches.slice(0, 12)) console.log(`    ${m.expected === "violation" ? C.r2 + "FN" : C.y + "FP"}${C.r} [${m.idx}] ${m.expected}→${m.detected}  ${(m.calls || []).join(" → ")}` + (m.detail ? `\n       ${C.d}${m.detail.slice(0, 100)}${C.r}` : "")); }
  console.log(`\n  Rating: ${F1 >= 0.7 ? C.g + "GOOD" : F1 >= 0.5 ? C.y + "FAIR" : C.r2 + "NEEDS IMPROVEMENT"}${C.r}\n`);
}
