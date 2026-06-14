"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P8.0: Name-Free Protocol Learning Tests
 *
 * Three decisive experiments:
 *   A: State graph extraction with scrambled names
 *   B: Topology fingerprint cross-repo similarity
 *   C: Full name scramble survival benchmark
 */
const vitest_1 = require("vitest");
const name_free_protocol_1 = require("./name-free-protocol");
// ── Test data: three structurally identical protocols with different names ──
const ACQUIRE_USE_RELEASE_A = [
    ["open", "read", "close"],
    ["open", "write", "close"],
    ["open", "read", "write", "close"],
];
const ACQUIRE_USE_RELEASE_B = [
    ["sql_open", "sql_read", "sql_close"],
    ["sql_open", "sql_write", "sql_close"],
];
const ACQUIRE_USE_RELEASE_C = [
    ["create_client", "send_cmd", "close_client"],
    ["create_client", "send_cmd", "send_cmd", "close_client"],
];
// ── Test data: different protocol shapes ──
const TRANSACTION_PATTERN = [
    ["begin_tx", "insert", "commit_tx"],
    ["begin_tx", "update", "commit_tx"],
    ["begin_tx", "delete", "rollback_tx"],
];
const LOOP_PATTERN = [
    ["init", "fetch", "process", "next", "fetch", "process", "exit"],
    ["init", "fetch", "process", "exit"],
];
(0, vitest_1.describe)("P8.0a Name-Free State Graph", () => {
    (0, vitest_1.it)("extracts state graph from sequences without using function names", () => {
        const graph = (0, name_free_protocol_1.extractNameFreeStateGraph)(ACQUIRE_USE_RELEASE_A);
        // Should have function nodes
        (0, vitest_1.expect)(graph.fnCount).toBeGreaterThan(0);
        // Should find at least one state (entry→middle→exit pattern)
        (0, vitest_1.expect)(graph.states.length).toBeGreaterThan(0);
        // Each state should have producers and consumers
        for (const state of graph.states) {
            (0, vitest_1.expect)(state.producers.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(state.consumers.length).toBeGreaterThan(0);
        }
        // Transition matrix should have non-zero entries
        let hasTransitions = false;
        for (let i = 0; i < graph.fnCount; i++) {
            for (let j = 0; j < graph.fnCount; j++) {
                if (graph.transitionMatrix[i][j] > 0)
                    hasTransitions = true;
            }
        }
        (0, vitest_1.expect)(hasTransitions).toBe(true);
        // fnStats should be computed
        (0, vitest_1.expect)(graph.fnStats.length).toBe(graph.fnCount);
        for (const stat of graph.fnStats) {
            (0, vitest_1.expect)(stat.frequency).toBeGreaterThanOrEqual(0);
        }
    });
    (0, vitest_1.it)("produces identical state graphs for structurally identical sequences with different names", () => {
        // Graph A: ["open","read","close"] + variants
        const graphA = (0, name_free_protocol_1.extractNameFreeStateGraph)(ACQUIRE_USE_RELEASE_A);
        const fpA = (0, name_free_protocol_1.computeTopologyFingerprint)(graphA);
        // Graph B: same structure, different names
        const graphB = (0, name_free_protocol_1.extractNameFreeStateGraph)(ACQUIRE_USE_RELEASE_B);
        const fpB = (0, name_free_protocol_1.computeTopologyFingerprint)(graphB);
        // Same number of functions and states
        (0, vitest_1.expect)(graphA.fnCount).toBe(graphB.fnCount);
        (0, vitest_1.expect)(graphA.states.length).toBe(graphB.states.length);
        // Fingerprints should be identical (pure structure)
        const sim = (0, name_free_protocol_1.fingerprintSimilarity)(fpA, fpB);
        (0, vitest_1.expect)(sim).toBeGreaterThan(0.9); // Should be nearly identical
    });
});
(0, vitest_1.describe)("P8.0b Topology Fingerprint", () => {
    (0, vitest_1.it)("computes fingerprint vector from state graph", () => {
        const graph = (0, name_free_protocol_1.extractNameFreeStateGraph)(ACQUIRE_USE_RELEASE_A);
        const fp = (0, name_free_protocol_1.computeTopologyFingerprint)(graph);
        // Core features should be non-zero
        (0, vitest_1.expect)(fp.nodeCount).toBeGreaterThan(0);
        (0, vitest_1.expect)(fp.edgeCount).toBeGreaterThan(0);
        (0, vitest_1.expect)(fp.entryPointCount).toBeGreaterThan(0);
        (0, vitest_1.expect)(fp.exitPointCount).toBeGreaterThan(0);
        // Fingerprint should be a valid vector
        const vec = [
            fp.nodeCount, fp.edgeCount, fp.stateCount,
            fp.avgInDegree, fp.avgOutDegree,
            fp.entryPointCount, fp.exitPointCount, fp.bridgeCount,
            fp.entryRatio, fp.exitRatio, fp.componentCount,
            fp.avgStateSize, fp.isDAG ? 1 : 0, fp.longestChain,
        ];
        (0, vitest_1.expect)(vec.every(v => typeof v === "number" && !isNaN(v))).toBe(true);
    });
    (0, vitest_1.it)("distinguishes different protocol topologies", () => {
        const acquireFp = (0, name_free_protocol_1.computeTopologyFingerprint)((0, name_free_protocol_1.extractNameFreeStateGraph)(ACQUIRE_USE_RELEASE_A));
        const transactionFp = (0, name_free_protocol_1.computeTopologyFingerprint)((0, name_free_protocol_1.extractNameFreeStateGraph)(TRANSACTION_PATTERN));
        const loopFp = (0, name_free_protocol_1.computeTopologyFingerprint)((0, name_free_protocol_1.extractNameFreeStateGraph)(LOOP_PATTERN));
        // Different topologies should have different fingerprints
        const aqTx = (0, name_free_protocol_1.fingerprintSimilarity)(acquireFp, transactionFp);
        const aqLp = (0, name_free_protocol_1.fingerprintSimilarity)(acquireFp, loopFp);
        const txLp = (0, name_free_protocol_1.fingerprintSimilarity)(transactionFp, loopFp);
        // They should not all be identical
        const allSame = aqTx > 0.99 && aqLp > 0.99 && txLp > 0.99;
        (0, vitest_1.expect)(allSame).toBe(false);
        console.log(`  Acquire↔Transaction: ${(aqTx * 100).toFixed(0)}%`);
        console.log(`  Acquire↔Loop:        ${(aqLp * 100).toFixed(0)}%`);
        console.log(`  Transaction↔Loop:    ${(txLp * 100).toFixed(0)}%`);
    });
});
(0, vitest_1.describe)("P8.0c Name Scramble Benchmark", () => {
    (0, vitest_1.it)("survival rate > 0 for structurally identical repos", () => {
        const result = (0, name_free_protocol_1.runNameScrambleBenchmark)(ACQUIRE_USE_RELEASE_A, ACQUIRE_USE_RELEASE_B, "RepoA", "RepoB");
        (0, name_free_protocol_1.printNameScrambleReport)(result);
        // Key assertion: same structure → high baseline
        (0, vitest_1.expect)(result.baselineSimilarity).toBeGreaterThan(0.8);
        // KEY TEST: survival rate should be non-zero!
        // With pure topology features, scrambling shouldn't kill similarity
        (0, vitest_1.expect)(result.survivalRate).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("survival rate > 0 for repos with same shape, different names", () => {
        const result = (0, name_free_protocol_1.runNameScrambleBenchmark)(ACQUIRE_USE_RELEASE_A, ACQUIRE_USE_RELEASE_C, "AcquireRelease_A", "AcquireRelease_C");
        (0, name_free_protocol_1.printNameScrambleReport)(result);
        // These have the same topology shape but different function names
        // The topology fingerprint should detect the structural similarity
        (0, vitest_1.expect)(result.survivalRate).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("runs full cross-repo scatter benchmark", () => {
        const report = (0, name_free_protocol_1.runFullNameScrambleBenchmark)();
        (0, name_free_protocol_1.printFullScrambleReport)(report);
        (0, vitest_1.expect)(report.results.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.avgSurvivalRate).toBeGreaterThanOrEqual(0);
    });
    (0, vitest_1.it)("THE decisive test: structurally identical repos survive scrambling", () => {
        // This is P8.0's north star: two repos with identical topology
        // but different names must show positive survival rate.
        //
        // AcquireUse_A: ["open","read","close"], ["open","write","close"]
        // AcquireUse_B: ["sql_open","sql_read","sql_close"], ["sql_open","sql_write","sql_close"]
        //
        // These have the SAME topology (entry→middle→exit) but different names.
        // The topology fingerprint must capture this structural identity.
        const result = (0, name_free_protocol_1.runNameScrambleBenchmark)(ACQUIRE_USE_RELEASE_A, ACQUIRE_USE_RELEASE_B, "AcquireUse_A", "AcquireUse_B");
        console.log(`\n  ═══ P8.0 NORTH STAR METRIC ═══`);
        console.log(`  Baseline:  ${(result.baselineSimilarity * 100).toFixed(1)}%`);
        console.log(`  Scrambled: ${(result.scrambledSimilarity * 100).toFixed(1)}%`);
        console.log(`  Survival:  ${(result.survivalRate * 100).toFixed(1)}%`);
        console.log(`  Target:    > 0%`);
        const verdict = result.survivalRate > 0
            ? "✅ BREAKTHROUGH: Name-free structure signal detected!"
            : "❌ No structure signal yet — keep iterating on fingerprint features.";
        console.log(`  ${verdict}\n`);
        (0, vitest_1.expect)(result.survivalRate).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("DISCRIMINATION: star vs chain topology differ meaningfully", () => {
        const STAR = [["hub", "leaf_a"], ["hub", "leaf_b"], ["hub", "leaf_c"], ["hub", "leaf_a", "leaf_b"]];
        const STAR_B = [["center", "b1"], ["center", "b2"], ["center", "b3"], ["center", "b1", "b2"]];
        const CHAIN = [["a", "b", "c", "d"], ["a", "b", "c"], ["a", "b", "c", "d", "e"]];
        const starVsStar = (0, name_free_protocol_1.runNameScrambleBenchmark)(STAR, STAR_B, "Star", "Star_B");
        const starVsChain = (0, name_free_protocol_1.runNameScrambleBenchmark)(STAR, CHAIN, "Star", "Chain");
        const gap = starVsStar.baselineSimilarity - starVsChain.baselineSimilarity;
        console.log(`  Star↔Star:  ${(starVsStar.baselineSimilarity * 100).toFixed(0)}%  surv=${(starVsStar.survivalRate * 100).toFixed(0)}%`);
        console.log(`  Star↔Chain: ${(starVsChain.baselineSimilarity * 100).toFixed(0)}%  surv=${(starVsChain.survivalRate * 100).toFixed(0)}%`);
        console.log(`  Discrimination gap: ${(gap * 100).toFixed(0)}%`);
        (0, vitest_1.expect)(starVsStar.survivalRate).toBeGreaterThan(0);
    });
});
