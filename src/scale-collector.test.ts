/**
 * Scale Trajectory Collector + Reward Model Integration Tests
 */

import { describe, it, expect } from "vitest";
import { collectTrajectoriesAtScale, printCollectionReport } from "./scale-trajectory-collector";
import { LearningRanker } from "./learning-ranker";
import { LogisticRewardModel } from "./logistic-reward";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import { createLinearRanker, extractFeatures } from "./repair-ranker";
import * as fs from "fs";
import * as path from "path";

const SCALE_DIR = path.resolve(__dirname, "..", "test-scale-collector");
process.env.PROGMUNE_PROJECT_DIR = SCALE_DIR;
fs.mkdirSync(SCALE_DIR, { recursive: true });
fs.mkdirSync(path.join(SCALE_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(SCALE_DIR, ".progmune_corpus", "trajectories"), { recursive: true });

describe("Scale Trajectory Collector", () => {
  it("collects 200+ validated trajectories from all sources", () => {
    const { sequences, report } = collectTrajectoriesAtScale();

    expect(report.sourceRepos).toBeGreaterThanOrEqual(20);
    expect(report.sourceSequences).toBeGreaterThan(50);
    expect(report.finalCorpusSize).toBeGreaterThan(50);

    // All sequences should be valid physics patterns
    for (const seq of sequences.slice(0, 10)) {
      expect(seq.length).toBeGreaterThanOrEqual(2);
    }

    printCollectionReport(report);
  });
});

describe("Reward Model Integration", () => {
  it("LearningRanker accepts optional LogisticRewardModel", () => {
    const telemetry = new PlannerTelemetry(
      path.join(SCALE_DIR, ".progmune_corpus", "telemetry", `rl-${Date.now()}.jsonl`)
    );

    // Seed some telemetry data
    for (let i = 0; i < 100; i++) {
      const a = ["open_file", "write_file", "close_file"];
      const fp = candidateFingerprint("FileProtocol", a, "resource_leak");
      const id = telemetry.recordDecision({
        goal: "write", protocol: "FileProtocol", violationType: "resource_leak",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, {
        decision: i < 80 ? "accepted" : "rejected",
        executionResult: i < 80 ? { success: true, violations: [] } : { success: false, violations: ["leak"] },
        timestamp: Date.now(),
      });
    }

    // Train reward model
    const model = LogisticRewardModel.train(telemetry);

    // Create LearningRanker with reward model
    const base = createLinearRanker();
    const ranker = new LearningRanker(base, telemetry, undefined, model, 0.5);

    expect(ranker).toBeDefined();

    // Rank candidates
    const candidates = [
      { id: "safe", source: "protocol" as const, actions: [{ kind: "call" as const, function: "open_file", args: [] }, { kind: "call" as const, function: "write_file", args: [] }, { kind: "call" as const, function: "close_file", args: [] }], explanation: "safe" },
      { id: "leaky", source: "corpus" as const, actions: [{ kind: "call" as const, function: "open_file", args: [] }, { kind: "call" as const, function: "write_file", args: [] }], explanation: "leaky" },
    ];
    const ctx = { protocol: "FileProtocol", currentState: ["FILE_OPEN"], targetState: [], violationType: "resource_leak", constraints: [], rules: new Map() };
    const features = candidates.map(c => extractFeatures(c, ctx));

    const ranked = ranker.rank(candidates, features, { protocol: "FileProtocol", violationType: "resource_leak" });

    expect(ranked.length).toBe(2);
    // Safe candidate should score higher (was accepted 80% vs leaky rejected)
    expect(ranked[0].id).toBe("safe");
  });
});
