/**
 * P7.2: Topology Representation Tests
 */

import { describe, it, expect } from "vitest";
import { runTopologyExperiment, printTopologyReport, buildTopologyGraph, TopologyGraph, fingerprintRepo } from "./topology-representation";

describe("Topology Graph", () => {
  it("builds DAG from linear sequence", () => {
    const g = buildTopologyGraph(["A", "B", "C"]);
    expect(g.nodeCount).toBe(3);
    expect(g.edgeCount).toBe(2);
    expect(g.sources.length).toBe(1); // A: in=0
    expect(g.sinks.length).toBe(1);   // C: out=0
    expect(g.isDAG).toBe(true);
    expect(g.diameter).toBe(2);
  });
});

describe("P7.2 Topology Experiment", () => {
  it("measures cross-repo similarity with pure topology (no names)", () => {
    const report = runTopologyExperiment();

    expect(report.baseline).toBeGreaterThan(0);
    expect(report.topologyOnly).toBeGreaterThanOrEqual(0);
    expect(report.topologyOnly).toBeLessThanOrEqual(1);

    printTopologyReport(report);
  });
});
