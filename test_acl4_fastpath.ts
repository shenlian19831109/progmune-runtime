/**
 * Test 2: ACL-4 Fast Path
 *
 * Verifies the white paper's key promise:
 *   After enough repetitions, ACL-4 antibodies bypass LLM entirely.
 *
 * Test: queryAntibodies with ACL-4 threshold, then simulate the
 * planner's ACL-4 fast-path logic (which reads from the same data).
 */
import { queryAntibodies, getLearnedPatterns, getFailureGenome } from "./src/failure-corpus";

console.log("═══ Test 2: ACL-4 Fast Path ═══\n");

// ── Check current ACL-4 antibody state ──
console.log("Phase 1: Current antibody landscape...");

const learned = getLearnedPatterns();
const acl4 = learned.failureToFix.filter(p => p.antibodyLevel === "ACL-4");
const acl3 = learned.failureToFix.filter(p => p.antibodyLevel === "ACL-3");

console.log(`  ACL-4 antibodies: ${acl4.length}`);
for (const p of acl4) {
  console.log(`    ${p.signature} | ${p.occurrenceCount}x | ${p.distinctIntents.length} intents | fix: ${p.fixPath.join(" → ")}`);
}
console.log(`  ACL-3 antibodies: ${acl3.length}`);

// ── Simulate: would fast path trigger? ──
console.log("\nPhase 2: Fast-path simulation...");

// Test with an intent that matches an ACL-4 antibody
let fastPathTriggered = false;
let llmSkipped = false;

for (const pattern of acl4) {
  // Try each distinct intent that was used to train this antibody
  for (const intent of pattern.distinctIntents.slice(0, 3)) {
    const matches = queryAntibodies(intent, "ACL-4");
    if (matches.length > 0 && matches[0].antibodyLevel === "ACL-4") {
      console.log(`  Intent: "${intent}"`);
      console.log(`  → ACL-4 match: ${matches[0].signature}`);
      console.log(`  → Fix path: ${matches[0].fixPath.join(" → ")}`);
      console.log(`  → Fast path: 0 LLM calls needed`);

      // Simulate what planner.ts does at line 477:
      // if (aclLabel === "ACL-4" && top.fixPath.length > 0)
      //   → build action sequence from fixPath, skip LLM
      const fixPath = matches[0].fixPath;
      const actions = fixPath.map(fn => ({ kind: "call", function: fn, args: [] }));
      console.log(`  → Generated ${actions.length} actions from fix path (0 LLM)`);
      fastPathTriggered = true;
      llmSkipped = true;
    }
  }
}

// ── Test with existing intents ──
console.log("\nPhase 3: Testing with all available learned intents...");
const allIntents = new Set<string>();
for (const p of learned.failureToFix) {
  for (const i of p.distinctIntents) allIntents.add(i);
}

let totalMatches = 0;
let acl4Matches = 0;
for (const intent of [...allIntents].slice(0, 10)) {
  const abs = queryAntibodies(intent, "ACL-3");
  if (abs.length > 0) {
    totalMatches++;
    if (abs[0].antibodyLevel === "ACL-4") acl4Matches++;
  }
}

console.log(`  Tested ${Math.min(allIntents.size, 10)} intents`);
console.log(`  ACL-3+ matches: ${totalMatches}`);
console.log(`  ACL-4 matches (fast path): ${acl4Matches}`);

// ── Summary ──
console.log("\n═══ Test 2 Result ═══");
console.log(`  ACL-4 antibodies exist:   ${acl4.length > 0 ? "✅" : "❌ (need more occurrences + distinct intents)"}`);
console.log(`  Fast path would trigger:  ${fastPathTriggered ? "✅ 0 LLM calls" : "❌"}`);
console.log(`  LLM bypass rate:          ${allIntents.size > 0 ? Math.round(acl4Matches / Math.min(allIntents.size, 10) * 100) : 0}%`);

if (acl4.length === 0) {
  console.log("\n  ⚠️  No ACL-4 antibodies yet.");
  console.log("  ACL-4 requires: count >= 10 AND distinctIntents >= 5");
  console.log("  Current closest: " + (acl3[0] ? `${acl3[0].signature} (${acl3[0].occurrenceCount}x, ${acl3[0].distinctIntents.length} intents)` : "none"));
}
