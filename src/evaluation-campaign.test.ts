/**
 * P3.9: Evaluation Campaign Tests
 *
 * Verifying:
 *   1. Failure attribution classifies benchmark misses correctly
 *   2. Error budget dashboard produces actionable breakdown
 *   3. Offline replay computes match rate against user choices
 *   4. Ranker A/B comparison produces delta
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  runFailureAttribution, computeErrorBudget, printErrorBudget,
  replayDecisions, compareRankers,
  printReplayReport, printRankerComparison,
  AttributedCase, ErrorBudget,
} from "./evaluation-campaign";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import { PlannerTraceStore } from "./planner-trace";

// ═══════════════════════════════════════════════════════════════
// Failure Attribution
// ═══════════════════════════════════════════════════════════════

describe("Failure Attribution", () => {
  it("classifies all 49 benchmark cases", async () => {
    const attributed = await runFailureAttribution();

    expect(attributed.length).toBeGreaterThanOrEqual(49);

    // Count by failure reason
    const counts: Record<string, number> = {};
    for (const a of attributed) {
      counts[a.failureReason] = (counts[a.failureReason] || 0) + 1;
    }

    // Should have at least some successes and some failures
    expect(counts["success"]).toBeGreaterThanOrEqual(1);
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(2);

    // Every attributed case has required fields
    for (const a of attributed) {
      expect(a.failureReason).toBeDefined();
      expect(a.expectedRepair.length).toBeGreaterThan(0);
      expect(["success", "missing_candidate", "bad_ranking", "bad_protocol_model", "goal_mismatch", "insufficient_history"]).toContain(a.failureReason);
    }
  }, 60_000);

  it("produces actionable error budget", async () => {
    const attributed = await runFailureAttribution();
    const budget = computeErrorBudget(attributed);

    expect(budget.totalCases).toBeGreaterThanOrEqual(49);
    expect(budget.successRate).toBeGreaterThanOrEqual(0);
    expect(budget.successRate).toBeLessThanOrEqual(1);
    expect(budget.recommendation.length).toBeGreaterThan(0);

    // All failure reasons should sum to total
    const sum = Object.values(budget.breakdown).reduce((s, v) => s + v, 0);
    expect(sum).toBe(budget.totalCases);

    printErrorBudget(budget);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════
// Offline Replay
// ═══════════════════════════════════════════════════════════════

const REPLAY_DIR = path.resolve(__dirname, "..", "test-evaluation-replay");
process.env.PROGMUNE_PROJECT_DIR = REPLAY_DIR;
fs.mkdirSync(REPLAY_DIR, { recursive: true });
fs.mkdirSync(path.join(REPLAY_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(REPLAY_DIR, ".progmune_corpus", "traces"), { recursive: true });

function seedReplayData(): { telemetry: PlannerTelemetry; traceStore: PlannerTraceStore } {
  const telemetry = new PlannerTelemetry(
    path.join(REPLAY_DIR, ".progmune_corpus", "telemetry", `replay-${Date.now()}.jsonl`)
  );
  const traceStore = new PlannerTraceStore(
    path.join(REPLAY_DIR, ".progmune_corpus", "traces", `replay-${Date.now()}.jsonl`)
  );

  // Seed: candidate A is safe (high acceptance), candidate B is fast (low acceptance)
  const fpA = candidateFingerprint("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
  const fpB = candidateFingerprint("FileProtocol", ["atomic_write"], "resource_leak");

  // A accepted 80 times, B rejected 50 times
  for (let i = 0; i < 80; i++) {
    const id = telemetry.recordDecision({
      goal: "safely write file",
      protocol: "FileProtocol",
      violationType: "resource_leak",
      candidates: [
        { candidateId: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
        { candidateId: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], explanation: "fast" },
      ],
      selectedCandidateId: fpA,
    });
    telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
  }
  for (let i = 0; i < 50; i++) {
    const id = telemetry.recordDecision({
      goal: "quick write",
      protocol: "FileProtocol",
      violationType: "resource_leak",
      candidates: [
        { candidateId: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
        { candidateId: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], explanation: "fast" },
      ],
      selectedCandidateId: fpB,
    });
    telemetry.recordFeedback(id, { decision: "rejected", timestamp: Date.now() });
  }

  // Create traces where user chose A over B (original ranker put B first, user chose A)
  for (let i = 0; i < 20; i++) {
    traceStore.recordTrace({
      decisionId: `pd-replay-${i}`,
      goal: "safely write config file",
      protocol: "FileProtocol",
      violationType: "resource_leak",
      candidates: [
        { fingerprint: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], score: 0.73, rank: 1 },
        { fingerprint: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], score: 0.68, rank: 2 },
      ],
      selectedFingerprint: fpA, // user chose A even though B was rank-1
      accepted: true,
    });
  }

  // Traces where user chose rank-1
  for (let i = 20; i < 30; i++) {
    traceStore.recordTrace({
      decisionId: `pd-replay-${i}`,
      goal: "safely write config file",
      protocol: "FileProtocol",
      violationType: "resource_leak",
      candidates: [
        { fingerprint: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], score: 0.81, rank: 1 },
        { fingerprint: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], score: 0.73, rank: 2 },
      ],
      selectedFingerprint: fpA,
      accepted: true,
    });
  }

  return { telemetry, traceStore };
}

describe("Offline Replay", () => {
  it("replays decisions and computes match rate", () => {
    const { telemetry, traceStore } = seedReplayData();
    const report = replayDecisions(traceStore, telemetry);

    expect(report.totalDecisions).toBeGreaterThanOrEqual(30);
    expect(report.matchRate).toBeGreaterThanOrEqual(0);
    expect(report.matchRate).toBeLessThanOrEqual(1);

    // LearningRanker should match > 80% (A has 80 accepts vs B has 50 rejects)
    expect(report.matchRate).toBeGreaterThan(0.8);

    printReplayReport(report);
  });

  it("compares rankers and shows delta", () => {
    const { telemetry, traceStore } = seedReplayData();
    const { baseline, learning, delta } = compareRankers(traceStore, telemetry);

    expect(baseline.totalDecisions).toBeGreaterThanOrEqual(30);
    expect(learning.totalDecisions).toBeGreaterThanOrEqual(30);
    expect(delta).toBeGreaterThan(0); // LearningRanker outperforms baseline

    // Baseline (rank-1 = what planner showed first): B was rank-1 in 20/30 traces
    // but user chose A. So baseline matches only when A was rank-1 (10/30 ≈ 33%)
    expect(baseline.matchRate).toBeLessThan(learning.matchRate);

    printRankerComparison(baseline, learning, delta);
  });
});
