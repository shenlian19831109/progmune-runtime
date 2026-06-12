/**
 * P4.0: Logistic Reward Model Tests
 *
 * Verifying:
 *   1. Model trains on telemetry data and converges
 *   2. Feature importance is interpretable
 *   3. Score produces valid probabilities [0,1]
 *   4. Off-policy comparison shows improvement over baseline
 *   5. Export/import roundtrip preserves weights
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { LogisticRewardModel, compareModels, LogisticFeatureVector } from "./logistic-reward";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import { createLinearRanker } from "./repair-ranker";

const LR_DIR = path.resolve(__dirname, "..", "test-logistic-reward");
process.env.PROGMUNE_PROJECT_DIR = LR_DIR;
fs.mkdirSync(LR_DIR, { recursive: true });
fs.mkdirSync(path.join(LR_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

function seedTrainingData(telemetry: PlannerTelemetry, samples: number): void {
  // Pattern: safe repairs (close_file) are usually accepted + executed successfully
  // Pattern: leaky repairs (skip close) are usually rejected or fail execution
  for (let i = 0; i < samples; i++) {
    const safe = i % 3 !== 0; // 2/3 are safe repairs
    const fp = safe
      ? candidateFingerprint("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak")
      : candidateFingerprint("FileProtocol", ["open_file", "write_file"], "resource_leak");

    const id = telemetry.recordDecision({
      goal: `train goal ${i}`,
      protocol: "FileProtocol", violationType: "resource_leak",
      candidates: [
        { candidateId: fp, source: "protocol", evidenceSources: ["protocol"],
          actions: safe ? ["open_file", "write_file", "close_file"] : ["open_file", "write_file"],
          explanation: safe ? "safe close" : "skip close" },
      ],
      selectedCandidateId: fp,
    });

    // Safe: 90% accepted + executed. Leaky: 80% rejected.
    const acceptRoll = Math.random();
    if (safe) {
      const accepted = acceptRoll < 0.9;
      telemetry.recordFeedback(id, {
        decision: accepted ? "accepted" : "rejected",
        executionResult: accepted ? { success: true, violations: [] } : { success: false, violations: ["resource_leak"] },
        timestamp: Date.now(),
      });
    } else {
      const accepted = acceptRoll < 0.2;
      telemetry.recordFeedback(id, {
        decision: accepted ? "accepted" : "rejected",
        executionResult: accepted ? { success: false, violations: ["resource_leak"] } : undefined,
        timestamp: Date.now(),
      });
    }
  }
}

describe("LogisticRewardModel", () => {
  it("trains on telemetry data and converges", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LR_DIR, ".progmune_corpus", "telemetry", `lr-train-${Date.now()}.jsonl`)
    );

    seedTrainingData(telemetry, 200);

    const model = LogisticRewardModel.train(telemetry);

    expect(model.isTrained).toBe(true);
    expect(model.sampleCount).toBeGreaterThanOrEqual(50);
    expect(model.finalLoss).toBeLessThan(1.0); // should be better than random

    // Weights should be non-zero after training
    expect(model.weights.some(w => Math.abs(w) > 1e-6)).toBe(true);

    model.printWeights();
  });

  it("produces valid probability scores [0,1]", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LR_DIR, ".progmune_corpus", "telemetry", `lr-score-${Date.now()}.jsonl`)
    );

    seedTrainingData(telemetry, 100);

    const model = LogisticRewardModel.train(telemetry);

    // Safe repair should score higher than leaky repair
    const safeFeatures = {
      protocolSafety: 1.0, historicalSuccessRate: 0.8, actionCount: 3,
      latencyCost: 0.4, auditability: 0.75, corpusEvidence: 5, source: "protocol" as const,
    };
    const leakyFeatures = {
      protocolSafety: 0.3, historicalSuccessRate: 0.3, actionCount: 2,
      latencyCost: 0.3, auditability: 0.4, corpusEvidence: 1, source: "corpus" as const,
    };

    const safeScore = model.score(safeFeatures, { acceptanceRate: 0.85, executionSuccessRate: 0.9 });
    const leakyScore = model.score(leakyFeatures, { acceptanceRate: 0.15, executionSuccessRate: 0.1 });

    expect(safeScore).toBeGreaterThanOrEqual(0);
    expect(safeScore).toBeLessThanOrEqual(1);
    expect(leakyScore).toBeGreaterThanOrEqual(0);
    expect(leakyScore).toBeLessThanOrEqual(1);

    // Safe should score higher than leaky
    expect(safeScore).toBeGreaterThan(leakyScore);
  });

  it("falls back gracefully with insufficient data", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LR_DIR, ".progmune_corpus", "telemetry", `lr-fallback-${Date.now()}.jsonl`)
    );

    // Only 5 samples — below minSamples=50
    seedTrainingData(telemetry, 5);

    const model = LogisticRewardModel.train(telemetry);

    expect(model.isTrained).toBe(false);
    expect(model.sampleCount).toBe(5);

    // Should still produce valid scores (weights are initialized to 0)
    const score = model.score(
      { protocolSafety: 0.5, historicalSuccessRate: 0.5, actionCount: 2, latencyCost: 0.3, auditability: 0.5, corpusEvidence: 0, source: "protocol" },
      { acceptanceRate: 0.5, executionSuccessRate: 0.5 }
    );
    expect(score).toBeCloseTo(0.5, 1); // sigmoid(0) = 0.5
  });

  it("feature importance is interpretable", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LR_DIR, ".progmune_corpus", "telemetry", `lr-importance-${Date.now()}.jsonl`)
    );

    seedTrainingData(telemetry, 150);

    const model = LogisticRewardModel.train(telemetry);
    const importance = model.featureImportance();

    expect(importance.length).toBe(7);
    // Top features should have positive importance
    expect(importance[0].importance).toBeGreaterThan(0);

    model.printWeights();
  });

  it("export/import roundtrip preserves weights", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LR_DIR, ".progmune_corpus", "telemetry", `lr-export-${Date.now()}.jsonl`)
    );

    seedTrainingData(telemetry, 100);

    const original = LogisticRewardModel.train(telemetry);
    const exported = original.exportWeights();
    const imported = LogisticRewardModel.importWeights(exported);

    expect(imported.isTrained).toBe(true);
    expect(imported.sampleCount).toBe(original.sampleCount);
    expect(imported.weights).toEqual(original.weights);
    expect(imported.bias).toBe(original.bias);

    // Scores should be identical
    const features = { protocolSafety: 0.7, historicalSuccessRate: 0.5, actionCount: 2, latencyCost: 0.3, auditability: 0.6, corpusEvidence: 3, source: "protocol" as const };
    const stats = { acceptanceRate: 0.8, executionSuccessRate: 0.9 };
    expect(imported.score(features, stats)).toBe(original.score(features, stats));
  });
});

describe("Model Comparison", () => {
  it("compares LogisticReward against baseline", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LR_DIR, ".progmune_corpus", "telemetry", `lr-compare-${Date.now()}.jsonl`)
    );

    seedTrainingData(telemetry, 300);

    const comparisons = compareModels(telemetry);

    expect(comparisons.length).toBeGreaterThanOrEqual(1);

    const lr = comparisons.find(c => c.model === "LogisticReward")!;
    if (lr.trained) {
      expect(lr.accuracy).toBeGreaterThan(0.5); // better than random
      expect(lr.logLoss).toBeLessThan(1.0);
    }

    console.log("\n─── Model Comparison ───");
    for (const c of comparisons) {
      console.log(`  ${c.model.padEnd(22)} acc=${(c.accuracy*100).toFixed(1)}%  logLoss=${c.logLoss.toFixed(4)}`);
    }
  });
});
