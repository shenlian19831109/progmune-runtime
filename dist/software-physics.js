"use strict";
/**
 * P6.2: Software Physics Engine — Protocol Structure Learning
 *
 * Maps diverse function names to abstract protocol patterns.
 * This is the bridge from "Function Memorization" to "Protocol Learning."
 *
 * Core insight: fopen, sqlite3_open, db_connect, socket() are all
 * the SAME thing — RESOURCE_ACQUIRE. The system should learn the
 * pattern, not the name.
 *
 * Five fundamental Software Physics patterns:
 *   1. Acquire-Release   (resource lifecycle)
 *   2. Lock-Unlock       (mutual exclusion)
 *   3. Begin-Commit      (transactional consistency)
 *   4. Authenticate-Act  (identity verification)
 *   5. Allocate-Free     (memory lifecycle)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_REPO_SIGNATURES = void 0;
exports.canonicalize = canonicalize;
exports.canonicalizeSequence = canonicalizeSequence;
exports.isValidPhysicsSequence = isValidPhysicsSequence;
exports.analyzeRepoPhysics = analyzeRepoPhysics;
exports.compareRepoPhysics = compareRepoPhysics;
exports.analyzeCrossRepoPhysics = analyzeCrossRepoPhysics;
exports.printCrossRepoReport = printCrossRepoReport;
/**
 * Keyword-based pattern recognition.
 *
 * Maps function name substrings to Software Physics patterns.
 * This is a lightweight symbolic approach — no ML needed.
 */
const PHYSICS_KEYWORDS = {
    // Acquire patterns
    open: { pattern: "RESOURCE_ACQUIRE", phase: "acquire" },
    connect: { pattern: "RESOURCE_ACQUIRE", phase: "acquire" },
    create: { pattern: "RESOURCE_ACQUIRE", phase: "acquire" },
    alloc: { pattern: "MEMORY_ALLOCATE", phase: "acquire" },
    malloc: { pattern: "MEMORY_ALLOCATE", phase: "acquire" },
    accept: { pattern: "RESOURCE_ACQUIRE", phase: "acquire" },
    begin: { pattern: "TRANSACTION_BEGIN", phase: "acquire" },
    start: { pattern: "TRANSACTION_BEGIN", phase: "acquire" },
    // Release patterns
    close: { pattern: "RESOURCE_RELEASE", phase: "release" },
    disconnect: { pattern: "RESOURCE_RELEASE", phase: "release" },
    destroy: { pattern: "RESOURCE_RELEASE", phase: "release" },
    free: { pattern: "MEMORY_FREE", phase: "release" },
    release: { pattern: "RESOURCE_RELEASE", phase: "release" },
    finalize: { pattern: "RESOURCE_RELEASE", phase: "release" },
    commit: { pattern: "TRANSACTION_COMMIT", phase: "release" },
    rollback: { pattern: "TRANSACTION_ROLLBACK", phase: "release" },
    finish: { pattern: "TRANSACTION_COMMIT", phase: "release" },
    // Use patterns
    read: { pattern: "RESOURCE_USE", phase: "use" },
    write: { pattern: "RESOURCE_USE", phase: "use" },
    query: { pattern: "RESOURCE_USE", phase: "use" },
    exec: { pattern: "RESOURCE_USE", phase: "use" },
    send: { pattern: "RESOURCE_USE", phase: "use" },
    recv: { pattern: "RESOURCE_USE", phase: "use" },
    step: { pattern: "RESOURCE_USE", phase: "use" },
    // Lock patterns
    lock: { pattern: "LOCK_ACQUIRE", phase: "acquire" },
    unlock: { pattern: "LOCK_RELEASE", phase: "release" },
    mutex: { pattern: "LOCK_ACQUIRE", phase: "acquire" },
    // Auth patterns
    verify: { pattern: "AUTHENTICATE", phase: "acquire" },
    auth: { pattern: "AUTHENTICATE", phase: "acquire" },
    login: { pattern: "AUTHENTICATE", phase: "acquire" },
    logout: { pattern: "RESOURCE_RELEASE", phase: "release" },
    signin: { pattern: "AUTHENTICATE", phase: "acquire" },
    signout: { pattern: "RESOURCE_RELEASE", phase: "release" },
    // Transaction / savepoint patterns (P7.3 expansion)
    insert: { pattern: "TRANSACTION_BEGIN", phase: "use" },
    update: { pattern: "TRANSACTION_BEGIN", phase: "use" },
    delete: { pattern: "TRANSACTION_BEGIN", phase: "use" },
    savepoint: { pattern: "TRANSACTION_BEGIN", phase: "acquire" },
    prep_two: { pattern: "TRANSACTION_COMMIT", phase: "release" },
    // Conditional patterns (P7.3 expansion)
    evaluate: { pattern: "RESOURCE_ACQUIRE", phase: "acquire" },
    grant: { pattern: "RESOURCE_USE", phase: "use" },
    deny: { pattern: "RESOURCE_USE", phase: "use" },
    escalate: { pattern: "RESOURCE_USE", phase: "use" },
    bypass: { pattern: "RESOURCE_USE", phase: "use" },
    retry: { pattern: "RESOURCE_USE", phase: "use" },
    audit: { pattern: "RESOURCE_USE", phase: "use" },
    log_: { pattern: "RESOURCE_USE", phase: "use" },
    // Loop / iteration patterns (P7.3 expansion)
    init_fetch: { pattern: "RESOURCE_ACQUIRE", phase: "acquire" },
    init_: { pattern: "RESOURCE_ACQUIRE", phase: "acquire" },
    fetch_batch: { pattern: "RESOURCE_USE", phase: "use" },
    fetch_: { pattern: "RESOURCE_USE", phase: "use" },
    has_more: { pattern: "RESOURCE_USE", phase: "use" },
    process: { pattern: "RESOURCE_USE", phase: "use" },
    poll_: { pattern: "RESOURCE_USE", phase: "use" },
    next_iter: { pattern: "RESOURCE_USE", phase: "use" },
    next_: { pattern: "RESOURCE_USE", phase: "use" },
    exit_loop: { pattern: "RESOURCE_RELEASE", phase: "release" },
    exit_: { pattern: "RESOURCE_RELEASE", phase: "release" },
    timeout_exit: { pattern: "RESOURCE_RELEASE", phase: "release" },
    timeout_: { pattern: "RESOURCE_RELEASE", phase: "release" },
    // Stateless / pure compute patterns (P7.3 expansion)
    compute: { pattern: "UNKNOWN", phase: "other" },
    validate: { pattern: "UNKNOWN", phase: "other" },
    sanitize: { pattern: "UNKNOWN", phase: "other" },
    encode: { pattern: "UNKNOWN", phase: "other" },
    decode: { pattern: "UNKNOWN", phase: "other" },
    compress: { pattern: "UNKNOWN", phase: "other" },
    decompress: { pattern: "UNKNOWN", phase: "other" },
    checksum: { pattern: "UNKNOWN", phase: "other" },
};
/**
 * Canonicalize a function name to a Software Physics pattern.
 *
 * Examples:
 *   "fopen"       → RESOURCE_ACQUIRE
 *   "sqlite3_open" → RESOURCE_ACQUIRE
 *   "db_connect"  → RESOURCE_ACQUIRE
 *   "fclose"      → RESOURCE_RELEASE
 *   "ngx_close_connection" → RESOURCE_RELEASE
 */
function canonicalize(fnName) {
    const lower = fnName.toLowerCase();
    let bestMatch = { function: fnName, pattern: "UNKNOWN", confidence: 0, phase: "other" };
    for (const [keyword, info] of Object.entries(PHYSICS_KEYWORDS)) {
        if (lower.includes(keyword)) {
            // Longer keyword match = higher confidence
            // Longer keyword = higher base confidence
            // Position bonus: keywords at word boundaries get +0.2
            let confidence = keyword.length / lower.length;
            const kwPos = lower.indexOf(keyword);
            if (kwPos === 0 || (kwPos > 0 && lower[kwPos - 1] === '_'))
                confidence += 0.2;
            if (confidence > bestMatch.confidence) {
                bestMatch = { function: fnName, pattern: info.pattern, confidence, phase: info.phase };
            }
        }
    }
    return bestMatch;
}
/**
 * Canonicalize a sequence of function calls into a Physics phase sequence.
 *
 * Example:
 *   ["fopen", "fread", "fclose"] → [ACQUIRE, USE, RELEASE]
 */
function canonicalizeSequence(fns) {
    return fns.map(canonicalize);
}
/**
 * Check if a call sequence forms a valid Software Physics pattern.
 *
 * A valid Acquire-Use-Release sequence: ACQUIRE → (USE*) → RELEASE
 * A valid transaction: BEGIN → (USE*) → COMMIT|ROLLBACK
 * A valid lock: LOCK → (USE*) → UNLOCK
 */
function isValidPhysicsSequence(fns) {
    if (fns.length < 2)
        return { valid: false, pattern: "none", detail: "Too short" };
    const seq = canonicalizeSequence(fns);
    const phases = seq.map(s => s.phase);
    const patterns = [...new Set(seq.map(s => s.pattern).filter(p => p !== "UNKNOWN"))];
    const hasAcquire = phases.includes("acquire");
    const hasRelease = phases.includes("release");
    const hasUse = phases.includes("use");
    const hasOther = phases.includes("other");
    const lastRelease = phases.lastIndexOf("release");
    const firstAcquire = phases.indexOf("acquire");
    // Valid acquire-use-release pattern: acquire before release
    if (hasAcquire && hasRelease && firstAcquire < lastRelease) {
        return { valid: true, pattern: patterns.join("→"), detail: `${patterns.length} physics patterns in valid order` };
    }
    // Valid: acquire-use pattern (no explicit release) — e.g., conditional branches
    if (hasAcquire && hasUse && !hasRelease) {
        return { valid: true, pattern: patterns.join("→"), detail: `Acquire-use sequence (open-ended), ${patterns.length} patterns` };
    }
    // Valid: pure stateless computation (all "other" phase) — e.g., hash, validate, encode
    if (!hasAcquire && !hasRelease && hasOther && phases.every(p => p === "other")) {
        return { valid: true, pattern: "stateless", detail: `Stateless computation, ${fns.length} actions` };
    }
    // Valid: mixed stateless + use actions (no acquire/release required)
    if (!hasAcquire && !hasRelease) {
        return { valid: true, pattern: patterns.join("→") || "generic", detail: `Non-resource sequence, ${fns.length} actions` };
    }
    // Invalid: release without acquire, or acquire after release
    return { valid: false, pattern: "incomplete", detail: "Release without preceding acquire, or invalid ordering" };
}
/**
 * Analyze a repository's functions through the Software Physics lens.
 *
 * Maps every function name to a Physics pattern, groups by pattern,
 * and computes coverage (how many functions are recognized).
 */
function analyzeRepoPhysics(repoName, functions) {
    const patterns = new Map();
    let recognized = 0;
    for (const fn of functions) {
        const annotation = canonicalize(fn);
        if (annotation.pattern !== "UNKNOWN") {
            recognized++;
            const list = patterns.get(annotation.pattern) || [];
            list.push(fn);
            patterns.set(annotation.pattern, list);
        }
    }
    return {
        repo: repoName,
        functions,
        patterns,
        coverage: functions.length > 0 ? recognized / functions.length : 0,
    };
}
/**
 * Compare two repositories to find shared Physics patterns.
 *
 * Even if the function names are completely different
 * (fopen vs sqlite3_open), the Physics patterns should match.
 */
function compareRepoPhysics(a, b) {
    const aPatterns = new Set(a.patterns.keys());
    const bPatterns = new Set(b.patterns.keys());
    const shared = [...aPatterns].filter(p => bPatterns.has(p) && p !== "UNKNOWN");
    const totalPatterns = new Set([...aPatterns, ...bPatterns]);
    const similarity = totalPatterns.size > 0 ? shared.length / totalPatterns.size : 0;
    return {
        sharedPatterns: shared,
        similarity,
        detail: shared.length > 0
            ? `${shared.length} shared patterns (${shared.join(", ")})`
            : "No shared physics patterns — structurally unrelated",
    };
}
// ═══════════════════════════════════════════════════════════════
// Known Repository Signatures
// ═══════════════════════════════════════════════════════════════
exports.KNOWN_REPO_SIGNATURES = {
    Redis: ["createClient", "sendCommand", "readReply", "closeClient", "selectDB", "getKey", "setKey"],
    SQLite: ["sqlite3_open", "sqlite3_prepare", "sqlite3_step", "sqlite3_finalize", "sqlite3_exec", "sqlite3_close"],
    nginx: ["ngx_accept_connection", "ngx_read_request", "ngx_process_request", "ngx_send_response", "ngx_close_connection", "ngx_parse_headers"],
    PostgreSQL: ["PQconnectdb", "PQexec", "PQfinish", "begin_transaction", "execute_query", "commit_transaction"],
    LevelDB: ["DB_Open", "DB_Get", "DB_Put", "DB_Close", "DB_Write", "DB_Compact"],
};
/**
 * Full cross-repository physics analysis.
 */
function analyzeCrossRepoPhysics() {
    const analyses = [];
    const pairwise = [];
    const repos = Object.entries(exports.KNOWN_REPO_SIGNATURES);
    for (const [name, fns] of repos) {
        analyses.push(analyzeRepoPhysics(name, fns));
    }
    for (let i = 0; i < analyses.length; i++) {
        for (let j = i + 1; j < analyses.length; j++) {
            const comp = compareRepoPhysics(analyses[i], analyses[j]);
            pairwise.push({ a: analyses[i].repo, b: analyses[j].repo, similarity: comp.similarity });
        }
    }
    const avgCoverage = analyses.reduce((s, a) => s + a.coverage, 0) / analyses.length;
    const avgSimilarity = pairwise.reduce((s, p) => s + p.similarity, 0) / pairwise.length;
    const verdict = avgSimilarity > 0.5 ? "structure_learned" :
        avgSimilarity > 0.3 ? "partial" :
            "name_memorized";
    return { analyses, pairwise, avgCoverage, avgSimilarity, verdict };
}
function printCrossRepoReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P6.2 Software Physics — Cross-Repo Analysis      ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Repos Analyzed: ${report.analyses.length}`);
    console.log(`Avg Coverage:   ${(report.avgCoverage * 100).toFixed(0)}%`);
    console.log(`Avg Similarity: ${(report.avgSimilarity * 100).toFixed(0)}%`);
    console.log(`Verdict:        ${report.verdict.toUpperCase()}`);
    console.log();
    console.log("─── Per-Repo Physics Coverage ───");
    for (const a of report.analyses) {
        const cov = (a.coverage * 100).toFixed(0).padStart(4);
        const patternList = [...a.patterns.entries()]
            .filter(([p]) => p !== "UNKNOWN")
            .map(([p, fns]) => `${p}(${fns.length})`)
            .join(", ");
        console.log(`  ${a.repo.padEnd(12)} ${cov}%  patterns: ${patternList || "none"}`);
    }
    console.log();
    console.log("─── Pairwise Similarity ───");
    for (const p of report.pairwise) {
        const sim = (p.similarity * 100).toFixed(0).padStart(4);
        console.log(`  ${p.a.padEnd(12)} ↔ ${p.b.padEnd(12)} ${sim}%`);
    }
    console.log();
}
