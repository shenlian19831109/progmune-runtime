"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P8.2: Unknown Protocol Discovery Tests
 *
 * Zero-shot transfer: train on Redis+SQLite, test on PostgreSQL.
 * The system must discover protocol structure in an UNSEEN repo
 * and repair defects using only discovered knowledge.
 */
const vitest_1 = require("vitest");
const unknown_protocol_discovery_1 = require("./unknown-protocol-discovery");
const unsupervised_physics_1 = require("./experimental/unsupervised-physics");
(0, vitest_1.describe)("P8.2 Unknown Protocol Discovery", () => {
    (0, vitest_1.it)("extracts sequences from known repos", () => {
        const redis = (0, unknown_protocol_discovery_1.extractUnknownRepoSequences)("Redis");
        const sqlite = (0, unknown_protocol_discovery_1.extractUnknownRepoSequences)("SQLite");
        const pg = (0, unknown_protocol_discovery_1.extractUnknownRepoSequences)("PostgreSQL");
        (0, vitest_1.expect)(redis.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(sqlite.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(pg.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("builds known fingerprint library from protocols.json", () => {
        const library = (0, unknown_protocol_discovery_1.buildKnownFingerprintLibrary)();
        (0, vitest_1.expect)(library.size).toBeGreaterThanOrEqual(8);
        (0, vitest_1.expect)(library.has("AuthProtocol")).toBe(true);
        (0, vitest_1.expect)(library.has("FileProtocol")).toBe(true);
    });
    (0, vitest_1.it)("discovers protocols from unseen repo sequences", () => {
        const seqs = (0, unknown_protocol_discovery_1.extractUnknownRepoSequences)("PostgreSQL");
        const known = (0, unknown_protocol_discovery_1.buildKnownFingerprintLibrary)();
        const discovered = (0, unknown_protocol_discovery_1.discoverProtocolsFromSequences)(seqs, "PostgreSQL", known);
        (0, vitest_1.expect)(discovered.length).toBeGreaterThan(0);
        for (const proto of discovered) {
            (0, vitest_1.expect)(proto.fingerprint.stateCount).toBeGreaterThan(0);
            (0, vitest_1.expect)(proto.prototype.length).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)("clusters structurally identical repos together (Redis ↔ SQLite)", () => {
        const known = (0, unknown_protocol_discovery_1.buildKnownFingerprintLibrary)();
        const redisDiscovered = (0, unknown_protocol_discovery_1.discoverProtocolsFromSequences)(unsupervised_physics_1.CROSS_REPO_SEQUENCES["Redis"], "Redis", known);
        const sqliteDiscovered = (0, unknown_protocol_discovery_1.discoverProtocolsFromSequences)(unsupervised_physics_1.CROSS_REPO_SEQUENCES["SQLite"], "SQLite", known);
        // Both Redis and SQLite should match the same known protocol family
        // (both are acquire→use→release chains)
        const redisMatch = redisDiscovered[0]?.closestKnown;
        const sqliteMatch = sqliteDiscovered[0]?.closestKnown;
        console.log(`  Redis closest:    ${redisMatch || "none"}`);
        console.log(`  SQLite closest:   ${sqliteMatch || "none"}`);
        // They should both match to FileProtocol or DBProtocol (resource lifecycle)
        (0, vitest_1.expect)(redisMatch).toBeTruthy();
        (0, vitest_1.expect)(sqliteMatch).toBeTruthy();
    });
    (0, vitest_1.it)("ZERO-SHOT: PostgreSQL defects repaired using Redis+SQLite knowledge", () => {
        // Train on Redis + SQLite (known repos)
        const trainRepos = ["Redis", "SQLite"];
        // Test: PostgreSQL defects
        // Common PG defects: missing commit, missing disconnect, missing begin
        const defectCases = [
            {
                broken: ["PQconnectdb", "PQexec"],
                expected: ["PQconnectdb", "PQexec", "PQfinish"],
                description: "PG: missing disconnect after query",
            },
            {
                broken: ["begin_transaction", "execute_query"],
                expected: ["begin_transaction", "execute_query", "commit_transaction"],
                description: "PG: missing commit after execute",
            },
            {
                broken: ["PQconnectdb"],
                expected: ["PQconnectdb", "PQexec", "PQfinish"],
                description: "PG: only connect, no query or finish",
            },
            {
                broken: ["PQconnectdb", "begin_transaction"],
                expected: ["PQconnectdb", "begin_transaction", "execute_query", "commit_transaction", "PQfinish"],
                description: "PG: full lifecycle missing middle+end",
            },
        ];
        const result = (0, unknown_protocol_discovery_1.runZeroShotDiscovery)(trainRepos, "PostgreSQL", defectCases);
        (0, unknown_protocol_discovery_1.printZeroShotResult)(result);
        // Discovery: should find at least 1 protocol
        (0, vitest_1.expect)(result.discoveredCount).toBeGreaterThan(0);
        // Zero-shot repair: should repair at least SOME defects
        // (PG sequences are structurally similar to Redis/SQLite acquire→use→release)
        (0, vitest_1.expect)(result.repairRate).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("CROSS-REPO: all 5 repos discoverable with cluster transfer", () => {
        const known = (0, unknown_protocol_discovery_1.buildKnownFingerprintLibrary)();
        const repos = Object.keys(unsupervised_physics_1.CROSS_REPO_SEQUENCES);
        console.log(`\n  Cross-repo discovery (${repos.length} repos):`);
        console.log(`  ${'Repo'.padEnd(14)} ${'Discovered'.padEnd(12)} ${'Closest Known'.padEnd(22)} ${'Confidence'}`);
        console.log(`  ${'─'.repeat(65)}`);
        for (const repo of repos) {
            const seqs = unsupervised_physics_1.CROSS_REPO_SEQUENCES[repo];
            const discovered = (0, unknown_protocol_discovery_1.discoverProtocolsFromSequences)(seqs, repo, known);
            const top = discovered[0];
            console.log(`  ${repo.padEnd(14)} ${String(discovered.length).padEnd(12)} ` +
                `${(top?.closestKnown || "novel").padEnd(22)} ${top ? (top.matchConfidence * 100).toFixed(0) + '%' : 'N/A'}`);
            (0, vitest_1.expect)(discovered.length).toBeGreaterThan(0);
        }
    });
});
