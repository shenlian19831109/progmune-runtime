/**
 * Experiment-017: Snake_case Trigger Lexical Normalization
 *
 * Question:
 *   Does snake_case lexical normalization improve C protocol detection?
 *
 * Independent Variable (ONE change only):
 *   Trigger regex: [A-Z] → (?:[A-Z]|_)  in all safeguard rule triggers.
 *   This allows snake_case suffixes: create_post, add_user, get_session.
 *
 * Dependent Variables:
 *   TP, FP, TN, FN, Precision, Recall, F1 (Gold C benchmark)
 *
 * Benchmark: Gold v1 (curl + libssh, human-annotated labels)
 *
 * Success Criteria:
 *   Primary:   How many of the 5 parser_failed FNs are recovered?
 *   Secondary: Does Precision change? (FP count)
 *
 * Usage: npx ts-node blind-benchmark/experiment-017-snake-case.ts
 */

import * as fs from "fs";
import * as path from "path";
import { SafeguardViolation } from "../src/protocol-detector";

// ═══════════════════════════════════════════════════
// SAFEGUARD_RULES — Baseline (v6, unchanged)
// ═══════════════════════════════════════════════════

interface SafeguardRule {
  name: string; category: string;
  trigger: RegExp;
  safeguards: Array<{ pattern: RegExp; label: string }>;
  violationMessage: string;
  conceptMissing: string[];
  conceptExpected: string[];
}

const BASELINE_RULES: SafeguardRule[] = [
  {
    name: "Password Hashing", category: "password_hashing",
    trigger: /\b(register|signUp|createUser|createAccount|registerUser)\b/i,
    safeguards: [{ pattern: /\b(bcrypt|argon2|scrypt|pbkdf2|hash|hashPassword|createHash|hashSync|hash_password)\b/i, label: "secure_hash" }],
    violationMessage: "User registration without secure password hashing.",
    conceptMissing: ["PasswordHash", "KeyDerivation"], conceptExpected: ["bcrypt", "argon2", "scrypt"],
  },
  {
    name: "Password Hashing (Weak)", category: "password_hashing",
    trigger: /\b(register|signUp|createUser|createAccount|registerUser)\b/i,
    safeguards: [{ pattern: /\b(bcrypt|argon2|scrypt|pbkdf2)\b/i, label: "strong_hash" }],
    violationMessage: "User registration uses weak or no password hashing.",
    conceptMissing: ["StrongHash", "SaltGeneration"], conceptExpected: ["bcrypt", "argon2"],
  },
  {
    name: "Authorization (Ownership Check)", category: "authorization",
    trigger: /\b(add|create|delete|remove|update|toggle|modify|edit|lock|ban|process|refund|assign|transfer|share|schedule|upload|set)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|checkOwner|authorId\s*[!=]==?|ownerId\s*[!=]==?|userId\s*[!=]==?|\.owner\s*[!=]==?)/i, label: "auth_check" }],
    violationMessage: "Mutation without ownership verification.",
    conceptMissing: ["OwnershipCheck", "AuthorizationGuard"], conceptExpected: ["getUser", "validateToken", "ownerId check"],
  },
  {
    name: "Authorization (Unauthenticated Access)", category: "authorization",
    trigger: /\b(get|list|download|view|read|fetch|find)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|token|session)\b/i, label: "auth_check" }],
    violationMessage: "Data access without authentication.",
    conceptMissing: ["AuthenticationCheck", "AccessControl"], conceptExpected: ["token validation", "session check"],
  },
  {
    name: "Data Integrity (Foreign Key)", category: "data_integrity",
    trigger: /\b(add|create|post|refund|process|send)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(get|find|check|exists|lookup|status)[A-Z]\w*\b/i, label: "fk_check" }],
    violationMessage: "Creates child entity without verifying parent exists.",
    conceptMissing: ["ForeignKeyValidation", "ReferentialIntegrity"], conceptExpected: ["checkExists", "getParent"],
  },
  {
    name: "Input Validation", category: "input_validation",
    trigger: /\b(create|add|post|send|upload)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(validate|sanitize|check|verify)\w*(Content|Input|Length|Title|Body|Type|Size|File)\b/i, label: "input_validation" }],
    violationMessage: "Content creation without input validation.",
    conceptMissing: ["InputSanitization", "ContentValidation", "SizeLimit"], conceptExpected: ["validateContent", "sanitizeInput"],
  },
  {
    name: "TLS Enforcement", category: "tls_enforcement",
    trigger: /\b(createServer|listen|handleRequest|app\.listen|express)\b/i,
    safeguards: [{ pattern: /\b(https|tls|ssl|cert|key|TLS|SSL|HTTPS|createSecureContext|credentials)\b/i, label: "tls_config" }],
    violationMessage: "Server created without TLS configuration.",
    conceptMissing: ["TLSConfiguration", "HTTPSEnforcement"], conceptExpected: ["https.createServer", "TLS cert"],
  },
  {
    name: "Token Security (Weak Generation)", category: "token_security",
    trigger: /\b(authenticate|login|signIn|logIn|createSession|generateToken)\b/i,
    safeguards: [{ pattern: /\b(crypto\.randomUUID|jwt\.sign|jsonwebtoken|nanoid|randomBytes|cryptoRandomString)\b/i, label: "secure_token" }],
    violationMessage: "Token/session generated without secure random source.",
    conceptMissing: ["SecureRandom", "TokenEntropy"], conceptExpected: ["crypto.randomUUID", "jwt.sign"],
  },
  {
    name: "Authorization (Resource Ownership)", category: "authorization",
    trigger: /\b(toggle|remove)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(ownerId\s*[!=]==?|authorId\s*[!=]==?|userId\s*[!=]==?|createdBy|\.owner\s*[!=]==?)/i, label: "ownership_comparison" }],
    violationMessage: "Resource mutation without ownership check.",
    conceptMissing: ["ResourceOwnership", "HorizontalAuthorization"], conceptExpected: ["ownerId comparison"],
  },
  {
    name: "Payment Order Verification", category: "data_integrity",
    trigger: /\b(process|create|make|submit)\w*(Payment|Charge|Transaction)\b/i,
    safeguards: [{ pattern: /\b(getOrder|verifyOrder|checkOrder|findOrder|orderExists|order\b)/i, label: "order_verification" }],
    violationMessage: "Payment processed without verifying order.",
    conceptMissing: ["OrderVerification", "PaymentAuthorization"], conceptExpected: ["getOrder", "verifyOrder"],
  },
  {
    name: "Room Membership Check", category: "authorization",
    trigger: /\b(send|post|publish)\w*(Message|Msg)\b/i,
    safeguards: [{ pattern: /\b(joinRoom|roomMember|checkMember|isMember|members\.includes|members\.find|memberOf|inRoom)\b/i, label: "room_membership" }],
    violationMessage: "Message sent without room membership check.",
    conceptMissing: ["RoomMembership", "ChannelAuthorization"], conceptExpected: ["joinRoom", "isMember"],
  },
  {
    name: "Refund Status Verification", category: "data_integrity",
    trigger: /\b(refund|cancel|void|reverse)\w*(Payment|Order|Charge|Transaction)\b/i,
    safeguards: [{ pattern: /\b(status|\.status|getStatus|checkStatus|orderStatus|paymentStatus)\b/i, label: "status_check" }],
    violationMessage: "Refund without checking current status.",
    conceptMissing: ["StatusVerification", "IdempotencyCheck"], conceptExpected: ["status check"],
  },
  {
    name: "Rate Limiting", category: "rate_limiting",
    trigger: /\b(createServer|listen|handleRequest|app\.listen|express|router\.(post|get|put|delete|patch))\b/i,
    safeguards: [{ pattern: /\b(rateLimit|rate_limit|throttle|RateLimiter|expressRateLimit|rateLimiterMiddleware|limiter)\b/i, label: "rate_limit" }],
    violationMessage: "Server/API without rate limiting.",
    conceptMissing: ["RateLimiting", "DoSProtection"], conceptExpected: ["rateLimit", "throttle"],
  },
];

// ═══════════════════════════════════════════════════
// EXPERIMENT: Snake_case trigger normalization
// ═══════════════════════════════════════════════════

/**
 * The ONE change: replace [A-Z] with (?:[A-Z]|_) in trigger regexes.
 *
 * Before: /\b(create)[A-Z]\w*\b/i  → matches createPost, CreateUser
 * After:  /\b(create)(?:[A-Z]|_)\w*\b/i → also matches create_post, create_user
 *
 * This is done by cloning the rules and rebuilding the trigger regex
 * from the source string.
 */
function normalizeTriggerForSnakeCase(rule: SafeguardRule): SafeguardRule {
  const srcPattern = rule.trigger.source;
  // Replace [A-Z] with (?:[A-Z]|_) — but only in trigger patterns
  // Also handle [a-z] and [A-Za-z] variants
  let newSrc = srcPattern.replace(/\[A-Z\]/g, "(?:[A-Z]|_)");
  newSrc = newSrc.replace(/\[a-z\]/g, "(?:[a-z]|_)");
  newSrc = newSrc.replace(/\[A-Za-z\]/g, "(?:[A-Za-z]|_)");
  const newTrigger = new RegExp(newSrc, rule.trigger.flags);
  return { ...rule, trigger: newTrigger };
}

const EXPERIMENTAL_RULES = BASELINE_RULES.map(normalizeTriggerForSnakeCase);

// ═══════════════════════════════════════════════════
// Detection (duplicated to avoid modifying protocol-detector.ts)
// ═══════════════════════════════════════════════════

function identifierParse(name: string): string[] {
  const parts = name.split(/[_\-\.]/);
  const words: string[] = [];
  for (const part of parts) {
    const camelWords = part.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
    for (const w of camelWords) {
      if (w.length > 0) words.push(w);
    }
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
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Experiment-017: Snake_case Trigger Lexical Normalization${C.r}             ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.d}Independent Variable: [A-Z] → (?:[A-Z]|_) in trigger regexes${C.r}          ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.d}Benchmark: Gold v1 (curl + libssh)${C.r}                                 ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

// ── Show the change ──
console.log(`${C.b}Transformation applied:${C.r}\n`);
const sampleRule = BASELINE_RULES[2]; // Authorization (Ownership Check)
const sampleExp = EXPERIMENTAL_RULES[2];
console.log(`  ${C.d}Baseline:${C.r}    ${sampleRule.trigger.source}`);
console.log(`  ${C.d}Experiment:${C.r}  ${sampleExp.trigger.source}\n`);

// ── Run on each repo ──
interface PerSequenceResult {
  idx: number; repo: string; function: string; file: string;
  expected: string;
  baselineVerdict: "clean" | "violation"; baselineViolations: string[];
  experimentalVerdict: "clean" | "violation"; experimentalViolations: string[];
  changed: boolean;
}

const allResults: PerSequenceResult[] = [];

for (const repo of ["curl", "libssh"]) {
  const { sequences, labels } = loadRepo(repo);

  // Build file calls
  const fileCallsMap = new Map<string, Set<string>>();
  for (const s of sequences) {
    if (!fileCallsMap.has(s.file)) fileCallsMap.set(s.file, new Set());
    for (const c of s.calls) fileCallsMap.get(s.file)!.add(c);
  }

  let repoBaselineTP = 0, repoBaselineFP = 0, repoBaselineTN = 0, repoBaselineFN = 0;
  let repoExpTP = 0, repoExpFP = 0, repoExpTN = 0, repoExpFN = 0;
  const changes: PerSequenceResult[] = [];

  for (const [idx, expected] of labels) {
    if (idx >= sequences.length) continue;
    const seq = sequences[idx];
    if (!seq.function || seq.calls.length === 0) continue;

    const fileCalls = [...(fileCallsMap.get(seq.file) || new Set())];
    const mergedCalls = [...new Set([...fileCalls, ...seq.calls])];

    // Baseline
    const baselineVios = detectSafeguards(mergedCalls, seq.function, BASELINE_RULES);
    const baselineVerdict: "clean" | "violation" = baselineVios.length === 0 ? "clean" : "violation";

    // Experimental
    const expVios = detectSafeguards(mergedCalls, seq.function, EXPERIMENTAL_RULES);
    const expVerdict: "clean" | "violation" = expVios.length === 0 ? "clean" : "violation";

    // Count
    if (expected === "violation" && baselineVerdict === "violation") repoBaselineTP++;
    else if (expected === "clean" && baselineVerdict === "violation") repoBaselineFP++;
    else if (expected === "clean" && baselineVerdict === "clean") repoBaselineTN++;
    else if (expected === "violation" && baselineVerdict === "clean") repoBaselineFN++;

    if (expected === "violation" && expVerdict === "violation") repoExpTP++;
    else if (expected === "clean" && expVerdict === "violation") repoExpFP++;
    else if (expected === "clean" && expVerdict === "clean") repoExpTN++;
    else if (expected === "violation" && expVerdict === "clean") repoExpFN++;

    if (baselineVerdict !== expVerdict) {
      changes.push({
        idx, repo, function: seq.function, file: seq.file.split("/").pop() || seq.file,
        expected,
        baselineVerdict, baselineViolations: baselineVios.map(v => v.rule),
        experimentalVerdict: expVerdict, experimentalViolations: expVios.map(v => v.rule),
        changed: true,
      });
    }
  }

  allResults.push(...changes);

  // Per-repo summary
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const bTotal = repoBaselineTP + repoBaselineFP + repoBaselineTN + repoBaselineFN;
  const eTotal = repoExpTP + repoExpFP + repoExpTN + repoExpFN;
  const bP = repoBaselineTP + repoBaselineFP > 0 ? repoBaselineTP / (repoBaselineTP + repoBaselineFP) : 0;
  const bR = repoBaselineTP + repoBaselineFN > 0 ? repoBaselineTP / (repoBaselineTP + repoBaselineFN) : 0;
  const eP = repoExpTP + repoExpFP > 0 ? repoExpTP / (repoExpTP + repoExpFP) : 0;
  const eR = repoExpTP + repoExpFN > 0 ? repoExpTP / (repoExpTP + repoExpFN) : 0;

  console.log(`${C.b}── ${repo.toUpperCase()} ──${C.r}`);
  console.log(`  Baseline:    TP=${repoBaselineTP} FP=${repoBaselineFP} TN=${repoBaselineTN} FN=${repoBaselineFN}  P=${pct(bP)} R=${pct(bR)}`);
  console.log(`  Experiment:  TP=${repoExpTP} FP=${repoExpFP} TN=${repoExpTN} FN=${repoExpFN}  P=${pct(eP)} R=${pct(eR)}`);
  console.log(`  Changes:     ${changes.length} sequences changed verdict\n`);
}

// ═══════════════════════════════════════════════════
// Aggregate
// ═══════════════════════════════════════════════════

console.log(`${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Aggregate Results${C.r}                                                      ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

// Recompute aggregate from all labeled sequences
let aggBaseTP = 0, aggBaseFP = 0, aggBaseTN = 0, aggBaseFN = 0;
let aggExpTP = 0, aggExpFP = 0, aggExpTN = 0, aggExpFN = 0;

for (const repo of ["curl", "libssh"]) {
  const { sequences, labels } = loadRepo(repo);
  const fileCallsMap = new Map<string, Set<string>>();
  for (const s of sequences) {
    if (!fileCallsMap.has(s.file)) fileCallsMap.set(s.file, new Set());
    for (const c of s.calls) fileCallsMap.get(s.file)!.add(c);
  }
  for (const [idx, expected] of labels) {
    if (idx >= sequences.length) continue;
    const seq = sequences[idx];
    if (!seq.function || seq.calls.length === 0) continue;
    const fileCalls = [...(fileCallsMap.get(seq.file) || new Set())];
    const mergedCalls = [...new Set([...fileCalls, ...seq.calls])];
    const bV = detectSafeguards(mergedCalls, seq.function, BASELINE_RULES).length === 0 ? "clean" : "violation";
    const eV = detectSafeguards(mergedCalls, seq.function, EXPERIMENTAL_RULES).length === 0 ? "clean" : "violation";

    if (expected === "violation" && bV === "violation") aggBaseTP++;
    else if (expected === "clean" && bV === "violation") aggBaseFP++;
    else if (expected === "clean" && bV === "clean") aggBaseTN++;
    else if (expected === "violation" && bV === "clean") aggBaseFN++;

    if (expected === "violation" && eV === "violation") aggExpTP++;
    else if (expected === "clean" && eV === "violation") aggExpFP++;
    else if (expected === "clean" && eV === "clean") aggExpTN++;
    else if (expected === "violation" && eV === "clean") aggExpFN++;
  }
}

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
const deltaFN = aggBaseFN - aggExpFN; // positive = fewer FN
console.log(`\n  Δ:           ${deltaTP >= 0 ? "+" : ""}${deltaTP}   ${deltaFP >= 0 ? "+" : ""}${deltaFP}   ${aggExpTN - aggBaseTN >= 0 ? "+" : ""}${aggExpTN - aggBaseTN}   ${aggExpFN - aggBaseFN >= 0 ? "+" : ""}${aggExpFN - aggBaseFN}   ${(eP-bP>=0?"+":"")}${((eP-bP)*100).toFixed(2)}pp  ${(eR-bR>=0?"+":"")}${((eR-bR)*100).toFixed(2)}pp  ${(eF1-bF1>=0?"+":"")}${((eF1-bF1)*100).toFixed(2)}pp`);

// ═══════════════════════════════════════════════════
// Changed Sequences Detail
// ═══════════════════════════════════════════════════

console.log(`\n${C.b}── Changed Sequences (${allResults.length} total) ──${C.r}\n`);

if (allResults.length === 0) {
  console.log(`  ${C.d}No sequences changed verdict.${C.r}\n`);
} else {
  for (const r of allResults) {
    const fromLabel = r.baselineVerdict === "clean" ? "clean" : "violation";
    const toLabel = r.experimentalVerdict === "clean" ? "clean" : "violation";
    const arrow = r.baselineVerdict === "clean" && r.experimentalVerdict === "violation"
      ? `${C.r2}clean→violation${C.r}`
      : r.baselineVerdict === "violation" && r.experimentalVerdict === "clean"
      ? `${C.g}violation→clean${C.r}`
      : `${C.d}changed${C.r}`;
    const impact = r.expected === "violation" && r.baselineVerdict === "clean" && r.experimentalVerdict === "violation"
      ? `${C.g}FN→TP ✅${C.r}`
      : r.expected === "clean" && r.baselineVerdict === "clean" && r.experimentalVerdict === "violation"
      ? `${C.r2}TN→FP ⚠️${C.r}`
      : r.expected === "violation" && r.baselineVerdict === "violation" && r.experimentalVerdict === "clean"
      ? `${C.r2}TP→FN ❌${C.r}`
      : `${C.d}FP→TN${C.r}`;

    console.log(`  ${C.b}[${r.idx}] ${r.function}${C.r}  ${C.d}${r.file}${C.r}  ${arrow}  ${impact}`);
    console.log(`     Expected: ${r.expected}  |  Baseline: ${r.baselineVerdict}  →  Experiment: ${r.experimentalVerdict}`);
    if (r.baselineViolations.length > 0) console.log(`     ${C.d}Baseline violations:${C.r} ${r.baselineViolations.join(", ")}`);
    if (r.experimentalViolations.length > 0) console.log(`     ${C.d}Experiment violations:${C.r} ${r.experimentalViolations.join(", ")}`);
    console.log("");
  }
}

// ═══════════════════════════════════════════════════
// Parser-Failed FN Recovery Check
// ═══════════════════════════════════════════════════

console.log(`${C.b}── Parser-Failed FN Recovery Check ──${C.r}\n`);

const parserFailedFNs = [
  { repo: "curl", idx: 16, func: "Curl_conn_connect" },
  { repo: "curl", idx: 22, func: "schannel_connect_step2" },
  { repo: "curl", idx: 27, func: "Curl_auth_decode_spnego_message" },
  { repo: "curl", idx: 85, func: "Curl_auth_create_ntlm_type1_message" },
  { repo: "libssh", idx: 40, func: "curve25519_do_create_k" },
];

let recovered = 0;
for (const fn of parserFailedFNs) {
  const matched = allResults.find(r => r.repo === fn.repo && r.idx === fn.idx);
  const recovered_this = matched && matched.baselineVerdict === "clean" && matched.experimentalVerdict === "violation";
  if (recovered_this) recovered++;
  const icon = recovered_this ? `${C.g}✅ recovered${C.r}` : `${C.r2}❌ still FN${C.r}`;
  console.log(`  ${icon}  [${fn.idx}] ${fn.func} (${fn.repo})`);
}

console.log(`\n  ${C.b}Parser-Failed FN Recovery: ${recovered}/${parserFailedFNs.length} (${(recovered/parserFailedFNs.length*100).toFixed(0)}%)${C.r}`);

// ═══════════════════════════════════════════════════
// Conclusion
// ═══════════════════════════════════════════════════

console.log(`\n${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Experiment-017 Conclusion${C.r}                                              ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

const fnRecovered = aggBaseFN - aggExpFN;
if (fnRecovered > 0 && aggExpFP - aggBaseFP <= 1) {
  console.log(`  ${C.g}✅ POSITIVE: Snake_case normalization recovered ${fnRecovered} FN with ${aggExpFP - aggBaseFP} new FP${C.r}`);
  console.log(`     Recommendation: Merge into detector baseline.`);
} else if (fnRecovered > 0 && aggExpFP - aggBaseFP > 1) {
  console.log(`  ${C.y}⚠️  MIXED: Recovered ${fnRecovered} FN but introduced ${aggExpFP - aggBaseFP} new FP${C.r}`);
  console.log(`     Recommendation: Investigate FP cases before merging.`);
} else if (fnRecovered === 0) {
  console.log(`  ${C.r2}❌ NEGATIVE: No FN recovered.${C.r}`);
  console.log(`     The 5 parser_failed FNs are NOT caused by snake_case trigger mismatch.`);
  console.log(`     They may be rule_coverage issues misclassified as parser_failed.`);
}

// Save report
const reportPath = path.join(__dirname, "reports", "experiment-017-snake-case.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  experimentId: "017",
  question: "Does snake_case lexical normalization improve C protocol detection?",
  independentVariable: "Trigger regex: [A-Z] → (?:[A-Z]|_)",
  benchmark: "Gold v1 (curl + libssh)",
  baseline: { TP: aggBaseTP, FP: aggBaseFP, TN: aggBaseTN, FN: aggBaseFN, precision: bP, recall: bR, f1: bF1 },
  experiment: { TP: aggExpTP, FP: aggExpFP, TN: aggExpTN, FN: aggExpFN, precision: eP, recall: eR, f1: eF1 },
  delta: { TP: deltaTP, FP: deltaFP, TN: aggExpTN - aggBaseTN, FN: aggExpFN - aggBaseFN, precision: eP - bP, recall: eR - bR, f1: eF1 - bF1 },
  parserFailedFNRecovery: `${recovered}/${parserFailedFNs.length}`,
  changedSequences: allResults,
}, null, 2));
console.log(`\n  ${C.d}Report: ${reportPath}${C.r}\n`);
