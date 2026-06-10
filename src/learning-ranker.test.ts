/**
 * P2.6: Ranking Evolution Test — Self-Improving Loop Verification
 *
 * Proves that the feedback loop works:
 *   Repair A accepted 90 times, Repair B accepted 10 times
 *   → LearningRanker ranks A > B
 *   → Then Repair B accepted 100 more times
 *   → LearningRanker now ranks B > A
 *
 * This is the first proof that Progmune is a Learning System,
 * not just a Rule System.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import { LearningRanker } from "./learning-ranker";
import { createLinearRanker, extractFeatures } from "./repair-ranker";
import { getRepairAdoptionRate } from "./analytics";
import type { RepairCandidate, CandidateFeatures, SearchContext } from "./repair-types";

// ── Test setup ──
const EVO_DIR = path.resolve(__dirname, "..", "test-ranking-evolution");
process.env.PROGMUNE_PROJECT_DIR = EVO_DIR;
fs.mkdirSync(EVO_DIR, { recursive: true });
fs.mkdirSync(path.join(EVO_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(EVO_DIR, ".progmune_corpus", "lifecycles"), { recursive: true });

const ctx: SearchContext = {
  protocol: "FileProtocol",
  currentState: ["FILE_OPEN"],
  targetState: [],
  violationType: "resource_leak",
  constraints: [],
  rules: new Map(),
};

function makeCandidate(id: string, source: "corpus" | "protocol" | "antibody", actions: string[]): RepairCandidate {
  return {
    id,
    source,
    actions: actions.map(fn => ({ kind: "call" as const, function: fn, args: [] })),
    explanation: `${id}: ${actions.join(" → ")}`,
  };
}

describe("Ranking Evolution", () => {
  it("accepted repairs rise over time (self-improving loop)", () => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const evoPath = path.join(EVO_DIR, ".progmune_corpus", "telemetry", `evo-${runId}.jsonl`);
    const t = new PlannerTelemetry(evoPath);
    const fpA = candidateFingerprint(`fp-${runId}`, ["open_file", "write_file", "close_file"], "resource_leak");
    const fpB = candidateFingerprint(`fp-${runId}`, ["atomic_write"], "resource_leak");

    const base = createLinearRanker();
    const learner = new LearningRanker(base, t);

    // Two candidates: A (safe) and B (fast)
    const safeA = makeCandidate("safe", "protocol", ["open_file", "write_file", "close_file"]);
    const fastB = makeCandidate("fast", "corpus", ["atomic_write"]);

    const safeFeatures: CandidateFeatures = {
      protocolSafety: 1.0, historicalSuccessRate: 0.5, actionCount: 3,
      latencyCost: 0.6, auditability: 0.8, corpusEvidence: 0, source: "protocol",
    };
    const fastFeatures: CandidateFeatures = {
      protocolSafety: 0.7, historicalSuccessRate: 0.99, actionCount: 1,
      latencyCost: 0.1, auditability: 0.5, corpusEvidence: 42, source: "corpus",
    };

    // ── Phase 1: A accepted 90 times, B accepted 10 times ──

    for (let i = 0; i < 90; i++) {
      const id = t.recordDecision({
        goal: "safely write config file",
        protocol: "FileProtocol",
        violationType: "resource_leak",
        candidates: [
          { candidateId: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
          { candidateId: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], explanation: "fast" },
        ],
        selectedCandidateId: fpA,
      });
      t.recordFeedback(id, {
        decision: "accepted",
        executionResult: { success: true, violations: [] },
        timestamp: Date.now(),
      });
    }

    for (let i = 0; i < 10; i++) {
      const id = t.recordDecision({
        goal: "quick config update",
        protocol: "FileProtocol",
        violationType: "resource_leak",
        candidates: [
          { candidateId: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
          { candidateId: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], explanation: "fast" },
        ],
        selectedCandidateId: fpB,
      });
      // B accepted but only 30% execution success → effective reward penalized
      const execOk = i < 3;
      t.recordFeedback(id, {
        decision: "accepted",
        executionResult: { success: execOk, violations: execOk ? [] : ["resource_leak"] },
        timestamp: Date.now(),
      });
    }

    // After phase 1: A should rank above B (A has higher effective reward)
    const ctx1 = { protocol: `fp-${runId}`, violationType: "resource_leak" as const };
    const ranked1 = learner.rank(
      [safeA, fastB],
      [safeFeatures, fastFeatures],
      ctx1
    );

    expect(ranked1[0].id).toBe("safe");
    expect(ranked1[0].acceptance).toBeGreaterThan(0.8);
    expect(ranked1[0].effectiveReward).toBe(1.0);

    // Verify TelemetryIndex stats
    const statsA1 = t.getCandidateStats(fpA);
    expect(statsA1.accepted).toBe(90);
    expect(statsA1.executionSuccess).toBe(90);

    const statsB1 = t.getCandidateStats(fpB);
    expect(statsB1.accepted).toBe(10);
    expect(statsB1.executionFailure).toBe(7);

    // ── Phase 2: B gets 100 more accepts → overtakes A ──
    for (let i = 0; i < 100; i++) {
      const id = t.recordDecision({
        goal: "quick config update",
        protocol: "FileProtocol",
        violationType: "resource_leak",
        candidates: [
          { candidateId: fpA, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
          { candidateId: fpB, source: "corpus", evidenceSources: ["corpus"], actions: ["atomic_write"], explanation: "fast" },
        ],
        selectedCandidateId: fpB,
      });
      t.recordFeedback(id, {
        decision: "accepted",
        executionResult: { success: true, violations: [] },
        timestamp: Date.now(),
      });
      // also record execution results for B
      t.recordExecutionResult(id, true, [], 3);
    }

    // After phase 2: B should overtake A (110 accepts, 103 execution successes)
    const ranked2 = learner.rank(
      [safeA, fastB],
      [safeFeatures, fastFeatures],
      { protocol: `fp-${runId}`, violationType: "resource_leak" }
    );

    expect(ranked2[0].id).toBe("fast");
    expect(ranked2[0].acceptance).toBeGreaterThan(0.9);
    expect(ranked2[0].effectiveReward).toBeGreaterThan(0.9);

    // Verify stats after evolution (>= because disk persistence may accumulate)
    const statsB2 = t.getCandidateStats(fpB);
    expect(statsB2.accepted).toBeGreaterThanOrEqual(110);
    expect(statsB2.executionSuccess).toBeGreaterThanOrEqual(103);

    // Adoption rate KPI
    const adoptionRate = getRepairAdoptionRate(t);
    expect(adoptionRate).toBe(1.0); // 200/200
  });

  it("rejected repairs sink in ranking", () => {
    const t = new PlannerTelemetry(
      path.join(EVO_DIR, ".progmune_corpus", "telemetry", `sink-${Date.now()}.jsonl`)
    );

    const learner = new LearningRanker(createLinearRanker(), t);

    const good = makeCandidate("good", "protocol", ["verify_password", "generate_jwt"]);
    const bad = makeCandidate("bad", "antibody", ["skip_auth"]);

    const goodFp = candidateFingerprint("AuthProtocol", ["verify_password", "generate_jwt"], "missing_prerequisite");
    const badFp = candidateFingerprint("AuthProtocol", ["skip_auth"], "missing_prerequisite");

    const features: CandidateFeatures = {
      protocolSafety: 0.8, historicalSuccessRate: 0.5, actionCount: 2,
      latencyCost: 0.3, auditability: 0.7, corpusEvidence: 0, source: "protocol",
    };

    // Good: accepted 50 times
    for (let i = 0; i < 50; i++) {
      const id = t.recordDecision({
        goal: "authenticate user",
        protocol: "AuthProtocol",
        violationType: "missing_prerequisite",
        candidates: [
          { candidateId: goodFp, source: "protocol", evidenceSources: ["protocol"], actions: ["verify_password", "generate_jwt"], explanation: "proper auth" },
          { candidateId: badFp, source: "antibody", evidenceSources: ["antibody"], actions: ["skip_auth"], explanation: "skip auth" },
        ],
        selectedCandidateId: goodFp,
      });
      t.recordFeedback(id, { decision: "accepted", timestamp: Date.now() });
    }

    // Bad: rejected 50 times
    for (let i = 0; i < 50; i++) {
      const id = t.recordDecision({
        goal: "authenticate user",
        protocol: "AuthProtocol",
        violationType: "missing_prerequisite",
        candidates: [
          { candidateId: goodFp, source: "protocol", evidenceSources: ["protocol"], actions: ["verify_password", "generate_jwt"], explanation: "proper auth" },
          { candidateId: badFp, source: "antibody", evidenceSources: ["antibody"], actions: ["skip_auth"], explanation: "skip auth" },
        ],
        selectedCandidateId: badFp,
      });
      t.recordFeedback(id, { decision: "rejected", timestamp: Date.now() });
    }

    const ranked = learner.rank(
      [good, bad],
      [features, { ...features, source: "antibody" as const }],
      { protocol: "AuthProtocol", violationType: "missing_prerequisite" }
    );

    expect(ranked[0].id).toBe("good");
    expect(ranked[1].acceptance).toBeLessThan(0.2); // ~0%

    // Verify rejection stats
    expect(t.getCandidateStats(badFp).rejected).toBe(50);
  });

  it("execution failure reduces effective reward", () => {
    const t = new PlannerTelemetry(
      path.join(EVO_DIR, ".progmune_corpus", "telemetry", `execfail-${Date.now()}.jsonl`)
    );

    const learner = new LearningRanker(createLinearRanker(), t);

    const safe = makeCandidate("safe", "protocol", ["open_file", "write_file", "close_file"]);
    const leaky = makeCandidate("leaky", "corpus", ["open_file", "write_file"]); // missing close

    const safeFp = candidateFingerprint("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
    const leakyFp = candidateFingerprint("FileProtocol", ["open_file", "write_file"], "resource_leak");

    const features: CandidateFeatures = {
      protocolSafety: 0.8, historicalSuccessRate: 0.5, actionCount: 2,
      latencyCost: 0.3, auditability: 0.7, corpusEvidence: 0, source: "protocol",
    };

    // Both accepted 50 times, but leaky always fails at execution
    for (let i = 0; i < 50; i++) {
      const safeId = t.recordDecision({
        goal: "write file",
        protocol: "FileProtocol",
        violationType: "resource_leak",
        candidates: [
          { candidateId: safeFp, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
          { candidateId: leakyFp, source: "corpus", evidenceSources: ["corpus"], actions: ["open_file", "write_file"], explanation: "fast but leaky" },
        ],
        selectedCandidateId: safeFp,
      });
      t.recordFeedback(safeId, {
        decision: "accepted",
        executionResult: { success: true, violations: [] },
        timestamp: Date.now(),
      });

      const leakyId = t.recordDecision({
        goal: "write file",
        protocol: "FileProtocol",
        violationType: "resource_leak",
        candidates: [
          { candidateId: safeFp, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "safe" },
          { candidateId: leakyFp, source: "corpus", evidenceSources: ["corpus"], actions: ["open_file", "write_file"], explanation: "fast but leaky" },
        ],
        selectedCandidateId: leakyFp,
      });
      t.recordFeedback(leakyId, {
        decision: "accepted",
        executionResult: { success: false, violations: ["resource_leak"] },
        timestamp: Date.now(),
      });
    }

    const ranked = learner.rank(
      [safe, leaky],
      [features, features],
      { protocol: "FileProtocol", violationType: "resource_leak" }
    );

    // Safe ranks higher despite equal acceptance (execution success matters)
    expect(ranked[0].id).toBe("safe");

    // Safe has higher effectiveReward
    expect(ranked[0].effectiveReward).toBeGreaterThan(ranked[1].effectiveReward);

    // Safe: acceptance=1.0, execution=1.0 → effectiveReward=1.0
    // Leaky: acceptance=1.0, execution=0.0 → effectiveReward=0.5
    expect(ranked[0].effectiveReward).toBe(1.0);
    expect(ranked[1].effectiveReward).toBe(0.5);

    // Verify stats
    const safeStats = t.getCandidateStats(safeFp);
    expect(safeStats.accepted).toBe(50);
    expect(safeStats.executionSuccess).toBe(50);
    expect(safeStats.executionFailure).toBe(0);

    const leakyStats = t.getCandidateStats(leakyFp);
    expect(leakyStats.accepted).toBe(50);
    expect(leakyStats.executionSuccess).toBe(0);
    expect(leakyStats.executionFailure).toBe(50);
  });
});
