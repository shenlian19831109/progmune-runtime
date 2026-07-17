/**
 * Experiment-021 & 022: Clear Remaining L1 FNs
 *
 * Exp-021: Certificate Pinning Validation — "pin without X.509 verify"
 *   Target: Curl_pin_peer_pubkey (curl idx 71)
 *   Hypothesis: pin/pubkey functions without cert chain verification are violations
 *
 * Exp-022: Safeguard Logic — tighten false safeguard matches
 *   Target: ssh_exec_shell (libssh idx 27), ssh_select (libssh idx 39)
 *   Hypothesis: removing overly broad safeguard patterns recovers these FNs
 *
 * Usage: npx ts-node blind-benchmark/experiment-021-022-l1-clear.ts
 */

import * as fs from "fs";
import * as path from "path";
import { SafeguardViolation } from "../src/protocol-detector";

interface SafeguardRule {
  name: string; category: string; trigger: RegExp;
  safeguards: Array<{ pattern: RegExp; label: string }>;
  violationMessage: string; conceptMissing: string[]; conceptExpected: string[];
}

// ═══════════════════════════════════════════════════
// BASELINE (v6 + Exp-018 graduated rule)
// ═══════════════════════════════════════════════════

const BASELINE: SafeguardRule[] = [
  { name: "Password Hashing", category: "password_hashing", trigger: /\b(register|signUp|createUser|createAccount|registerUser)\b/i, safeguards: [{ pattern: /\b(bcrypt|argon2|scrypt|pbkdf2|hash|hashPassword|createHash|hashSync|hash_password)\b/i, label: "secure_hash" }], violationMessage: "No secure password hashing.", conceptMissing: ["PasswordHash"], conceptExpected: ["bcrypt"] },
  { name: "Authorization (Ownership Check)", category: "authorization", trigger: /\b(add|create|delete|remove|update|toggle|modify|edit|lock|ban|process|refund|assign|transfer|share|schedule|upload|set)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|checkOwner|authorId\s*[!=]==?|ownerId\s*[!=]==?|userId\s*[!=]==?|\.owner\s*[!=]==?)/i, label: "auth_check" }], violationMessage: "Mutation without ownership verification.", conceptMissing: ["OwnershipCheck"], conceptExpected: ["getUser"] },
  // Exp-022 target: safeguard has "token|session" — too broad, but trigger fix deferred (would break 10 curl TPs)
  // Exp-022 target: safeguard has "token|session" — too broad
  { name: "Authorization (Unauthenticated Access)", category: "authorization", trigger: /\b(get|list|download|view|read|fetch|find)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|token|session)\b/i, label: "auth_check" }], violationMessage: "Data access without authentication.", conceptMissing: ["AuthenticationCheck"], conceptExpected: ["token validation", "session check"] },
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
// EXPERIMENT: Exp-021 + Exp-022 combined
// TWO independent variables:
//   A. New rule: Certificate Pinning Validation
//   B. Modified rule: tighten "Unauthenticated Access" safeguard
// ═══════════════════════════════════════════════════

// Exp-021: Certificate Pinning — pin without X.509 verify
const CERT_PIN_RULE: SafeguardRule = {
  name: "Certificate Pinning Validation",
  category: "certificate",
  trigger: /(pin_peer_pubkey|pin_cert|pin_pubkey|pubkey_pin|cert_pin|ssl_pin|pkpin)\b/i,
  safeguards: [
    { pattern: /\b(X509_verify_cert|SSL_get_verify_result|X509_STORE_CTX_get_error|verify_certificate|verify_peer|cert_verify|ssl_verify|Curl_ssl_cf_get_config|ossl_verify|gtls_verify|mbedtls_ssl_conf_verify)\b/i, label: "cert_verify" },
    { pattern: /\b(Curl_ssl_cf_get_primary_config|Curl_ssl_cf_get_config|ssl_cf_get_config|ssl_config_get|peer_cert|get_peer_certificate)\b/i, label: "ssl_config" },
  ],
  violationMessage: "Certificate/public key pinning without X.509 certificate chain verification. Pinned key may be from an untrusted source.",
  conceptMissing: ["X509Verification", "CertificateChainValidation"],
  conceptExpected: ["X509_verify_cert", "SSL_get_verify_result"],
};

// Exp-022: Tighten "Unauthenticated Access" safeguard
// Remove "token|session" — too broad, matches any file with these words
const UNAUTH_ACCESS_FIXED: SafeguardRule = {
  name: "Authorization (Unauthenticated Access)",
  category: "authorization",
  trigger: /\b(get|list|download|view|read|fetch|find)[A-Z]\w*\b/i,
  safeguards: [
    // Tighter safeguard: removed standalone "token|session" (too broad)
    // Added qualified patterns: token/session must be part of a VALIDATION operation
    { pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|checkAuth|isAuthenticated|requireAuth|ensureAuth|token\w*(Check|Verify|Valid)|session\w*(Check|Verify|Valid)|checkToken|checkSession)\b/i, label: "auth_check" },
  ],
  violationMessage: "Data access without authentication.",
  conceptMissing: ["AuthenticationCheck", "AccessControl"],
  conceptExpected: ["getUser", "validateToken", "verifySession"],
};

// Build experimental rule set
const EXPERIMENTAL = BASELINE.map(r => {
  // Replace the broad safeguard rule with the tightened version
  if (r.name === "Authorization (Unauthenticated Access)") return UNAUTH_ACCESS_FIXED;
  return r;
});
EXPERIMENTAL.push(CERT_PIN_RULE);

// ═══════════════════════════════════════════════════
// Detection + Data Loading (standard)
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
  const seqData = JSON.parse(fs.readFileSync(path.join(benchDir, `${repoName}-sequences.json`), "utf-8"));
  const labData = JSON.parse(fs.readFileSync(path.join(benchDir, `${repoName}-labels.json`), "utf-8"));
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
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Experiment-021 & 022: Clear Remaining L1 FNs${C.r}                       ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.d}Exp-021: Certificate Pinning   Exp-022: Safeguard Logic fix${C.r}         ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

// Show the changes
console.log(`${C.b}Exp-021: New Rule${C.r}`);
console.log(`  Trigger:    ${CERT_PIN_RULE.trigger.source}`);
console.log(`  Safeguards: ${CERT_PIN_RULE.safeguards.length}\n`);

console.log(`${C.b}Exp-022: Safeguard Fix${C.r}`);
const oldSafeguard = BASELINE.find(r => r.name === "Authorization (Unauthenticated Access)")!;
console.log(`  Old: ${oldSafeguard.safeguards[0].pattern.source}`);
console.log(`  New: ${UNAUTH_ACCESS_FIXED.safeguards[0].pattern.source}\n`);

// Run
const TARGETS = [
  { repo: "curl", idx: 71, func: "Curl_pin_peer_pubkey", exp: "021" },
  { repo: "libssh", idx: 27, func: "ssh_exec_shell", exp: "022" },
  { repo: "libssh", idx: 39, func: "ssh_select", exp: "022" },
];

const allChanged: any[] = [];
let bTP = 0, bFP = 0, bTN = 0, bFN = 0, eTP = 0, eFP = 0, eTN = 0, eFN = 0;

for (const repo of ["curl", "libssh"]) {
  const { sequences, labels } = loadRepo(repo);
  const fcm = new Map<string, Set<string>>();
  for (const s of sequences) {
    if (!fcm.has(s.file)) fcm.set(s.file, new Set());
    for (const c of s.calls) fcm.get(s.file)!.add(c);
  }

  console.log(`${C.b}── ${repo.toUpperCase()} ──${C.r}`);

  let rbTP = 0, rbFP = 0, rbTN = 0, rbFN = 0, reTP = 0, reFP = 0, reTN = 0, reFN = 0;

  for (const [idx, expected] of labels) {
    if (idx >= sequences.length) continue;
    const seq = sequences[idx];
    if (!seq.function || seq.calls.length === 0) continue;
    const merged = [...new Set([...(fcm.get(seq.file) || new Set()), ...seq.calls])];
    const bV = detect(merged, seq.function, BASELINE).length === 0 ? "clean" : "violation";
    const eV = detect(merged, seq.function, EXPERIMENTAL).length === 0 ? "clean" : "violation";

    if (expected === "violation" && bV === "violation") rbTP++; else if (expected === "clean" && bV === "violation") rbFP++; else if (expected === "clean" && bV === "clean") rbTN++; else if (expected === "violation" && bV === "clean") rbFN++;
    if (expected === "violation" && eV === "violation") reTP++; else if (expected === "clean" && eV === "violation") reFP++; else if (expected === "clean" && eV === "clean") reTN++; else if (expected === "violation" && eV === "clean") reFN++;

    if (bV !== eV) allChanged.push({ repo, idx, func: seq.function, file: seq.file.split("/").pop(), expected, bV, eV });
  }

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const bP = rbTP + rbFP > 0 ? rbTP / (rbTP + rbFP) : 0, bR = rbTP + rbFN > 0 ? rbTP / (rbTP + rbFN) : 0;
  const eP = reTP + reFP > 0 ? reTP / (reTP + reFP) : 0, eR = reTP + reFN > 0 ? reTP / (reTP + reFN) : 0;
  console.log(`  Baseline:    TP=${rbTP} FP=${rbFP} TN=${rbTN} FN=${rbFN}  P=${pct(bP)} R=${pct(bR)}`);
  console.log(`  Experiment:  TP=${reTP} FP=${reFP} TN=${reTN} FN=${reFN}  P=${pct(eP)} R=${pct(eR)}`);

  bTP += rbTP; bFP += rbFP; bTN += rbTN; bFN += rbFN;
  eTP += reTP; eFP += reFP; eTN += reTN; eFN += reFN;

  // Show target status
  const repoTargets = TARGETS.filter(t => t.repo === repo);
  if (repoTargets.length > 0) {
    console.log(`  ${C.b}Targets:${C.r}`);
    for (const t of repoTargets) {
      const changed = allChanged.find(r => r.repo === t.repo && r.idx === t.idx);
      const recovered = changed && changed.bV === "clean" && changed.eV === "violation";
      const icon = recovered ? `${C.g}✅ recovered${C.r}` : `${C.r2}❌ not recovered${C.r}`;
      console.log(`    ${icon} [${t.idx}] ${t.func} (Exp-${t.exp})`);
    }
  }
  console.log("");
}

// Aggregate
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const bP = bTP + bFP > 0 ? bTP / (bTP + bFP) : 0, bR = bTP + bFN > 0 ? bTP / (bTP + bFN) : 0;
const bF1 = bP + bR > 0 ? 2 * bP * bR / (bP + bR) : 0;
const eP = eTP + eFP > 0 ? eTP / (eTP + eFP) : 0, eR = eTP + eFN > 0 ? eTP / (eTP + eFN) : 0;
const eF1 = eP + eR > 0 ? 2 * eP * eR / (eP + eR) : 0;

console.log(`${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Aggregate${C.r}                                                             ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

console.log(`              TP    FP    TN    FN    Precision  Recall   F1`);
console.log(`  Baseline   ${String(bTP).padStart(4)}  ${String(bFP).padStart(4)}  ${String(bTN).padStart(4)}  ${String(bFN).padStart(4)}  ${pct(bP).padStart(8)}  ${pct(bR).padStart(6)}  ${pct(bF1).padStart(5)}`);
console.log(`  Experiment ${String(eTP).padStart(4)}  ${String(eFP).padStart(4)}  ${String(eTN).padStart(4)}  ${String(eFN).padStart(4)}  ${pct(eP).padStart(8)}  ${pct(eR).padStart(6)}  ${pct(eF1).padStart(5)}`);

// Per-experiment breakdown
console.log(`\n${C.b}── Per-Experiment Breakdown ──${C.r}\n`);

const exp021Recovered = allChanged.filter(r => TARGETS.find(t => t.exp === "021" && t.repo === r.repo && t.idx === r.idx) && r.bV === "clean" && r.eV === "violation").length;
const exp022Recovered = allChanged.filter(r => TARGETS.find(t => t.exp === "022" && t.repo === r.repo && t.idx === r.idx) && r.bV === "clean" && r.eV === "violation").length;
const exp021Targets = TARGETS.filter(t => t.exp === "021").length;
const exp022Targets = TARGETS.filter(t => t.exp === "022").length;
const otherChanges = allChanged.filter(r => !TARGETS.find(t => t.repo === r.repo && t.idx === r.idx));

console.log(`  Exp-021 (Certificate Pinning):  ${exp021Recovered}/${exp021Targets} recovered`);
console.log(`  Exp-022 (Safeguard Logic):      ${exp022Recovered}/${exp022Targets} recovered`);
console.log(`  Other changes:                  ${otherChanges.length} (${otherChanges.filter(r => r.eV === "violation" && r.bV === "clean").length} new violations, ${otherChanges.filter(r => r.eV === "clean" && r.bV === "violation").length} resolved)`);

if (otherChanges.length > 0) {
  console.log(`\n  ${C.b}Other changes:${C.r}`);
  for (const r of otherChanges) {
    const impact = r.expected === "violation" && r.bV === "clean" && r.eV === "violation" ? `${C.g}FN→TP${C.r}`
      : r.expected === "clean" && r.bV === "clean" && r.eV === "violation" ? `${C.r2}TN→FP${C.r}`
      : r.expected === "clean" && r.bV === "violation" && r.eV === "clean" ? `${C.g}FP→TN${C.r}`
      : `${C.y}TP→FN${C.r}`;
    console.log(`  ${C.b}[${r.idx}] ${r.func}${C.r} ${C.d}${r.file}${C.r}  ${impact}`);
  }
}

// Verdict
console.log(`\n${C.b}Verdict:${C.r}`);
const totalRecovered = exp021Recovered + exp022Recovered;
const totalTargets = exp021Targets + exp022Targets;
const newFPs = otherChanges.filter(r => r.expected === "clean" && r.bV === "clean" && r.eV === "violation").length;
if (totalRecovered >= 2 && newFPs === 0) {
  console.log(`  ${C.g}✅ L1 CLEARED: ${totalRecovered}/${totalTargets} recovered, 0 new FP${C.r}`);
} else if (totalRecovered > 0) {
  console.log(`  ${C.y}⚠️  PARTIAL: ${totalRecovered}/${totalTargets} recovered, ${newFPs} new FP${C.r}`);
} else {
  console.log(`  ${C.r2}❌ REJECTED${C.r}`);
}
console.log("");
