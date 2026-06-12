/**
 * P3.11-13: Pairwise Preference Tests
 *
 * Verifying:
 *   1. Pairwise preference recording and win rate computation
 *   2. Ranker stress test with acceptable/unacceptable patterns
 *   3. PreferenceRanker using pairwise win rates
 */

import { describe, it, expect } from "vitest";
import {
  createPreferenceStore, recordPreference, getWinRate,
  runRankerStressTest, printRankerStressReport,
  PreferenceRanker, PAIRWISE_BENCHMARK_CASES,
  RepairPreference,
} from "./pairwise-preference";
import { candidateFingerprint } from "./planner-telemetry";
import type { RepairCandidate } from "./repair-types";

// ═══════════════════════════════════════════════════════════════
// P3.11: Pairwise Preference
// ═══════════════════════════════════════════════════════════════

describe("Pairwise Preference", () => {
  it("records and queries win rates", () => {
    const store = createPreferenceStore();

    const fpA = candidateFingerprint("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
    const fpB = candidateFingerprint("FileProtocol", ["open_file", "write_file"], "resource_leak");
    const fpC = candidateFingerprint("FileProtocol", ["atomic_write"], "resource_leak");

    // A beats B 8 times
    for (let i = 0; i < 8; i++) {
      recordPreference(store, fpA, fpB, "safely write config file", "FileProtocol");
    }
    // B beats A 2 times
    for (let i = 0; i < 2; i++) {
      recordPreference(store, fpB, fpA, "safely write config file", "FileProtocol");
    }
    // A beats C 5 times
    for (let i = 0; i < 5; i++) {
      recordPreference(store, fpA, fpC, "safely write config file", "FileProtocol");
    }

    expect(store.preferences.length).toBe(15);

    // A: 8+5=13 wins / 10+5=15 comparisons = 86.7%
    const aRate = getWinRate(store, fpA, 3);
    expect(aRate).toBeCloseTo(13 / 15, 2);

    // B: 2 wins / 10 comparisons = 20%
    const bRate = getWinRate(store, fpB, 3);
    expect(bRate).toBe(0.2);

    // C: 0 wins / 5 comparisons = 0%
    const cRate = getWinRate(store, fpC, 3);
    expect(cRate).toBe(0);

    // Unknown fingerprint: default 0.5
    const unknown = getWinRate(store, "unknown-fp", 3);
    expect(unknown).toBe(0.5);
  });

  it("defaults to 0.5 for fingerprints with insufficient comparisons", () => {
    const store = createPreferenceStore();
    const fp = candidateFingerprint("FileProtocol", ["close_file"], "resource_leak");
    recordPreference(store, fp, "other", "test", "FileProtocol");

    // 1 win, 1 comparison → need 3 minimum
    expect(getWinRate(store, fp, 3)).toBe(0.5);
    // 1 win, 1 comparison → enough for min 1
    expect(getWinRate(store, fp, 1)).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════
// P3.12: Ranker Stress Test
// ═══════════════════════════════════════════════════════════════

function fakeCandidateGenerator(goal: string, _protocol: string): RepairCandidate[] {
  if (goal.includes("safely write")) {
    return [
      { id: "safe", source: "protocol", actions: fnActions(["open_file", "write_file", "close_file"]), explanation: "safe" },
      { id: "flush", source: "corpus", actions: fnActions(["open_file", "write_file", "flush", "close_file"]), explanation: "safe+flush" },
      { id: "leak", source: "corpus", actions: fnActions(["open_file", "write_file"]), explanation: "leaky" },
      { id: "bare", source: "antibody", actions: fnActions(["write_file"]), explanation: "bare" },
    ];
  }
  if (goal.includes("authenticate")) {
    return [
      { id: "full", source: "protocol", actions: fnActions(["verify_password", "generate_jwt", "create_session"]), explanation: "full" },
      { id: "partial", source: "protocol", actions: fnActions(["verify_password", "generate_jwt"]), explanation: "partial" },
      { id: "skip", source: "antibody", actions: fnActions(["generate_jwt"]), explanation: "skip-verify" },
      { id: "wrong", source: "corpus", actions: fnActions(["logout"]), explanation: "wrong" },
    ];
  }
  return [];
}

function fnActions(fns: string[]): RepairCandidate["actions"] {
  return fns.map(fn => ({ kind: "call" as const, function: fn, args: [] }));
}

describe("Ranker Stress Test", () => {
  it("measures top-1 accuracy and top-3 acceptability", () => {
    const testCases = PAIRWISE_BENCHMARK_CASES.slice(0, 2); // first 2
    const report = runRankerStressTest(testCases, fakeCandidateGenerator);

    expect(report.cases).toBe(2);
    expect(report.top1Accuracy).toBeGreaterThanOrEqual(0);
    expect(report.top3Acceptability).toBeGreaterThanOrEqual(0);
    expect(report.unacceptableFiltered).toBeGreaterThanOrEqual(0);

    // With our fake generator: safe+flush both in top 3 for file case, full+partial for auth
    expect(report.top3Acceptability).toBeGreaterThan(0.5);

    printRankerStressReport(report);
  });

  it("all benchmark cases have expectedTop1, acceptableTop3, unacceptableRepairs", () => {
    for (const c of PAIRWISE_BENCHMARK_CASES) {
      expect(c.expectedTop1.length).toBeGreaterThan(0);
      expect(c.acceptableTop3.length).toBeGreaterThan(0);
      expect(c.unacceptableRepairs.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// P3.13: PreferenceRanker
// ═══════════════════════════════════════════════════════════════

describe("PreferenceRanker", () => {
  it("ranks candidates by pairwise win rate", () => {
    const store = createPreferenceStore();

    const safeFp = candidateFingerprint("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
    const leakFp = candidateFingerprint("FileProtocol", ["open_file", "write_file"], "resource_leak");

    // Safe beats leak 9 times, leak beats safe 1 time
    for (let i = 0; i < 9; i++) recordPreference(store, safeFp, leakFp, "write file", "FileProtocol");
    for (let i = 0; i < 1; i++) recordPreference(store, leakFp, safeFp, "write file", "FileProtocol");

    const ranker = new PreferenceRanker(store);

    const safe: RepairCandidate = { id: "safe", source: "protocol", actions: fnActions(["open_file", "write_file", "close_file"]), explanation: "safe" };
    const leak: RepairCandidate = { id: "leak", source: "corpus", actions: fnActions(["open_file", "write_file"]), explanation: "leaky" };

    const features = [
      { protocolSafety: 1.0, historicalSuccessRate: 0.5, actionCount: 3, latencyCost: 0.6, auditability: 0.8, corpusEvidence: 0, source: "protocol" as const },
      { protocolSafety: 0.3, historicalSuccessRate: 0.5, actionCount: 2, latencyCost: 0.4, auditability: 0.5, corpusEvidence: 0, source: "corpus" as const },
    ];

    const ranked = ranker.rank([leak, safe], features, "FileProtocol", "resource_leak");

    // Safe should rank higher (90% win rate vs 10%)
    expect(ranked[0].id).toBe("safe");
    expect(ranked[1].id).toBe("leak");
  });

  it("defaults to heuristic when no preference data", () => {
    const ranker = new PreferenceRanker();

    const safe: RepairCandidate = { id: "safe", source: "protocol", actions: fnActions(["open_file", "write_file", "close_file"]), explanation: "safe" };
    const leak: RepairCandidate = { id: "leak", source: "antibody", actions: fnActions(["open_file", "write_file"]), explanation: "missing close" };

    // Safe has higher protocolSafety, leak has lower (missing close = unsafe)
    const safeFeatures = { protocolSafety: 1.0, historicalSuccessRate: 0.5, actionCount: 3, latencyCost: 0.6, auditability: 0.8, corpusEvidence: 0, source: "protocol" as const };
    const leakFeatures = { protocolSafety: 0.2, historicalSuccessRate: 0.3, actionCount: 2, latencyCost: 0.4, auditability: 0.4, corpusEvidence: 0, source: "antibody" as const };

    // Without preference data, falls back to heuristic
    const ranked = ranker.rank([leak, safe], [leakFeatures, safeFeatures], "FileProtocol");
    expect(ranked[0].id).toBe("safe");
  });
});
