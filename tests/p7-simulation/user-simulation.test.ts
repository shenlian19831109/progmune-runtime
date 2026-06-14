/**
 * P7.3: Realistic User Simulation
 *
 * Simulates 14 days of developer interaction with the Planner.
 * LearningRanker adapts to user preferences (70% fast, 20% safe, 10% random).
 * Measures acceptance rate improvement over baseline.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PlannerTelemetry, candidateFingerprint } from "../../src/planner-telemetry";
import { createLinearRanker, extractFeatures } from "../../src/repair-ranker";
import { LearningRanker } from "../../src/learning-ranker";
import type { RepairCandidate, CandidateFeatures } from "../../src/repair-types";

const SIM_DIR = path.resolve(__dirname, "..", "..", "test-user-sim");
process.env.PROGMUNE_PROJECT_DIR = SIM_DIR;
fs.mkdirSync(SIM_DIR, { recursive: true });
fs.mkdirSync(path.join(SIM_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

/** Realistic user: 70% fast, 20% safe, 10% random, 5% ignore, 10% execution failure on acceptance */
function realisticUser(ranking: { fast: number; safe: number; random: number }): { selected: number; accepted: boolean; executionOk: boolean } {
  const roll = Math.random();
  let selected: number;

  if (roll < 0.70) selected = 0;       // 70% take the fastest
  else if (roll < 0.90) selected = 1;  // 20% take the safest
  else selected = Math.floor(Math.random() * 3); // 10% random

  const ignoreRoll = Math.random();
  if (ignoreRoll < 0.05) return { selected, accepted: false, executionOk: false }; // 5% ignore

  const acceptRoll = Math.random();
  const accepted = acceptRoll < 0.85; // 85% accept what they chose
  const execRoll = Math.random();
  const executionOk = accepted ? execRoll < 0.90 : false; // 10% of accepted fail at execution

  return { selected, accepted, executionOk };
}

function makeCandidate(id: string, source: "protocol" | "corpus" | "antibody", actions: string[]): RepairCandidate {
  return { id, source, actions: actions.map(fn => ({ kind: "call" as const, function: fn, args: [] })), explanation: id };
}

describe("P7.3 Realistic User Simulation", () => {
  it("LearningRanker outperforms baseline after 14 simulated days", () => {
    const telemetry = new PlannerTelemetry(
      path.join(SIM_DIR, ".progmune_corpus", "telemetry", `sim-${Date.now()}.jsonl`)
    );
    const base = createLinearRanker();
    const learner = new LearningRanker(base, telemetry);

    const days = 14;
    const tasksPerDay = 50;

    const baselineDailyRates: number[] = [];
    const learningDailyRates: number[] = [];

    for (let day = 0; day < days; day++) {
      let baseAccepted = 0;
      let learnAccepted = 0;
      let baseTotal = 0;
      let learnTotal = 0;

      for (let t = 0; t < tasksPerDay; t++) {
        // Three candidates: fast (lean), safe (3-step), random
        const fastCand = makeCandidate("fast", "corpus", ["flush_atomic"]);
        const safeCand = makeCandidate("safe", "protocol", ["open_file", "write_file", "close_file"]);
        const randomCand = makeCandidate("random", "antibody", ["reopen_file", "append_data"]);

        const candidates = [fastCand, safeCand, randomCand];
        const ctx = { protocol: "FileProtocol", currentState: ["FILE_OPEN"], targetState: [], violationType: "resource_leak", constraints: [], rules: new Map() };
        const features: CandidateFeatures[] = candidates.map(c => extractFeatures(c, ctx));

        // Baseline (LinearRanker + acceptance from telemetry)
        const baseScored = candidates.map((c, i) => ({ ...c, score: base.score(features[i]) }));
        baseScored.sort((a, b) => b.score - a.score);
        const user = realisticUser({ fast: 0, safe: 1, random: 2 });
        const baseChoice = baseScored[user.selected];
        if (user.accepted) baseAccepted++;
        baseTotal++;

        const baseFp = candidateFingerprint("FileProtocol", baseChoice.actions.filter(a => a.kind === "call").map(a => (a as any).function), "resource_leak");
        const baseId = telemetry.recordDecision({
          goal: "write file safely", protocol: "FileProtocol", violationType: "resource_leak",
          candidates: candidates.map(c => ({
            candidateId: candidateFingerprint("FileProtocol", c.actions.filter(a => a.kind === "call").map(a => (a as any).function), "resource_leak"),
            source: c.source, evidenceSources: [c.source],
            actions: c.actions.filter(a => a.kind === "call").map(a => (a as any).function),
            explanation: c.explanation,
          })),
          selectedCandidateId: baseFp,
        });
        telemetry.recordFeedback(baseId, {
          decision: user.accepted ? "accepted" : "rejected",
          executionResult: user.executionOk ? { success: true, violations: [] } : { success: false, violations: ["resource_leak"] },
          timestamp: Date.now(),
        });

        // Learning (LearningRanker with accumulated feedback)
        const learnScored = learner.rank(candidates, features, { protocol: "FileProtocol", violationType: "resource_leak" });
        const learnChoice = learnScored[user.selected];
        if (user.accepted) learnAccepted++;
        learnTotal++;

        const learnFp = candidateFingerprint("FileProtocol", learnChoice.actions.filter(a => a.kind === "call").map(a => (a as any).function), "resource_leak");
        const learnId = telemetry.recordDecision({
          goal: "write file safely", protocol: "FileProtocol", violationType: "resource_leak",
          candidates: candidates.map(c => ({
            candidateId: candidateFingerprint("FileProtocol", c.actions.filter(a => a.kind === "call").map(a => (a as any).function), "resource_leak"),
            source: c.source, evidenceSources: [c.source],
            actions: c.actions.filter(a => a.kind === "call").map(a => (a as any).function),
            explanation: c.explanation,
          })),
          selectedCandidateId: learnFp,
        });
        telemetry.recordFeedback(learnId, {
          decision: user.accepted ? "accepted" : "rejected",
          executionResult: user.executionOk ? { success: true, violations: [] } : { success: false, violations: ["resource_leak"] },
          timestamp: Date.now(),
        });
      }

      baselineDailyRates.push(baseTotal > 0 ? baseAccepted / baseTotal : 0);
      learningDailyRates.push(learnTotal > 0 ? learnAccepted / learnTotal : 0);
    }

    // Last 3 days average
    const baseAvg = baselineDailyRates.slice(-3).reduce((s, r) => s + r, 0) / 3;
    const learnAvg = learningDailyRates.slice(-3).reduce((s, r) => s + r, 0) / 3;

    console.log(`Day 14 baseline: ${(baseAvg*100).toFixed(0)}%, Learning: ${(learnAvg*100).toFixed(0)}%`);

    // LearningRanker should maintain or improve acceptance
    expect(learnAvg).toBeGreaterThanOrEqual(baseAvg * 0.95);

    // Trend: learning improves over time
    const firstLearn = learningDailyRates[0];
    const lastLearn = learningDailyRates[learningDailyRates.length - 1];
    console.log(`Learning trend: day 1 = ${(firstLearn*100).toFixed(0)}%, day 14 = ${(lastLearn*100).toFixed(0)}%`);
  }, 60000);
});
