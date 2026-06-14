"use strict";
/**
 * P7.2: Topology Representation Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const topology_representation_1 = require("./topology-representation");
(0, vitest_1.describe)("Topology Graph", () => {
    (0, vitest_1.it)("builds DAG from linear sequence", () => {
        const g = (0, topology_representation_1.buildTopologyGraph)(["A", "B", "C"]);
        (0, vitest_1.expect)(g.nodeCount).toBe(3);
        (0, vitest_1.expect)(g.edgeCount).toBe(2);
        (0, vitest_1.expect)(g.sources.length).toBe(1); // A: in=0
        (0, vitest_1.expect)(g.sinks.length).toBe(1); // C: out=0
        (0, vitest_1.expect)(g.isDAG).toBe(true);
        (0, vitest_1.expect)(g.diameter).toBe(2);
    });
});
(0, vitest_1.describe)("P7.2 Topology Experiment", () => {
    (0, vitest_1.it)("measures cross-repo similarity with pure topology (no names)", () => {
        const report = (0, topology_representation_1.runTopologyExperiment)();
        (0, vitest_1.expect)(report.baseline).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.topologyOnly).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.topologyOnly).toBeLessThanOrEqual(1);
        (0, topology_representation_1.printTopologyReport)(report);
    });
});
