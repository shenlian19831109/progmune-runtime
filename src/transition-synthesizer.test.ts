/**
 * P3.18-20: Transition Synthesizer Tests
 */

import { describe, it, expect } from "vitest";
import {
  synthesizeTransitions, augmentRulesWithInferences,
  generateGapBenchmarks, writeGapBenchmarks,
  trackCandidateOrigin, computeEnhancedScores,
  printSynthesizerReport, printCandidateOriginStats,
} from "./transition-synthesizer";
import type { ProtocolDefinition } from "./protocol-coverage";
import type { StateAnnotation } from "./ssg-validator";

function makeProtocols(): ProtocolDefinition[] {
  const rules = new Map<string, StateAnnotation>();
  rules.set("verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] });
  rules.set("generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] });
  rules.set("create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] });
  rules.set("logout", { pre_states: ["SESSION_ACTIVE"], post_states: ["UNAUTHENTICATED"], invalidate: ["SESSION_ACTIVE"] });
  rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
  rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: ["FILE_DIRTY"] });
  rules.set("flush_file", { pre_states: ["FILE_DIRTY"], post_states: ["FILE_FLUSHED"] });
  rules.set("close_file", { pre_states: ["FILE_OPEN", "FILE_DIRTY", "FILE_FLUSHED"], post_states: [], invalidate: ["FILE_OPEN", "FILE_DIRTY", "FILE_FLUSHED"] });
  rules.set("connect_db", { pre_states: [], post_states: ["DB_CONNECTED"] });
  rules.set("query_db", { pre_states: ["DB_CONNECTED"], post_states: [] });
  rules.set("disconnect_db", { pre_states: ["DB_CONNECTED"], post_states: [], invalidate: ["DB_CONNECTED"] });

  return [{
    name: "AuthProtocol", states: ["UNAUTHENTICATED", "PASSWORD_VERIFIED", "TOKEN_ISSUED", "SESSION_ACTIVE"],
    initialState: "UNAUTHENTICATED",
    transitions: [], rules: new Map([...rules].filter(([k]) => ["verify_password", "generate_jwt", "create_session", "logout"].includes(k))),
  }, {
    name: "FileProtocol", states: ["FILE_OPEN", "FILE_DIRTY", "FILE_FLUSHED"],
    initialState: "INIT",
    transitions: [], rules: new Map([...rules].filter(([k]) => ["open_file", "write_file", "flush_file", "close_file"].includes(k))),
  }, {
    name: "DBProtocol", states: ["DB_CONNECTED"],
    initialState: "INIT",
    transitions: [], rules: new Map([...rules].filter(([k]) => ["connect_db", "query_db", "disconnect_db"].includes(k))),
  }];
}

describe("Transition Synthesizer", () => {
  it("infers transitions from benchmark failures", () => {
    // open_file→flush_file: FILE_OPEN ≠ FILE_DIRTY → genuinely missing transition
    // write_file→close_file: FILE_DIRTY → close_file needs FILE_OPEN/FILE_DIRTY/FILE_FLUSHED → connected
    // But open_file→flush_file is NOT connected (FILE_OPEN vs FILE_DIRTY)
    const failures = [
      { goal: "flush after open without write", protocol: "FileProtocol", expectedRepair: ["open_file", "flush_file"] },
      { goal: "flush after open v2", protocol: "FileProtocol", expectedRepair: ["open_file", "flush_file"] },
    ];

    const inferences = synthesizeTransitions(failures, makeProtocols());

    expect(inferences.length).toBeGreaterThan(0);

    // open_file→flush_file should be inferred (FILE_OPEN → FILE_DIRTY gap)
    const hasOpenFlush = inferences.some(i => i.action.includes("open_file → flush_file"));
    expect(hasOpenFlush).toBe(true);

    // Confidence: appears 2x
    const top = inferences[0];
    expect(top.confidence).toBeGreaterThan(0.5);

    printSynthesizerReport(inferences);
  });

  it("augments rules with inferred transitions", () => {
    const failures = [
      { goal: "flush after open", protocol: "FileProtocol", expectedRepair: ["open_file", "flush_file"] },
    ];
    const inferences = synthesizeTransitions(failures, makeProtocols());
    const fileProto = makeProtocols().find(p => p.name === "FileProtocol")!;
    const augmented = augmentRulesWithInferences(fileProto.rules, inferences);

    // Should have the original rules plus inferred bridges
    expect(augmented.size).toBeGreaterThan(fileProto.rules.size);
    // Should contain an inferred bridge
    const hasBridge = [...augmented.keys()].some(k => k.startsWith("_inferred_"));
    expect(hasBridge).toBe(true);
  });

  it("generates gap-driven benchmarks", () => {
    const failures = [
      { goal: "flush after open", protocol: "FileProtocol", expectedRepair: ["open_file", "flush_file"] },
    ];
    const inferences = synthesizeTransitions(failures, makeProtocols());

    const cases = generateGapBenchmarks(inferences);
    expect(cases.length).toBeGreaterThan(0);

    // Each case targets a specific gap
    for (const c of cases) {
      expect(c.targetsGap.length).toBeGreaterThan(0);
      expect(c.broken.length).toBeGreaterThan(0);
      expect(c.expected.length).toBeGreaterThan(0);
    }

    // Write to disk
    const fp = writeGapBenchmarks(cases);
    expect(fp).toContain("transition_gaps_");
  });
});

describe("Candidate Origin Tracking", () => {
  it("tracks origin stats", () => {
    const candidates = [
      { metadata: { source: "frontier" }, fixPath: ["close_file"] },
      { metadata: { source: "goal_template" }, fixPath: ["verify_password", "generate_jwt"] },
      { metadata: { source: "frontier" }, fixPath: ["open_file", "close_file"] },
      { metadata: { source: "corpus" }, fixPath: ["connect_db", "query_db", "disconnect_db"] },
    ];

    const stats = trackCandidateOrigin(candidates);
    expect(stats.length).toBe(3); // frontier, goal_template, corpus

    const frontier = stats.find(s => s.origin === "frontier")!;
    expect(frontier.count).toBe(2);

    printCandidateOriginStats(stats);
  });
});

describe("Enhanced Knowledge Score", () => {
  it("includes discoveryRate", () => {
    const scores = computeEnhancedScores(
      ["FileProtocol", "AuthProtocol", "DBProtocol"],
      [
        { protocol: "FileProtocol", stateCoverage: 0.6, transitionCoverage: 0.5 },
        { protocol: "AuthProtocol", stateCoverage: 0.8, transitionCoverage: 0.7 },
        { protocol: "DBProtocol", stateCoverage: 0.3, transitionCoverage: 0.2 },
      ],
      {
        FileProtocol: { total: 20, passed: 10 },
        AuthProtocol: { total: 15, passed: 8 },
        DBProtocol: { total: 10, passed: 2 },
      },
      {
        FileProtocol: { total: 20, found: 15 },
        AuthProtocol: { total: 15, found: 12 },
        DBProtocol: { total: 10, found: 3 },
      }
    );

    expect(scores.length).toBe(3);

    // AuthProtocol should have highest score (better coverage + success)
    expect(scores[0].protocol).toBe("AuthProtocol");
    expect(scores[0].discoveryRate).toBeGreaterThan(0.5);

    // DBProtocol should have lowest discovery rate
    const db = scores.find(s => s.protocol === "DBProtocol")!;
    expect(db.discoveryRate).toBe(0.3);
  });
});
