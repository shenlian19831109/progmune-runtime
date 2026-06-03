/**
 * Comprehensive Test Suite v2 — Protocol, Feedback, TF-IDF, IR, Chain, Parser
 * Usage: npx ts-node --transpile-only test_comprehensive_v2.ts
 */

import * as assert from "assert";

let passed = 0, failed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e: any) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
};

// ═══════════════════════════════════════════════════════════════
// 1. Protocol Edge Cases
// ═══════════════════════════════════════════════════════════════
console.log("\n── 1. Protocol Edge Cases ──");

import { validateTransition, rebuildState, checkLedgerConsistency, parseProtocolsFromJSON } from "./src/ssg-validator";
import type { ValidationContext, StateTransition } from "./src/runtime-types";

test("multi-namespace state isolation", () => {
  const rules = new Map();
  rules.set("login", { pre_states: ["UNAUTHENTICATED"], post_states: ["AUTHENTICATED"], namespace: "auth" });
  rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"], namespace: "file" });
  rules.set("read_file", { pre_states: ["FILE_OPEN"], post_states: [], namespace: "file" });

  const nsInit = new Map([["_global", "UNAUTHENTICATED"], ["auth", "UNAUTHENTICATED"], ["file", "INIT"]]);
  const ctx: ValidationContext = { ledger: [], currentState: rebuildState([], nsInit) };

  // open_file should be valid even when auth is UNAUTHENTICATED (different namespace)
  const r1 = validateTransition(ctx, "open_file", 0, rules, nsInit);
  assert.ok(r1.valid, "open_file in file namespace should not be blocked by auth state");
});

test("nested state invalidation chain", () => {
  const rules = new Map();
  rules.set("verify", { pre_states: ["UNAUTHENTICATED"], post_states: ["VERIFIED"], namespace: "auth" });
  rules.set("issue_token", { pre_states: ["VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["VERIFIED"], namespace: "auth" });
  rules.set("create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"], namespace: "auth" });

  const nsInit = new Map([["auth", "UNAUTHENTICATED"]]);
  const ctx: ValidationContext = { ledger: [], currentState: rebuildState([], nsInit) };

  const r1 = validateTransition(ctx, "verify", 0, rules, nsInit);
  assert.ok(r1.valid);

  ctx.ledger = [r1.transition];
  ctx.currentState = r1.transition.statesAfter;

  const r2 = validateTransition(ctx, "issue_token", 1, rules, nsInit);
  assert.ok(r2.valid);
  // VERIFIED should be invalidated after token issued
  assert.ok(!(r2.transition.statesAfter["auth"] || []).includes("VERIFIED"), "VERIFIED should be invalidated");
});

test("protocol violation with cross-namespace fix path", () => {
  const rules = new Map();
  rules.set("extract_ir", { pre_states: [], post_states: ["IR_READY"], namespace: "dev" });
  rules.set("validate", { pre_states: ["IR_READY"], post_states: ["VALIDATED"], namespace: "dev" });
  rules.set("emit", { pre_states: ["VALIDATED"], post_states: ["EMITTED"], namespace: "dev" });

  const nsInit = new Map([["dev", "INIT"]]);
  const ctx: ValidationContext = { ledger: [], currentState: rebuildState([], nsInit) };

  // Trying to call emit before extract_ir should fail
  const r = validateTransition(ctx, "emit", 0, rules, nsInit);
  assert.ok(!r.valid, "emit should be blocked without IR_READY");
  assert.ok(r.rejection, "should have rejection");
  assert.ok((r.rejection!.missingFunctions || []).includes("extract_ir"), "fixPath should include extract_ir");
});

// ═══════════════════════════════════════════════════════════════
// 2. Feedback Dynamics
// ═══════════════════════════════════════════════════════════════
console.log("\n── 2. Feedback Dynamics ──");

import { getFunctionSuccessRate, getWeightedSuccessRate, getFailureAdjustedCredit, recordRun } from "./src/feedback";

test("unknown function returns neutral 0.5", () => {
  assert.equal(getFunctionSuccessRate("unknown_xyz_func_123"), 0.5);
  assert.equal(getWeightedSuccessRate("unknown_xyz_func_123"), 0.5);
  assert.equal(getFailureAdjustedCredit("unknown_xyz_func_123"), 0.5);
});

test("success rate updates after recordRun", () => {
  const funcName = "test_dynamic_func_" + Date.now();
  // Record some runs
  recordRun("test intent", [{ kind: "call", function: funcName, args: [] }], true);
  recordRun("test intent", [{ kind: "call", function: funcName, args: [] }], false);

  const rate = getFunctionSuccessRate(funcName);
  assert.ok(rate > 0.4 && rate < 0.6, `Expected ~0.5, got ${rate}`);
});

test("feedback records persist and affect scoring", () => {
  const funcName = "feedback_test_" + Date.now();
  // Record a successful run
  recordRun("test", [{ kind: "call", function: funcName, args: [] }], true);
  const rate1 = getFunctionSuccessRate(funcName);
  assert.ok(rate1 >= 0.5, `After 1 success, rate should be >= 0.5, got ${rate1}`);

  // Record a failure
  recordRun("test", [{ kind: "call", function: funcName, args: [] }], false);
  const rate2 = getFunctionSuccessRate(funcName);
  assert.ok(rate2 < rate1, `After failure, rate should drop: ${rate2} < ${rate1}`);
});

// ═══════════════════════════════════════════════════════════════
// 3. TF-IDF (Keyword Extraction) Robustness
// ═══════════════════════════════════════════════════════════════
console.log("\n── 3. TF-IDF / Keyword Robustness ──");

import { extractKeywords, jaccardSimilarity } from "./src/utils";

test("empty string returns empty keywords", () => {
  const kw = extractKeywords("");
  assert.equal(kw.length, 0);
});

test("short words filtered, long words kept", () => {
  const kw = extractKeywords("a bb ccc dddd");
  // 'a' (len 1) should be filtered out
  assert.ok(!kw.includes("a"), "Single char 'a' should be filtered");
  // 'bb', 'ccc', 'dddd' (len >= 2) should be kept
  assert.ok(kw.length >= 3, `Expected >=3 keywords, got ${kw.length}: ${kw}`);
});

test("very long text extracts keywords", () => {
  const long = "process data and analyze the failure genome statistics for the current project " + "x".repeat(500);
  const kw = extractKeywords(long);
  assert.ok(kw.length >= 3, `Expected >=3 keywords, got ${kw.length}`);
  assert.ok(kw.includes("process") || kw.includes("data") || kw.includes("analyze"));
});

test("jaccard with identical strings is 1.0", () => {
  assert.equal(jaccardSimilarity("hello", "hello"), 1.0);
});

test("jaccard with completely different strings is <0.3", () => {
  const sim = jaccardSimilarity("failure", "xyzqwrty");
  assert.ok(sim < 0.3, `Expected <0.3, got ${sim}`);
});

// ═══════════════════════════════════════════════════════════════
// 4. IR Robustness
// ═══════════════════════════════════════════════════════════════
console.log("\n── 4. IR Robustness ──");

import { selectCapabilityChains } from "./src/strategy-planner";

test("IR with missing produces/requires fields", () => {
  const ir = [
    { name: "funcA", purpose: "do something", tags: ["util"], produces: ["DATA"], requires: [], exported: true },
    { name: "funcB", purpose: "consume data", tags: ["util"], requires: ["DATA"], exported: true },
    // Missing produces field entirely
    { name: "funcC", purpose: "helper", tags: ["helper"], exported: true },
    // Missing requires field
    { name: "funcD", purpose: "producer", tags: ["util"], produces: ["RESULT"], exported: true },
  ];
  const chains = selectCapabilityChains("do something with data", ir);
  assert.ok(chains.length >= 0, "Should not crash with missing fields");
});

test("empty IR returns empty chains", () => {
  const chains = selectCapabilityChains("anything", []);
  assert.equal(chains.length, 0);
});

test("IR with null/undefined values", () => {
  const ir = [
    { name: "funcA", purpose: null as any, tags: null as any, produces: null as any, requires: null as any, exported: true },
  ];
  const chains = selectCapabilityChains("test", ir);
  assert.equal(chains.length, 0, "Null fields should be handled gracefully");
});

// ═══════════════════════════════════════════════════════════════
// 5. Complex Chain Depth & Circular Dependencies
// ═══════════════════════════════════════════════════════════════
console.log("\n── 5. Complex Chain Depth ──");

test("deep chain stops at max length (8)", () => {
  // Build a chain: A→B→C→...→K (11 nodes)
  const ir: any[] = [];
  for (let i = 0; i < 11; i++) {
    const name = `step${i}`;
    ir.push({
      name,
      purpose: `step ${i}`,
      tags: ["chain"],
      produces: i < 10 ? [`DATA_${i}`] : [],
      requires: i > 0 ? [`DATA_${i - 1}`] : [],
      exported: true,
    });
  }
  const chains = selectCapabilityChains("complete the chain", ir);
  if (chains.length > 0) {
    // Chain should be truncated to <= 8 nodes
    assert.ok(chains[0].nodes.length <= 8, `Chain too long: ${chains[0].nodes.length} nodes`);
  }
});

test("circular dependency does not infinite loop", () => {
  const ir = [
    { name: "A", purpose: "first", tags: ["loop"], produces: ["A_OUT"], requires: ["B_OUT"], exported: true },
    { name: "B", purpose: "second", tags: ["loop"], produces: ["B_OUT"], requires: ["A_OUT"], exported: true },
  ];
  const chains = selectCapabilityChains("start the loop", ir);
  // Should not hang — just return whatever it can build
  assert.ok(chains.length >= 0, "Should not crash on circular deps");
});

test("self-referencing function", () => {
  const ir = [
    { name: "recursive", purpose: "self call", tags: ["recursion"], produces: ["REC_OUT"], requires: ["REC_OUT"], exported: true },
  ];
  const chains = selectCapabilityChains("recursive call", ir);
  assert.ok(chains.length >= 0, "Should not infinite loop on self-reference");
});

// ═══════════════════════════════════════════════════════════════
// 6. Parser Robustness
// ═══════════════════════════════════════════════════════════════
console.log("\n── 6. Parser Robustness ──");

// parseActionJSON is not exported, but we test through the planner
import { parseProtocolsFromJSON } from "./src/ssg-validator";

test("protocols.json with missing fields", () => {
  const proto = {
    rules: {
      "func1": { pre_states: ["A"], post_states: ["B"] },
      "func2": { pre_states: ["B"] }, // missing post_states
    }
  };
  const parsed = parseProtocolsFromJSON(proto);
  assert.ok(parsed.length >= 1, "Should parse at least one valid rule");
});

test("protocols.json with empty rules", () => {
  const parsed = parseProtocolsFromJSON({ rules: {} });
  assert.equal(parsed.length, 0);
});

test("protocols.json with invalid namespace", () => {
  const proto = {
    rules: {
      "func": { pre_states: [], post_states: [], namespace: 123 as any }
    }
  };
  const parsed = parseProtocolsFromJSON(proto);
  assert.ok(parsed.length >= 1, "Should handle invalid namespace gracefully");
});

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(50)}`);
console.log(`  Passed: ${passed}  Failed: ${failed}`);
console.log(`${"═".repeat(50)}`);

if (failed > 0) process.exit(1);
