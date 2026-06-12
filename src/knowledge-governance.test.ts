/**
 * P3.21-23: Knowledge Governance Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  validateInferences, KnowledgePatchStore,
  regressionTestPatch, autoApprovePatch,
  runKnowledgeGovernance, printGovernanceReport,
} from "./knowledge-governance";
import { synthesizeTransitions } from "./transition-synthesizer";
import type { StateAnnotation } from "./ssg-validator";

const GOV_DIR = path.resolve(__dirname, "..", "test-knowledge-gov");
process.env.PROGMUNE_PROJECT_DIR = GOV_DIR;
fs.mkdirSync(GOV_DIR, { recursive: true });
fs.mkdirSync(path.join(GOV_DIR, ".progmune_corpus", "knowledge"), { recursive: true });

function makeBaseRules(): Map<string, StateAnnotation> {
  return new Map([
    ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
    ["write_file", { pre_states: ["FILE_OPEN"], post_states: ["FILE_DIRTY"] }],
    ["close_file", { pre_states: ["FILE_OPEN", "FILE_DIRTY"], post_states: [], invalidate: ["FILE_OPEN", "FILE_DIRTY"] }],
  ]);
}

describe("Inference Validator", () => {
  it("classifies inferences as proposed/verified/rejected", () => {
    const inferences = [
      { from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file", protocol: "FileProtocol", confidence: 1.0, evidenceCount: 1, examples: ["test"] },
      { from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file", protocol: "FileProtocol", confidence: 1.0, evidenceCount: 3, examples: ["a","b","c"] },
    ];

    const validated = validateInferences(inferences, 5); // 5 trajectory support

    // First: only 1 benchmark → proposed
    expect(validated[0].validation.status).toBe("proposed");
    expect(validated[0].validation.benchmarkSupport).toBe(1);
    expect(validated[0].validation.trajectorySupport).toBe(5);

    // Second: 3 benchmarks + 5 trajectories → verified
    expect(validated[1].validation.status).toBe("verified");
  });
});

describe("Knowledge Patch Store", () => {
  it("proposes, approves, rejects, and rolls back patches", () => {
    const store = new KnowledgePatchStore(
      path.join(GOV_DIR, ".progmune_corpus", "knowledge", `test-${Date.now()}.json`)
    );

    const inference = {
      from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file",
      protocol: "FileProtocol", confidence: 1.0, evidenceCount: 3, examples: ["a", "b", "c"],
      validation: { benchmarkSupport: 3, trajectorySupport: 5, contradictionCount: 0, status: "verified" as const },
    };

    // Propose
    const patch = store.propose(inference);
    expect(patch.status).toBe("proposed");
    expect(patch.id).toMatch(/^KP-/);
    expect(store.proposed.length).toBe(1);

    // Approve
    const ok = store.approve(patch.id, { top1Before: 0.5, top1After: 0.55, top3Before: 0.7, top3After: 0.75 });
    expect(ok).toBe(true);
    expect(store.approved.length).toBe(1);
    expect(store.approved[0].approvalMetrics?.top1After).toBe(0.55);

    // Rollback
    const rb = store.rollback(patch.id);
    expect(rb).toBe(true);
    expect(store.approved.length).toBe(0);

    // Reject a new one
    const p2 = store.propose(inference);
    store.reject(p2.id);
    expect(store.all.filter(p => p.status === "rejected").length).toBe(1);
  });

  it("builds augmented rules from approved patches", () => {
    const store = new KnowledgePatchStore(
      path.join(GOV_DIR, ".progmune_corpus", "knowledge", `aug-${Date.now()}.json`)
    );

    const inference = {
      from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file",
      protocol: "FileProtocol", confidence: 1.0, evidenceCount: 3, examples: ["a"],
      validation: { benchmarkSupport: 3, trajectorySupport: 5, contradictionCount: 0, status: "verified" as const },
    };

    const patch = store.propose(inference);
    store.approve(patch.id, { top1Before: 0.5, top1After: 0.6, top3Before: 0.7, top3After: 0.8 });

    const baseRules = makeBaseRules();
    const augmented = store.buildAugmentedRules(baseRules);

    // Should have base rules + 1 patch bridge
    expect(augmented.size).toBe(baseRules.size + 1);
    const hasBridge = [...augmented.keys()].some(k => k.startsWith("_patch_"));
    expect(hasBridge).toBe(true);
  });
});

describe("Regression Test", () => {
  it("auto-approves if Top-1/Top-3 improves", () => {
    const store = new KnowledgePatchStore(
      path.join(GOV_DIR, ".progmune_corpus", "knowledge", `reg-${Date.now()}.json`)
    );

    const patch = store.propose({
      from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file",
      protocol: "FileProtocol", confidence: 1.0, evidenceCount: 3, examples: ["a", "b", "c"],
      validation: { benchmarkSupport: 3, trajectorySupport: 5, contradictionCount: 0, status: "verified" as const },
    });

    const baseRules = makeBaseRules();
    // Test case: from FILE_OPEN to FILE_DIRTY — this path doesn't exist in base rules (open→write exists, but open→flush is missing)
    const testCases = [
      { currentState: ["FILE_OPEN"], targetState: ["FILE_DIRTY"] },
    ];

    const result = autoApprovePatch(patch, baseRules, testCases, store);

    // With augmented rules, the patch adds open_file→flush_file bridge
    // This should improve Top-1 (found paths increase)
    expect(result.passed).toBe(true);
    expect(result.top1After).toBeGreaterThanOrEqual(result.top1Before);
  });
});

describe("Full Governance Pipeline", () => {
  it("runs synthesize → validate → propose → regression → approve", () => {
    // revoke_token produces UNAUTHENTICATED, create_session needs TOKEN_ISSUED
    // These are NOT connected (UNAUTHENTICATED ≠ TOKEN_ISSUED) → genuine gap
    // Both functions exist in AuthProtocol (protocols.json)
    const failures = [
      { goal: "revoke then create session", protocol: "AuthProtocol", expectedRepair: ["revoke_token", "create_session"] },
      { goal: "revoke then create session v2", protocol: "AuthProtocol", expectedRepair: ["revoke_token", "create_session"] },
    ];

    const testCases = [
      { currentState: ["FILE_OPEN"], targetState: ["FILE_DIRTY"] },
    ];

    const store = new KnowledgePatchStore(
      path.join(GOV_DIR, ".progmune_corpus", "knowledge", `full-${Date.now()}.json`)
    );

    const report = runKnowledgeGovernance(failures, testCases, store);

    expect(report.proposed).toBeGreaterThanOrEqual(1);

    printGovernanceReport(report);
  });
});
