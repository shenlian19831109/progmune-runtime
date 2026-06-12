/**
 * P4.1-4.4: Reward System Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  buildRewardDataset, saveRewardDataset, loadRewardDataset, RewardExample,
  PairwiseRewardModel, PairwiseSample,
  computeNDCG, compareRankersOffPolicy, deploymentGate, printRankingMetrics,
  buildContextualFeatures, ContextualRewardModel,
  printRewardSystemReport,
} from "./reward-system";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";

const REW_DIR = path.resolve(__dirname, "..", "test-reward-system");
process.env.PROGMUNE_PROJECT_DIR = REW_DIR;
fs.mkdirSync(REW_DIR, { recursive: true });
fs.mkdirSync(path.join(REW_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

function seedTelemetry(n: number): PlannerTelemetry {
  const t = new PlannerTelemetry(path.join(REW_DIR, ".progmune_corpus", "telemetry", `reward-${Date.now()}.jsonl`));
  for (let i = 0; i < n; i++) {
    const safe = i % 3 !== 0;
    const actions = safe ? ["open_file", "write_file", "close_file"] : ["open_file", "write_file"];
    const fp = candidateFingerprint("FileProtocol", actions, "resource_leak");
    const id = t.recordDecision({
      goal: safe ? "safely write config" : "quick write",
      protocol: "FileProtocol", violationType: "resource_leak",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: safe ? "safe" : "quick" }],
      selectedCandidateId: fp,
    });
    const accepted = safe ? Math.random() < 0.9 : Math.random() < 0.2;
    t.recordFeedback(id, {
      decision: accepted ? "accepted" : "rejected",
      executionResult: accepted ? { success: true, violations: [] } : { success: false, violations: ["resource_leak"] },
      timestamp: Date.now(),
    });
  }
  return t;
}

describe("P4.4 Reward Dataset", () => {
  it("builds and persists reward dataset", () => {
    const telemetry = seedTelemetry(100);
    const examples = buildRewardDataset(telemetry);
    expect(examples.length).toBeGreaterThanOrEqual(50);
    for (const e of examples) {
      expect(e.features.length).toBe(7);
      expect(typeof e.accepted).toBe("boolean");
    }

    const fp = saveRewardDataset(examples, path.join(REW_DIR, "reward_dataset"));
    expect(fs.existsSync(fp)).toBe(true);

    const loaded = loadRewardDataset(path.join(REW_DIR, "reward_dataset"));
    expect(loaded.length).toBe(examples.length);
  });
});

describe("P4.1 PairwiseRewardModel", () => {
  it("trains on pairwise samples", () => {
    const samples: PairwiseSample[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push({
        winnerFeatures: [1.0, 0.8, 0.3, 0.4, 0.75, 0.85, 0.9],
        loserFeatures:  [0.3, 0.3, 0.6, 0.7, 0.3,  0.15, 0.1],
        goal: "safely write", protocol: "FileProtocol",
      });
    }

    const model = PairwiseRewardModel.train(samples);
    expect(model.isTrained).toBe(true);
    expect(model.sampleCount).toBe(100);

    // Safe should beat leaky
    const prob = model.predictPair(
      [1.0, 0.8, 0.3, 0.4, 0.75, 0.85, 0.9],
      [0.3, 0.3, 0.6, 0.7, 0.3,  0.15, 0.1]
    );
    expect(prob).toBeGreaterThan(0.5);
  });
});

describe("P4.2 Off-Policy Evaluator++", () => {
  it("computes NDCG correctly", () => {
    const perfect = [1, 1, 1, 0, 0];
    expect(computeNDCG(perfect)).toBe(1.0);

    const terrible = [0, 0, 0, 0, 1];
    expect(computeNDCG(terrible)).toBeLessThan(0.5);

    const mixed = [1, 0, 1, 0, 0];
    const ndcg = computeNDCG(mixed);
    expect(ndcg).toBeGreaterThan(0.5);
    expect(ndcg).toBeLessThan(1.0);
  });

  it("compares rankers with lift metrics", () => {
    const decisions = Array.from({ length: 20 }, () => {
      const safe = Math.random() < 0.7;
      return {
        candidates: [
          { features: safe ? [1.0,0.8,0.3,0.4,0.75,0.85,0.9] : [0.3,0.3,0.6,0.5,0.3,0.15,0.1], accepted: safe },
          { features: safe ? [0.3,0.3,0.6,0.5,0.3,0.15,0.1] : [1.0,0.8,0.3,0.4,0.75,0.85,0.9], accepted: !safe },
        ],
        userChoseIndex: 0,
      };
    });

    // Old ranker: score = sum(features) — puts all weight on first feature magnitude
    const oldRanker = (f: number[]) => f.reduce((a, b) => a + b, 0);
    // New ranker: score = 2*acceptance + 2*execution — better aligned with truth
    const newRanker = (f: number[]) => f[5] * 2 + f[6] * 2;

    const metrics = compareRankersOffPolicy(decisions as any, oldRanker, newRanker);

    expect(metrics.ndcg).toBeGreaterThan(0);
    expect(metrics.acceptanceLift).toBeGreaterThanOrEqual(-1);
    expect(metrics.acceptanceLift).toBeLessThanOrEqual(1);

    printRankingMetrics(metrics);

    const gate = deploymentGate(metrics);
    console.log(`  Deployment gate: ${gate.passed ? "PASS" : "FAIL"} — ${gate.reason}`);
  });

  it("deployment gate rejects negative lift", () => {
    const badMetrics = { ndcg: 0.45, top1Lift: 0.1, top3Lift: 0.05, acceptanceLift: -0.02 };
    expect(deploymentGate(badMetrics).passed).toBe(false);
  });

  it("deployment gate approves positive lift", () => {
    const goodMetrics = { ndcg: 0.55, top1Lift: 0.15, top3Lift: 0.1, acceptanceLift: 0.05 };
    expect(deploymentGate(goodMetrics).passed).toBe(true);
  });
});

describe("P4.3 ContextualRewardModel", () => {
  it("builds 22-d contextual features", () => {
    const base = [0.8, 0.5, 0.3, 0.4, 0.7, 0.85, 0.9];
    const ctx = buildContextualFeatures(base, "safely write config", "FileProtocol", "resource_leak");
    expect(ctx.length).toBe(22); // 7 + 8 + 4 + 3
    // "safely write" goal bit should be 1
    expect(ctx[7]).toBe(1.0); // first goal feature
    // "FileProtocol" protocol bit should be 1
    expect(ctx[7 + 8]).toBe(1.0);
    // "resource_leak" violation bit should be 1
    expect(ctx[7 + 8 + 4]).toBe(1.0);
  });

  it("trains on reward examples", () => {
    const telemetry = seedTelemetry(200);
    const examples = buildRewardDataset(telemetry);

    const model = ContextualRewardModel.train(examples);
    expect(model.isTrained).toBe(true);

    // Safe repair should score higher
    const safeScore = model.score(buildContextualFeatures(
      [0.8, 0.5, 0.3, 0.4, 0.7, 0.85, 0.9],
      "safely write config", "FileProtocol", "resource_leak"
    ));
    expect(safeScore).toBeGreaterThan(0.5);

    const imp = model.featureImportance();
    expect(imp.length).toBe(22);
    expect(imp[0].importance).toBeGreaterThan(0);
  });
});

describe("Reward System Report", () => {
  it("prints full system report", () => {
    const metrics = { ndcg: 0.62, top1Lift: 0.12, top3Lift: 0.08, acceptanceLift: 0.04 };
    printRewardSystemReport(250, 100, metrics);
  });
});
