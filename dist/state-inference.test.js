"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P8.1: State Inference Tests — The decisive structure learning benchmark
 *
 * Three experiments:
 *   A: Name-Scramble — inferred state machine must survive function renaming
 *   B: State-Discrimination — different topologies must produce different fingerprints
 *   C: Real-world: infer state machines from Redis/SQLite sequences
 */
const vitest_1 = require("vitest");
const state_inference_1 = require("./state-inference");
// ── Test data: structurally distinct protocols ──
const ACQUIRE_USE_RELEASE = [
    ["open", "read", "close"],
    ["open", "write", "close"],
    ["open", "read", "write", "close"],
];
const ACQUIRE_USE_RELEASE_B = [
    ["sql_open", "sql_read", "sql_close"],
    ["sql_open", "sql_write", "sql_close"],
];
const TRANSACTION = [
    ["begin_tx", "insert", "commit_tx"],
    ["begin_tx", "update", "commit_tx"],
    ["begin_tx", "delete", "rollback_tx"],
    ["begin_tx", "savepoint", "update", "release", "commit_tx"],
];
const LOOP = [
    ["init", "fetch", "process", "next", "fetch", "process", "exit"],
    ["init", "fetch", "process", "exit"],
    ["init", "fetch", "process", "timeout"],
];
const STAR = [
    ["hub", "leaf_a", "hub", "leaf_b", "hub", "destroy"],
    ["hub", "leaf_c", "hub", "leaf_a", "hub", "destroy"],
];
(0, vitest_1.describe)("P8.1 State Inference", () => {
    (0, vitest_1.it)("infers state machine from call sequences", () => {
        const sm = (0, state_inference_1.inferStateMachine)(ACQUIRE_USE_RELEASE);
        (0, state_inference_1.printInferredStateMachine)(sm);
        (0, vitest_1.expect)(sm.fnCount).toBeGreaterThan(1);
        (0, vitest_1.expect)(sm.stateCount).toBeGreaterThan(0);
        (0, vitest_1.expect)(sm.states.some(s => s.role === "entry")).toBe(true);
        (0, vitest_1.expect)(sm.states.some(s => s.role === "exit")).toBe(true);
    });
    (0, vitest_1.it)("NAME-SCRAMBLE: identical topology, different names → identical state machine", () => {
        // This is the P8.1 decisive test:
        // If state inference truly ignores function names,
        // two repos with identical structure but different names
        // must produce structurally identical state machines.
        const smA = (0, state_inference_1.inferStateMachine)(ACQUIRE_USE_RELEASE);
        const smB = (0, state_inference_1.inferStateMachine)(ACQUIRE_USE_RELEASE_B);
        const fpA = (0, state_inference_1.extractStateFingerprint)(smA);
        const fpB = (0, state_inference_1.extractStateFingerprint)(smB);
        console.log(`\n  ═══ P8.1 NAME-SCRAMBLE TEST ═══`);
        console.log(`  States A: ${fpA.stateCount}  States B: ${fpB.stateCount}`);
        console.log(`  Trans A:  ${fpA.transitionCount}  Trans B:  ${fpB.transitionCount}`);
        console.log(`  Entries:  ${fpA.entryCount}/${fpB.entryCount}  Exits: ${fpA.exitCount}/${fpB.exitCount}`);
        console.log(`  DAG:      ${fpA.isDAG}/${fpB.isDAG}`);
        const sim = (0, state_inference_1.stateFingerprintSimilarity)(fpA, fpB);
        console.log(`  Similarity: ${(sim * 100).toFixed(1)}%`);
        console.log(`  Target:     >90%`);
        // Must be >90% similar — state inference should ignore function names
        (0, vitest_1.expect)(sim).toBeGreaterThan(0.9);
    });
    (0, vitest_1.it)("STATE-DISCRIMINATION: different topologies produce distinguishable fingerprints", () => {
        const acquire = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(ACQUIRE_USE_RELEASE));
        const transaction = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(TRANSACTION));
        const loop = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(LOOP));
        const star = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(STAR));
        // Same topology: acquire vs acquire_B
        const acquireB = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(ACQUIRE_USE_RELEASE_B));
        const sameSim = (0, state_inference_1.stateFingerprintSimilarity)(acquire, acquireB);
        // Different topologies
        const vsTx = (0, state_inference_1.stateFingerprintSimilarity)(acquire, transaction);
        const vsLoop = (0, state_inference_1.stateFingerprintSimilarity)(acquire, loop);
        const vsStar = (0, state_inference_1.stateFingerprintSimilarity)(acquire, star);
        console.log(`\n  Same (acquire vs acquire_B):  ${(sameSim * 100).toFixed(0)}%`);
        console.log(`  Diff (acquire vs transaction): ${(vsTx * 100).toFixed(0)}%`);
        console.log(`  Diff (acquire vs loop):        ${(vsLoop * 100).toFixed(0)}%`);
        console.log(`  Diff (acquire vs star):        ${(vsStar * 100).toFixed(0)}%`);
        // Same topology should be more similar than different topologies
        (0, vitest_1.expect)(sameSim).toBeGreaterThan(vsTx);
        (0, vitest_1.expect)(sameSim).toBeGreaterThan(vsLoop);
        // Discrimination gap: same vs different should be detectable
        const gap = sameSim - Math.min(vsTx, vsLoop, vsStar);
        console.log(`  Discrimination gap: ${(gap * 100).toFixed(0)}%`);
        (0, vitest_1.expect)(gap).toBeGreaterThan(0.01);
    });
    (0, vitest_1.it)("cross-repo: Redis and SQLite have similar state structures", () => {
        const redisSeqs = [
            ["createClient", "sendCommand", "closeClient"],
            ["selectDB", "getKey"],
            ["createClient", "sendCommand", "readReply", "closeClient"],
        ];
        const sqliteSeqs = [
            ["sqlite3_open", "sqlite3_exec", "sqlite3_close"],
            ["sqlite3_prepare", "sqlite3_step", "sqlite3_finalize"],
            ["sqlite3_open", "sqlite3_prepare", "sqlite3_step", "sqlite3_finalize", "sqlite3_close"],
        ];
        const redisFp = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(redisSeqs));
        const sqliteFp = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(sqliteSeqs));
        const sim = (0, state_inference_1.stateFingerprintSimilarity)(redisFp, sqliteFp);
        console.log(`\n  Redis ↔ SQLite state similarity: ${(sim * 100).toFixed(0)}%`);
        // Both are acquire→use→release — should be structurally similar
        (0, vitest_1.expect)(sim).toBeGreaterThan(0.5);
    });
    (0, vitest_1.it)("empty input produces empty state machine", () => {
        const sm = (0, state_inference_1.inferStateMachine)([]);
        (0, vitest_1.expect)(sm.fnCount).toBe(0);
        (0, vitest_1.expect)(sm.stateCount).toBe(0);
        const fp = (0, state_inference_1.extractStateFingerprint)(sm);
        (0, vitest_1.expect)(fp.stateCount).toBe(0);
    });
});
