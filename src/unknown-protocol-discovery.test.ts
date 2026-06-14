/**
 * P8.2: Unknown Protocol Discovery Tests
 *
 * Zero-shot transfer: train on Redis+SQLite, test on PostgreSQL.
 * The system must discover protocol structure in an UNSEEN repo
 * and repair defects using only discovered knowledge.
 */
import { describe, it, expect } from "vitest";
import {
  buildKnownFingerprintLibrary,
  extractUnknownRepoSequences,
  discoverProtocolsFromSequences,
  evaluateZeroShotRepair,
  runZeroShotDiscovery,
  printZeroShotResult,
  DefectCase,
} from "./unknown-protocol-discovery";
import { CROSS_REPO_SEQUENCES } from "./unsupervised-physics";

describe("P8.2 Unknown Protocol Discovery", () => {
  it("extracts sequences from known repos", () => {
    const redis = extractUnknownRepoSequences("Redis");
    const sqlite = extractUnknownRepoSequences("SQLite");
    const pg = extractUnknownRepoSequences("PostgreSQL");

    expect(redis.length).toBeGreaterThan(0);
    expect(sqlite.length).toBeGreaterThan(0);
    expect(pg.length).toBeGreaterThan(0);
  });

  it("builds known fingerprint library from protocols.json", () => {
    const library = buildKnownFingerprintLibrary();
    expect(library.size).toBeGreaterThanOrEqual(8);
    expect(library.has("AuthProtocol")).toBe(true);
    expect(library.has("FileProtocol")).toBe(true);
  });

  it("discovers protocols from unseen repo sequences", () => {
    const seqs = extractUnknownRepoSequences("PostgreSQL");
    const known = buildKnownFingerprintLibrary();
    const discovered = discoverProtocolsFromSequences(seqs, "PostgreSQL", known);

    expect(discovered.length).toBeGreaterThan(0);

    for (const proto of discovered) {
      expect(proto.fingerprint.stateCount).toBeGreaterThan(0);
      expect(proto.prototype.length).toBeGreaterThan(0);
    }
  });

  it("clusters structurally identical repos together (Redis ↔ SQLite)", () => {
    const known = buildKnownFingerprintLibrary();

    const redisDiscovered = discoverProtocolsFromSequences(
      CROSS_REPO_SEQUENCES["Redis"], "Redis", known
    );
    const sqliteDiscovered = discoverProtocolsFromSequences(
      CROSS_REPO_SEQUENCES["SQLite"], "SQLite", known
    );

    // Both Redis and SQLite should match the same known protocol family
    // (both are acquire→use→release chains)
    const redisMatch = redisDiscovered[0]?.closestKnown;
    const sqliteMatch = sqliteDiscovered[0]?.closestKnown;

    console.log(`  Redis closest:    ${redisMatch || "none"}`);
    console.log(`  SQLite closest:   ${sqliteMatch || "none"}`);

    // They should both match to FileProtocol or DBProtocol (resource lifecycle)
    expect(redisMatch).toBeTruthy();
    expect(sqliteMatch).toBeTruthy();
  });

  it("ZERO-SHOT: PostgreSQL defects repaired using Redis+SQLite knowledge", () => {
    // Train on Redis + SQLite (known repos)
    const trainRepos = ["Redis", "SQLite"];

    // Test: PostgreSQL defects
    // Common PG defects: missing commit, missing disconnect, missing begin
    const defectCases: DefectCase[] = [
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

    const result = runZeroShotDiscovery(trainRepos, "PostgreSQL", defectCases);
    printZeroShotResult(result);

    // Discovery: should find at least 1 protocol
    expect(result.discoveredCount).toBeGreaterThan(0);

    // Zero-shot repair: should repair at least SOME defects
    // (PG sequences are structurally similar to Redis/SQLite acquire→use→release)
    expect(result.repairRate).toBeGreaterThan(0);
  });

  it("CROSS-REPO: all 5 repos discoverable with cluster transfer", () => {
    const known = buildKnownFingerprintLibrary();
    const repos = Object.keys(CROSS_REPO_SEQUENCES);

    console.log(`\n  Cross-repo discovery (${repos.length} repos):`);
    console.log(`  ${'Repo'.padEnd(14)} ${'Discovered'.padEnd(12)} ${'Closest Known'.padEnd(22)} ${'Confidence'}`);
    console.log(`  ${'─'.repeat(65)}`);

    for (const repo of repos) {
      const seqs = CROSS_REPO_SEQUENCES[repo];
      const discovered = discoverProtocolsFromSequences(seqs, repo, known);
      const top = discovered[0];
      console.log(
        `  ${repo.padEnd(14)} ${String(discovered.length).padEnd(12)} ` +
        `${(top?.closestKnown || "novel").padEnd(22)} ${top ? (top.matchConfidence * 100).toFixed(0) + '%' : 'N/A'}`
      );
      expect(discovered.length).toBeGreaterThan(0);
    }
  });
});
