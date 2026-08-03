#!/usr/bin/env npx ts-node
/**
 * Validate P0 payment + registration rules on ecommerce TS project.
 * Checks: which violations do the NEW P0 rules catch
 *         that the OLD v6/v7 rules missed?
 */

import { detectSafeguardViolations, SafeguardViolation } from "../src/protocol-detector";

// ── Ecommerce function call sequences (extracted from source) ──

const sequences: { func: string; calls: string[]; gold_finding: string }[] = [
  // === Payment ===
  {
    func: "processPayment",
    calls: ["getUser"],
    gold_finding: "Payment processed without verifying order exists and belongs to user.",
  },
  {
    func: "refundPayment",
    calls: ["getUser"],
    gold_finding: "(no gold annotation — but missing admin check)",
  },
  // === Order ===
  {
    func: "placeOrder",
    calls: ["getUser", "updateStock", "updateStock"],
    gold_finding: "(no gold annotation)",
  },
  // === Auth / Registration ===
  {
    func: "signUp",
    calls: [],
    gold_finding: "Password stored as plaintext. No hashing.",
  },
  {
    func: "signIn",
    calls: ["signUp", "getUser"],
    gold_finding: "Token = tok_<increment> — predictable.",
  },
  {
    func: "signOut",
    calls: ["getUser"],
    gold_finding: "(no gold annotation)",
  },
  {
    func: "getUser",
    calls: ["getUser"],
    gold_finding: "(no gold annotation)",
  },
];

// Also check a broader context for session functions
const sessionSequences = [
  {
    func: "signIn",
    calls: ["signUp", "getUser", "signOut"],
    gold_finding: "No session timeout/expiry set",
  },
];

console.log("═══ P0 Payment + Registration Rule Validation ═══\n");
console.log("Project: ecommerce (Claude-generated TS)");
console.log("Source: blind-benchmark/generated/ecommerce/src/\n");

let totalViolations = 0;
let newP0Catches = 0;
let missedViolations = 0;

const P0_CATEGORIES = ["payment", "registration", "session"];

for (const seq of [...sequences, ...sessionSequences]) {
  const violations = detectSafeguardViolations(seq.calls, seq.func, "typescript");

  // Separate P0-new violations from existing ones
  const p0Violations = violations.filter(v => P0_CATEGORIES.includes(v.category));
  const existingViolations = violations.filter(v => !P0_CATEGORIES.includes(v.category));

  console.log(`┌─ ${seq.func}(${seq.calls.join(", ") || "no calls"})`);
  console.log(`│  Gold: ${seq.gold_finding}`);

  if (violations.length === 0) {
    console.log(`│  Result: NO violations detected`);
    if (seq.gold_finding && !seq.gold_finding.startsWith("(no gold")) {
      console.log(`│  🔴 MISSED: expected violation not caught`);
      missedViolations++;
    }
  } else {
    console.log(`│  Violations: ${violations.length}`);

    // P0-new violations
    if (p0Violations.length > 0) {
      console.log(`│  🆕 P0 RULES (newly added):`);
      for (const v of p0Violations) {
        console.log(`│     [${v.category}] ${v.rule}`);
        console.log(`│     → ${v.detail}`);
        newP0Catches++;
      }
    }

    // Existing violations
    if (existingViolations.length > 0) {
      console.log(`│  ✅ EXISTING RULES (v6/v7):`);
      for (const v of existingViolations) {
        console.log(`│     [${v.category}] ${v.rule}`);
      }
    }

    // Check if gold finding is covered
    if (seq.gold_finding && !seq.gold_finding.startsWith("(no gold")) {
      const covered = violations.some(v =>
        v.detail.toLowerCase().includes(seq.gold_finding.toLowerCase().slice(0, 20))
      );
      if (!covered) {
        console.log(`│  ⚠️  Gold finding not directly addressed by detected violations`);
      }
    }
  }

  totalViolations += violations.length;
  console.log(`└─\n`);
}

console.log(`─── Summary ───`);
console.log(`  Total violations detected: ${totalViolations}`);
console.log(`  New P0 rule catches: ${newP0Catches}`);
console.log(`  Missed expected violations: ${missedViolations}`);
console.log();

// Also verify: does the Payment Processing detector fire?
console.log(`─── Protocol Detector Check ───`);
const { detectProtocolViolations } = require("../src/protocol-detector");

const paymentCalls = ["getUser"];
const protoViolations = detectProtocolViolations(paymentCalls);
if (protoViolations.length > 0) {
  console.log(`  Protocol violations found:`);
  for (const v of protoViolations) {
    console.log(`    [${v.protocol}] ${v.detail}`);
  }
} else {
  console.log(`  No protocol state violations (expected: payment functions are single-call)`);
}
console.log();
