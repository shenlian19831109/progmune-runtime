/**
 * P0: C Gold Benchmark — FN Root Cause Analysis
 *
 * For each False Negative (gold=violation, detector=clean), classifies the root cause:
 *   rule_missing         — no safeguard rule's trigger matches
 *   parser_failed        — trigger matches but identifier parsing loses important info
 *   context_insufficient — safeguard exists at project level but not in file context
 *   ir_incomplete        — call sequence appears truncated / missing key operations
 *   rule_logic_flawed    — rule fires but safeguard check is too generous
 *
 * Usage: npx ts-node blind-benchmark/fn-root-cause-analysis.ts
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectSafeguardViolations,
  identifierParse,
  SafeguardViolation,
} from "../src/protocol-detector";

// Need access to SAFEGUARD_RULES — re-import the rules directly
const SAFEGUARD_RULES = [
  {
    name: "Password Hashing", category: "password_hashing",
    trigger: /\b(register|signUp|createUser|createAccount|registerUser)\b/i,
    safeguards: [{ pattern: /\b(bcrypt|argon2|scrypt|pbkdf2|hash|hashPassword|createHash|hashSync|hash_password)\b/i, label: "secure_hash" }],
    concepts: { missing: ["PasswordHash", "KeyDerivation"], expected: ["bcrypt", "argon2", "scrypt"] },
  },
  {
    name: "Password Hashing (Weak)", category: "password_hashing",
    trigger: /\b(register|signUp|createUser|createAccount|registerUser)\b/i,
    safeguards: [{ pattern: /\b(bcrypt|argon2|scrypt|pbkdf2)\b/i, label: "strong_hash" }],
    concepts: { missing: ["StrongHash", "SaltGeneration"], expected: ["bcrypt", "argon2"] },
  },
  {
    name: "Authorization (Ownership Check)", category: "authorization",
    trigger: /\b(add|create|delete|remove|update|toggle|modify|edit|lock|ban|process|refund|assign|transfer|share|schedule|upload|set)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|checkOwner|authorId\s*[!=]==?|ownerId\s*[!=]==?|userId\s*[!=]==?|\.owner\s*[!=]==?)/i, label: "auth_check" }],
    concepts: { missing: ["OwnershipCheck", "AuthorizationGuard"], expected: ["getUser", "validateToken", "ownerId check"] },
  },
  {
    name: "Authorization (Unauthenticated Access)", category: "authorization",
    trigger: /\b(get|list|download|view|read|fetch|find)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|token|session)\b/i, label: "auth_check" }],
    concepts: { missing: ["AuthenticationCheck", "AccessControl"], expected: ["token validation", "session check"] },
  },
  {
    name: "Data Integrity (Foreign Key)", category: "data_integrity",
    trigger: /\b(add|create|post|refund|process|send)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(get|find|check|exists|lookup|status)[A-Z]\w*\b/i, label: "fk_check" }],
    concepts: { missing: ["ForeignKeyValidation", "ReferentialIntegrity"], expected: ["checkExists", "getParent", "validateReference"] },
  },
  {
    name: "Input Validation", category: "input_validation",
    trigger: /\b(create|add|post|send|upload)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(validate|sanitize|check|verify)\w*(Content|Input|Length|Title|Body|Type|Size|File)\b/i, label: "input_validation" }],
    concepts: { missing: ["InputSanitization", "ContentValidation", "SizeLimit"], expected: ["validateContent", "sanitizeInput", "checkLength"] },
  },
  {
    name: "TLS Enforcement", category: "tls_enforcement",
    trigger: /\b(createServer|listen|handleRequest|app\.listen|express)\b/i,
    safeguards: [{ pattern: /\b(https|tls|ssl|cert|key|TLS|SSL|HTTPS|createSecureContext|credentials)\b/i, label: "tls_config" }],
    concepts: { missing: ["TLSConfiguration", "HTTPSEnforcement", "CertificateSetup"], expected: ["https.createServer", "TLS cert", "SSL configuration"] },
  },
  {
    name: "Token Security (Weak Generation)", category: "token_security",
    trigger: /\b(authenticate|login|signIn|logIn|createSession|generateToken)\b/i,
    safeguards: [{ pattern: /\b(crypto\.randomUUID|jwt\.sign|jsonwebtoken|nanoid|randomBytes|cryptoRandomString)\b/i, label: "secure_token" }],
    concepts: { missing: ["SecureRandom", "TokenEntropy", "CryptographicSignature"], expected: ["crypto.randomUUID", "jwt.sign", "nanoid"] },
  },
  {
    name: "Authorization (Resource Ownership)", category: "authorization",
    trigger: /\b(toggle|remove)[A-Z]\w*\b/i,
    safeguards: [{ pattern: /\b(ownerId\s*[!=]==?|authorId\s*[!=]==?|userId\s*[!=]==?|createdBy|\.owner\s*[!=]==?)/i, label: "ownership_comparison" }],
    concepts: { missing: ["ResourceOwnership", "HorizontalAuthorization"], expected: ["ownerId comparison", "authorId check"] },
  },
  {
    name: "Payment Order Verification", category: "data_integrity",
    trigger: /\b(process|create|make|submit)\w*(Payment|Charge|Transaction)\b/i,
    safeguards: [{ pattern: /\b(getOrder|verifyOrder|checkOrder|findOrder|orderExists|order\b)/i, label: "order_verification" }],
    concepts: { missing: ["OrderVerification", "PaymentAuthorization"], expected: ["getOrder", "verifyOrder"] },
  },
  {
    name: "Room Membership Check", category: "authorization",
    trigger: /\b(send|post|publish)\w*(Message|Msg)\b/i,
    safeguards: [{ pattern: /\b(joinRoom|roomMember|checkMember|isMember|members\.includes|members\.find|memberOf|inRoom)\b/i, label: "room_membership" }],
    concepts: { missing: ["RoomMembership", "ChannelAuthorization"], expected: ["joinRoom", "isMember"] },
  },
  {
    name: "Refund Status Verification", category: "data_integrity",
    trigger: /\b(refund|cancel|void|reverse)\w*(Payment|Order|Charge|Transaction)\b/i,
    safeguards: [{ pattern: /\b(status|\.status|getStatus|checkStatus|orderStatus|paymentStatus)\b/i, label: "status_check" }],
    concepts: { missing: ["StatusVerification", "IdempotencyCheck"], expected: ["status check", "orderStatus"] },
  },
  {
    name: "Rate Limiting", category: "rate_limiting",
    trigger: /\b(createServer|listen|handleRequest|app\.listen|express|router\.(post|get|put|delete|patch))\b/i,
    safeguards: [{ pattern: /\b(rateLimit|rate_limit|throttle|RateLimiter|expressRateLimit|rateLimiterMiddleware|limiter)\b/i, label: "rate_limit" }],
    concepts: { missing: ["RateLimiting", "DoSProtection", "AbusePrevention"], expected: ["rateLimit", "throttle", "express-rate-limit"] },
  },
];

interface Sequence {
  function: string;
  file: string;
  calls: string[];
}

function loadRepo(repoName: string): { sequences: Sequence[]; labels: Map<number, string> } {
  const benchDir = path.resolve(__dirname, "..", "benchmarks");
  const seqPath = path.join(benchDir, `${repoName}-sequences.json`);
  const labPath = path.join(benchDir, `${repoName}-labels.json`);

  const seqData = JSON.parse(fs.readFileSync(seqPath, "utf-8"));
  const labData = JSON.parse(fs.readFileSync(labPath, "utf-8"));

  const sequences: Sequence[] = (seqData.sequences || seqData).map((s: any) => ({
    function: s.function || "",
    file: s.file || "",
    calls: s.calls || [],
  }));

  const labels = new Map<number, string>();
  const labSource = labData.labels || labData;
  for (const [key, val] of Object.entries(labSource)) {
    const idx = parseInt(key);
    if (!isNaN(idx) && (val === "clean" || val === "violation")) {
      labels.set(idx, val as string);
    }
  }

  return { sequences, labels };
}

type RootCause = "rule_missing" | "parser_failed" | "context_insufficient" | "ir_incomplete" | "rule_logic_flawed" | "other";

interface FNAnalysis {
  idx: number;
  repo: string;
  function: string;
  file: string;
  calls: string[];
  // Which rules' triggers match?
  triggeredRules: string[];
  // For each triggered rule, why didn't it fire?
  ruleDetails: Array<{
    rule: string;
    triggerMatched: boolean;
    triggerMatchDetail: string;
    safeguardInFile: boolean;
    safeguardInProject: boolean;
    safeguardMatchDetail: string;
    whyFN: string;
  }>;
  // All calls in same file
  fileCalls: string[];
  // Root cause classification
  rootCause: RootCause;
  rootCauseExplanation: string;
}

function analyzeFN(
  idx: number, repo: string, seq: Sequence,
  allCalls: string[], fileCallsMap: Map<string, Set<string>>
): FNAnalysis {
  const funcCalls = [...new Set(seq.calls)];
  const fileCalls = [...(fileCallsMap.get(seq.file) || new Set())];

  // Build effective calls (same as v6 does)
  const rawCalls = [seq.function, ...fileCalls, ...funcCalls];
  const parsedWords: string[] = [];
  for (const c of rawCalls) parsedWords.push(...identifierParse(c));
  const effectiveCalls = [...new Set([...rawCalls, ...parsedWords])];

  // Build project-level effective calls
  const projRaw = [seq.function, ...allCalls];
  const projParsed: string[] = [];
  for (const c of projRaw) projParsed.push(...identifierParse(c));
  const projEffectiveCalls = [...new Set([...projRaw, ...projParsed])];

  const ruleDetails: FNAnalysis["ruleDetails"] = [];
  const triggeredRules: string[] = [];

  for (const rule of SAFEGUARD_RULES) {
    // Check trigger against file-level context
    const triggerMatched = effectiveCalls.some(c => rule.trigger.test(c));
    if (!triggerMatched) continue;

    triggeredRules.push(rule.name);

    const triggerHits = effectiveCalls.filter(c => rule.trigger.test(c)).slice(0, 5);

    // Check safeguard in file context
    const safeguardInFile = rule.safeguards.some(s =>
      effectiveCalls.some(c => s.pattern.test(c))
    );

    // Check safeguard in project context
    const safeguardInProject = rule.safeguards.some(s =>
      projEffectiveCalls.some(c => s.pattern.test(c))
    );

    // Determine why it's FN
    let whyFN: string;
    if (!triggerMatched) {
      whyFN = "Trigger doesn't match function name or file calls";
    } else if (safeguardInFile) {
      whyFN = "Safeguard found in file context — detector thinks it's protected";
    } else if (safeguardInProject && !safeguardInFile) {
      whyFN = "Safeguard exists in project but NOT in this file — context insufficient";
    } else {
      whyFN = "No safeguard found anywhere — rule coverage gap for this pattern";
    }

    ruleDetails.push({
      rule: rule.name,
      triggerMatched: true,
      triggerMatchDetail: `Trigger hits: ${triggerHits.join(", ")}`,
      safeguardInFile,
      safeguardInProject,
      safeguardMatchDetail: safeguardInFile
        ? "File has safeguard → detector suppressed"
        : safeguardInProject
        ? "Project has safeguard but not in this file"
        : "No safeguard pattern matches at all",
      whyFN,
    });
  }

  // If NO rules triggered → rule_missing
  let rootCause: RootCause;
  let rootCauseExplanation: string;

  if (triggeredRules.length === 0) {
    // Check if parser could help
    const funcWords = identifierParse(seq.function);
    const hasActionWords = funcWords.some(w =>
      /\b(init|create|connect|send|read|write|close|free|auth|verify|check|config|setup|start|stop|open|parse|process|handle)\b/i.test(w)
    );

    if (hasActionWords) {
      rootCause = "parser_failed";
      rootCauseExplanation = `Function "${seq.function}" contains action words (${funcWords.filter(w => /\b(init|create|connect|send|read|write|close|free|auth|verify|check|config|setup|start|stop|open|parse|process|handle)\b/i.test(w)).join(", ")}) but no trigger matches. Rules need C-specific patterns.`;
    } else {
      rootCause = "rule_missing";
      rootCauseExplanation = `No safeguard rule's trigger matches function "${seq.function}" or its file context. Rules are designed for TS/web patterns and don't cover C protocol functions.`;
    }
  } else {
    // Rules triggered but all had safeguard matches → rule_logic_flawed or context_insufficient
    const allHaveSafeguardInFile = ruleDetails.every(r => r.safeguardInFile);
    const anyHaveSafeguardOnlyInProject = ruleDetails.some(r => r.safeguardInProject && !r.safeguardInFile);

    if (allHaveSafeguardInFile) {
      rootCause = "rule_logic_flawed";
      rootCauseExplanation = "Rules triggered but safeguards found in file context. The safeguard is a false match — the file happens to contain a word that matches the safeguard regex but doesn't actually provide the protection.";
    } else if (anyHaveSafeguardOnlyInProject) {
      rootCause = "context_insufficient";
      rootCauseExplanation = "Safeguard exists in project scope but not in this file. Per-file context can't see cross-file protections.";
    } else {
      rootCause = "rule_missing";
      rootCauseExplanation = `Rules triggered (${triggeredRules.join(", ")}) but no matching safeguard exists anywhere. Rules' safeguard patterns don't cover C idioms.`;
    }
  }

  return {
    idx, repo, function: seq.function, file: seq.file, calls: funcCalls,
    triggeredRules, ruleDetails, fileCalls,
    rootCause, rootCauseExplanation,
  };
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════

const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r2: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", m: "\x1b[35m" };

console.log(`${C.b}${C.c}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.b}P0: C Gold Benchmark — FN Root Cause Analysis${C.r}                           ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.d}Quantifying WHY each False Negative exists${C.r}                               ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

const allFNs: FNAnalysis[] = [];

for (const repo of ["curl", "libssh"]) {
  const { sequences, labels } = loadRepo(repo);
  const allCalls = [...new Set(sequences.flatMap(s => s.calls))];

  // Build file calls map
  const fileCallsMap = new Map<string, Set<string>>();
  for (const s of sequences) {
    if (!fileCallsMap.has(s.file)) fileCallsMap.set(s.file, new Set());
    for (const c of s.calls) fileCallsMap.get(s.file)!.add(c);
  }

  console.log(`${C.b}── ${repo.toUpperCase()} ──${C.r}\n`);

  for (const [idx, expected] of labels) {
    if (expected !== "violation") continue;
    if (idx >= sequences.length) continue;
    const seq = sequences[idx];

    // Check v6 verdict
    const fileCalls = [...(fileCallsMap.get(seq.file) || new Set())];
    const mergedCalls = [...new Set([...fileCalls, ...seq.calls])];
    const v6Vios = detectSafeguardViolations(mergedCalls, seq.function);
    const v6Verdict = v6Vios.length === 0 ? "clean" : "violation";

    if (v6Verdict !== "clean") continue; // Not an FN (v6 caught it)

    const analysis = analyzeFN(idx, repo, seq, allCalls, fileCallsMap);
    allFNs.push(analysis);

    // Print detail
    const rootCauseColor = analysis.rootCause === "rule_missing" ? C.y
      : analysis.rootCause === "parser_failed" ? C.m
      : analysis.rootCause === "context_insufficient" ? C.c
      : analysis.rootCause === "rule_logic_flawed" ? C.r2
      : C.d;

    console.log(`  ${C.b}[${idx}] ${seq.function}${C.r}  ${C.d}${seq.file.split("/").pop()}${C.r}`);
    console.log(`     ${C.d}Calls:${C.r} ${seq.calls.slice(0, 8).join(", ")}${seq.calls.length > 8 ? " ..." : ""}`);
    console.log(`     ${C.d}Root cause:${C.r} ${rootCauseColor}${analysis.rootCause}${C.r}`);
    console.log(`     ${analysis.rootCauseExplanation}`);

    if (analysis.triggeredRules.length > 0) {
      console.log(`     ${C.d}Rules triggered:${C.r} ${analysis.triggeredRules.join(", ")}`);
      for (const rd of analysis.ruleDetails.slice(0, 2)) {
        console.log(`       ${rd.rule}: ${rd.whyFN}`);
        console.log(`         ${C.d}${rd.triggerMatchDetail}${C.r}`);
        console.log(`         ${C.d}Safeguard: file=${rd.safeguardInFile} project=${rd.safeguardInProject}${C.r}`);
      }
    } else {
      console.log(`     ${C.d}No rules triggered${C.r} — function name & file calls don't match any rule patterns`);
      // Show what the function name parses to
      const words = identifierParse(seq.function);
      console.log(`     ${C.d}Identifier parse:${C.r} ${seq.function} → [${words.join(", ")}]`);
    }
    console.log("");
  }
}

// ═══════════════════════════════════════════════════
// Aggregate Analysis
// ═══════════════════════════════════════════════════

console.log(`${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Aggregate: FN Root Cause Distribution${C.r}                                  ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

const causeCounts = new Map<RootCause, number>();
for (const fn of allFNs) {
  causeCounts.set(fn.rootCause, (causeCounts.get(fn.rootCause) || 0) + 1);
}

console.log(`  Total FNs analyzed: ${allFNs.length}\n`);

const causeLabels: Record<RootCause, string> = {
  rule_missing: "Rule Missing (no trigger matches at all)",
  parser_failed: "Parser Failed (trigger could match with better parsing)",
  context_insufficient: "Context Insufficient (safeguard exists but not visible)",
  ir_incomplete: "IR Incomplete (call sequence truncated)",
  rule_logic_flawed: "Rule Logic Flawed (trigger+safeguard both present, false match)",
  other: "Other",
};

const causeColors: Record<RootCause, string> = {
  rule_missing: C.y,
  parser_failed: C.m,
  context_insufficient: C.c,
  ir_incomplete: C.d,
  rule_logic_flawed: C.r2,
  other: C.d,
};

console.log(`  ${C.b}Root Cause                          Count   Pct     Investment${C.r}`);
console.log(`  ${C.d}────────────────────────────────────────────────────────────${C.r}`);

for (const [cause, count] of [...causeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = (count / allFNs.length * 100).toFixed(0);
  const bar = "█".repeat(Math.round(count / allFNs.length * 20));
  const investment = cause === "rule_missing" ? "→ Rule Coverage"
    : cause === "parser_failed" ? "→ Parser / Identifier"
    : cause === "context_insufficient" ? "→ Context (v7/v8)"
    : cause === "ir_incomplete" ? "→ IR Extraction"
    : cause === "rule_logic_flawed" ? "→ Rule Refinement"
    : "→ Investigate";

  console.log(`  ${causeColors[cause]}${causeLabels[cause].padEnd(36)}${C.r} ${String(count).padStart(3)}   ${pct.padStart(3)}%   ${investment}`);
}

// ── Recommendations ──
console.log(`\n${C.b}── Investment Recommendations (based on data) ──${C.r}\n`);

const pctRuleMissing = (causeCounts.get("rule_missing") || 0) / allFNs.length;
const pctParser = (causeCounts.get("parser_failed") || 0) / allFNs.length;
const pctContext = (causeCounts.get("context_insufficient") || 0) / allFNs.length;

if (pctRuleMissing + pctParser > 0.5) {
  console.log(`  ${C.y}P0: Rule Coverage + Parser — ${((pctRuleMissing + pctParser) * 100).toFixed(0)}% of FNs from these two${C.r}`);
  console.log(`     Rule patterns need C-specific idioms (macro guards, goto cleanup, state machine transitions)`);
  console.log(`     Identifier parser needs snake_case and abbreviation awareness`);
}

if (pctContext > 0.1) {
  console.log(`  ${C.c}P1: Context — ${(pctContext * 100).toFixed(0)}% of FNs from context visibility${C.r}`);
  console.log(`     v7 caller-chain could help for these specific cases`);
}

console.log(`\n  ${C.d}See: docs/experiments/fn-root-cause-analysis-2026-07-16.json for full data${C.r}\n`);

// Save
const reportPath = path.join(__dirname, "reports", "fn-root-cause-analysis-2026-07-16.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  generated: new Date().toISOString(),
  totalFNs: allFNs.length,
  distribution: Object.fromEntries(causeCounts),
  details: allFNs.map(fn => ({
    repo: fn.repo,
    idx: fn.idx,
    function: fn.function,
    file: fn.file,
    rootCause: fn.rootCause,
    explanation: fn.rootCauseExplanation,
    triggeredRules: fn.triggeredRules,
  })),
}, null, 2));
