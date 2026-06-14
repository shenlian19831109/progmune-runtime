"use strict";
/**
 * P6.2: Software Physics Engine Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const software_physics_1 = require("./software-physics");
(0, vitest_1.describe)("Protocol Canonicalization", () => {
    (0, vitest_1.it)("maps fopen/fclose to ACQUIRE/RELEASE", () => {
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("fopen").pattern).toBe("RESOURCE_ACQUIRE");
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("fclose").pattern).toBe("RESOURCE_RELEASE");
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("fread").pattern).toBe("RESOURCE_USE");
    });
    (0, vitest_1.it)("maps diverse names to the same pattern", () => {
        // fopen, sqlite3_open, db_connect, socket → ALL ACQUIRE
        const acquires = ["fopen", "sqlite3_open", "db_connect", "open_connection", "createClient"];
        for (const fn of acquires) {
            (0, vitest_1.expect)((0, software_physics_1.canonicalize)(fn).pattern).toBe("RESOURCE_ACQUIRE");
        }
        // fclose, sqlite3_close, db_disconnect, close_socket → ALL RELEASE
        const releases = ["fclose", "sqlite3_close", "db_disconnect", "closeClient"];
        for (const fn of releases) {
            (0, vitest_1.expect)((0, software_physics_1.canonicalize)(fn).pattern).toBe("RESOURCE_RELEASE");
        }
    });
    (0, vitest_1.it)("maps lock/unlock to LOCK patterns", () => {
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("mutex_lock").pattern).toBe("LOCK_ACQUIRE");
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("mutex_unlock").pattern).toBe("LOCK_RELEASE");
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("pthread_mutex_lock").pattern).toBe("LOCK_ACQUIRE");
    });
    (0, vitest_1.it)("maps begin/commit to TRANSACTION patterns", () => {
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("begin_transaction").pattern).toBe("TRANSACTION_BEGIN");
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("commit_transaction").pattern).toBe("TRANSACTION_COMMIT");
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("rollback").pattern).toBe("TRANSACTION_ROLLBACK");
    });
    (0, vitest_1.it)("returns UNKNOWN for unrecognized names", () => {
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("foobar").pattern).toBe("UNKNOWN");
        (0, vitest_1.expect)((0, software_physics_1.canonicalize)("xyz").pattern).toBe("UNKNOWN");
    });
});
(0, vitest_1.describe)("Physics Sequence Validation", () => {
    (0, vitest_1.it)("validates complete Acquire-Use-Release sequence", () => {
        const result = (0, software_physics_1.isValidPhysicsSequence)(["fopen", "fread", "fclose"]);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)("validates Lock-Use-Unlock sequence", () => {
        const result = (0, software_physics_1.isValidPhysicsSequence)(["mutex_lock", "write_data", "mutex_unlock"]);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)("accepts acquire-use sequences (open-ended read)", () => {
        const result = (0, software_physics_1.isValidPhysicsSequence)(["fopen", "fread"]);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)("rejects release before acquire", () => {
        const result = (0, software_physics_1.isValidPhysicsSequence)(["fclose", "fopen"]);
        (0, vitest_1.expect)(result.valid).toBe(false);
    });
});
(0, vitest_1.describe)("Cross-Repository Physics Analysis", () => {
    (0, vitest_1.it)("analyzes known repo signatures", () => {
        const redis = (0, software_physics_1.analyzeRepoPhysics)("Redis", software_physics_1.KNOWN_REPO_SIGNATURES["Redis"]);
        (0, vitest_1.expect)(redis.coverage).toBeGreaterThan(0.5); // most Redis functions map to known patterns
        const sqlite = (0, software_physics_1.analyzeRepoPhysics)("SQLite", software_physics_1.KNOWN_REPO_SIGNATURES["SQLite"]);
        (0, vitest_1.expect)(sqlite.coverage).toBeGreaterThan(0.5);
    });
    (0, vitest_1.it)("finds shared physics between different repos", () => {
        const redis = (0, software_physics_1.analyzeRepoPhysics)("Redis", software_physics_1.KNOWN_REPO_SIGNATURES["Redis"]);
        const sqlite = (0, software_physics_1.analyzeRepoPhysics)("SQLite", software_physics_1.KNOWN_REPO_SIGNATURES["SQLite"]);
        const comp = (0, software_physics_1.compareRepoPhysics)(redis, sqlite);
        // Both have ACQUIRE/USE/RELEASE → should share patterns
        (0, vitest_1.expect)(comp.similarity).toBeGreaterThan(0.3);
        (0, vitest_1.expect)(comp.sharedPatterns.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("full cross-repo report", () => {
        const report = (0, software_physics_1.analyzeCrossRepoPhysics)();
        (0, vitest_1.expect)(report.analyses.length).toBe(5); // Redis, SQLite, nginx, PostgreSQL, LevelDB
        (0, vitest_1.expect)(report.pairwise.length).toBe(10); // 5C2 = 10
        (0, vitest_1.expect)(report.avgSimilarity).toBeGreaterThan(0);
        (0, software_physics_1.printCrossRepoReport)(report);
    });
});
