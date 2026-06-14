/**
 * P2→P4 Evolution Path Verification Tests
 *
 * These tests verify that the refactored architecture truly opens
 * the path from Counterfactual Planner → Reward Model.
 *
 * Five architecture-level invariants:
 *   1. Strategy never knows about ranking
 *   2. Same candidate from multiple sources = merged evidence
 *   3. Same candidate ranks differently under different objectives
 *   4. Feedback + cost survive trajectory persistence (P4 pre-burial)
 *   5. Goal → Repair → Feedback → Corpus closed loop (the flywheel)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createDefaultStrategies } from "./repair-strategies";
import { extractFeatures, createLinearRanker } from "./repair-ranker";
import { deduplicateCandidates, suggestAlternatives } from "./counterfactual-engine";
import { parseProtocolsFromJSON } from "./ssg-validator";
import type { StateAnnotation } from "./ssg-validator";
import type { RepairCandidate, SearchContext, CandidateFeatures, CandidateSearchStrategy } from "./repair-types";

// ── Helpers ──

function fileProtocolRules(): Map<string, StateAnnotation> {
  const protoDef = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "protocols.json"), "utf-8")
  );
  const protocols = parseProtocolsFromJSON(protoDef);
  const rules = new Map<string, StateAnnotation>();
  for (const p of protocols) rules.set(p.function, p.protocol);
  return rules;
}

function fileProtocolContext(targetState?: string[]): SearchContext {
  return {
    protocol: "_global",
    currentState: ["FILE_OPEN"],
    targetState: targetState || [],
    violationType: "resource_leak",
    constraints: [],
    rules: fileProtocolRules(),
  };
}

// ════════════════════════════════════════════════════════
// Test 1: Strategy completely unaware of ranking
// ════════════════════════════════════════════════════════

class DummyStrategy implements CandidateSearchStrategy {
  name = "dummy";

  search(_: SearchContext): RepairCandidate[] {
    return [{
      id: "dummy-1",
      source: "protocol" as const,
      actions: [
        { kind: "call" as const, function: "open_file", args: [] },
        { kind: "call" as const, function: "write_file", args: [] },
        { kind: "call" as const, function: "close_file", args: [] },
      ],
      explanation: "dummy test candidate",
    }];
  }
}

describe("Test 1: Strategy unaware of ranking", () => {
  it("strategy returns candidates without score or rank", () => {
    const s = new DummyStrategy();
    const result = s.search({} as SearchContext);

    expect(result.length).toBe(1);
    expect((result[0] as any).score).toBeUndefined();
    expect((result[0] as any).rank).toBeUndefined();

    // Has required RepairCandidate shape
    expect(result[0].id).toBeDefined();
    expect(result[0].source).toBe("protocol");
    expect(result[0].actions.length).toBe(3);
    expect(result[0].explanation).toBeDefined();
  });

  it("future LLMRepairStrategy would not need Ranker changes", () => {
    // Any class implementing CandidateSearchStrategy works
    const iface: CandidateSearchStrategy = new DummyStrategy();
    expect(iface.name).toBe("dummy");
    expect(typeof iface.search).toBe("function");

    // The Ranker consumes RepairCandidate[], not strategy-specific types
    const ranker = createLinearRanker();
    const ctx: SearchContext = {
      protocol: "test", currentState: [], targetState: ["DONE"],
      violationType: "test", constraints: [], rules: new Map(),
    };
    const candidate = iface.search(ctx)[0];
    const features = extractFeatures(candidate, ctx);
    const score = ranker.score(features);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════
// Test 2: Cross-source evidence merging
// ════════════════════════════════════════════════════════

describe("Test 2: Cross-source evidence merge", () => {
  it("merges identical action sequences from different sources", () => {
    const candidates: RepairCandidate[] = [
      {
        id: "corpus-close",
        source: "corpus",
        actions: [{ kind: "call", function: "close_file", args: [] }],
        explanation: "From historical data: close the file",
        evidence: 42,
        metadata: { historicalSuccessRate: 0.85 },
      },
      {
        id: "protocol-close",
        source: "protocol",
        actions: [{ kind: "call", function: "close_file", args: [] }],
        explanation: "From SSG: close_file invalidates FILE_OPEN",
        evidence: 0,
        metadata: { pathLength: 1 },
      },
      {
        id: "antibody-close",
        source: "antibody",
        actions: [{ kind: "call", function: "close_file", args: [] }],
        explanation: "From antibody: resource leak → close_file",
        evidence: 0,
        metadata: { avgSuccessRate: 0.5 },
      },
    ];

    const merged = deduplicateCandidates(candidates);

    expect(merged.length).toBe(1);
    expect(merged[0].evidenceSources).toBeDefined();
    expect(merged[0].evidenceSources!.sort()).toEqual(
      ["antibody", "corpus", "protocol"]
    );
    // Evidence count takes max from all sources
    expect(merged[0].evidence).toBe(42);
    // Metadata merges: highest historicalSuccessRate survives
    expect(merged[0].metadata?.historicalSuccessRate).toBe(0.85);
  });

  it("single-source candidate has evidenceSources = [source]", () => {
    const candidates: RepairCandidate[] = [{
      id: "solo",
      source: "protocol",
      actions: [{ kind: "call", function: "verify_email", args: [] }],
      explanation: "Only from protocol",
    }];

    const merged = deduplicateCandidates(candidates);

    expect(merged.length).toBe(1);
    expect(merged[0].evidenceSources).toEqual(["protocol"]);
  });

  it("different action sequences stay separate", () => {
    const candidates: RepairCandidate[] = [
      {
        id: "a", source: "protocol",
        actions: [{ kind: "call", function: "close_file", args: [] }],
        explanation: "close",
      },
      {
        id: "b", source: "corpus",
        actions: [
          { kind: "call", function: "flush", args: [] },
          { kind: "call", function: "close_file", args: [] },
        ],
        explanation: "flush then close",
      },
    ];

    const merged = deduplicateCandidates(candidates);

    expect(merged.length).toBe(2);
    // Each has its own evidenceSources
    for (const m of merged) {
      expect(m.evidenceSources!.length).toBe(1);
    }
  });
});

// ════════════════════════════════════════════════════════
// Test 3: Ranking mode switching
// ════════════════════════════════════════════════════════

describe("Test 3: Ranking mode switching", () => {
  const safeCandidate: RepairCandidate = {
    id: "safe", source: "protocol",
    actions: [
      { kind: "call", function: "open_file", args: [] },
      { kind: "call", function: "write_file", args: [] },
      { kind: "call", function: "close_file", args: [] },
    ],
    explanation: "Safe: full open-write-close sequence",
  };

  const fastCandidate: RepairCandidate = {
    id: "fast", source: "corpus",
    actions: [
      { kind: "call", function: "atomic_write", args: [] },
    ],
    explanation: "Fast: single atomic operation",
    evidence: 42,
    metadata: { historicalSuccessRate: 0.99, corpusEvidenceCount: 42 },
  };

  const safeFeatures: CandidateFeatures = {
    protocolSafety: 1.0,
    historicalSuccessRate: 0.5,
    actionCount: 3,
    latencyCost: 0.6,
    auditability: 0.8,
    corpusEvidence: 0,
    source: "protocol",
    goalMatch: 0,
  };

  const fastFeatures: CandidateFeatures = {
    protocolSafety: 0.7,
    historicalSuccessRate: 0.99,
    actionCount: 1,
    latencyCost: 0.1,
    auditability: 0.5,
    corpusEvidence: 42,
    source: "corpus",
    goalMatch: 0,
  };

  it("ranks safe higher under safety objective", () => {
    const ranker = createLinearRanker();
    const ranked = ranker.rankSafety(
      [fastCandidate, safeCandidate],
      [fastFeatures, safeFeatures]
    );
    expect(ranked[0].id).toBe("safe");
  });

  it("ranks fast higher under performance objective", () => {
    const ranker = createLinearRanker();
    const ranked = ranker.rankPerformance(
      [safeCandidate, fastCandidate],
      [safeFeatures, fastFeatures]
    );
    expect(ranked[0].id).toBe("fast");
  });

  it("different objectives produce different orderings", () => {
    const ranker = createLinearRanker();

    const bySafety = ranker.rankSafety(
      [safeCandidate, fastCandidate],
      [safeFeatures, fastFeatures]
    );
    const byPerf = ranker.rankPerformance(
      [safeCandidate, fastCandidate],
      [safeFeatures, fastFeatures]
    );

    // Same candidates, different orderings
    expect(bySafety[0].id).not.toBe(byPerf[0].id);
  });

  it("future RewardModelRanker would use same interface", () => {
    // The Ranker interface is { score(features: CandidateFeatures): number }
    // Any implementation works — linear weights, learned model, etc.
    const ranker = createLinearRanker();
    const score = ranker.score(safeFeatures);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════
// Test 4: P4 pre-burial — feedback + cost persistence
// ════════════════════════════════════════════════════════

// Set env BEFORE importing from failure-corpus
const FEEDBACK_DIR = path.resolve(__dirname, "..", "test-evolution-feedback");
process.env.PROGMUNE_PROJECT_DIR = FEEDBACK_DIR;
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
fs.mkdirSync(path.join(FEEDBACK_DIR, ".progmune_corpus"), { recursive: true });
fs.mkdirSync(
  path.join(FEEDBACK_DIR, ".progmune_corpus", "trajectories"),
  { recursive: true }
);

import { recordTrajectory, loadTrajectories, getRepairStats } from "./failure-corpus";

// ── Wait helper (recordTrajectory writes via setImmediate) ──
function flushWrites(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe("Test 4: P4 pre-burial", () => {
  it("feedback {accepted, rejected} survives write→read roundtrip", async () => {
    const uniqueSig = `test-evo-accepted-${Date.now()}`;
    recordTrajectory({
      protocol: "FileProtocol",
      initialState: ["FILE_OPEN"],
      finalState: [],
      trajectory: ["open_file", "write_file", "close_file"],
      result: "repair",
      violationType: "resource_leak",
      violationDesc: uniqueSig,
      fixPath: ["close_file"],
      successRate: 1.0,
      source: "planner",
      feedback: { accepted: true, rejected: false },
      cost: { latency: 12, actions: 3 },
    });
    await flushWrites();

    const loaded = loadTrajectories();
    const repair = loaded.find(
      t => t.result === "repair" && t.violation?.description === uniqueSig
    );

    expect(repair).toBeDefined();
    expect(repair!.feedback?.accepted).toBe(true);
    expect(repair!.feedback?.rejected).toBe(false);
    expect(repair!.cost?.latency).toBe(12);
    expect(repair!.cost?.actions).toBe(3);
  });

  it("rejected repair is also recorded", async () => {
    const uniqueSig = `test-evo-rejected-${Date.now()}`;
    recordTrajectory({
      protocol: "FileProtocol",
      initialState: ["FILE_OPEN"],
      finalState: ["FILE_OPEN"],
      trajectory: ["open_file", "write_file"],
      result: "repair",
      violationType: "resource_leak",
      violationDesc: uniqueSig,
      fixPath: ["close_file"],
      successRate: 0.0,
      source: "llm",
      feedback: { accepted: false, rejected: true },
      cost: { latency: 7, actions: 2 },
    });
    await flushWrites();

    const loaded = loadTrajectories();
    const rejected = loaded.filter(
      t => t.result === "repair" && t.feedback?.rejected === true && t.violation?.description === uniqueSig
    );

    expect(rejected.length).toBe(1);
    expect(rejected[0].cost?.latency).toBe(7);
  });

  it("getRepairStats aggregates feedback for P4 Reward Model", async () => {
    recordTrajectory({
      protocol: "AuthProtocol",
      initialState: ["UNAUTHENTICATED"],
      finalState: ["SESSION_ACTIVE"],
      trajectory: ["verify_password", "generate_jwt", "create_session"],
      result: "repair",
      violationType: "missing_prerequisite",
      violationDesc: "Skipped verification",
      fixPath: ["verify_password"],
      successRate: 1.0,
      source: "planner",
      feedback: { accepted: true, rejected: false },
      cost: { latency: 25, actions: 3 },
    });
    await flushWrites();

    const stats = getRepairStats();

    expect(stats.totalRepairs).toBeGreaterThanOrEqual(3);
    expect(stats.acceptedRepairs).toBeGreaterThanOrEqual(2);
    expect(stats.rejectedRepairs).toBeGreaterThanOrEqual(1);
    expect(stats.acceptanceRate).toBeGreaterThan(0);
    expect(stats.acceptanceRate).toBeLessThanOrEqual(1);
    expect(stats.avgLatency).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════
// Test 5: Goal → Repair → Feedback → Corpus closed loop
// ════════════════════════════════════════════════════════

// Separate corpus dir for the flywheel test
const FLYWHEEL_DIR = path.resolve(__dirname, "..", "test-evolution-flywheel");
fs.mkdirSync(FLYWHEEL_DIR, { recursive: true });
const flywheelCorpus = path.join(FLYWHEEL_DIR, ".progmune_corpus");
fs.mkdirSync(flywheelCorpus, { recursive: true });
fs.mkdirSync(path.join(flywheelCorpus, "trajectories"), { recursive: true });

describe("Test 5: Goal → Repair → Feedback → Corpus flywheel", () => {
  it("accepted repair feeds back into corpus as future evidence", async () => {
    // Point to flywheel corpus for this test
    process.env.PROGMUNE_PROJECT_DIR = FLYWHEEL_DIR;
    const flywheelId = `flywheel-accepted-${Date.now()}`;

    // Step 1: Generate a repair plan via the Planner
    const rules = fileProtocolRules();
    const alts = await suggestAlternatives({
      violation: {
        svl: 4,
        violatedConstraint: "resource_leak",
        actionIndex: 2,
        currentStates: ["FILE_OPEN"],
        requiredStates: [],
        description: "File not closed after write",
      },
      protocol: "_global",
      currentState: ["FILE_OPEN"],
      targetState: [],
      constraints: [],
      rules,
    });

    expect(alts.length).toBeGreaterThan(0);
    const topRepair = alts[0];

    // Step 2: Simulate user accepting the repair
    recordTrajectory({
      protocol: "FileProtocol",
      initialState: ["FILE_OPEN"],
      finalState: [],
      trajectory: ["open_file", "write_file", ...topRepair.fixPath],
      result: "repair",
      violationType: "resource_leak",
      violationDesc: flywheelId,
      fixPath: topRepair.fixPath,
      successRate: 1.0,
      source: "planner",
      intent: "safely write config file",
      feedback: { accepted: true, rejected: false },
      cost: { latency: 15, actions: topRepair.fixPath.length + 2 },
    });
    await flushWrites();

    // Step 3: Verify corpus has the accepted repair
    const loaded = loadTrajectories();
    const repairs = loaded.filter(
      t => t.result === "repair" && t.violation?.description === flywheelId
    );

    expect(repairs.length).toBe(1);
    expect(repairs[0].feedback?.accepted).toBe(true);
    expect(repairs[0].metadata.intent).toBe("safely write config file");
    expect(repairs[0].violation?.fixPath?.length).toBeGreaterThan(0);

    // Step 4: The flywheel is spinning
    // Goal → Planner → Repair → Accepted → Corpus → (future) Planner
    const stats = {
      accepted: repairs.length,
      hasIntent: repairs.filter(r => r.metadata.intent).length,
      hasFixPath: repairs.filter(r => r.violation?.fixPath?.length).length,
    };
    expect(stats.accepted).toBeGreaterThanOrEqual(1);
    expect(stats.hasIntent).toBeGreaterThanOrEqual(1);
    expect(stats.hasFixPath).toBeGreaterThanOrEqual(1);
  });

  it("rejected repair also feeds the flywheel (negative signal)", async () => {
    process.env.PROGMUNE_PROJECT_DIR = FLYWHEEL_DIR;
    const flywheelId = `flywheel-rejected-${Date.now()}`;

    recordTrajectory({
      protocol: "FileProtocol",
      initialState: ["FILE_OPEN"],
      finalState: ["FILE_OPEN"], // still open — repair failed
      trajectory: ["open_file", "write_file"],
      result: "repair",
      violationType: "resource_leak",
      violationDesc: flywheelId,
      fixPath: [],
      successRate: 0.0,
      source: "llm",
      intent: "safely write config file",
      feedback: { accepted: false, rejected: true },
      cost: { latency: 8, actions: 2 },
    });
    await flushWrites();

    const loaded = loadTrajectories();
    const myRecord = loaded.filter(t => t.violation?.description === flywheelId);

    expect(myRecord.length).toBe(1);
    expect(myRecord[0].feedback?.accepted).toBe(false);
    expect(myRecord[0].feedback?.rejected).toBe(true);

    // Both signals present — P4 Reward Model can learn from both
    const allRepairs = loaded.filter(t => t.result === "repair");
    const accepted = allRepairs.filter(t => t.feedback?.accepted === true).length;
    const rejected = allRepairs.filter(t => t.feedback?.rejected === true).length;
    expect(accepted).toBeGreaterThanOrEqual(1);
    expect(rejected).toBeGreaterThanOrEqual(1);
  });
});
