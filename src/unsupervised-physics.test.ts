/**
 * P6.3: Unsupervised Physics Discovery Tests
 *
 * Verifying: does structural clustering discover Acquire/Release
 * patterns WITHOUT any keyword matching or function names?
 */

import { describe, it, expect } from "vitest";
import { fingerprint, fingerprintSequences, clusterByStructure, evaluateUnsupervisedDiscovery, runUnsupervisedDiscovery, printUnsupervisedReport, CROSS_REPO_SEQUENCES } from "./unsupervised-physics";
import { canonicalize } from "./software-physics";

describe("Structural Fingerprint (no function names)", () => {
  it("assigns phase 0/1/2 based on position only", () => {
    const fp0 = fingerprint("fopen", 0, ["fopen", "fread", "fclose"]);
    expect(fp0.phase).toBe(0);
    expect(fp0.isFirst).toBe(true);
    expect(fp0.isLast).toBe(false);

    const fp1 = fingerprint("fread", 1, ["fopen", "fread", "fclose"]);
    expect(fp1.phase).toBe(1);

    const fp2 = fingerprint("fclose", 2, ["fopen", "fread", "fclose"]);
    expect(fp2.phase).toBe(2);
    expect(fp2.isLast).toBe(true);
  });

  it("detects closed loops (first and last appear only once)", () => {
    const fp = fingerprint("fopen", 0, ["fopen", "fread", "fclose"]);
    // The SEQUENCE [fopen, fread, fclose] is a closed loop
    // because fopen and fclose each appear once
    expect(fp.isClosedLoop).toBe(true);
  });

  it("does NOT consider repeated functions as closed loops", () => {
    const fp = fingerprint("fread", 0, ["fread", "fread", "fread"]);
    expect(fp.isClosedLoop).toBe(false);
  });
});

describe("Unsupervised Clustering", () => {
  it("groups sequences by structure, not by name", () => {
    // [A,B,C] and [X,Y,Z] should cluster together — same structure (length=3, closed loop)
    const seqs = [
      ["fopen", "fread", "fclose"],
      ["sqlite3_open", "sqlite3_exec", "sqlite3_close"],
      ["DB_Open", "DB_Get", "DB_Close"],
      ["PQconnectdb", "PQexec", "PQfinish"],
      ["ngx_accept", "ngx_process", "ngx_close"],
    ];

    const clusters = clusterByStructure(seqs);
    expect(clusters.length).toBeGreaterThan(0);

    // All 5 sequences have length=3 and are closed-loop → same cluster
    const mainCluster = clusters.find(c => c.avgLength === 3 && c.closedLoopRate === 1);
    expect(mainCluster).toBeDefined();
    expect(mainCluster!.sequences.length).toBe(5);
  });

  it("separates Acquire-Release from Lock-Unlock by length", () => {
    const seqs = [
      ["open", "read", "close"],      // len=3, closed → Acquire
      ["connect", "query", "disconnect"], // len=3, closed → Acquire
      ["lock", "unlock"],              // len=2, closed → Lock
      ["mutex_lock", "mutex_unlock"],  // len=2, closed → Lock
    ];

    const clusters = clusterByStructure(seqs);
    expect(clusters.length).toBeGreaterThanOrEqual(2);

    const acquireCluster = clusters.find(c => c.avgLength === 3);
    expect(acquireCluster).toBeDefined();
    expect(acquireCluster!.inferredPattern).toBe("RESOURCE_ACQUIRE");

    const lockCluster = clusters.find(c => c.avgLength === 2);
    expect(lockCluster).toBeDefined();
    expect(lockCluster!.inferredPattern).toBe("LOCK_ACQUIRE");
  });
});

describe("Unsupervised Discovery Evaluation", () => {
  it("discovers physics patterns across all repos", () => {
    const allSeqs: string[][] = [];
    for (const seqs of Object.values(CROSS_REPO_SEQUENCES)) {
      allSeqs.push(...seqs);
    }

    const eval_ = evaluateUnsupervisedDiscovery(allSeqs);

    expect(eval_.totalSequences).toBeGreaterThanOrEqual(10);
    expect(eval_.clusters.length).toBeGreaterThan(0);
    expect(eval_.sequenceCoverage).toBeGreaterThan(0.5);
    expect(eval_.emergent).toBe(true);
  });

  it("each repo independently shows emergent physics", () => {
    for (const [repo, seqs] of Object.entries(CROSS_REPO_SEQUENCES)) {
      const eval_ = evaluateUnsupervisedDiscovery(seqs);
      // Each repo has at least one Acquire-Use-Release sequence
      expect(eval_.sequenceCoverage).toBeGreaterThan(0);
    }
  });

  it("full unsupervised report", () => {
    const report = runUnsupervisedDiscovery();

    expect(report.perRepo).toBeDefined();
    expect(report.allSequences.clusters.length).toBeGreaterThan(0);
    // At minimum, the 3-element closed-loop cluster should emerge
    expect(report.emergent).toBe(true);

    printUnsupervisedReport(report);
  });
});
