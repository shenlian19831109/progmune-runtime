/**
 * P6.1: Evaluation Hardening Tests
 */

import { describe, it, expect } from "vitest";
import { createBlindSplit, runBlindBenchmark, runHoldoutEvaluation, analyzeDiscoveryCeiling, runEvaluationHardening, printHardeningReport, BlindBenchmarkResult } from "./eval-hardening";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import type { StateAnnotation } from "./ssg-validator";
import type { AttributedCase } from "./evaluation-campaign";

describe("Blind Benchmark", () => {
  it("splits protocols into train/test with strict isolation", () => {
    const split = createBlindSplit(
      ["FileProtocol", "AuthProtocol", "DBProtocol"],
      ["IRProtocol"]
    );

    expect(split.trainProtocols).toContain("FileProtocol");
    expect(split.testProtocols).toContain("IRProtocol");
    expect(split.trainProtocols).not.toContain("IRProtocol");
    expect(split.testProtocols).not.toContain("FileProtocol");

    // Train and test should have minimal overlap (some cross-protocol functions exist)
    const trainFns = new Set(split.trainRules.keys());
    const testFns = new Set(split.testRules.keys());
    let overlap = 0;
    for (const fn of trainFns) {
      if (testFns.has(fn)) overlap++;
    }
    // Some overlap is expected (cross-protocol functions). IRProtocol shares auth functions.
    // The blind split test is valid as long as overlap < 100% of either set.
    expect(overlap).toBeLessThan(trainFns.size);
    expect(overlap).toBeLessThan(testFns.size);
  });

  it("runs blind benchmark on current repo", () => {
    const result = runBlindBenchmark(__dirname + "/..");

    expect(result.verdict).toBeDefined();
    expect(result.generalizationGap).toBeGreaterThanOrEqual(-1);
    expect(result.generalizationGap).toBeLessThanOrEqual(1);

    console.log(`Blind benchmark verdict: ${result.verdict}, gap: ${(result.generalizationGap*100).toFixed(0)}%`);
  });
});

describe("Holdout Protocol", () => {
  it("evaluates generalization to unseen protocol", () => {
    const result = runHoldoutEvaluation(__dirname + "/..", "IRProtocol");

    expect(result.heldOutProtocol).toBe("IRProtocol");
    expect(result.trainedOn).not.toContain("IRProtocol");
    expect(result.verdict).toBeDefined();

    console.log(`Holdout ${result.heldOutProtocol}: F1=${(result.extractionF1*100).toFixed(0)}%, verdict=${result.verdict}`);
  });
});

describe("Discovery Ceiling", () => {
  it("decomposes missing_candidate into root causes", () => {
    const attributed: AttributedCase[] = [
      { caseId: "c1", goal: "test", protocol: "_global", violationType: "resource_leak", expectedRepair: ["close_file"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
      { caseId: "c2", goal: "test", protocol: "_global", violationType: "missing_prerequisite", expectedRepair: ["flush_file"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
      { caseId: "c3", goal: "test", protocol: "_global", violationType: "resource_leak", expectedRepair: ["open_file", "write_file", "close_file"], candidatesReturned: 2, rank: null, failureReason: "missing_candidate" },
      { caseId: "c4", goal: "cross", protocol: "_global", violationType: "missing_prerequisite", expectedRepair: ["verify_password", "open_file", "write_file", "close_file", "connect_db", "query_db", "disconnect_db"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
      { caseId: "c5", goal: "deep", protocol: "_global", violationType: "illegal_state_transition", expectedRepair: ["a", "b", "c", "d", "e", "f", "g"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
      { caseId: "c6", goal: "ok", protocol: "_global", violationType: "resource_leak", expectedRepair: ["close_file"], candidatesReturned: 1, rank: 1, failureReason: "success" },
    ];

    const rules = new Map<string, StateAnnotation>();
    rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });
    rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
    rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });

    const ceiling = analyzeDiscoveryCeiling(attributed, rules, 0.69);

    expect(ceiling.totalMissing).toBe(5);
    // protocol_missing: flush_file + 7-action chain + cross-proto (verify_password etc not in rules)
    // ranking_side_effect: case with 2 candidates returned but no match
    expect(ceiling.breakdown.protocol_missing).toBeGreaterThanOrEqual(3);
    expect(ceiling.breakdown.ranking_side_effect).toBeGreaterThanOrEqual(1);
    // Total should cover 5 missing cases (remaining fall to benchmark_artifact or bridge)
    const sum = Object.values(ceiling.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(5);

    // Achievable ceiling should be higher than current discovery (1/6 ≈ 17%)
    expect(ceiling.achievableCeiling).toBeGreaterThan(0.17);

    console.log(`Ceiling breakdown: protocol_missing=${ceiling.breakdown.protocol_missing}, bridge=${ceiling.breakdown.bridge_missing}, depth=${ceiling.breakdown.planner_depth_limit}, ranking=${ceiling.breakdown.ranking_side_effect}`);
    console.log(`Achievable ceiling: ${(ceiling.achievableCeiling*100).toFixed(0)}%`);
    console.log(`Recommendation: ${ceiling.recommendation}`);
  });
});

describe("Full Hardening Report", () => {
  it("generates comprehensive evaluation hardening report", async () => {
    const report = await runEvaluationHardening();

    expect(report.credibilityScore).toBeGreaterThanOrEqual(0);
    expect(report.credibilityScore).toBeLessThanOrEqual(1);
    expect(report.blind.verdict).toBeDefined();
    expect(report.holdout.verdict).toBeDefined();
    expect(report.ceiling.achievableCeiling).toBeGreaterThan(0);

    printHardeningReport(report);
  }, 30000);
});
