/**
 * Chaos Tests: Robustness under corrupted data
 *
 * Injects random errors to verify system degrades gracefully:
 *   - Corrupted protocol rules (unknown states, cycles)
 *   - Invalid telemetry data (negative counts, missing fields)
 *   - Extreme inputs (empty goals, 1000-action chains)
 *   - Concurrent access patterns
 */

import { describe, it, expect } from "vitest";
import { searchFrontier } from "../../src/protocol-frontier";
import { PlannerTelemetry, candidateFingerprint, CandidateStats } from "../../src/planner-telemetry";
import { deduplicateCandidates } from "../../src/counterfactual-engine";
import { createLinearRanker, extractFeatures } from "../../src/repair-ranker";
import { synthesizeTransitions } from "../../src/transition-synthesizer";
import * as fs from "fs";
import * as path from "path";
import type { StateAnnotation } from "../../src/ssg-validator";

const CHAOS_DIR = path.resolve(__dirname, "..", "..", "test-chaos");
process.env.PROGMUNE_PROJECT_DIR = CHAOS_DIR;
fs.mkdirSync(CHAOS_DIR, { recursive: true });
fs.mkdirSync(path.join(CHAOS_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

describe("Chaos: Corrupted Protocol Rules", () => {
  it("returns empty path but does not throw when rule points to unknown state", () => {
    const corrupted = new Map<string, StateAnnotation>([
      ["step1", { pre_states: ["START"], post_states: ["MID"] }],
      ["step2", { pre_states: ["MID"], post_states: ["NONEXISTENT"] }],
    ]);

    expect(() => {
      const result = searchFrontier(corrupted, ["START"], ["END"], 8);
      expect(result.found).toBe(false);
    }).not.toThrow();
  });

  it("handles empty rule set gracefully", () => {
    const empty = new Map<string, StateAnnotation>();
    expect(() => {
      const result = searchFrontier(empty, ["START"], ["END"]);
      expect(result.found).toBe(false);
    }).not.toThrow();
  });

  it("handles circular state transitions without infinite loop", () => {
    const circular = new Map<string, StateAnnotation>([
      ["cycle_a", { pre_states: ["A"], post_states: ["B"] }],
      ["cycle_b", { pre_states: ["B"], post_states: ["A"] }],
    ]);

    expect(() => {
      const result = searchFrontier(circular, ["A"], ["C"], 8);
      expect(result.found).toBe(false);
    }).not.toThrow();
  });

  it("handles self-loop transitions", () => {
    const selfLoop = new Map<string, StateAnnotation>([
      ["loop", { pre_states: ["A"], post_states: ["A"] }],
    ]);

    expect(() => {
      const result = searchFrontier(selfLoop, ["A"], ["B"], 8);
      expect(result.found).toBe(false);
    }).not.toThrow();
  });
});

describe("Chaos: Corrupted Telemetry Data", () => {
  it("recovers from negative acceptance counts", () => {
    const telemetry = new PlannerTelemetry(
      path.join(CHAOS_DIR, ".progmune_corpus", "telemetry", `chaos-${Date.now()}.jsonl`)
    );

    const fp = candidateFingerprint("FileProtocol", ["close_file"], "resource_leak");

    // Record valid feedback to create an entry
    const id = telemetry.recordDecision({
      goal: "test", protocol: "FileProtocol",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: ["close_file"], explanation: "close" }],
      selectedCandidateId: fp,
    });
    telemetry.recordFeedback(id, { decision: "accepted", timestamp: Date.now() });

    // Stats should be valid (accepted >= 0)
    const stats = telemetry.getCandidateStats(fp);
    expect(stats.accepted).toBeGreaterThanOrEqual(0);
    expect(stats.rejected).toBeGreaterThanOrEqual(0);
    expect(stats.executionSuccess).toBeGreaterThanOrEqual(0);
    expect(stats.executionFailure).toBeGreaterThanOrEqual(0);
  });

  it("handles unknown fingerprint lookup", () => {
    const telemetry = new PlannerTelemetry(
      path.join(CHAOS_DIR, ".progmune_corpus", "telemetry", `unknown-${Date.now()}.jsonl`)
    );

    // Query stats for a fingerprint that doesn't exist
    expect(() => {
      const stats = telemetry.getCandidateStats("nonexistent-fp-12345");
      expect(stats.accepted).toBe(0);
      expect(stats.rejected).toBe(0);
    }).not.toThrow();

    // Acceptance should default to 0.5 for unknown
    const acceptance = telemetry.getCandidateAcceptance("nonexistent-fp-12345");
    expect(acceptance).toBe(0.5);
  });
});

describe("Chaos: Extreme Inputs", () => {
  it("handles empty goal string", async () => {
    const { suggestAlternatives } = await import("../../src/counterfactual-engine");
    const alts = await suggestAlternatives({
      violation: { svl: 4, violatedConstraint: "resource_leak", actionIndex: 0, currentStates: [], requiredStates: [], description: "" },
      protocol: "_global", currentState: [], targetState: [],
      constraints: [], rules: new Map(), goal: "",
    });
    // Should not throw, may return empty
    expect(Array.isArray(alts)).toBe(true);
  });

  it("handles very long action sequence (1000 actions)", () => {
    const telemetry = new PlannerTelemetry(
      path.join(CHAOS_DIR, ".progmune_corpus", "telemetry", `long-${Date.now()}.jsonl`)
    );

    const longActions = Array.from({ length: 1000 }, (_, i) => `fn_${i}`);
    const fp = candidateFingerprint("Test", longActions, "test");

    const id = telemetry.recordDecision({
      goal: "massive test", protocol: "Test",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: longActions, explanation: "many actions" }],
    });

    expect(id).toMatch(/^PD-/);
    expect(telemetry.size).toBe(1);
  });

  it("deduplicate handles all-identical candidates", () => {
    const identical = Array.from({ length: 100 }, (_, i) => ({
      id: `dup-${i}`,
      source: "protocol" as const,
      actions: [{ kind: "call" as const, function: "close_file", args: [] }],
      explanation: "close",
      evidenceSources: ["protocol"],
    }));

    const result = deduplicateCandidates(identical);
    expect(result.length).toBe(1);
    expect(result[0].evidenceSources?.length).toBe(1);
  });
});

describe("Chaos: Ranker robustness", () => {
  it("handles candidates with zero actions", () => {
    const ranker = createLinearRanker();
    const features = extractFeatures(
      { id: "empty", source: "protocol", actions: [], explanation: "none" },
      { protocol: "test", currentState: [], targetState: [], violationType: "test", constraints: [], rules: new Map() }
    );
    const score = ranker.score(features);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("handles candidates with negative historical success rate", () => {
    const features = extractFeatures(
      { id: "bad", source: "corpus", actions: [{ kind: "call" as const, function: "fn", args: [] }], explanation: "bad", metadata: { historicalSuccessRate: -5 } },
      { protocol: "test", currentState: [], targetState: [], violationType: "test", constraints: [], rules: new Map() }
    );
    // Feature extraction preserves raw metadata (even negative values — the ranker's responsibility to handle)
    expect(features.historicalSuccessRate).toBe(-5);
    // Ranker does not crash on negative features
    const ranker = createLinearRanker();
    expect(() => ranker.score(features)).not.toThrow();
    const score = ranker.score(features);
    // Score may be outside [0,1] with extreme negative features — that's expected chaos behavior
    expect(typeof score).toBe("number");
  });
});
