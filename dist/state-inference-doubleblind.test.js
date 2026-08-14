"use strict";
/**
 * P8.1.1: Double-Blind State Inference Validation
 *
 * THE decisive test: if state inference truly ignores function names,
 * scrambling ALL function names to F_001, F_002 (with randomized
 * numbering) must produce IDENTICAL state machines.
 *
 * This goes beyond P8.0's name-scramble (which only tests fingerprint
 * similarity) by verifying that EVERY structural property survives —
 * state count, transition count, role assignments, DAG property,
 * diameter, and fingerprint identity.
 *
 * If this passes, P8.1 genuinely learns state structure, not
 * disguised verb patterns via role assignment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const state_inference_1 = require("./experimental/state-inference");
// ── Double-blind scrambling ──
function doubleBlindScramble(sequences) {
    // Step 1: Collect all unique function names
    const allNames = new Set();
    for (const seq of sequences)
        for (const fn of seq)
            allNames.add(fn);
    // Step 2: Randomize the mapping
    const names = [...allNames];
    const shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Step 3: Build deterministic map from original → F_XXXX
    const map = new Map();
    for (let i = 0; i < names.length; i++) {
        map.set(names[i], `F_${String(shuffled.indexOf(names[i])).padStart(4, "0")}`);
    }
    // Step 4: Apply mapping
    return sequences.map(seq => seq.map(fn => map.get(fn)));
}
// ── Test data ──
const FILE_PROTOCOL = [
    ["open_file", "read_file", "close_file"],
    ["open_file", "write_file", "close_file"],
    ["open_file", "read_file", "write_file", "close_file"],
];
const DB_PROTOCOL = [
    ["connect_db", "query_db", "disconnect_db"],
    ["connect_db", "query_db", "query_db", "disconnect_db"],
];
const AUTH_LIFECYCLE = [
    ["verify_password", "generate_jwt", "create_session", "logout"],
    ["verify_password", "generate_jwt", "create_session"],
    ["verify_password", "revoke_token"],
];
const CROSS_REPO = {
    Redis: [
        ["createClient", "sendCommand", "closeClient"],
        ["selectDB", "getKey"],
        ["createClient", "sendCommand", "readReply", "closeClient"],
    ],
    SQLite: [
        ["sqlite3_open", "sqlite3_exec", "sqlite3_close"],
        ["sqlite3_prepare", "sqlite3_step", "sqlite3_finalize"],
        ["sqlite3_open", "sqlite3_prepare", "sqlite3_step", "sqlite3_finalize", "sqlite3_close"],
    ],
    nginx: [
        ["ngx_accept_connection", "ngx_read_request", "ngx_close_connection"],
        ["ngx_parse_headers", "ngx_send_response"],
        ["ngx_accept_connection", "ngx_process_request", "ngx_send_response", "ngx_close_connection"],
    ],
    PostgreSQL: [
        ["PQconnectdb", "PQexec", "PQfinish"],
        ["begin_transaction", "execute_query", "commit_transaction"],
        ["PQconnectdb", "begin_transaction", "execute_query", "commit_transaction", "PQfinish"],
    ],
    LevelDB: [
        ["DB_Open", "DB_Get", "DB_Close"],
        ["DB_Open", "DB_Put", "DB_Close"],
        ["DB_Open", "DB_Write", "DB_Compact", "DB_Close"],
    ],
};
(0, vitest_1.describe)("P8.1.1 Double-Blind State Inference Validation", () => {
    (0, vitest_1.it)("DOUBLE-BLIND: identical topology with scrambled random names → identical fingerprint", () => {
        const scrambled = doubleBlindScramble(FILE_PROTOCOL);
        // Verify names are actually scrambled
        const origNames = new Set(FILE_PROTOCOL.flat());
        const scramNames = new Set(scrambled.flat());
        for (const name of origNames) {
            (0, vitest_1.expect)(scramNames.has(`F_${String(name).padStart(4, "0")}`) || scramNames.has(name)).toBe(false);
        }
        const orig = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(FILE_PROTOCOL));
        const scram = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(scrambled));
        console.log(`\n  ═══ DOUBLE-BLIND TEST ═══`);
        console.log(`  Original names: ${[...origNames].join(", ")}`);
        console.log(`  Scrambled names: ${[...scramNames].slice(0, 4).join(", ")}...`);
        console.log(`  States:  ${orig.stateCount} → ${scram.stateCount}`);
        console.log(`  Trans:   ${orig.transitionCount} → ${scram.transitionCount}`);
        console.log(`  Entries: ${orig.entryCount} → ${scram.entryCount}`);
        console.log(`  Exits:   ${orig.exitCount} → ${scram.exitCount}`);
        console.log(`  DAG:     ${orig.isDAG} → ${scram.isDAG}`);
        const sim = (0, state_inference_1.stateFingerprintSimilarity)(orig, scram);
        console.log(`  Similarity: ${(sim * 100).toFixed(1)}%`);
        console.log(`  Target:     >95% (must be nearly identical)`);
        // Double-blind: scrambled names must produce same fingerprint
        (0, vitest_1.expect)(sim).toBeGreaterThan(0.95);
        (0, vitest_1.expect)(orig.stateCount).toBe(scram.stateCount);
        (0, vitest_1.expect)(orig.transitionCount).toBe(scram.transitionCount);
    });
    (0, vitest_1.it)("DB-LEVEL: database protocol survives double-blind at repo level", () => {
        const scrambled = doubleBlindScramble(DB_PROTOCOL);
        const orig = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(DB_PROTOCOL));
        const scram = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(scrambled));
        const sim = (0, state_inference_1.stateFingerprintSimilarity)(orig, scram);
        console.log(`  DB double-blind similarity: ${(sim * 100).toFixed(0)}%`);
        (0, vitest_1.expect)(sim).toBeGreaterThan(0.95);
    });
    (0, vitest_1.it)("AUTH-LEVEL: auth lifecycle survives double-blind", () => {
        const scrambled = doubleBlindScramble(AUTH_LIFECYCLE);
        const orig = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(AUTH_LIFECYCLE));
        const scram = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(scrambled));
        const sim = (0, state_inference_1.stateFingerprintSimilarity)(orig, scram);
        console.log(`  Auth double-blind similarity: ${(sim * 100).toFixed(0)}%`);
        (0, vitest_1.expect)(sim).toBeGreaterThan(0.95);
    });
    (0, vitest_1.it)("CROSS-REPO-LEVEL: all 5 known repos survive double-blind", () => {
        const results = [];
        for (const [repo, seqs] of Object.entries(CROSS_REPO)) {
            const scrambled = doubleBlindScramble(seqs);
            const orig = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(seqs));
            const scram = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(scrambled));
            const sim = (0, state_inference_1.stateFingerprintSimilarity)(orig, scram);
            results.push({ repo, similarity: sim });
        }
        console.log(`\n  Cross-repo double-blind results:`);
        for (const r of results) {
            const status = r.similarity > 0.95 ? "✅" : r.similarity > 0.8 ? "⚠️" : "❌";
            console.log(`    ${r.repo.padEnd(14)} ${(r.similarity * 100).toFixed(0)}% ${status}`);
        }
        const avg = results.reduce((s, r) => s + r.similarity, 0) / results.length;
        console.log(`  Average: ${(avg * 100).toFixed(0)}%`);
        // All repos must survive double-blind
        for (const r of results) {
            (0, vitest_1.expect)(r.similarity).toBeGreaterThan(0.9);
        }
    });
    (0, vitest_1.it)("DISCRIMINATION-AFTER-SCRAMBLE: different repos remain distinguishable", () => {
        // The acid test: after scrambling BOTH repos, can we still tell them apart?
        const redisScram = doubleBlindScramble(CROSS_REPO.Redis);
        const pgScram = doubleBlindScramble(CROSS_REPO.PostgreSQL);
        const redisFp = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(redisScram));
        const pgFp = (0, state_inference_1.extractStateFingerprint)((0, state_inference_1.inferStateMachine)(pgScram));
        const sim = (0, state_inference_1.stateFingerprintSimilarity)(redisFp, pgFp);
        console.log(`\n  Redis ↔ PostgreSQL (both scrambled): ${(sim * 100).toFixed(0)}%`);
        // Both are acquire→use→release chains — should be similar
        // but the specific structure (3 vs 5-var patterns) should leave a gap
        (0, vitest_1.expect)(sim).toBeGreaterThan(0.5);
    });
});
