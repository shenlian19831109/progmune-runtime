/**
 * P8.0 unit: Name-Free Protocol edge cases
 * Empty graphs, self-loops, single-node, and renaming invariance.
 */
import { describe, it, expect } from "vitest";
import {
  extractNameFreeStateGraph,
  computeTopologyFingerprint,
  fingerprintSimilarity,
} from "../../src/name-free-protocol";

describe("NameFreeProtocol edge cases", () => {
  it("handles empty graph (no sequences)", () => {
    const graph = extractNameFreeStateGraph([]);
    const fp = computeTopologyFingerprint(graph);
    expect(fp.nodeCount).toBe(0);
    expect(fp.edgeCount).toBe(0);
    expect(fp.stateCount).toBe(0);
  });

  it("handles single-sequence, single-function graph", () => {
    const graph = extractNameFreeStateGraph([["only"]]);
    const fp = computeTopologyFingerprint(graph);
    expect(fp.nodeCount).toBe(1);
    expect(fp.edgeCount).toBe(0); // no transitions
    expect(fp.isDAG).toBe(true);
  });

  it("handles self-loop pattern (multiple identical calls)", () => {
    // process → process pattern
    const graph = extractNameFreeStateGraph([
      ["init", "process", "process", "process", "exit"],
    ]);
    const fp = computeTopologyFingerprint(graph);
    expect(fp.nodeCount).toBeGreaterThan(0);
    // process should appear as a self-loop or repeat transition
    expect(fp.edgeCount).toBeGreaterThan(0);
  });

  it("is invariant under node renaming (same topology, different names)", () => {
    const seqsA = [["alpha", "beta", "gamma"], ["alpha", "delta", "gamma"]];
    const seqsB = [["F001", "F002", "F003"], ["F001", "F004", "F003"]];

    const fpA = computeTopologyFingerprint(extractNameFreeStateGraph(seqsA));
    const fpB = computeTopologyFingerprint(extractNameFreeStateGraph(seqsB));

    // Same structure → identical fingerprint
    expect(fpA.nodeCount).toBe(fpB.nodeCount);
    expect(fpA.edgeCount).toBe(fpB.edgeCount);
    expect(fpA.stateCount).toBe(fpB.stateCount);
    expect(fpA.isDAG).toBe(fpB.isDAG);
    expect(fingerprintSimilarity(fpA, fpB)).toBe(1.0);
  });

  it("handles single-edge graph (two functions)", () => {
    const graph = extractNameFreeStateGraph([["start", "finish"]]);
    const fp = computeTopologyFingerprint(graph);
    expect(fp.nodeCount).toBe(2);
    expect(fp.edgeCount).toBe(1);
    expect(fp.entryPointCount).toBe(1);
    expect(fp.exitPointCount).toBe(1);
  });

  it("handles disconnected sequences (separate protocols)", () => {
    // Two completely separate protocols in same repo
    const graph = extractNameFreeStateGraph([
      ["open", "read", "close"],
      ["begin", "commit"],
    ]);
    const fp = computeTopologyFingerprint(graph);
    expect(fp.componentCount).toBeGreaterThanOrEqual(2);
  });
});
