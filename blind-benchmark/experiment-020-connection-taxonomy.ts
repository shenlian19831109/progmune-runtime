/**
 * Experiment-020: Connection Lifecycle Safety Taxonomy
 *
 * Question: Does "Connection Lifecycle Safety" deserve to be a protocol category?
 *
 * Independent Variable: ONE new rule — connection functions must validate state
 *   or handle errors before connecting.
 *
 * Target: 1 FN (Curl_conn_connect)
 * Expected: ≥30% recovery (1/1), 0 FP
 *
 * Usage: npx ts-node blind-benchmark/experiment-020-connection-taxonomy.ts
 */

import * as fs from "fs";
import * as path from "path";
import { SafeguardViolation } from "../src/protocol-detector";

interface SafeguardRule {
  name: string; category: string; trigger: RegExp;
  safeguards: Array<{ pattern: RegExp; label: string }>;
  violationMessage: string; conceptMissing: string[]; conceptExpected: string[];
}

const BASELINE: SafeguardRule[] = [
  { name: "Password Hashing", category: "password_hashing", trigger: /\b(register|signUp|createUser|createAccount|registerUser)\b/i, safeguards: [{ pattern: /\b(bcrypt|argon2|scrypt|pbkdf2|hash|hashPassword|createHash|hashSync|hash_password)\b/i, label: "secure_hash" }], violationMessage: "No secure password hashing.", conceptMissing: ["PasswordHash"], conceptExpected: ["bcrypt"] },
  { name: "Authorization (Ownership Check)", category: "authorization", trigger: /\b(add|create|delete|remove|update|toggle|modify|edit|lock|ban|process|refund|assign|transfer|share|schedule|upload|set)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|checkOwner|authorId\s*[!=]==?|ownerId\s*[!=]==?|userId\s*[!=]==?|\.owner\s*[!=]==?)/i, label: "auth_check" }], violationMessage: "Mutation without ownership verification.", conceptMissing: ["OwnershipCheck"], conceptExpected: ["getUser"] },
  { name: "Authorization (Unauthenticated Access)", category: "authorization", trigger: /\b(get|list|download|view|read|fetch|find)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|token|session)\b/i, label: "auth_check" }], violationMessage: "Data access without auth.", conceptMissing: ["AuthenticationCheck"], conceptExpected: ["token"] },
  { name: "Data Integrity (Foreign Key)", category: "data_integrity", trigger: /\b(add|create|post|refund|process|send)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(get|find|check|exists|lookup|status)[A-Z]\w*\b/i, label: "fk_check" }], violationMessage: "Creates child without verifying parent.", conceptMissing: ["ForeignKeyValidation"], conceptExpected: ["checkExists"] },
  { name: "Input Validation", category: "input_validation", trigger: /\b(create|add|post|send|upload)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(validate|sanitize|check|verify)\w*(Content|Input|Length|Title|Body|Type|Size|File)\b/i, label: "input_validation" }], violationMessage: "No input validation.", conceptMissing: ["InputSanitization"], conceptExpected: ["validateContent"] },
  { name: "TLS Enforcement", category: "tls_enforcement", trigger: /\b(createServer|listen|handleRequest|app\.listen|express)\b/i, safeguards: [{ pattern: /\b(https|tls|ssl|cert|key|TLS|SSL|HTTPS|createSecureContext|credentials)\b/i, label: "tls_config" }], violationMessage: "Server without TLS.", conceptMissing: ["TLSConfiguration"], conceptExpected: ["https"] },
  { name: "Token Security", category: "token_security", trigger: /\b(authenticate|login|signIn|logIn|createSession|generateToken)\b/i, safeguards: [{ pattern: /\b(crypto\.randomUUID|jwt\.sign|jsonwebtoken|nanoid|randomBytes)\b/i, label: "secure_token" }], violationMessage: "Token without secure random.", conceptMissing: ["SecureRandom"], conceptExpected: ["crypto.randomUUID"] },
  { name: "Authorization (Resource Ownership)", category: "authorization", trigger: /\b(toggle|remove)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(ownerId\s*[!=]==?|authorId\s*[!=]==?|userId\s*[!=]==?|createdBy|\.owner\s*[!=]==?)/i, label: "ownership_comparison" }], violationMessage: "No ownership check.", conceptMissing: ["ResourceOwnership"], conceptExpected: ["ownerId"] },
  { name: "Payment Order Verification", category: "data_integrity", trigger: /\b(process|create|make|submit)\w*(Payment|Charge|Transaction)\b/i, safeguards: [{ pattern: /\b(getOrder|verifyOrder|checkOrder|findOrder|orderExists|order\b)/i, label: "order_verification" }], violationMessage: "Payment without order verification.", conceptMissing: ["OrderVerification"], conceptExpected: ["getOrder"] },
  { name: "Room Membership Check", category: "authorization", trigger: /\b(send|post|publish)\w*(Message|Msg)\b/i, safeguards: [{ pattern: /\b(joinRoom|roomMember|checkMember|isMember|members\.includes|members\.find|memberOf|inRoom)\b/i, label: "room_membership" }], violationMessage: "Message without room membership check.", conceptMissing: ["RoomMembership"], conceptExpected: ["joinRoom"] },
  { name: "Refund Status Verification", category: "data_integrity", trigger: /\b(refund|cancel|void|reverse)\w*(Payment|Order|Charge|Transaction)\b/i, safeguards: [{ pattern: /\b(status|\.status|getStatus|checkStatus|orderStatus|paymentStatus)\b/i, label: "status_check" }], violationMessage: "Refund without status check.", conceptMissing: ["StatusVerification"], conceptExpected: ["status"] },
  { name: "Rate Limiting", category: "rate_limiting", trigger: /\b(createServer|listen|handleRequest|app\.listen|express|router\.(post|get|put|delete|patch))\b/i, safeguards: [{ pattern: /\b(rateLimit|rate_limit|throttle|RateLimiter|expressRateLimit|rateLimiterMiddleware|limiter)\b/i, label: "rate_limit" }], violationMessage: "No rate limiting.", conceptMissing: ["RateLimiting"], conceptExpected: ["rateLimit"] },
  { name: "Key Derivation Safety", category: "crypto", trigger: /\b(ecdh|curve25519|ssh_dh_|kex_|build_k|do_create_k|derive\w*secret|dh_set_param|ec_key|ecdh_)\b/i, safeguards: [{ pattern: /\b(EC_KEY_get0_group|EC_KEY_check_key|EVP_PKEY_check|DH_check|get0_group|check_key|verify_param|validate_curve|ssh_key_is_private|ssh_key_type)\b/i, label: "key_validation" }, { pattern: /\b(EC_KEY_free|EVP_PKEY_free|DH_free|BN_free|BN_clear_free|gcry_sexp_release|mbedtls_ecp_group_free|mbedtls_ecp_point_free|mbedtls_mpi_free|ssh_string_free|ssh_string_burn|ssh_buffer_free|OSSL_PARAM_BLD_free|OSSL_PARAM_free|explicit_bzero)\b/i, label: "crypto_cleanup" }], violationMessage: "Key derivation lacks validation or cleanup.", conceptMissing: ["KeyValidation"], conceptExpected: ["EVP_PKEY_free"] },
];

// ═══════════════════════════════════════════════════
// EXPERIMENT: Connection Lifecycle Safety
// ═══════════════════════════════════════════════════

const CONNECTION_LIFECYCLE_RULE: SafeguardRule = {
  name: "Connection Lifecycle Safety",
  category: "connection",
  trigger: /\b(Curl_conn_connect|Curl_connect|conn_connect|do_connect|start_connect|socket_connect|tcp_connect|_connect\b)/i,
  safeguards: [
    // Connection state validation — check state BEFORE connecting
    { pattern: /\b(CONN_SOCK_IDX_VALID|Curl_conn_is_connected|connected|is_connected|conn_is_alive|socket_valid|fd_valid|sock_valid)\b/i, label: "state_check" },
    // Error path / disconnect — handle failures
    { pattern: /\b(Curl_conn_disconnect|conn_disconnect|socket_close|close_socket|conn_fail|connect_failed|CURL_SOCKET_BAD|return.*error|goto.*fail|goto.*error)\b/i, label: "error_handling" },
  ],
  violationMessage: "Connection function lacks state validation or error handling. May connect on invalid socket or leak resources on failure.",
  conceptMissing: ["ConnectionStateCheck", "ErrorHandling"],
  conceptExpected: ["CONN_SOCK_IDX_VALID", "conn_disconnect"],
};

const EXPERIMENTAL = [...BASELINE, CONNECTION_LIFECYCLE_RULE];

// ═══════════════════════════════════════════════════
// Detection + Data loading (same as prior experiments)
// ═══════════════════════════════════════════════════

function identifierParse(name: string): string[] {
  const parts = name.split(/[_\-\.]/);
  const words: string[] = [];
  for (const part of parts) {
    const camelWords = part.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
    for (const w of camelWords) if (w.length > 0) words.push(w);
  }
  return words;
}

function detect(calls: string[], funcName: string | undefined, rules: SafeguardRule[]): SafeguardViolation[] {
  const violations: SafeguardViolation[] = [];
  const rawCalls = funcName ? [funcName, ...calls] : [...calls];
  const parsedWords: string[] = [];
  for (const c of rawCalls) parsedWords.push(...identifierParse(c));
  const effectiveCalls = [...new Set([...rawCalls, ...parsedWords])];
  const rawLower = funcName?.toLowerCase() || "";
  const AUTH_PATTERN = /\b(register|signup|signin|login|authenticate|createuser|createaccount|registeruser|registernewuser|dologin|verifytoken|validatesession|getuser|getsessionuser|getcurrentuser|endsession|logout|signout|dologout|destroysession|invalidatesession|invalidate|signout)\b/i;
  const isAuth = funcName != null && (AUTH_PATTERN.test(rawLower) || identifierParse(funcName).some(w => AUTH_PATTERN.test(w)));

  for (const rule of rules) {
    if (!effectiveCalls.some(c => rule.trigger.test(c))) continue;
    if (isAuth && rule.category === "authorization") continue;
    if (rule.safeguards.find(s => effectiveCalls.some(c => s.pattern.test(c)))) continue;
    violations.push({ rule: rule.name, category: rule.category, type: "missing_safeguard", detail: rule.violationMessage, conceptDetail: `Missing: ${rule.conceptMissing.join(", ")}`, missingConcepts: rule.conceptMissing, expectedConcepts: rule.conceptExpected });
  }
  return violations;
}

interface Sequence { function: string; file: string; calls: string[]; }
function loadRepo(repoName: string): { sequences: Sequence[]; labels: Map<number, string> } {
  const benchDir = path.resolve(__dirname, "..", "benchmarks");
  const seqPath = path.join(benchDir, `${repoName}-sequences.json`);
  const labPath = path.join(benchDir, `${repoName}-labels.json`);
  const seqData = JSON.parse(fs.readFileSync(seqPath, "utf-8"));
  const labData = JSON.parse(fs.readFileSync(labPath, "utf-8"));
  const sequences: Sequence[] = (seqData.sequences || seqData).map((s: any) => ({ function: s.function || "", file: s.file || "", calls: s.calls || [] }));
  const labels = new Map<number, string>();
  for (const [key, val] of Object.entries(labData.labels || labData)) {
    const idx = parseInt(key);
    if (!isNaN(idx) && (val === "clean" || val === "violation")) labels.set(idx, val as string);
  }
  return { sequences, labels };
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r2: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", m: "\x1b[35m" };

console.log(`${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Experiment-020: Connection Lifecycle Safety${C.r}                         ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.d}Target: 1 FN (Curl_conn_connect) — regex-friendly${C.r}                     ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

const allChanged: any[] = [];
let bTP = 0, bFP = 0, bTN = 0, bFN = 0, eTP = 0, eFP = 0, eTN = 0, eFN = 0;

for (const repo of ["curl", "libssh"]) {
  const { sequences, labels } = loadRepo(repo);
  const fcm = new Map<string, Set<string>>();
  for (const s of sequences) {
    if (!fcm.has(s.file)) fcm.set(s.file, new Set());
    for (const c of s.calls) fcm.get(s.file)!.add(c);
  }
  for (const [idx, expected] of labels) {
    if (idx >= sequences.length) continue;
    const seq = sequences[idx];
    if (!seq.function || seq.calls.length === 0) continue;
    const merged = [...new Set([...(fcm.get(seq.file) || new Set()), ...seq.calls])];
    const bV = detect(merged, seq.function, BASELINE).length === 0 ? "clean" : "violation";
    const eV = detect(merged, seq.function, EXPERIMENTAL).length === 0 ? "clean" : "violation";
    if (expected === "violation" && bV === "violation") bTP++; else if (expected === "clean" && bV === "violation") bFP++; else if (expected === "clean" && bV === "clean") bTN++; else if (expected === "violation" && bV === "clean") bFN++;
    if (expected === "violation" && eV === "violation") eTP++; else if (expected === "clean" && eV === "violation") eFP++; else if (expected === "clean" && eV === "clean") eTN++; else if (expected === "violation" && eV === "clean") eFN++;
    if (bV !== eV) allChanged.push({ repo, idx, func: seq.function, file: seq.file.split("/").pop(), expected, bV, eV });
  }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const bP = bTP + bFP > 0 ? bTP / (bTP + bFP) : 0, bR = bTP + bFN > 0 ? bTP / (bTP + bFN) : 0;
const eP = eTP + eFP > 0 ? eTP / (eTP + eFP) : 0, eR = eTP + eFN > 0 ? eTP / (eTP + eFN) : 0;

console.log(`  Baseline:    TP=${bTP} FP=${bFP} TN=${bTN} FN=${bFN}  P=${pct(bP)} R=${pct(bR)}`);
console.log(`  Experiment:  TP=${eTP} FP=${eFP} TN=${eTN} FN=${eFN}  P=${pct(eP)} R=${pct(eR)}`);
console.log(`  Δ:           TP${eTP-bTP>=0?"+":""}${eTP-bTP} FP${eFP-bFP>=0?"+":""}${eFP-bFP} FN${eFN-bFN>=0?"+":""}${eFN-bFN}\n`);

const targetRecovered = allChanged.filter(r => r.repo === "curl" && r.idx === 16 && r.bV === "clean" && r.eV === "violation").length;
console.log(`  Target [16] Curl_conn_connect: ${targetRecovered ? `${C.g}✅ recovered${C.r}` : `${C.r2}❌ not recovered${C.r}`}`);
console.log(`  Changed: ${allChanged.length} sequences\n`);

for (const r of allChanged) {
  const impact = r.expected === "violation" && r.bV === "clean" && r.eV === "violation" ? `${C.g}FN→TP ✅${C.r}` : `${C.r2}TN→FP ⚠️${C.r}`;
  console.log(`  ${C.b}[${r.idx}] ${r.func}${C.r}  ${C.d}${r.file}${C.r}  ${impact}`);
}

console.log(`\n${C.b}Verdict:${C.r} ${targetRecovered && eFP - bFP === 0 ? `${C.g}✅ CATEGORY CONFIRMED${C.r}` : targetRecovered ? `${C.y}⚠️  MIXED${C.r}` : `${C.r2}❌ REJECTED${C.r}`}\n`);
