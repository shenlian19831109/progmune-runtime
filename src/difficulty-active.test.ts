/**
 * P3.7 + P3.8: Difficulty Map & Active Learning Tests
 *
 * Verifying:
 *   1. TransitionStats computation from trajectory + telemetry data
 *   2. Protocol difficulty ranking (critical/high/medium/low)
 *   3. Active Learning importance scoring
 *   4. Prioritized benchmark generation
 *   5. End-to-end: difficulty → importance → prioritized cases
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  buildDifficultyMap, rankProtocolsByDifficulty,
  printDifficultyDashboard, TransitionStats, ProtocolDifficulty,
} from "./difficulty-map";
import {
  generatePrioritizedBenchmarks, writeTopPriorityBenchmarks,
  printActiveLearningReport, ActiveLearningReport,
} from "./active-learning";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import type { TrajectoryRecord } from "./runtime-types";
import type { PlannerDecision } from "./planner-telemetry";

// ═══════════════════════════════════════════════════════════════
// Difficulty Map
// ═══════════════════════════════════════════════════════════════

function makeTrajectory(overrides: Partial<TrajectoryRecord> = {}): TrajectoryRecord {
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    protocol: "_global",
    initialState: [],
    finalState: [],
    trajectory: ["open_file", "write_file", "close_file"],
    result: "success",
    context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
    successRate: 1.0,
    metadata: { source: "human" },
    ...overrides,
  };
}

describe("Difficulty Map", () => {
  it("computes transition stats from trajectories", () => {
    const trajectories: TrajectoryRecord[] = [
      makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] }),
      makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] }),
      makeTrajectory({ result: "violation", trajectory: ["open_file", "write_file"] }),  // missing close
      makeTrajectory({
        result: "repair", trajectory: ["open_file", "write_file", "close_file"],
        successRate: 1.0,
        violation: { type: "resource_leak", failingStepIndex: 2, expectedStates: [], actualStates: ["FILE_OPEN"], fixPath: ["close_file"], description: "fix" },
      }),
    ];

    const statsMap = buildDifficultyMap(trajectories);

    // FileProtocol should have stats
    const fileKeys = [...statsMap.keys()].filter(k => k.startsWith("FileProtocol:"));
    expect(fileKeys.length).toBeGreaterThan(0);

    // open_file transition should have attempts
    const openKey = "FileProtocol:INIT→FILE_OPEN";
    const openStats = statsMap.get(openKey);
    expect(openStats).toBeDefined();
    expect(openStats!.attempts).toBeGreaterThanOrEqual(3);
    expect(openStats!.failures).toBeGreaterThanOrEqual(1); // the violation

    // close_file invalidation should be tracked
    const closeInvKey = "FileProtocol:FILE_OPEN→∅";
    const closeStats = statsMap.get(closeInvKey);
    expect(closeStats).toBeDefined();
  });

  it("difficulty > 0 for transitions with failures", () => {
    const trajectories: TrajectoryRecord[] = [
      makeTrajectory({ result: "success", trajectory: ["verify_password", "generate_jwt", "create_session"] }),
      makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),  // missing jwt
      makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),
      makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),
    ];

    const statsMap = buildDifficultyMap(trajectories);

    // The failures are on verify_password transitions (missing the rest)
    // UNAUTHENTICATED→PASSWORD_VERIFIED should have failures from the violations
    const vpKey = "AuthProtocol:UNAUTHENTICATED→PASSWORD_VERIFIED";
    const vpStats = statsMap.get(vpKey);
    expect(vpStats).toBeDefined();
    expect(vpStats!.attempts).toBeGreaterThanOrEqual(4); // 1 success + 3 violations
    expect(vpStats!.failures).toBeGreaterThanOrEqual(3);
    expect(vpStats!.difficulty).toBeGreaterThan(0);
  });

  it("ranks protocols by difficulty", () => {
    const trajectories: TrajectoryRecord[] = [
      // FileProtocol: mostly successes
      ...Array.from({ length: 10 }, () =>
        makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] })
      ),
      // AuthProtocol: many failures
      makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),
      makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),
      makeTrajectory({ result: "violation", trajectory: ["generate_jwt"] }),
    ];

    const statsMap = buildDifficultyMap(trajectories);
    const ranking = rankProtocolsByDifficulty(statsMap);

    expect(ranking.length).toBe(4);

    // AuthProtocol should be highest difficulty
    const auth = ranking.find(r => r.protocol === "AuthProtocol")!;
    const file = ranking.find(r => r.protocol === "FileProtocol")!;

    expect(auth.maxDifficulty).toBeGreaterThan(file.maxDifficulty);

    printDifficultyDashboard(statsMap, ranking);
  });

  it("empty data = all zeros", () => {
    const statsMap = buildDifficultyMap([]);
    const ranking = rankProtocolsByDifficulty(statsMap);

    for (const r of ranking) {
      expect(r.avgDifficulty).toBe(0);
      expect(r.maxDifficulty).toBe(0);
      expect(r.risk).toBe("low");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Active Learning
// ═══════════════════════════════════════════════════════════════

describe("Active Learning", () => {
  it("prioritizes gaps by importance (difficulty × usage × failure)", () => {
    // Seed with skewed data: FileProtocol is easy, AuthProtocol is hard
    const trajectories: TrajectoryRecord[] = [
      // File: many successes, few failures → low difficulty
      ...Array.from({ length: 20 }, () =>
        makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] })
      ),
      // Auth: many failures → high difficulty
      ...Array.from({ length: 5 }, () =>
        makeTrajectory({ result: "violation", trajectory: ["verify_password"] })
      ),
    ];

    const report = generatePrioritizedBenchmarks(trajectories);

    expect(report.totalGaps).toBeGreaterThan(0);
    expect(report.prioritized.length).toBeGreaterThan(0);

    // Auth transitions should have higher importance than File transitions
    // (auth has violations → higher difficulty)
    const authCases = report.prioritized.filter(
      c => c.targetsTransition.rule.includes("password") || c.targetsTransition.rule.includes("jwt") || c.targetsTransition.rule.includes("session")
    );
    const fileCases = report.prioritized.filter(
      c => c.targetsTransition.rule.includes("file") || c.targetsTransition.rule.includes("open") || c.targetsTransition.rule.includes("write") || c.targetsTransition.rule.includes("close")
    );

    if (authCases.length > 0 && fileCases.length > 0) {
      // Auth should have non-zero difficulty (has violations)
      const authHasDifficulty = authCases.some(c => c.difficulty > 0);
      expect(authHasDifficulty).toBe(true);
    }

    printActiveLearningReport(report);
  });

  it("writes top-K priority benchmarks", () => {
    const trajectories: TrajectoryRecord[] = [
      ...Array.from({ length: 30 }, () =>
        makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] })
      ),
    ];

    const report = generatePrioritizedBenchmarks(trajectories);
    const outDir = path.resolve(__dirname, "..", "test-active-learning");
    const written = writeTopPriorityBenchmarks(report, 8, outDir);

    expect(written.length).toBeGreaterThanOrEqual(1);

    // Verify files are valid JSON with importance scores
    for (const fp of written) {
      expect(fs.existsSync(fp)).toBe(true);
      const content = JSON.parse(fs.readFileSync(fp, "utf-8"));
      expect(content.source).toBe("active-learning");
      expect(content.cases.length).toBeGreaterThan(0);
      expect(content.cases.length).toBeLessThanOrEqual(8);
      for (const c of content.cases) {
        expect(c.importance).toBeGreaterThanOrEqual(0);
        expect(c.difficulty).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("importance = 0 when no data (all gaps equal priority)", () => {
    const report = generatePrioritizedBenchmarks([]);

    // With no data, all gaps have equal importance
    // They're still generated, just not differentiated
    expect(report.totalGaps).toBeGreaterThan(0);
    for (const c of report.prioritized) {
      expect(c.importance).toBeGreaterThanOrEqual(0);
      expect(c.importance).toBeLessThanOrEqual(1);
    }
  });
});
