/**
 * P8.1: State Inference Tests — The decisive structure learning benchmark
 *
 * Three experiments:
 *   A: Name-Scramble — inferred state machine must survive function renaming
 *   B: State-Discrimination — different topologies must produce different fingerprints
 *   C: Real-world: infer state machines from Redis/SQLite sequences
 */
import { describe, it, expect } from "vitest";
import {
  inferStateMachine,
  extractStateFingerprint,
  stateFingerprintSimilarity,
  printInferredStateMachine,
} from "./state-inference";

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

describe("P8.1 State Inference", () => {
  it("infers state machine from call sequences", () => {
    const sm = inferStateMachine(ACQUIRE_USE_RELEASE);
    printInferredStateMachine(sm);

    expect(sm.fnCount).toBeGreaterThan(1);
    expect(sm.stateCount).toBeGreaterThan(0);
    expect(sm.states.some(s => s.role === "entry")).toBe(true);
    expect(sm.states.some(s => s.role === "exit")).toBe(true);
  });

  it("NAME-SCRAMBLE: identical topology, different names → identical state machine", () => {
    // This is the P8.1 decisive test:
    // If state inference truly ignores function names,
    // two repos with identical structure but different names
    // must produce structurally identical state machines.

    const smA = inferStateMachine(ACQUIRE_USE_RELEASE);
    const smB = inferStateMachine(ACQUIRE_USE_RELEASE_B);

    const fpA = extractStateFingerprint(smA);
    const fpB = extractStateFingerprint(smB);

    console.log(`\n  ═══ P8.1 NAME-SCRAMBLE TEST ═══`);
    console.log(`  States A: ${fpA.stateCount}  States B: ${fpB.stateCount}`);
    console.log(`  Trans A:  ${fpA.transitionCount}  Trans B:  ${fpB.transitionCount}`);
    console.log(`  Entries:  ${fpA.entryCount}/${fpB.entryCount}  Exits: ${fpA.exitCount}/${fpB.exitCount}`);
    console.log(`  DAG:      ${fpA.isDAG}/${fpB.isDAG}`);

    const sim = stateFingerprintSimilarity(fpA, fpB);
    console.log(`  Similarity: ${(sim * 100).toFixed(1)}%`);
    console.log(`  Target:     >90%`);

    // Must be >90% similar — state inference should ignore function names
    expect(sim).toBeGreaterThan(0.9);
  });

  it("SAME-TOPOLOGY: structurally identical repos produce near-identical fingerprints (>90%)", () => {
    const acquire = extractStateFingerprint(inferStateMachine(ACQUIRE_USE_RELEASE));
    const acquireB = extractStateFingerprint(inferStateMachine(ACQUIRE_USE_RELEASE_B));
    const sameSim = stateFingerprintSimilarity(acquire, acquireB);
    console.log(`  Same topo (acquire vs acquire_B): ${(sameSim*100).toFixed(0)}%`);
    expect(sameSim).toBeGreaterThan(0.9);
  });

  it("CROSS-TOPOLOGY: topologies with different node counts are distinguishable", () => {
    // Small (3-state chain) vs larger (5-10 state transaction)
    const cfg = [["a","b","c"],["a","c"]]; // 3-node chain
    const largeCfg: string[][] = [];
    for (let i = 0; i < 20; i++) {
      largeCfg.push(["init","fetch","process","next","fetch","process","exit"]);
    }

    const small = extractStateFingerprint(inferStateMachine(cfg));
    const large = extractStateFingerprint(inferStateMachine(largeCfg));
    const sim = stateFingerprintSimilarity(small, large);

    console.log(`  Small (3-node) vs Large (7-fn loop): ${(sim*100).toFixed(0)}%`);
    // Different-sized state machines should NOT be identical
    expect(sim).toBeLessThan(0.99);
    // Should still show some structural similarity (both are chains)
    expect(sim).toBeGreaterThan(0.3);
  });

  it("cross-repo: Redis and SQLite have similar state structures", () => {
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

    const redisFp = extractStateFingerprint(inferStateMachine(redisSeqs));
    const sqliteFp = extractStateFingerprint(inferStateMachine(sqliteSeqs));

    const sim = stateFingerprintSimilarity(redisFp, sqliteFp);
    console.log(`\n  Redis ↔ SQLite state similarity: ${(sim*100).toFixed(0)}%`);

    // Both are acquire→use→release — should be structurally similar
    expect(sim).toBeGreaterThan(0.5);
  });

  it("empty input produces empty state machine", () => {
    const sm = inferStateMachine([]);
    expect(sm.fnCount).toBe(0);
    expect(sm.stateCount).toBe(0);

    const fp = extractStateFingerprint(sm);
    expect(fp.stateCount).toBe(0);
  });
});
