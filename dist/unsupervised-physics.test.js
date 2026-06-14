"use strict";
/**
 * P6.3: Unsupervised Physics Discovery Tests
 *
 * Verifying: does structural clustering discover Acquire/Release
 * patterns WITHOUT any keyword matching or function names?
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const unsupervised_physics_1 = require("./unsupervised-physics");
(0, vitest_1.describe)("Structural Fingerprint (no function names)", () => {
    (0, vitest_1.it)("assigns phase 0/1/2 based on position only", () => {
        const fp0 = (0, unsupervised_physics_1.fingerprint)("fopen", 0, ["fopen", "fread", "fclose"]);
        (0, vitest_1.expect)(fp0.phase).toBe(0);
        (0, vitest_1.expect)(fp0.isFirst).toBe(true);
        (0, vitest_1.expect)(fp0.isLast).toBe(false);
        const fp1 = (0, unsupervised_physics_1.fingerprint)("fread", 1, ["fopen", "fread", "fclose"]);
        (0, vitest_1.expect)(fp1.phase).toBe(1);
        const fp2 = (0, unsupervised_physics_1.fingerprint)("fclose", 2, ["fopen", "fread", "fclose"]);
        (0, vitest_1.expect)(fp2.phase).toBe(2);
        (0, vitest_1.expect)(fp2.isLast).toBe(true);
    });
    (0, vitest_1.it)("detects closed loops (first and last appear only once)", () => {
        const fp = (0, unsupervised_physics_1.fingerprint)("fopen", 0, ["fopen", "fread", "fclose"]);
        // The SEQUENCE [fopen, fread, fclose] is a closed loop
        // because fopen and fclose each appear once
        (0, vitest_1.expect)(fp.isClosedLoop).toBe(true);
    });
    (0, vitest_1.it)("does NOT consider repeated functions as closed loops", () => {
        const fp = (0, unsupervised_physics_1.fingerprint)("fread", 0, ["fread", "fread", "fread"]);
        (0, vitest_1.expect)(fp.isClosedLoop).toBe(false);
    });
});
(0, vitest_1.describe)("Unsupervised Clustering", () => {
    (0, vitest_1.it)("groups sequences by structure, not by name", () => {
        // [A,B,C] and [X,Y,Z] should cluster together — same structure (length=3, closed loop)
        const seqs = [
            ["fopen", "fread", "fclose"],
            ["sqlite3_open", "sqlite3_exec", "sqlite3_close"],
            ["DB_Open", "DB_Get", "DB_Close"],
            ["PQconnectdb", "PQexec", "PQfinish"],
            ["ngx_accept", "ngx_process", "ngx_close"],
        ];
        const clusters = (0, unsupervised_physics_1.clusterByStructure)(seqs);
        (0, vitest_1.expect)(clusters.length).toBeGreaterThan(0);
        // All 5 sequences have length=3 and are closed-loop → same cluster
        const mainCluster = clusters.find(c => c.avgLength === 3 && c.closedLoopRate === 1);
        (0, vitest_1.expect)(mainCluster).toBeDefined();
        (0, vitest_1.expect)(mainCluster.sequences.length).toBe(5);
    });
    (0, vitest_1.it)("separates Acquire-Release from Lock-Unlock by length", () => {
        const seqs = [
            ["open", "read", "close"], // len=3, closed → Acquire
            ["connect", "query", "disconnect"], // len=3, closed → Acquire
            ["lock", "unlock"], // len=2, closed → Lock
            ["mutex_lock", "mutex_unlock"], // len=2, closed → Lock
        ];
        const clusters = (0, unsupervised_physics_1.clusterByStructure)(seqs);
        (0, vitest_1.expect)(clusters.length).toBeGreaterThanOrEqual(2);
        const acquireCluster = clusters.find(c => c.avgLength === 3);
        (0, vitest_1.expect)(acquireCluster).toBeDefined();
        (0, vitest_1.expect)(acquireCluster.inferredPattern).toBe("RESOURCE_ACQUIRE");
        const lockCluster = clusters.find(c => c.avgLength === 2);
        (0, vitest_1.expect)(lockCluster).toBeDefined();
        (0, vitest_1.expect)(lockCluster.inferredPattern).toBe("LOCK_ACQUIRE");
    });
});
(0, vitest_1.describe)("Unsupervised Discovery Evaluation", () => {
    (0, vitest_1.it)("discovers physics patterns across all repos", () => {
        const allSeqs = [];
        for (const seqs of Object.values(unsupervised_physics_1.CROSS_REPO_SEQUENCES)) {
            allSeqs.push(...seqs);
        }
        const eval_ = (0, unsupervised_physics_1.evaluateUnsupervisedDiscovery)(allSeqs);
        (0, vitest_1.expect)(eval_.totalSequences).toBeGreaterThanOrEqual(10);
        (0, vitest_1.expect)(eval_.clusters.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(eval_.sequenceCoverage).toBeGreaterThan(0.5);
        (0, vitest_1.expect)(eval_.emergent).toBe(true);
    });
    (0, vitest_1.it)("each repo independently shows emergent physics", () => {
        for (const [repo, seqs] of Object.entries(unsupervised_physics_1.CROSS_REPO_SEQUENCES)) {
            const eval_ = (0, unsupervised_physics_1.evaluateUnsupervisedDiscovery)(seqs);
            // Each repo has at least one Acquire-Use-Release sequence
            (0, vitest_1.expect)(eval_.sequenceCoverage).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)("full unsupervised report", () => {
        const report = (0, unsupervised_physics_1.runUnsupervisedDiscovery)();
        (0, vitest_1.expect)(report.perRepo).toBeDefined();
        (0, vitest_1.expect)(report.allSequences.clusters.length).toBeGreaterThan(0);
        // At minimum, the 3-element closed-loop cluster should emerge
        (0, vitest_1.expect)(report.emergent).toBe(true);
        (0, unsupervised_physics_1.printUnsupervisedReport)(report);
    });
});
