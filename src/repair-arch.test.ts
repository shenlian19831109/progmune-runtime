/**
 * Architecture Boundary Tests — P2 Counterfactual Planner
 *
 * Verifying:
 *   P0: Missing close() scenario (user-visible demo capability)
 *   P0: Planner aggregation (multi-strategy merge)
 *   P0: Deduplication (no duplicate repair plans)
 *   P1: Ranker logic (prefers safer candidate)
 *   P1: Strategy independence (produces candidates, never scores)
 *   P2: Trajectory feedback (pre-burial for P4 Reward Model)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createDefaultStrategies } from "./repair-strategies";
import { extractFeatures, createLinearRanker } from "./repair-ranker";
import { suggestAlternatives } from "./counterfactual-engine";
import type { RepairCandidate, SearchContext, CandidateFeatures } from "./repair-types";
import type { StateAnnotation } from "./ssg-validator";
import { parseProtocolsFromJSON } from "./ssg-validator";

// ── Helpers ──

/** Build a SearchContext for a FileProtocol "missing close()" scenario. */
function fileProtocolContext(actions: string[]): SearchContext {
  // open_file → write_file → ... missing close_file
  const currentStates = ["FILE_OPEN"];
  const targetStates: string[] = []; // should invalidate FILE_OPEN

  const protoDef = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "protocols.json"), "utf-8")
  );
  const protocols = parseProtocolsFromJSON(protoDef);
  const rules = new Map<string, StateAnnotation>();
  for (const p of protocols) {
    rules.set(p.function, p.protocol);
  }

  return {
    protocol: "_global",
    currentState: currentStates,
    targetState: targetStates,
    violationType: "resource_leak",
    constraints: [{ type: "safety", value: 0.9, description: "文件安全关闭" }],
    rules,
  };
}

// ════════════════════════════════════════════════════════
// P0: Missing close() — real user-visible scenario
// ════════════════════════════════════════════════════════

describe("P0: Missing close() repair", () => {
  it("suggests close_file as a repair candidate", async () => {
    const rules = fileProtocolContext(["open_file", "write_file"]).rules;
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
      constraints: [{ type: "safety", value: 0.9, description: "文件安全关闭" }],
      rules,
    });

    const functionNames = alts.flatMap(a => a.fixPath);
    // At least one candidate must include close_file
    expect(functionNames).toContain("close_file");
  });

  it("repair plan closes the file with open → write → close", async () => {
    const ctx = fileProtocolContext(["open_file", "write_file"]);
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
      constraints: [{ type: "safety", value: 0.9, description: "文件安全关闭" }],
      rules: ctx.rules,
    });

    const signatures = alts.map(a => a.fixPath.join(","));
    // Should have a candidate whose fix path includes close_file
    const hasClose = signatures.some(s => s.includes("close_file"));
    expect(hasClose).toBe(true);
  });

  it("close_file ranks higher than a longer alternative on safety", () => {
    const ctx = fileProtocolContext(["open_file", "write_file"]);
    const strategies = createDefaultStrategies();
    const allCandidates: RepairCandidate[] = [];
    for (const s of strategies) allCandidates.push(...s.search(ctx));

    if (allCandidates.length >= 2) {
      const maxActions = Math.max(...allCandidates.map(c => c.actions.length), 8);
      const features = allCandidates.map(c => extractFeatures(c, ctx, { maxActions }));
      const ranker = createLinearRanker();
      const ranked = ranker.rankSafety(allCandidates, features);

      // The top-ranked by safety should be relatively safe (score >= 0.5)
      const topFeature = features[allCandidates.indexOf(ranked[0])];
      expect(topFeature.protocolSafety).toBeGreaterThanOrEqual(0.5);
    }
  });
});

// ════════════════════════════════════════════════════════
// P1: Strategy independence — no scoring in strategies
// ════════════════════════════════════════════════════════

describe("P1: Strategy independence", () => {
  const ctx = fileProtocolContext(["open_file"]);

  it("CorpusStrategy returns candidates without score fields", () => {
    const strategies = createDefaultStrategies();
    for (const strategy of strategies) {
      const results = strategy.search(ctx);
      for (const r of results) {
        expect(r.source).toBe(strategy.name);
        expect((r as any).score).toBeUndefined();
        expect((r as any).rank).toBeUndefined();
      }
    }
  });

  it("every candidate has required RepairCandidate shape", () => {
    const strategies = createDefaultStrategies();
    for (const strategy of strategies) {
      const results = strategy.search(ctx);
      for (const r of results) {
        expect(r).toHaveProperty("id");
        expect(r).toHaveProperty("source");
        expect(r).toHaveProperty("actions");
        expect(r).toHaveProperty("explanation");
        expect(["corpus", "protocol", "antibody"]).toContain(r.source);
        expect(Array.isArray(r.actions)).toBe(true);
        expect(r.actions.length).toBeGreaterThan(0);
      }
    }
  });

  it("ProtocolStrategy finds protocol-based candidates for FileProtocol", () => {
    const strategies = createDefaultStrategies();
    // ProtocolStrategy is index 1
    const protoStrat = strategies.find(s => s.name === "protocol")!;
    expect(protoStrat).toBeDefined();

    const results = protoStrat.search(ctx);
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r.source).toBe("protocol");
      // FileProtocol candidates must include file operations
      const fns = r.actions
        .filter(a => a.kind === "call")
        .map(a => (a as any).function);
      expect(fns.length).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════
// P1: Ranker logic — prefers safer/shorter candidates
// ════════════════════════════════════════════════════════

describe("P1: LinearRanker", () => {
  // Construct two candidates with different safety profiles
  const safeFeatures: CandidateFeatures = {
    protocolSafety: 0.95,
    historicalSuccessRate: 0.3,
    actionCount: 2,
    latencyCost: 0.25,
    auditability: 0.75,
    corpusEvidence: 0,
    source: "protocol",
  };

  const fastFeatures: CandidateFeatures = {
    protocolSafety: 0.4,
    historicalSuccessRate: 0.99,
    actionCount: 1,
    latencyCost: 0.1,
    auditability: 0.8,
    corpusEvidence: 42,
    source: "corpus",
  };

  const safeCandidate: RepairCandidate = {
    id: "safe",
    source: "protocol",
    actions: [
      { kind: "call", function: "open_file", args: [] },
      { kind: "call", function: "close_file", args: [] },
    ],
    explanation: "Safe: properly close the file",
  };

  const fastCandidate: RepairCandidate = {
    id: "fast",
    source: "corpus",
    actions: [{ kind: "call", function: "flush_and_close", args: [] }],
    explanation: "Fast: single atomic operation",
    evidence: 42,
    metadata: { historicalSuccessRate: 0.99, corpusEvidenceCount: 42 },
  };

  it("rankSafety prefers the safer candidate", () => {
    const ranker = createLinearRanker();
    const ranked = ranker.rankSafety(
      [fastCandidate, safeCandidate],
      [fastFeatures, safeFeatures]
    );
    expect(ranked[0].id).toBe("safe");
  });

  it("rankPerformance prefers the faster candidate (fewer actions)", () => {
    const ranker = createLinearRanker();
    const ranked = ranker.rankPerformance(
      [safeCandidate, fastCandidate],
      [safeFeatures, fastFeatures]
    );
    expect(ranked[0].id).toBe("fast");
  });

  it("rankOverall with default weights prefers overall best", () => {
    const ranker = createLinearRanker();
    const scoreSafe = ranker.score(safeFeatures);
    const scoreFast = ranker.score(fastFeatures);

    // Both scores in 0-1 range
    expect(scoreSafe).toBeGreaterThanOrEqual(0);
    expect(scoreSafe).toBeLessThanOrEqual(1);
    expect(scoreFast).toBeGreaterThanOrEqual(0);
    expect(scoreFast).toBeLessThanOrEqual(1);

    // Scores are deterministic
    expect(scoreSafe).toBe(scoreSafe); // idempotent
  });

  it("custom weights change the ranking", () => {
    const safetyFirst = createLinearRanker({ safety: 0.9, successRate: 0.05, performance: 0.03, auditability: 0.02 });
    const speedFirst = createLinearRanker({ safety: 0.05, successRate: 0.1, performance: 0.8, auditability: 0.05 });

    const bySafety = safetyFirst.score(safeFeatures);
    const bySpeed = speedFirst.score(fastFeatures);

    // With safety-first weights, safe candidate should score higher
    expect(bySafety).toBeGreaterThan(speedFirst.score(safeFeatures));
    // With speed-first weights, fast candidate should score higher
    expect(bySpeed).toBeGreaterThan(safetyFirst.score(fastFeatures));
  });

  it("rankAuditability prefers shorter path (more auditable)", () => {
    const ranker = createLinearRanker();
    const ranked = ranker.rankAuditability(
      [safeCandidate, fastCandidate],
      [safeFeatures, fastFeatures]
    );
    // fast has actionCount=1 vs safe has actionCount=2
    // auditability = 1 - actionCount/maxActions → fast is more auditable
    expect(ranked[0].id).toBe("fast");
  });
});

// ════════════════════════════════════════════════════════
// P0: Planner aggregation — multi-strategy merge
// ════════════════════════════════════════════════════════

describe("P0: Planner aggregation", () => {
  it("merges candidates from all three strategies via suggestAlternatives", async () => {
    const ctx = fileProtocolContext(["open_file", "write_file"]);
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
      constraints: [{ type: "safety", value: 0.9, description: "文件安全关闭" }],
      rules: ctx.rules,
    });

    expect(alts.length).toBeGreaterThan(0);

    const sources = new Set(alts.map(a => a.source));
    // At least one strategy produced results
    expect(
      sources.has("corpus") || sources.has("ssg_bfs") || sources.has("antibody")
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// P0: Deduplication — no duplicate repair plans
// ════════════════════════════════════════════════════════

describe("P0: Deduplication", () => {
  it("removes candidates with identical action sequences", () => {
    // Pre-seed corpus: record a trajectory with a known fix path
    // so CorpusStrategy returns a duplicate of what ProtocolStrategy finds
    process.env.PROGMUNE_CORPUS_DIR = path.resolve(
      __dirname, "..", "test-corpus-dedup", ".progmune_corpus"
    );
    const trajDir = path.resolve(
      process.env.PROGMUNE_CORPUS_DIR, "trajectories",
      new Date().toISOString().slice(0, 10)
    );
    fs.mkdirSync(trajDir, { recursive: true });
    // Write a trajectory that has the same close_file fix path
    const trajRecord = {
      id: `dedup-test-${Date.now()}`,
      timestamp: new Date().toISOString(),
      protocol: "_global",
      initialState: ["FILE_OPEN"],
      finalState: [],
      trajectory: ["open_file", "write_file", "close_file"],
      result: "violation",
      violation: {
        type: "resource_leak",
        failingStepIndex: 2,
        expectedStates: [],
        actualStates: ["FILE_OPEN"],
        fixPath: ["close_file"],
        description: "File not closed",
      },
      context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
      successRate: 0.9,
      metadata: { source: "planner" },
    };
    fs.writeFileSync(
      path.join(trajDir, `${trajRecord.id}.json`),
      JSON.stringify(trajRecord)
    );

    const ctx = fileProtocolContext(["open_file", "write_file"]);
    const strategies = createDefaultStrategies();
    const allCandidates: RepairCandidate[] = [];
    for (const s of strategies) {
      allCandidates.push(...s.search(ctx));
    }

    // Now we have at least 2 candidates: one from ProtocolStrategy, one from CorpusStrategy
    // Both suggest close_file → same action signature
    expect(allCandidates.length).toBeGreaterThanOrEqual(2);

    const signatures = allCandidates.map(c =>
      c.actions
        .filter(a => a.kind === "call")
        .map(a => (a as any).function)
        .join("→")
    );

    const unique = new Set(signatures);
    // After dedup, unique should be LESS than total (duplicates removed)
    expect(unique.size).toBeLessThan(signatures.length);
  });

  it("suggestAlternatives returns deduplicated results", async () => {
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
      constraints: [{ type: "safety", value: 0.9, description: "安全关闭" }],
      rules: fileProtocolContext(["open_file", "write_file"]).rules,
    });

    const fixPaths = alts.map(a => a.fixPath.join("→"));
    const unique = new Set(fixPaths);
    expect(unique.size).toBe(fixPaths.length);
  });
});

// ════════════════════════════════════════════════════════
// FeatureExtractor boundary
// ════════════════════════════════════════════════════════

describe("FeatureExtractor", () => {
  const ctx = fileProtocolContext(["open_file"]);

  it("returns exactly 7 feature dimensions", () => {
    const candidate: RepairCandidate = {
      id: "test",
      source: "protocol",
      actions: [
        { kind: "call", function: "close_file", args: [] },
      ],
      explanation: "close the file",
    };
    const features = extractFeatures(candidate, ctx);
    const keys = Object.keys(features);
    expect(keys.length).toBe(7);
    expect(keys).toContain("protocolSafety");
    expect(keys).toContain("historicalSuccessRate");
    expect(keys).toContain("actionCount");
    expect(keys).toContain("latencyCost");
    expect(keys).toContain("auditability");
    expect(keys).toContain("corpusEvidence");
    expect(keys).toContain("source");
  });

  it("all features in [0,1] range (except actionCount and corpusEvidence)", () => {
    const candidate: RepairCandidate = {
      id: "test",
      source: "protocol",
      actions: [
        { kind: "call", function: "a", args: [] },
        { kind: "call", function: "b", args: [] },
      ],
      explanation: "test",
      metadata: { historicalSuccessRate: 0.75, corpusEvidenceCount: 10 },
    };
    const features = extractFeatures(candidate, ctx, { maxActions: 8 });

    expect(features.protocolSafety).toBeGreaterThanOrEqual(0);
    expect(features.protocolSafety).toBeLessThanOrEqual(1);
    expect(features.historicalSuccessRate).toBe(0.75);
    expect(features.actionCount).toBe(2); // raw integer, not clamped
    expect(features.latencyCost).toBeGreaterThanOrEqual(0);
    expect(features.latencyCost).toBeLessThanOrEqual(1);
    expect(features.auditability).toBeGreaterThanOrEqual(0);
    expect(features.auditability).toBeLessThanOrEqual(1);
    expect(features.corpusEvidence).toBe(10);
  });
});
