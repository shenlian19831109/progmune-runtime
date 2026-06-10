/**
 * P2: Trajectory Feedback Tests — pre-burial for P4 Reward Model
 *
 * These tests verify that feedback and cost fields survive
 * write→read roundtrips through the trajectory corpus.
 *
 * IMPORTANT: process.env.PROGMUNE_PROJECT_DIR must be set BEFORE
 * importing from failure-corpus, because module-level path constants
 * are computed at import time. This file sets the env var FIRST.
 */

// ═══ MUST be set before any import from failure-corpus ═══
import * as fs from "fs";
import * as path from "path";

const FEEDBACK_TEST_DIR = path.resolve(
  __dirname, "..", "test-corpus-feedback"
);
process.env.PROGMUNE_PROJECT_DIR = FEEDBACK_TEST_DIR;

// Ensure directories exist before module loads
fs.mkdirSync(FEEDBACK_TEST_DIR, { recursive: true });
fs.mkdirSync(path.join(FEEDBACK_TEST_DIR, ".progmune_corpus"), { recursive: true });
fs.mkdirSync(
  path.join(FEEDBACK_TEST_DIR, ".progmune_corpus", "trajectories"),
  { recursive: true }
);

// ═══ Now safe to import ═══
import { describe, it, expect } from "vitest";
import { recordTrajectory, loadTrajectories } from "./failure-corpus";

describe("P2: Trajectory feedback", () => {
  it("stores accepted repair feedback on TrajectoryRecord", () => {
    recordTrajectory({
      protocol: "FileProtocol",
      initialState: ["FILE_OPEN"],
      finalState: [],
      trajectory: ["open_file", "write_file", "close_file"],
      result: "repair",
      violationType: "resource_leak",
      violationDesc: "File not closed",
      fixPath: ["close_file"],
      successRate: 1.0,
      source: "planner",
      feedback: { accepted: true, rejected: false },
      cost: { latency: 12, actions: 3 },
    });

    const trajectories = loadTrajectories();
    const accepted = trajectories.filter(
      t => t.result === "repair" && t.feedback?.accepted === true
    );
    expect(accepted.length).toBeGreaterThanOrEqual(1);

    const withCost = trajectories.filter(t => t.cost?.latency !== undefined);
    expect(withCost.length).toBeGreaterThanOrEqual(1);
  });

  it("stores rejected repair feedback", () => {
    recordTrajectory({
      protocol: "FileProtocol",
      initialState: ["FILE_OPEN"],
      finalState: ["FILE_OPEN"],
      trajectory: ["open_file", "write_file"],
      result: "repair",
      violationType: "resource_leak",
      violationDesc: "Attempted fix but still leaking",
      fixPath: ["close_file"],
      successRate: 0.0,
      source: "planner",
      feedback: { accepted: false, rejected: true },
      cost: { latency: 8, actions: 2 },
    });

    const trajectories = loadTrajectories();
    const rejected = trajectories.filter(
      t => t.result === "repair" && t.feedback?.rejected === true
    );
    expect(rejected.length).toBeGreaterThanOrEqual(1);
  });

  it("accumulates feedback statistics for future reward model", () => {
    const all = loadTrajectories().filter(t => t.result === "repair");

    const accepted = all.filter(t => t.feedback?.accepted === true).length;
    const rejected = all.filter(t => t.feedback?.rejected === true).length;
    const total = accepted + rejected;

    expect(total).toBeGreaterThanOrEqual(2);

    const acceptanceRate = accepted / total;
    expect(acceptanceRate).toBeGreaterThanOrEqual(0);
    expect(acceptanceRate).toBeLessThanOrEqual(1);

    // Cost summary for P4 reward model
    const costs = all
      .map(t => t.cost?.latency)
      .filter((l): l is number => l !== undefined);
    expect(costs.length).toBeGreaterThanOrEqual(1);
    const avgLatency = costs.reduce((s, l) => s + l, 0) / costs.length;
    expect(avgLatency).toBeGreaterThan(0);
  });
});
