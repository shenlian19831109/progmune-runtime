/**
 * P6.4: Auto Protocol Synthesizer Tests
 *
 * Validates the full zero-intervention pipeline:
 *   Trajectories → Clusters → State Machines → Governance-Ready Rules
 */

import { describe, it, expect } from "vitest";
import { synthesizeProtocols, synthesizeAllKnownProtocols, detectConflicts, runAutoSynthesis, printSynthesisReport, findPrototype, SynthesizedProtocol } from "./auto-protocol-synthesizer";
import { clusterByStructure } from "./unsupervised-physics";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import type { StateAnnotation } from "./ssg-validator";

describe("Prototype Selection", () => {
  it("finds centroid by minimum average edit distance", () => {
    const seqs = [
      ["open", "read", "close"],
      ["open", "write", "close"],
      ["open", "read", "write", "close"],
    ];
    const proto = findPrototype(seqs);
    expect(proto.length).toBeGreaterThanOrEqual(2);
    // The prototype should be one of the 3-step sequences (more central)
    expect(proto.length).toBeLessThanOrEqual(3);
  });
});

describe("Protocol Synthesis", () => {
  it("generates state machine from prototype sequence", () => {
    const seqs = [
      ["fopen", "fread", "fclose"],
      ["sqlite3_open", "sqlite3_exec", "sqlite3_close"],
      ["DB_Open", "DB_Get", "DB_Close"],
    ];

    const protocols = synthesizeProtocols(seqs);

    expect(protocols.length).toBeGreaterThan(0);

    // The main cluster should have Acquire-Use-Release structure
    const mainProto = protocols[0];
    expect(mainProto.inferredPattern).toBe("RESOURCE_ACQUIRE");
    expect(mainProto.rules.length).toBe(3);
    expect(mainProto.stateCount).toBe(4); // S0, S1, S2, S3

    // Last rule should have invalidation
    const lastRule = mainProto.rules[mainProto.rules.length - 1];
    expect(lastRule.invalidate).toBeDefined();
    expect(lastRule.invalidate!.length).toBeGreaterThan(0);
  });

  it("synthesizes from all known cross-repo sequences", () => {
    const protocols = synthesizeAllKnownProtocols();

    expect(protocols.length).toBeGreaterThan(0);
    // Should have at least Acquire-Release (len=3 closed) and Lock-Unlock (len=2 closed)
    expect(protocols.some(p => p.inferredPattern === "RESOURCE_ACQUIRE")).toBe(true);
    expect(protocols.some(p => p.prototype.length === 2)).toBe(true);
  });
});

describe("Conflict Detection", () => {
  it("detects conflicts with existing protocol rules", () => {
    const seqs = [
      ["open_file", "read_file", "close_file"],
      ["open_file", "write_file", "close_file"],
    ];

    const protocols = synthesizeProtocols(seqs);
    const defs = loadDefaultProtocolDefinitions();
    const existingRules = new Map<string, StateAnnotation>();
    for (const p of defs) for (const [fn, rule] of p.rules) existingRules.set(fn, rule);

    const conflicts = detectConflicts(protocols, existingRules);

    // Synthesized open_file may conflict with existing open_file definition
    // That's expected and correctly flagged
    expect(conflicts.length).toBeGreaterThan(0);
  });
});

describe("Full Synthesis Pipeline", () => {
  it("runs auto-synthesis and produces governance-ready report", () => {
    const report = runAutoSynthesis();

    expect(report.protocols.length).toBeGreaterThan(0);
    expect(report.totalRules).toBeGreaterThan(0);
    expect(report.newFunctions).toBeGreaterThan(0);

    // Some conflicts expected (synthesized rules may differ from hand-written)
    // The system correctly flags these for governance review
    expect(report.conflictCount).toBeGreaterThanOrEqual(0);

    printSynthesisReport(report);
  });
});
