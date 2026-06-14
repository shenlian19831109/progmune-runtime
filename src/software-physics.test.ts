/**
 * P6.2: Software Physics Engine Tests
 */

import { describe, it, expect } from "vitest";
import { canonicalize, canonicalizeSequence, isValidPhysicsSequence, analyzeRepoPhysics, compareRepoPhysics, analyzeCrossRepoPhysics, printCrossRepoReport, KNOWN_REPO_SIGNATURES } from "./software-physics";

describe("Protocol Canonicalization", () => {
  it("maps fopen/fclose to ACQUIRE/RELEASE", () => {
    expect(canonicalize("fopen").pattern).toBe("RESOURCE_ACQUIRE");
    expect(canonicalize("fclose").pattern).toBe("RESOURCE_RELEASE");
    expect(canonicalize("fread").pattern).toBe("RESOURCE_USE");
  });

  it("maps diverse names to the same pattern", () => {
    // fopen, sqlite3_open, db_connect, socket → ALL ACQUIRE
    const acquires = ["fopen", "sqlite3_open", "db_connect", "open_connection", "createClient"];
    for (const fn of acquires) {
      expect(canonicalize(fn).pattern).toBe("RESOURCE_ACQUIRE");
    }

    // fclose, sqlite3_close, db_disconnect, close_socket → ALL RELEASE
    const releases = ["fclose", "sqlite3_close", "db_disconnect", "closeClient"];
    for (const fn of releases) {
      expect(canonicalize(fn).pattern).toBe("RESOURCE_RELEASE");
    }
  });

  it("maps lock/unlock to LOCK patterns", () => {
    expect(canonicalize("mutex_lock").pattern).toBe("LOCK_ACQUIRE");
    expect(canonicalize("mutex_unlock").pattern).toBe("LOCK_RELEASE");
    expect(canonicalize("pthread_mutex_lock").pattern).toBe("LOCK_ACQUIRE");
  });

  it("maps begin/commit to TRANSACTION patterns", () => {
    expect(canonicalize("begin_transaction").pattern).toBe("TRANSACTION_BEGIN");
    expect(canonicalize("commit_transaction").pattern).toBe("TRANSACTION_COMMIT");
    expect(canonicalize("rollback").pattern).toBe("TRANSACTION_ROLLBACK");
  });

  it("returns UNKNOWN for unrecognized names", () => {
    expect(canonicalize("foobar").pattern).toBe("UNKNOWN");
    expect(canonicalize("xyz").pattern).toBe("UNKNOWN");
  });
});

describe("Physics Sequence Validation", () => {
  it("validates complete Acquire-Use-Release sequence", () => {
    const result = isValidPhysicsSequence(["fopen", "fread", "fclose"]);
    expect(result.valid).toBe(true);
  });

  it("validates Lock-Use-Unlock sequence", () => {
    const result = isValidPhysicsSequence(["mutex_lock", "write_data", "mutex_unlock"]);
    expect(result.valid).toBe(true);
  });

  it("accepts acquire-use sequences (open-ended read)", () => {
    const result = isValidPhysicsSequence(["fopen", "fread"]);
    expect(result.valid).toBe(true);
  });

  it("rejects release before acquire", () => {
    const result = isValidPhysicsSequence(["fclose", "fopen"]);
    expect(result.valid).toBe(false);
  });
});

describe("Cross-Repository Physics Analysis", () => {
  it("analyzes known repo signatures", () => {
    const redis = analyzeRepoPhysics("Redis", KNOWN_REPO_SIGNATURES["Redis"]);
    expect(redis.coverage).toBeGreaterThan(0.5); // most Redis functions map to known patterns

    const sqlite = analyzeRepoPhysics("SQLite", KNOWN_REPO_SIGNATURES["SQLite"]);
    expect(sqlite.coverage).toBeGreaterThan(0.5);
  });

  it("finds shared physics between different repos", () => {
    const redis = analyzeRepoPhysics("Redis", KNOWN_REPO_SIGNATURES["Redis"]);
    const sqlite = analyzeRepoPhysics("SQLite", KNOWN_REPO_SIGNATURES["SQLite"]);

    const comp = compareRepoPhysics(redis, sqlite);
    // Both have ACQUIRE/USE/RELEASE → should share patterns
    expect(comp.similarity).toBeGreaterThan(0.3);
    expect(comp.sharedPatterns.length).toBeGreaterThan(0);
  });

  it("full cross-repo report", () => {
    const report = analyzeCrossRepoPhysics();

    expect(report.analyses.length).toBe(5); // Redis, SQLite, nginx, PostgreSQL, LevelDB
    expect(report.pairwise.length).toBe(10); // 5C2 = 10
    expect(report.avgSimilarity).toBeGreaterThan(0);

    printCrossRepoReport(report);
  });
});
