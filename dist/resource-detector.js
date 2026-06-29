"use strict";
/**
 * Resource Lifecycle Detector
 *
 * Focused detection of resource acquire/release violations.
 * Replaces noisy auto-discovered call-ordering rules with
 * explicit acquire→release pair analysis.
 *
 * Strategy:
 *   1. Identify resource-acquiring calls (malloc, open, connect, SSL_new, ...)
 *   2. Identify resource-releasing calls (free, close, disconnect, SSL_free, ...)
 *   3. Flag violations: acquire without corresponding release in same scope
 *   4. Exclude "allocation-return" pattern (function allocates for caller)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectResourceViolations = detectResourceViolations;
exports.validateResourceLifecycle = validateResourceLifecycle;
// ── Known resource pairs ──
const RESOURCE_PAIRS = [
    // Memory
    { acquire: /\b(malloc|calloc|realloc|curlx_malloc|curlx_calloc|curlx_realloc|zmalloc|zcalloc|zrealloc|ngx_alloc|ngx_calloc|ngx_palloc)\b/i, release: /\b(free|curlx_free|zfree|ngx_free|ngx_pfree)\b/i, category: "memory" },
    // File descriptors (accept removed — listening sockets stay open)
    { acquire: /\b(open|fopen|socket|curlx_open)\b/i, release: /\b(close|fclose|closesocket|curlx_close|shutdown)\b/i, category: "file" },
    // SSL/TLS (expanded with CTX and bio patterns)
    { acquire: /\b(SSL_new|TLS_new|wolfSSL_new|gtls_new|BIO_new|ossl_new|nghttp2_session_new|SSL_CTX_new|BIO_new_mem_buf|BIO_s_file|BIO_read_filename)\b/i, release: /\b(SSL_free|TLS_free|wolfSSL_free|gtls_free|BIO_free|ossl_free|nghttp2_session_del|SSL_CTX_free|BIO_free_all)\b/i, category: "ssl" },
    // Connections (accept removed — server socket, not per-connection resource)
    { acquire: /\b(connect|Curl_connect|ngx_connect|redisConnect)\b/i, release: /\b(disconnect|Curl_disconnect|ngx_disconnect|redisFree)\b/i, category: "connection" },
    // General lifecycle — only for double-release / UAF checks, not missing-release
    { acquire: /\b(_init|_create|_setup|_start|_begin|_open|_alloc|_connect|init|create|setup|start|open|alloc)\b/i, release: /\b(_free|_destroy|_cleanup|_close|_stop|_end|_release|_unlock|_done|_finish|_remove|_delete|cleanup|destroy|close|free)\b/i, category: "lifecycle" },
];
// ── Allocation-return patterns (functions that allocate and return to caller) ──
const ALLOCATOR_PATTERNS = [
    /\b(create|alloc|new|init|open|dup|clone|copy|build|make|setup|construct)\w*\b/i,
];
// ── Cleanup/destructor functions (expected to call release without acquire) ──
const CLEANUP_PATTERNS = [
    /\b(remove|cleanup|destroy|free|close|delete|detach|release|shutdown|teardown|done|finish)\w*\b/i,
];
function isAllocatorFunction(funcName) {
    return ALLOCATOR_PATTERNS.some(p => p.test(funcName));
}
function isCleanupFunction(funcName) {
    return CLEANUP_PATTERNS.some(p => p.test(funcName));
}
function detectResourceViolations(calls, enclosingFuncName) {
    const violations = [];
    const funcName = enclosingFuncName || "";
    for (const pair of RESOURCE_PAIRS) {
        const acquires = [];
        const releases = [];
        for (let i = 0; i < calls.length; i++) {
            const c = calls[i];
            if (pair.acquire.test(c) && !isAllocatorFunction(c))
                acquires.push(i);
            if (pair.release.test(c))
                releases.push(i);
        }
        // Rule 1: more acquires than releases → potential leak
        // Exception: allocator functions (return resource to caller)
        // Exception: cleanup functions (release resources allocated elsewhere)
        // Exception: lifecycle category (too broad for missing-release check)
        if (acquires.length > releases.length && acquires.length > 0 && pair.category !== "lifecycle") {
            if (!isAllocatorFunction(funcName) && !isCleanupFunction(funcName)) {
                for (let i = releases.length; i < acquires.length; i++) {
                    violations.push({
                        type: "missing_release",
                        category: pair.category,
                        acquireCall: calls[acquires[i]],
                        detail: `${calls[acquires[i]]} acquired without matching ${pair.release.source} — possible resource leak`,
                    });
                }
            }
        }
        // Rule 2: release before any acquire → possible double-free or UAF
        // Exception: cleanup/destructor functions expected to call release
        if (releases.length > 0 && acquires.length === 0) {
            if (!isCleanupFunction(funcName)) {
                violations.push({
                    type: "use_after_release",
                    category: pair.category,
                    releaseCall: calls[releases[0]],
                    detail: `${calls[releases[0]]} called without prior acquire — possible double-free or use-after-release`,
                });
            }
        }
        // Rule 3: release before corresponding acquire (interleaved)
        if (acquires.length > 0 && releases.length > 0) {
            for (const ri of releases) {
                // A release at position ri must have at least one acquire before it
                const hasPriorAcquire = acquires.some(ai => ai < ri);
                if (!hasPriorAcquire) {
                    violations.push({
                        type: "use_after_release",
                        category: pair.category,
                        releaseCall: calls[ri],
                        detail: `${calls[ri]} called before any ${pair.acquire.source} — possible double-free`,
                    });
                }
            }
        }
    }
    return violations;
}
/**
 * Validate a call sequence using resource lifecycle analysis.
 * Returns valid=true if no resource violations found.
 */
function validateResourceLifecycle(calls, enclosingFuncName) {
    const violations = detectResourceViolations(calls, enclosingFuncName);
    const missingCount = violations.filter(v => v.type === "missing_release").length;
    const otherCount = violations.length - missingCount;
    let detail = "";
    if (violations.length === 0) {
        detail = "Resource lifecycle clean";
    }
    else {
        const parts = [];
        if (missingCount > 0)
            parts.push(`${missingCount} potential resource leak(s)`);
        if (otherCount > 0)
            parts.push(`${otherCount} ordering violation(s)`);
        detail = parts.join(", ");
    }
    return {
        valid: violations.length === 0,
        violations,
        detail,
    };
}
// ═══════════════════════════════════════════════════════════════
// CLI — Precision Report
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
    const fs = require("fs");
    const path = require("path");
    const args = process.argv.slice(2);
    const repoPath = path.resolve(args.find(a => !a.startsWith("--")) || ".");
    const baseDir = path.dirname(repoPath);
    const repoName = path.basename(repoPath);
    const seqFile = path.join(baseDir, `${repoName}-sequences.json`);
    const labelFile = path.join(baseDir, `${repoName}-labels.json`);
    if (!fs.existsSync(seqFile) || !fs.existsSync(labelFile)) {
        console.error(`❌ Files not found: ${seqFile}, ${labelFile}`);
        process.exit(1);
    }
    const seqData = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
    const labelData = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
    const sequences = seqData.sequences || seqData;
    const labels = labelData.labels || labelData;
    let tp = 0, fp = 0, tn = 0, fn = 0;
    const mismatches = [];
    for (const seq of sequences) {
        const idx = sequences.indexOf(seq);
        const expected = labels[idx];
        if (!expected || expected === "s" || expected === "skip")
            continue;
        const result = validateResourceLifecycle(seq.calls || [], seq.function);
        const detected = result.valid ? "clean" : "violation";
        if (expected === "clean" && detected === "clean")
            tn++;
        else if (expected === "violation" && detected === "violation")
            tp++;
        else if (expected === "clean" && detected === "violation")
            fp++;
        else if (expected === "violation" && detected === "clean")
            fn++;
        if (expected !== detected || result.violations.length > 0) {
            mismatches.push({ idx, fn: seq.function, expected, detected, calls: (seq.calls || []).slice(0, 5), vios: result.violations.map(v => v.detail) });
        }
    }
    const total = tp + fp + tn + fn;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    const pct = (v) => `${(v * 100).toFixed(0)}%`;
    const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
    const color = (v) => v >= 0.7 ? C.green : v >= 0.5 ? C.yellow : C.red;
    console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}Resource Lifecycle Precision — ${repoName}${C.reset}${" ".repeat(Math.max(0, 19 - repoName.length))}${C.bold}${C.cyan}║${C.reset}`);
    console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════╝${C.reset}`);
    console.log("");
    console.log(`  Samples:    ${total}`);
    console.log(`  TP: ${C.green}${tp}${C.reset}  FP: ${C.red}${fp}${C.reset}  TN: ${C.green}${tn}${C.reset}  FN: ${C.red}${fn}${C.reset}`);
    console.log("");
    console.log(`  Precision:  ${color(precision)}${pct(precision)}${C.reset}`);
    console.log(`  Recall:     ${color(recall)}${pct(recall)}${C.reset}`);
    console.log(`  F1:         ${color(f1)}${pct(f1)}${C.reset}`);
    console.log("");
    if (mismatches.length > 0) {
        console.log(`  ${C.yellow}Details:${C.reset}`);
        for (const m of mismatches.slice(0, 12)) {
            const icon = m.expected === "violation" ? `${C.red}FN${C.reset}` : `${C.yellow}FP${C.reset}`;
            console.log(`    ${icon} [${m.idx}] ${m.expected}→${m.detected}  ${(m.calls || []).join(" → ")}`);
            if (m.vios.length)
                console.log(`       ${C.dim}${m.vios[0]}${C.reset}`);
        }
    }
    console.log("");
    const rating = f1 >= 0.7 ? `${C.green}GOOD${C.reset}` : f1 >= 0.5 ? `${C.yellow}FAIR${C.reset}` : `${C.red}NEEDS IMPROVEMENT${C.reset}`;
    console.log(`  Rating: ${rating}\n`);
}
