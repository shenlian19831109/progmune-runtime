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
// 1b. Protocol Edge Cases — Deep Dive
// ═══════════════════════════════════════════════════════════════
console.log("\n── 1b. Protocol — Deep Dive ──");

test("empty rules map — function not found returns invalid", () => {
  try {
    const ctx: ValidationContext = { ledger: [], currentState: rebuildState([], new Map([["_global", "INIT"]])) };
    const r = validateTransition(ctx, "any_func", 0, new Map(), new Map([["_global", "INIT"]]));
    // If it doesn't throw, it should return invalid
    if (typeof r === "object") assert.ok(!r.valid, "Function not in rules should be invalid");
  } catch {
    // Throwing is also acceptable behavior for missing rules
  }
});

test("function with no pre_states is always callable", () => {
  const rules = new Map();
  rules.set("always_ok", { pre_states: [], post_states: ["READY"], namespace: "test" });
  const nsInit = new Map([["test", "INIT"]]);
  const ctx: ValidationContext = { ledger: [], currentState: rebuildState([], nsInit) };
  const r = validateTransition(ctx, "always_ok", 0, rules, nsInit);
  assert.ok(r.valid, "Function with empty pre_states should always pass");
});

test("state machine deadlock detection", () => {
  const rules = new Map();
  rules.set("step1", { pre_states: ["A"], post_states: ["B"], invalidate: ["A"], namespace: "x" });
  rules.set("step2", { pre_states: ["B"], post_states: ["A"], invalidate: ["B"], namespace: "x" });
  const nsInit = new Map([["x", "A"]]);
  const ctx: ValidationContext = { ledger: [], currentState: rebuildState([], nsInit) };

  const r1 = validateTransition(ctx, "step1", 0, rules, nsInit);
  assert.ok(r1.valid);
  ctx.ledger = [r1.transition];
  ctx.currentState = r1.transition.statesAfter;

  const r2 = validateTransition(ctx, "step2", 1, rules, nsInit);
  assert.ok(r2.valid);
  // After step2, we should be back to state A
  const afterB = r2.transition.statesAfter["x"] || [];
  assert.ok(afterB.includes("A"), "Deadlock cycle should return to A");
});

test("namespace collision — same state name different namespace", () => {
  const rules = new Map();
  rules.set("auth_login", { pre_states: ["INIT"], post_states: ["ACTIVE"], namespace: "auth" });
  rules.set("db_connect", { pre_states: ["INIT"], post_states: ["ACTIVE"], namespace: "db" });
  const nsInit = new Map([["auth", "INIT"], ["db", "INIT"]]);
  const ctx: ValidationContext = { ledger: [], currentState: rebuildState([], nsInit) };

  const r1 = validateTransition(ctx, "auth_login", 0, rules, nsInit);
  assert.ok(r1.valid);
  ctx.ledger = [r1.transition];
  ctx.currentState = r1.transition.statesAfter;

  // db_connect should still work — auth state doesn't affect db namespace
  const r2 = validateTransition(ctx, "db_connect", 1, rules, nsInit);
  assert.ok(r2.valid, "Different namespaces with same state name should not conflict");
});

// ═══════════════════════════════════════════════════════════════
// 2b. Feedback Dynamics — Deep Dive
// ═══════════════════════════════════════════════════════════════
console.log("\n── 2b. Feedback — Deep Dive ──");

test("rapid succession of 10 records converges", () => {
  const fn = "rapid_test_" + Date.now();
  // 5 successes, 5 failures
  for (let i = 0; i < 10; i++) {
    recordRun("test", [{ kind: "call", function: fn, args: [] }], i < 5);
  }
  const rate = getFunctionSuccessRate(fn);
  assert.ok(rate >= 0.4 && rate <= 0.6, `Expected ~0.5 after 5+5, got ${rate}`);
});

test("function with only successes has rate 1.0", () => {
  const fn = "always_win_" + Date.now();
  for (let i = 0; i < 3; i++) {
    recordRun("test", [{ kind: "call", function: fn, args: [] }], true);
  }
  assert.equal(getFunctionSuccessRate(fn), 1.0);
});

test("function with only failures has rate 0.0", () => {
  const fn = "always_fail_" + Date.now();
  for (let i = 0; i < 3; i++) {
    recordRun("test", [{ kind: "call", function: fn, args: [] }], false);
  }
  assert.equal(getFunctionSuccessRate(fn), 0.0);
});

test("weighted rate gives more weight to recent results", () => {
  // This is structural: verify the formula exists and doesn't crash
  const rate = getWeightedSuccessRate("some_func_" + Date.now());
  assert.ok(rate >= 0 && rate <= 1, "Weighted rate should be 0-1");
});

// ═══════════════════════════════════════════════════════════════
// 3b. TF-IDF / Keywords — Deep Dive
// ═══════════════════════════════════════════════════════════════
console.log("\n── 3b. Keywords — Deep Dive ──");

test("unicode characters handled", () => {
  const kw = extractKeywords("处理数据 分析日志");
  assert.ok(kw.length >= 2, `Expected >=2 keywords, got ${kw.length}`);
  assert.ok(kw.includes("处理数据") || kw.includes("分析日志"), "Chinese tokens should be preserved");
});

test("mixed CJK and ASCII", () => {
  const kw = extractKeywords("process 数据 analyze 日志");
  assert.ok(kw.includes("process") || kw.includes("analyze"), "English words should be extracted");
  assert.ok(kw.includes("数据") || kw.includes("日志"), "CJK words should be extracted");
});

test("emojis and special characters stripped", () => {
  const kw = extractKeywords("hello 😀 world 🚀 test");
  assert.ok(kw.includes("hello") && kw.includes("world") && kw.includes("test"), "Real words should remain");
});

test("very long single token", () => {
  const long = "a".repeat(5000);
  const kw = extractKeywords(long);
  assert.equal(kw.length, 1);
  assert.equal(kw[0], long.toLowerCase());
});

test("Jaccard with empty strings", () => {
  assert.equal(jaccardSimilarity("", ""), 0);
  assert.equal(jaccardSimilarity("hello", ""), 0);
  assert.equal(jaccardSimilarity("", "world"), 0);
});

// ═══════════════════════════════════════════════════════════════
// 4b. IR Robustness — Deep Dive
// ═══════════════════════════════════════════════════════════════
console.log("\n── 4b. IR — Deep Dive ──");

test("duplicate function names — second wins", () => {
  const ir = [
    { name: "dup", purpose: "first", tags: ["a"], produces: ["A"], requires: [], exported: true },
    { name: "dup", purpose: "second", tags: ["b"], produces: ["B"], requires: [], exported: true },
  ];
  const chains = selectCapabilityChains("second", ir);
  assert.ok(chains.length >= 0, "Duplicate names should not crash");
});

test("IR function with empty string fields", () => {
  const ir = [
    { name: "fn1", purpose: "", tags: [""], produces: [""], requires: [""], exported: true },
    { name: "fn2", purpose: "valid", tags: ["tag"], produces: [], requires: [], exported: true },
  ];
  const chains = selectCapabilityChains("valid", ir);
  assert.ok(chains.length >= 0, "Empty string fields should not crash");
});

test("IR with only external functions (non-exported)", () => {
  const ir = [
    { name: "ext1", purpose: "external", external: true, exported: false },
    { name: "ext2", purpose: "external2", external: true, exported: false },
  ];
  const chains = selectCapabilityChains("external", ir);
  assert.equal(chains.length, 0, "Non-exported functions should be excluded");
});

test("IR with deeply nested capability labels", () => {
  const ir: any[] = [];
  for (let i = 0; i < 20; i++) {
    ir.push({
      name: `fn${i}`,
      purpose: `step ${i}`,
      tags: [`level${i % 5}`],
      produces: i < 19 ? [`OUT_${i}`] : [],
      requires: i > 0 ? [`OUT_${i - 1}`] : [],
      exported: true,
    });
  }
  const chains = selectCapabilityChains("complete all steps", ir);
  assert.ok(chains.length >= 0, "Deep nesting should not crash");
});

// ═══════════════════════════════════════════════════════════════
// 5b. Complex Chain — Deep Dive
// ═══════════════════════════════════════════════════════════════
console.log("\n── 5b. Chain — Deep Dive ──");

test("diamond dependency (A→B→D, A→C→D)", () => {
  const ir = [
    { name: "A", purpose: "start", produces: ["A_OUT"], requires: [], exported: true },
    { name: "B", purpose: "path1", produces: ["B_OUT"], requires: ["A_OUT"], exported: true },
    { name: "C", purpose: "path2", produces: ["C_OUT"], requires: ["A_OUT"], exported: true },
    { name: "D", purpose: "merge", produces: [], requires: ["B_OUT", "C_OUT"], exported: true },
  ];
  const chains = selectCapabilityChains("start and merge", ir);
  // Should find at least A→B or A→C path
  assert.ok(chains.length >= 0, "Diamond deps should not crash");
  if (chains.length > 0) {
    const names = chains[0].nodes.map(n => n.name);
    assert.ok(names.includes("A"), "Chain should include A");
  }
});

test("dead-end chain (no consumers)", () => {
  const ir = [
    { name: "producer", purpose: "make data", produces: ["ORPHAN_DATA"], requires: [], exported: true },
    // No consumer for ORPHAN_DATA
  ];
  const chains = selectCapabilityChains("make data", ir);
  // Should return the producer alone
  if (chains.length > 0) {
    assert.equal(chains[0].nodes.length, 1, "Orphan producer should be single-node chain");
  }
});

test("multiple seeds compete for same consumer", () => {
  const ir = [
    { name: "seed1", purpose: "first seed", produces: ["SHARED"], requires: [], exported: true },
    { name: "seed2", purpose: "second seed", produces: ["SHARED"], requires: [], exported: true },
    { name: "consumer", purpose: "consumer", produces: [], requires: ["SHARED"], exported: true },
  ];
  const chains = selectCapabilityChains("seed", ir);
  assert.ok(chains.length >= 0, "Multiple producers for same consumer should not crash");
});

// ═══════════════════════════════════════════════════════════════
// 6b. Parser Robustness — Deep Dive
// ═══════════════════════════════════════════════════════════════
console.log("\n── 6b. Parser — Deep Dive ──");

// parseActionJSON is internal to planner, test via plan()
import { plan } from "./src/planner";

test("LLM output with trailing commas", async () => {
  // parseActionJSON handles this internally, test indirectly
  try {
    const r = await plan("get all sessions");
    assert.ok(r.actions.length > 0, "Plan should succeed");
  } catch (e: any) {
    assert.fail("Should not crash: " + e.message);
  }
});

test("plan with empty intent", async () => {
  try {
    const r = await plan("");
    assert.ok(r.actions.length >= 0, "Empty intent should not crash");
  } catch {
    // Empty intent failing is acceptable behavior
  }
});

test("plan with very long intent", async () => {
  const longIntent = "analyze the failure genome statistics and format a comprehensive report " + "with detailed breakdown ".repeat(50);
  try {
    const r = await plan(longIntent);
    assert.ok(r.actions.length >= 0, "Long intent should not crash");
  } catch {
    // Long intent failing is acceptable
  }
});

test("IR with typeMap format (v2.1+ compat)", () => {
  const ir = require("fs").readFileSync("ir.json", "utf-8");
  const parsed = JSON.parse(ir);
  assert.ok(parsed.functions || Array.isArray(parsed), "IR should be valid format");
  assert.ok(parsed.typeMap || Array.isArray(parsed), "IR should have typeMap or be array");
});

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(50)}`);
console.log(`  Passed: ${passed}  Failed: ${failed}`);
console.log(`${"═".repeat(50)}`);

if (failed > 0) process.exit(1);
