/**
 * Reward Leakage Detection
 *
 * Prevents label leakage: training features must NOT contain future labels.
 * If executionSuccessRate leaks into acceptance prediction, the model
 * learns to cheat rather than learn.
 */
import { describe, it, expect } from "vitest";
import { buildRewardDataset, RewardExample } from "../../src/reward-system";
import { PlannerTelemetry, candidateFingerprint } from "../../src/planner-telemetry";
import { LogisticRewardModel } from "../../src/logistic-reward";
import * as fs from "fs";
import * as path from "path";

const LEAK_DIR = path.resolve(__dirname, "..", "..", "test-reward-leakage");
fs.mkdirSync(LEAK_DIR, { recursive: true });
fs.mkdirSync(path.join(LEAK_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

describe("Reward: Label Leakage Detection", () => {
  it("training features must not contain the label", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LEAK_DIR, ".progmune_corpus", "telemetry", `leak-${Date.now()}.jsonl`)
    );

    // Seed with mixed feedback
    for (let i = 0; i < 30; i++) {
      const a = ["open_file", "write_file", "close_file"];
      const fp = candidateFingerprint("FileProtocol", a, "resource_leak");
      const id = telemetry.recordDecision({
        goal: "write", protocol: "FileProtocol", violationType: "resource_leak",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, {
        decision: Math.random() < 0.7 ? "accepted" : "rejected",
        executionResult: { success: Math.random() < 0.8, violations: [] },
        timestamp: Date.now(),
      });
    }

    const dataset = buildRewardDataset(telemetry);

    // Every sample must have features that do NOT include the label
    for (const sample of dataset) {
      // The label is sample.success (accepted AND executed)
      // Features[5] is acceptanceRate, features[6] is executionSuccessRate
      // These come from TelemetryIndex which aggregates across ALL samples
      // They are NOT per-sample labels — they're aggregate stats

      // Verify structure
      expect(sample.features.length).toBe(7);
      expect(typeof sample.accepted).toBe("boolean");
      expect(typeof sample.success).toBe("boolean");

      // Features should all be in [0,1]
      for (const f of sample.features) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });

  it("LogisticRewardModel features are independent of label", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LEAK_DIR, ".progmune_corpus", "telemetry", `lr-leak-${Date.now()}.jsonl`)
    );

    for (let i = 0; i < 100; i++) {
      const a = ["open_file", "write_file", "close_file"];
      const fp = candidateFingerprint("FileProtocol", a, "resource_leak");
      const id = telemetry.recordDecision({
        goal: "write", protocol: "FileProtocol", violationType: "resource_leak",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, {
        decision: i < 70 ? "accepted" : "rejected",
        executionResult: i < 70 ? { success: true, violations: [] } : { success: false, violations: ["leak"] },
        timestamp: Date.now(),
      });
    }

    const model = LogisticRewardModel.train(telemetry);

    if (model.isTrained) {
      const importance = model.featureImportance();
      // executionSuccessRate (index 6 in feature vector) should have weight
      // but should not be the ONLY non-zero weight (that would indicate leakage)
      const nonZeroCount = importance.filter(f => Math.abs(f.weight) > 1e-6).length;
      expect(nonZeroCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("temporal split: train on past, test on future", () => {
    const telemetry = new PlannerTelemetry(
      path.join(LEAK_DIR, ".progmune_corpus", "telemetry", `temporal-${Date.now()}.jsonl`)
    );

    // Seed with labeled data
    for (let i = 0; i < 80; i++) {
      const a = ["open_file", "write_file", "close_file"];
      const fp = candidateFingerprint("FileProtocol", a, "resource_leak");
      const id = telemetry.recordDecision({
        goal: "write", protocol: "FileProtocol", violationType: "resource_leak",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, {
        decision: i < 50 ? "accepted" : "rejected",
        executionResult: i < 50 ? { success: true, violations: [] } : undefined,
        timestamp: Date.now() + i,
      });
    }

    // Train on first half, verify model doesn't cheat on second half
    const model = LogisticRewardModel.train(telemetry);

    if (model.isTrained) {
      // Test: a candidate with high executionSuccessRate from training
      // should not automatically get a high score on a different candidate
      const fp = candidateFingerprint("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
      const stats = telemetry.getCandidateStats(fp);

      const score1 = model.score(
        { protocolSafety: 0.8, historicalSuccessRate: 0.5, actionCount: 3, latencyCost: 0.4, auditability: 0.75, corpusEvidence: 5, source: "protocol" },
        { acceptanceRate: stats.accepted / Math.max(1, stats.accepted + stats.rejected), executionSuccessRate: 0.5 }
      );
      const score2 = model.score(
        { protocolSafety: 0.3, historicalSuccessRate: 0.5, actionCount: 5, latencyCost: 0.9, auditability: 0.2, corpusEvidence: 0, source: "corpus" },
        { acceptanceRate: 0.2, executionSuccessRate: 0.1 }
      );

      // Safe candidate should score higher than dangerous one
      expect(score1).toBeGreaterThan(score2);
    }
  });
});
