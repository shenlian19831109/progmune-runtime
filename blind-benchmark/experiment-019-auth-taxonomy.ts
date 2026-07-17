/**
 * Experiment-019: Auth Message Lifecycle Taxonomy
 *
 * Question:
 *   Does "Auth Message Lifecycle" deserve to be a protocol category?
 *
 * Independent Variable (ONE new rule):
 *   NTLM, SPNEGO, and SSH userauth message construction must include
 *   auth resource cleanup or error verification.
 *
 * Scope:
 *   - curl: Curl_auth_create_*, Curl_auth_decode_*, Curl_auth_build_*
 *   - libssh: ssh_userauth_*, ssh_agent_*
 *
 * Success criteria:
 *   - ≥2/5 recovered → Category confirmed
 *   - 0 FP
 *
 * Benchmark: Gold v1 (curl + libssh)
 *
 * Usage: npx ts-node blind-benchmark/experiment-019-auth-taxonomy.ts
 */

import * as fs from "fs";
import * as path from "path";
import { SafeguardViolation } from "../src/protocol-detector";

interface SafeguardRule {
  name: string; category: string;
  trigger: RegExp;
  safeguards: Array<{ pattern: RegExp; label: string }>;
  violationMessage: string;
  conceptMissing: string[];
  conceptExpected: string[];
}

const BASELINE_RULES: SafeguardRule[] = [
  { name: "Password Hashing", category: "password_hashing", trigger: /\b(register|signUp|createUser|createAccount|registerUser)\b/i, safeguards: [{ pattern: /\b(bcrypt|argon2|scrypt|pbkdf2|hash|hashPassword|createHash|hashSync|hash_password)\b/i, label: "secure_hash" }], violationMessage: "User registration without secure password hashing.", conceptMissing: ["PasswordHash"], conceptExpected: ["bcrypt", "argon2"] },
  { name: "Password Hashing (Weak)", category: "password_hashing", trigger: /\b(register|signUp|createUser|createAccount|registerUser)\b/i, safeguards: [{ pattern: /\b(bcrypt|argon2|scrypt|pbkdf2)\b/i, label: "strong_hash" }], violationMessage: "Weak or no password hashing.", conceptMissing: ["StrongHash"], conceptExpected: ["bcrypt", "argon2"] },
  { name: "Authorization (Ownership Check)", category: "authorization", trigger: /\b(add|create|delete|remove|update|toggle|modify|edit|lock|ban|process|refund|assign|transfer|share|schedule|upload|set)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|checkOwner|authorId\s*[!=]==?|ownerId\s*[!=]==?|userId\s*[!=]==?|\.owner\s*[!=]==?)/i, label: "auth_check" }], violationMessage: "Mutation without ownership verification.", conceptMissing: ["OwnershipCheck"], conceptExpected: ["getUser", "validateToken"] },
  { name: "Authorization (Unauthenticated Access)", category: "authorization", trigger: /\b(get|list|download|view|read|fetch|find)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|token|session)\b/i, label: "auth_check" }], violationMessage: "Data access without authentication.", conceptMissing: ["AuthenticationCheck"], conceptExpected: ["token validation", "session check"] },
  { name: "Data Integrity (Foreign Key)", category: "data_integrity", trigger: /\b(add|create|post|refund|process|send)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(get|find|check|exists|lookup|status)[A-Z]\w*\b/i, label: "fk_check" }], violationMessage: "Creates child entity without verifying parent.", conceptMissing: ["ForeignKeyValidation"], conceptExpected: ["checkExists", "getParent"] },
  { name: "Input Validation", category: "input_validation", trigger: /\b(create|add|post|send|upload)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(validate|sanitize|check|verify)\w*(Content|Input|Length|Title|Body|Type|Size|File)\b/i, label: "input_validation" }], violationMessage: "Content creation without input validation.", conceptMissing: ["InputSanitization"], conceptExpected: ["validateContent"] },
  { name: "TLS Enforcement", category: "tls_enforcement", trigger: /\b(createServer|listen|handleRequest|app\.listen|express)\b/i, safeguards: [{ pattern: /\b(https|tls|ssl|cert|key|TLS|SSL|HTTPS|createSecureContext|credentials)\b/i, label: "tls_config" }], violationMessage: "Server without TLS.", conceptMissing: ["TLSConfiguration"], conceptExpected: ["https", "TLS cert"] },
  { name: "Token Security (Weak Generation)", category: "token_security", trigger: /\b(authenticate|login|signIn|logIn|createSession|generateToken)\b/i, safeguards: [{ pattern: /\b(crypto\.randomUUID|jwt\.sign|jsonwebtoken|nanoid|randomBytes|cryptoRandomString)\b/i, label: "secure_token" }], violationMessage: "Token without secure random source.", conceptMissing: ["SecureRandom"], conceptExpected: ["crypto.randomUUID"] },
  { name: "Authorization (Resource Ownership)", category: "authorization", trigger: /\b(toggle|remove)[A-Z]\w*\b/i, safeguards: [{ pattern: /\b(ownerId\s*[!=]==?|authorId\s*[!=]==?|userId\s*[!=]==?|createdBy|\.owner\s*[!=]==?)/i, label: "ownership_comparison" }], violationMessage: "Resource mutation without ownership check.", conceptMissing: ["ResourceOwnership"], conceptExpected: ["ownerId comparison"] },
  { name: "Payment Order Verification", category: "data_integrity", trigger: /\b(process|create|make|submit)\w*(Payment|Charge|Transaction)\b/i, safeguards: [{ pattern: /\b(getOrder|verifyOrder|checkOrder|findOrder|orderExists|order\b)/i, label: "order_verification" }], violationMessage: "Payment without order verification.", conceptMissing: ["OrderVerification"], conceptExpected: ["getOrder"] },
  { name: "Room Membership Check", category: "authorization", trigger: /\b(send|post|publish)\w*(Message|Msg)\b/i, safeguards: [{ pattern: /\b(joinRoom|roomMember|checkMember|isMember|members\.includes|members\.find|memberOf|inRoom)\b/i, label: "room_membership" }], violationMessage: "Message without room membership check.", conceptMissing: ["RoomMembership"], conceptExpected: ["joinRoom"] },
  { name: "Refund Status Verification", category: "data_integrity", trigger: /\b(refund|cancel|void|reverse)\w*(Payment|Order|Charge|Transaction)\b/i, safeguards: [{ pattern: /\b(status|\.status|getStatus|checkStatus|orderStatus|paymentStatus)\b/i, label: "status_check" }], violationMessage: "Refund without status check.", conceptMissing: ["StatusVerification"], conceptExpected: ["status check"] },
  { name: "Rate Limiting", category: "rate_limiting", trigger: /\b(createServer|listen|handleRequest|app\.listen|express|router\.(post|get|put|delete|patch))\b/i, safeguards: [{ pattern: /\b(rateLimit|rate_limit|throttle|RateLimiter|expressRateLimit|rateLimiterMiddleware|limiter)\b/i, label: "rate_limit" }], violationMessage: "Server/API without rate limiting.", conceptMissing: ["RateLimiting"], conceptExpected: ["rateLimit"] },
  // From Exp-018 (graduated)
  { name: "Key Derivation Safety", category: "crypto", trigger: /\b(ecdh|curve25519|ssh_dh_|kex_|build_k|do_create_k|derive\w*secret|dh_set_param|ec_key|ecdh_)\b/i, safeguards: [{ pattern: /\b(EC_KEY_get0_group|EC_KEY_check_key|EVP_PKEY_check|DH_check|get0_group|check_key|verify_param|validate_curve|ssh_key_is_private|ssh_key_type)\b/i, label: "key_validation" }, { pattern: /\b(EC_KEY_free|EVP_PKEY_free|DH_free|BN_free|BN_clear_free|gcry_sexp_release|mbedtls_ecp_group_free|mbedtls_ecp_point_free|mbedtls_mpi_free|ssh_string_free|ssh_string_burn|ssh_buffer_free|OSSL_PARAM_BLD_free|OSSL_PARAM_free|explicit_bzero)\b/i, label: "crypto_cleanup" }], violationMessage: "Key derivation lacks key validation or resource cleanup.", conceptMissing: ["KeyValidation", "CryptoCleanup"], conceptExpected: ["EC_KEY_check_key", "EVP_PKEY_free"] },
];

// ═══════════════════════════════════════════════════
// EXPERIMENT: Add ONE rule — Auth Message Lifecycle
// ═══════════════════════════════════════════════════

/**
 * Auth Message Lifecycle
 *
 * Auth message construction/decoding functions must clean up auth resources
 * (SSPI contexts, buffers, credentials) or verify operation success.
 *
 * Scope:
 *   - curl NTLM/SPNEGO: Curl_auth_create_*, Curl_auth_decode_*, Curl_auth_build_*
 *   - libSSH userauth:  ssh_userauth_*, ssh_agent_*
 *
 * Key insight from Exp-018: exclude ubiquitous calls (ssh_set_error, SSH_LOG)
 * that are called by almost every function. Only include auth-SPECIFIC safeguards.
 */
const AUTH_MESSAGE_LIFECYCLE_RULE: SafeguardRule = {
  name: "Auth Message Lifecycle",
  category: "auth",
  trigger: /\b(Curl_auth_(create|decode|build|encode)|ssh_userauth_|ssh_agent_|spnego|ntlm_type)/i,
  safeguards: [
    // DIAGNOSTIC: no safeguards — measure pure trigger coverage
    // This tells us the UPPER BOUND of FN recovery for this trigger.
    // Add safeguards back once the trigger-only baseline is known.
  ],
  violationMessage: "Auth message construction/decoding without resource cleanup or operation verification. Auth contexts and buffers may be leaked.",
  conceptMissing: ["AuthCleanup", "AuthVerification"],
  conceptExpected: ["FreeContextBuffer", "Curl_auth_cleanup", "ssh_pki_import"],
};

const EXPERIMENTAL_RULES = [...BASELINE_RULES, AUTH_MESSAGE_LIFECYCLE_RULE];

// ═══════════════════════════════════════════════════
// Detection (duplicated for experiment isolation)
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

function detectSafeguards(calls: string[], enclosingFuncName: string | undefined, rules: SafeguardRule[]): SafeguardViolation[] {
  const violations: SafeguardViolation[] = [];
  const rawCalls = enclosingFuncName ? [enclosingFuncName, ...calls] : [...calls];
  const parsedWords: string[] = [];
  for (const c of rawCalls) parsedWords.push(...identifierParse(c));
  const effectiveCalls = [...new Set([...rawCalls, ...parsedWords])];

  const rawLower = enclosingFuncName?.toLowerCase() || "";
  const AUTH_PATTERN = /\b(register|signup|signin|login|authenticate|createuser|createaccount|registeruser|registernewuser|dologin|verifytoken|validatesession|getuser|getsessionuser|getcurrentuser|endsession|logout|signout|dologout|destroysession|invalidatesession|invalidate|signout)\b/i;
  const isAuthFunction = enclosingFuncName != null && (
    AUTH_PATTERN.test(rawLower) || identifierParse(enclosingFuncName).some(w => AUTH_PATTERN.test(w))
  );

  for (const rule of rules) {
    const triggerMatch = effectiveCalls.some(c => rule.trigger.test(c));
    if (!triggerMatch) continue;
    if (isAuthFunction && rule.category === "authorization") continue;
    const matchedSafeguard = rule.safeguards.find(s => effectiveCalls.some(c => s.pattern.test(c)));
    if (matchedSafeguard) continue;
    violations.push({
      rule: rule.name, category: rule.category, type: "missing_safeguard",
      detail: rule.violationMessage,
      conceptDetail: `Missing: ${rule.conceptMissing.join(", ")}. Expected: ${rule.conceptExpected.join(", ")}`,
      missingConcepts: rule.conceptMissing, expectedConcepts: rule.conceptExpected,
    });
  }
  return violations;
}

// ═══════════════════════════════════════════════════
// Data Loading
// ═══════════════════════════════════════════════════

interface Sequence { function: string; file: string; calls: string[]; }

function loadRepo(repoName: string): { sequences: Sequence[]; labels: Map<number, string> } {
  const benchDir = path.resolve(__dirname, "..", "benchmarks");
  const seqPath = path.join(benchDir, `${repoName}-sequences.json`);
  const labPath = path.join(benchDir, `${repoName}-labels.json`);
  const seqData = JSON.parse(fs.readFileSync(seqPath, "utf-8"));
  const labData = JSON.parse(fs.readFileSync(labPath, "utf-8"));
  const sequences: Sequence[] = (seqData.sequences || seqData).map((s: any) => ({
    function: s.function || "", file: s.file || "", calls: s.calls || [],
  }));
  const labels = new Map<number, string>();
  const labSource = labData.labels || labData;
  for (const [key, val] of Object.entries(labSource)) {
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
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Experiment-019: Auth Message Lifecycle Taxonomy${C.r}                      ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.d}Independent Variable: ONE new rule — Auth Message Lifecycle${C.r}           ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.d}Target: 5 Auth FNs (curl NTLM/SPNEGO + libssh userauth/agent)${C.r}        ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

console.log(`${C.b}New Rule: Auth Message Lifecycle${C.r}`);
console.log(`  ${C.d}Category:${C.r}   auth`);
console.log(`  ${C.d}Trigger:${C.r}    ${AUTH_MESSAGE_LIFECYCLE_RULE.trigger.source}`);
console.log(`  ${C.d}Safeguards:${C.r} ${AUTH_MESSAGE_LIFECYCLE_RULE.safeguards.length} patterns (auth cleanup, auth verification)\n`);

const AUTH_FNS = [
  { repo: "curl", idx: 27, func: "Curl_auth_decode_spnego_message" },
  { repo: "curl", idx: 85, func: "Curl_auth_create_ntlm_type1_message" },
  { repo: "libssh", idx: 14, func: "ssh_userauth_agent" },
  { repo: "libssh", idx: 15, func: "ssh_userauth_publickey_auto" },
  { repo: "libssh", idx: 38, func: "ssh_agent_remove_identity" },
];

const allChanged: any[] = [];
let aggBaseTP = 0, aggBaseFP = 0, aggBaseTN = 0, aggBaseFN = 0;
let aggExpTP = 0, aggExpFP = 0, aggExpTN = 0, aggExpFN = 0;

for (const repo of ["curl", "libssh"]) {
  const { sequences, labels } = loadRepo(repo);

  const fileCallsMap = new Map<string, Set<string>>();
  for (const s of sequences) {
    if (!fileCallsMap.has(s.file)) fileCallsMap.set(s.file, new Set());
    for (const c of s.calls) fileCallsMap.get(s.file)!.add(c);
  }

  console.log(`${C.b}── ${repo.toUpperCase()} ──${C.r}`);

  let repoBaseTP = 0, repoBaseFP = 0, repoBaseTN = 0, repoBaseFN = 0;
  let repoExpTP = 0, repoExpFP = 0, repoExpTN = 0, repoExpFN = 0;
  const authResults: any[] = [];

  for (const [idx, expected] of labels) {
    if (idx >= sequences.length) continue;
    const seq = sequences[idx];
    if (!seq.function || seq.calls.length === 0) continue;

    const fileCalls = [...(fileCallsMap.get(seq.file) || new Set())];
    const mergedCalls = [...new Set([...fileCalls, ...seq.calls])];

    const baseVios = detectSafeguards(mergedCalls, seq.function, BASELINE_RULES);
    const expVios = detectSafeguards(mergedCalls, seq.function, EXPERIMENTAL_RULES);
    const baseV = baseVios.length === 0 ? "clean" : "violation";
    const expV = expVios.length === 0 ? "clean" : "violation";

    if (expected === "violation" && baseV === "violation") repoBaseTP++;
    else if (expected === "clean" && baseV === "violation") repoBaseFP++;
    else if (expected === "clean" && baseV === "clean") repoBaseTN++;
    else if (expected === "violation" && baseV === "clean") repoBaseFN++;

    if (expected === "violation" && expV === "violation") repoExpTP++;
    else if (expected === "clean" && expV === "violation") repoExpFP++;
    else if (expected === "clean" && expV === "clean") repoExpTN++;
    else if (expected === "violation" && expV === "clean") repoExpFN++;

    if (baseV !== expV) {
      allChanged.push({
        repo, idx, function: seq.function, file: seq.file.split("/").pop(),
        expected, baselineVerdict: baseV, experimentalVerdict: expV,
        baselineVios: baseVios.map(v => v.rule),
        experimentalVios: expVios.map(v => v.rule),
      });
    }

    const isAuth = AUTH_FNS.some(af => af.repo === repo && af.idx === idx);
    if (isAuth) {
      authResults.push({
        idx, func: seq.function,
        baseline: baseV, experiment: expV,
        recovered: baseV === "clean" && expV === "violation",
        newRuleHit: expVios.some(v => v.rule === "Auth Message Lifecycle"),
        expVios: expVios.filter(v => v.rule === "Auth Message Lifecycle").map(v => v.detail),
      });
    }
  }

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const bP = repoBaseTP + repoBaseFP > 0 ? repoBaseTP / (repoBaseTP + repoBaseFP) : 0;
  const bR = repoBaseTP + repoBaseFN > 0 ? repoBaseTP / (repoBaseTP + repoBaseFN) : 0;
  const eP = repoExpTP + repoExpFP > 0 ? repoExpTP / (repoExpTP + repoExpFP) : 0;
  const eR = repoExpTP + repoExpFN > 0 ? repoExpTP / (repoExpTP + repoExpFN) : 0;

  console.log(`  Baseline:    TP=${repoBaseTP} FP=${repoBaseFP} TN=${repoBaseTN} FN=${repoBaseFN}  P=${pct(bP)} R=${pct(bR)}`);
  console.log(`  Experiment:  TP=${repoExpTP} FP=${repoExpFP} TN=${repoExpTN} FN=${repoExpFN}  P=${pct(eP)} R=${pct(eR)}`);

  if (authResults.length > 0) {
    console.log(`  ${C.b}Auth FNs:${C.r}`);
    for (const ar of authResults) {
      const icon = ar.recovered ? `${C.g}✅ recovered${C.r}` : ar.newRuleHit ? `${C.y}~ new rule hit but safeguard matched${C.r}` : `${C.r2}❌ not triggered${C.r}`;
      console.log(`    ${icon} [${ar.idx}] ${ar.func}`);
    }
  }
  console.log("");

  aggBaseTP += repoBaseTP; aggBaseFP += repoBaseFP; aggBaseTN += repoBaseTN; aggBaseFN += repoBaseFN;
  aggExpTP += repoExpTP; aggExpFP += repoExpFP; aggExpTN += repoExpTN; aggExpFN += repoExpFN;
}

// ═══════════════════════════════════════════════════
// Aggregate
// ═══════════════════════════════════════════════════

console.log(`${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Aggregate Results${C.r}                                                      ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const bP = aggBaseTP + aggBaseFP > 0 ? aggBaseTP / (aggBaseTP + aggBaseFP) : 0;
const bR = aggBaseTP + aggBaseFN > 0 ? aggBaseTP / (aggBaseTP + aggBaseFN) : 0;
const bF1 = bP + bR > 0 ? 2 * bP * bR / (bP + bR) : 0;
const eP = aggExpTP + aggExpFP > 0 ? aggExpTP / (aggExpTP + aggExpFP) : 0;
const eR = aggExpTP + aggExpFN > 0 ? aggExpTP / (aggExpTP + aggExpFN) : 0;
const eF1 = eP + eR > 0 ? 2 * eP * eR / (eP + eR) : 0;

console.log(`  ${C.b}              TP    FP    TN    FN    Precision  Recall   F1${C.r}`);
console.log(`  ${C.d}────────────  ────  ────  ────  ────  ─────────  ──────  ────${C.r}`);
console.log(`  Baseline     ${String(aggBaseTP).padStart(4)}  ${String(aggBaseFP).padStart(4)}  ${String(aggBaseTN).padStart(4)}  ${String(aggBaseFN).padStart(4)}  ${pct(bP).padStart(8)}  ${pct(bR).padStart(6)}  ${pct(bF1).padStart(5)}`);
console.log(`  Experiment   ${String(aggExpTP).padStart(4)}  ${String(aggExpFP).padStart(4)}  ${String(aggExpTN).padStart(4)}  ${String(aggExpFN).padStart(4)}  ${pct(eP).padStart(8)}  ${pct(eR).padStart(6)}  ${pct(eF1).padStart(5)}`);

const deltaTP = aggExpTP - aggBaseTP;
const deltaFP = aggExpFP - aggBaseFP;
const deltaFN = aggBaseFN - aggExpFN;
console.log(`\n  Δ:           ${deltaTP>=0?"+":""}${deltaTP}   ${deltaFP>=0?"+":""}${deltaFP}   ${aggExpTN-aggBaseTN>=0?"+":""}${aggExpTN-aggBaseTN}   ${aggExpFN-aggBaseFN>=0?"+":""}${aggExpFN-aggBaseFN}   ${(eP-bP>=0?"+":"")}${((eP-bP)*100).toFixed(2)}pp  ${(eR-bR>=0?"+":"")}${((eR-bR)*100).toFixed(2)}pp  ${(eF1-bF1>=0?"+":"")}${((eF1-bF1)*100).toFixed(2)}pp`);

// ── Changed Sequences ──
console.log(`\n${C.b}── Changed Sequences (${allChanged.length} total) ──${C.r}\n`);
for (const r of allChanged) {
  const arrow = r.baselineVerdict === "clean" && r.experimentalVerdict === "violation"
    ? `${C.r2}clean→violation${C.r}` : `${C.g}violation→clean${C.r}`;
  const impact = r.expected === "violation" && r.baselineVerdict === "clean" && r.experimentalVerdict === "violation"
    ? `${C.g}FN→TP ✅${C.r}` : r.expected === "clean" && r.baselineVerdict === "clean" && r.experimentalVerdict === "violation"
    ? `${C.r2}TN→FP ⚠️${C.r}` : `${C.d}other${C.r}`;
  console.log(`  ${C.b}[${r.idx}] ${r.function}${C.r}  ${C.d}${r.file}${C.r}  ${arrow}  ${impact}`);
  if (r.experimentalVios.length > 0) console.log(`     ${C.d}New violations:${C.r} ${r.experimentalVios.join(", ")}`);
}

// ── Auth FN Recovery ──
let authRecovered = 0;
console.log(`\n${C.b}── Auth FN Recovery Report ──${C.r}\n`);
for (const af of AUTH_FNS) {
  const changed = allChanged.find(r => r.repo === af.repo && r.idx === af.idx);
  const recovered = changed && changed.baselineVerdict === "clean" && changed.experimentalVerdict === "violation";
  if (recovered) authRecovered++;
  const icon = recovered ? `${C.g}✅${C.r}` : `${C.r2}❌${C.r}`;
  console.log(`  ${icon} [${af.idx}] ${af.func} (${af.repo})`);
}
console.log(`\n  ${C.b}Auth FN Recovery: ${authRecovered}/${AUTH_FNS.length} (${(authRecovered/AUTH_FNS.length*100).toFixed(0)}%)${C.r}`);

// ── Verdict ──
console.log(`\n${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Experiment-019 Verdict${C.r}                                                ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

if (authRecovered >= 2 && deltaFP === 0) {
  console.log(`  ${C.g}✅ CATEGORY CONFIRMED: Auth Message Lifecycle deserves to be a category.${C.r}`);
} else if (authRecovered >= 1 && deltaFP <= 1) {
  console.log(`  ${C.y}⚠️  RULE TOO NARROW: Recovered ${authRecovered}/5. Expand trigger/safeguard.${C.r}`);
} else if (deltaFP >= 2) {
  console.log(`  ${C.r2}❌ TOO MANY FP: ${deltaFP} new false positives introduced.${C.r}`);
} else {
  console.log(`  ${C.r2}❌ CATEGORY REJECTED: ${authRecovered}/5 recovered, ${deltaFP} FP.${C.r}`);
}

const reportPath = path.join(__dirname, "reports", "experiment-019-auth-taxonomy.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  experimentId: "019",
  question: "Does Auth Message Lifecycle deserve to be a protocol category?",
  independentVariable: "One new rule: Auth Message Lifecycle (NTLM/SPNEGO/SSH userauth)",
  benchmark: "Gold v1 (curl + libssh)",
  baseline: { TP: aggBaseTP, FP: aggBaseFP, TN: aggBaseTN, FN: aggBaseFN, precision: bP, recall: bR, f1: bF1 },
  experiment: { TP: aggExpTP, FP: aggExpFP, TN: aggExpTN, FN: aggExpFN, precision: eP, recall: eR, f1: eF1 },
  delta: { TP: deltaTP, FP: deltaFP, TN: aggExpTN - aggBaseTN, FN: aggExpFN - aggBaseFN },
  authFNRecovery: `${authRecovered}/${AUTH_FNS.length}`,
  changedSequences: allChanged,
}, null, 2));
console.log(`\n  ${C.d}Report: ${reportPath}${C.r}\n`);
