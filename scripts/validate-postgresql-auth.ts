#!/usr/bin/env npx ts-node
/**
 * PostgreSQL Auth Module Validation
 *
 * Extracts function call sequences from postgresql auth.c,
 * runs P0 session/registration/payment rules against them,
 * and classifies findings as TP/FP.
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectSafeguardViolations,
  detectProtocolViolations,
  SafeguardViolation,
  ProtocolViolation,
} from "../src/protocol-detector";

const SRC_FILE = path.join(__dirname, "..", "benchmarks", "postgresql", "auth.c");

// ── C function + call extraction (simplified C parser) ──
interface CFunction {
  name: string;
  body: string;
  calls: string[];
  lineStart: number;
}

function extractCFunctions(source: string): CFunction[] {
  const funcs: CFunction[] = [];
  // Match C function definitions: return_type func_name(params) { body }
  const funcRegex = /^(?:static\s+)?(?:const\s+)?(\w+(?:\s*\*?\s*)+)(\w+)\s*\([^)]*\)\s*(\{)/gm;
  const braceRegex = /[{}]/g;
  const callRegex = /(\w+)\s*\(/g;

  let match;
  while ((match = funcRegex.exec(source)) !== null) {
    const name = match[2];
    const bodyStart = match.index + match[0].length;

    // Skip known non-interesting functions
    if (/^(pg_|elog|ereport|errmsg|errhint|errdetail|MemoryContext|palloc|pfree|memcpy|memset|strcmp|strncmp|strlen|snprintf|sprintf|gettext|pstrdup)/.test(name)) continue;
    if (name === "check_usermap" || name === "perform_addrs_compiled_test" || name === "is_tunneling_trust_checks_disabled") continue;

    // Find matching closing brace
    let depth = 1;
    let pos = bodyStart;
    while (pos < source.length && depth > 0) {
      const ch = source[pos];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      pos++;
    }
    const bodyEnd = pos;
    const body = source.substring(bodyStart, bodyEnd);

    // Extract function calls from body
    const calls = new Set<string>();
    let cm;
    const skipCalls = new Set([
      "if", "for", "while", "switch", "return", "sizeof", "case", "default",
      "NULL", "true", "false", "void", "int", "char", "bool", "size_t",
      "elog", "ereport", "errmsg", "errhint", "errdetail", "errstart",
      "palloc", "palloc0", "pfree", "repalloc", "MemoryContextAlloc",
      "memcpy", "memset", "strcmp", "strncmp", "strlen", "strcat", "strcpy",
      "snprintf", "sprintf", "gettext", "pstrdup", "pnstrdup",
      "Assert", "AssertMacro", "CHECK_FOR_INTERRUPTS",
      "list_head", "list_length", "list_nth", "list_free",
    ]);
    while ((cm = callRegex.exec(body)) !== null) {
      const called = cm[1];
      if (!skipCalls.has(called) && called.length > 2) {
        calls.add(called);
      }
    }

    if (calls.size > 0 || /session|auth|login|password|token|verify|register|authenticate|connect|disconnect/i.test(name)) {
      funcs.push({ name, body: body.substring(0, 200), calls: [...calls].slice(0, 30), lineStart: match.index });
    }
  }

  return funcs;
}

// ── Main ──
console.log("\n═══ PostgreSQL Auth Module Validation ═══\n");
console.log(`Source: ${SRC_FILE}\n`);

const source = fs.readFileSync(SRC_FILE, "utf-8");
const funcs = extractCFunctions(source);

console.log(`Functions extracted: ${funcs.length}\n`);

// Run detectors
let totalViolations = 0;
let p0Catches = 0;
let existingCatches = 0;
const findings: Array<{
  fn: string;
  calls: string[];
  p0: string[];
  existing: string[];
  verdict: string;
}> = [];

const P0_CATEGORIES = ["payment", "registration", "session", "file_upload", "notification", "api_gateway", "data_integrity", "resource", "supplier"];

for (const func of funcs) {
  const safeViolations = detectSafeguardViolations(func.calls, func.name, "c");
  const protoViolations = detectProtocolViolations(func.calls);

  const p0 = safeViolations.filter((v: SafeguardViolation) => P0_CATEGORIES.includes(v.category));
  const existing = safeViolations.filter((v: SafeguardViolation) => !P0_CATEGORIES.includes(v.category));

  if (safeViolations.length > 0 || protoViolations.length > 0) {
    totalViolations++;
    p0Catches += p0.length;
    existingCatches += existing.length;

    findings.push({
      fn: func.name,
      calls: func.calls,
      p0: p0.map(v => `${v.rule} [${v.category}]`),
      existing: existing.map(v => `${v.rule} [${v.category}]`),
      verdict: "?",
    });
  }
}

// ── Classify findings ──
console.log(`Total violations: ${totalViolations} (across ${funcs.length} functions)`);
console.log(`P0 new catches: ${p0Catches}`);
console.log(`Existing catches: ${existingCatches}\n`);

// Show only functions with session/auth-relevant names
const authFuncs = findings.filter(f =>
  /session|auth|login|password|token|verify|register|authenticate|connect|disconnect|ident|hba|radius|ldap|cert|scram|gss|sspi|pam|peer/i.test(f.fn)
);

console.log(`─── Auth-Relevant Functions with Violations (${authFuncs.length}) ───\n`);

for (const f of authFuncs) {
  // Manual classification
  const fn = f.fn;
  const allRules = [...f.p0, ...f.existing];

  let verdict = "FP";
  let reason = "";

  // Heuristic: PostgreSQL auth functions manage their own protocol state correctly
  if (/^(ClientAuthentication|PerformAuthentication|pg_)/.test(fn)) {
    verdict = "🟢 FP";
    reason = "Orchestrator function — manages full auth lifecycle";
  } else if (/^(Check|check_)/.test(fn)) {
    verdict = "🟢 FP";
    reason = "Validation helper — stateless check";
  } else if (/^(sendAuthRequest|recvAuthRequest)/.test(fn)) {
    verdict = "🟢 FP";
    reason = "I/O helper";
  } else if (allRules.some(r => /P0/.test(r) || /session/i.test(r) || /registration/i.test(r))) {
    verdict = "🟡 REVIEW";
    reason = "P0 rule triggered — needs manual review";
  }

  console.log(`${verdict} | ${fn}`);
  console.log(`  calls: ${f.calls.slice(0, 8).join(", ")}`);
  if (f.p0.length > 0) {
    console.log(`  🆕 P0: ${f.p0.join("; ")}`);
  }
  if (f.existing.length > 0) {
    console.log(`  ✅ existing: ${f.existing.join("; ")}`);
  }
  if (reason) console.log(`  → ${reason}`);
  console.log();
}

// ── Show ALL P0 catches ──
console.log(`─── P0 Rule Catches (${p0Catches} total) ───\n`);
const p0ByRule: Record<string, string[]> = {};
for (const f of findings) {
  for (const p of f.p0) {
    const ruleName = p.split(" [")[0];
    if (!p0ByRule[ruleName]) p0ByRule[ruleName] = [];
    p0ByRule[ruleName].push(f.fn);
  }
}
for (const [rule, fns] of Object.entries(p0ByRule).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${rule}: ${fns.length}x — ${fns.slice(0, 6).join(", ")}`);
}

// ── Key auth functions that should have been caught but weren't ──
console.log(`\n─── Key Auth Functions (ALL, including those with NO violations) ───\n`);
const keyFns = funcs.filter(f =>
  /^(ClientAuthentication|PerformAuthentication|CheckPWChallengeAuth|CheckSCRAMAuth|CheckMD5Auth|CheckPasswordAuth|pg_SSPI_continue|pg_GSS_continue|auth_peer|ident_inet|InitializeSession|StartSession)$/i.test(f.name)
);
for (const f of keyFns) {
  const safeViolations = detectSafeguardViolations(f.calls, f.name, "c");
  const hasP0 = safeViolations.some(v => P0_CATEGORIES.includes(v.category));
  const hasOld = safeViolations.some(v => !P0_CATEGORIES.includes(v.category));
  console.log(`  ${f.name}: P0=${hasP0} old=${hasOld} calls=${f.calls.slice(0, 5).join(", ")}`);
}

console.log();
