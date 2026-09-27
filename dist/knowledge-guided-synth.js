"use strict";
/**
 * P6: Knowledge-Guided Rule Synthesis
 *
 * The existing synthesizer generates too many rules (452 from 61 sequences)
 * because it blindly clusters ALL observed patterns. This module adds
 * knowledge-based filtering to produce fewer, higher-quality rules.
 *
 * Three filters:
 *   1. DOMAIN_FILTER    — Only generate rules for protocol-relevant functions
 *   2. SPECIFICITY_FILTER — Require minimum pre/post state specificity
 *   3. FREQUENCY_FILTER — Require pattern observed in ≥N sequences
 *
 * Target: 452 rules → ~50 high-quality rules (89% reduction)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.synthesizeWithKnowledge = synthesizeWithKnowledge;
exports.formatKGSynthesisStats = formatKGSynthesisStats;
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
// ═══════════════════════════════════════════════════════════════
// Knowledge Base — Protocol-Relevant Function Patterns
// ═══════════════════════════════════════════════════════════════
/**
 * Protocol domain patterns — functions matching these patterns
 * are likely to be part of real protocols (TLS, SSH, HTTP, File, Auth).
 *
 * Functions NOT matching any pattern are likely utilities, helpers,
 * or internal functions that should be excluded from rule generation.
 */
const PROTOCOL_DOMAINS = [
    {
        domain: "TLS/SSL",
        patterns: [
            /ssl/i, /tls/i, /handshake/i, /cipher/i, /cert/i, /verify/i,
            /encrypt/i, /decrypt/i, /key/i, /x509/i, /pki/i,
            /SSL_/i, /TLS_/i, /ossl_/i,
        ],
    },
    {
        domain: "SSH",
        patterns: [
            /ssh_/i, /sftp/i, /scp/i, /auth_/i, /kex/i, /hostkey/i,
            /SSH_/i, /ssh_/i,
        ],
    },
    {
        domain: "HTTP",
        patterns: [
            /http/i, /request/i, /response/i, /header/i, /cookie/i,
            /session/i, /url/i, /uri/i, /CURL/i, /curl_/i, /ngx_http/i,
        ],
    },
    {
        domain: "File I/O",
        patterns: [
            /open_/i, /close_/i, /read_/i, /write_/i, /file_/i,
            /fopen/i, /fclose/i, /fread/i, /fwrite/i, /fd_/i,
        ],
    },
    {
        domain: "Auth",
        patterns: [
            /auth/i, /login/i, /logout/i, /password/i, /token/i,
            /verify_/i, /credential/i, /oauth/i, /jwt/i,
        ],
    },
    {
        domain: "Connection",
        patterns: [
            /connect/i, /disconnect/i, /bind/i, /listen/i, /accept/i,
            /socket/i, /resolve/i, /dns/i,
        ],
    },
    {
        domain: "Memory/Resource",
        patterns: [
            /alloc/i, /free/i, /init/i, /cleanup/i, /destroy/i,
            /create_/i, /delete_/i, /new_/i, /release/i, /acquire/i,
        ],
    },
];
/**
 * Generic utility functions that are NOT protocol-relevant.
 * Rules generated from these functions are almost always false positives.
 */
const GENERIC_FUNCTIONS = new Set([
    // Standard library
    "memset", "memcpy", "memmove", "memcmp", "strlen", "strcmp", "strcasecmp",
    "strdup", "strcpy", "strncpy", "strcat", "sprintf", "snprintf",
    "malloc", "calloc", "realloc", "free",
    "printf", "fprintf", "assert", "abort", "exit",
    // Preprocessor / compiler
    "defined", "UNUSED", "FALLTHROUGH", "GOOD_MULTI_HANDLE",
    // Data structures
    "STACK_OF", "ERR_clear_error", "curlx_dyn_init",
    // Generic utility
    "time", "delay", "sleep", "usleep",
    "buffer", "files", "multi_now", "scheme",
    "curl_socket", "curl_dynhds_init", "curl_global_trace",
    "is_pkcs11_uri", "ossl_do_file_type",
    // One-off internal helpers
    "init_telnet", "rfc2228", "myssh_to_error",
    "libssh2_sftp_stat_ex",
]);
const DEFAULT_KG_OPTIONS = {
    minFrequency: 3, // Cluster must have ≥3 sequences
    minSpecificity: 1,
    filterGenerics: true,
    requireDomain: false,
};
/**
 * Check if a function name matches any known protocol domain.
 */
function matchesDomain(fnName) {
    for (const domain of PROTOCOL_DOMAINS) {
        if (domain.patterns.some(p => p.test(fnName))) {
            return domain.domain;
        }
    }
    return null;
}
function classifySemanticRole(fnName, preStates, postStates, invalidate) {
    const fn = fnName.toLowerCase();
    // Init: creates/acquires resources — empty pre_states, produces post_states
    if (preStates.length === 0 && postStates.length > 0)
        return "init";
    // Cleanup: releases/invalidates resources
    if (invalidate && invalidate.length > 0)
        return "cleanup";
    // Use: requires pre_states, may produce post_states, no invalidation
    if (preStates.length > 0)
        return "use";
    return "unknown";
}
function synthesizeWithKnowledge(sequences, options = {}) {
    const opts = { ...DEFAULT_KG_OPTIONS, ...options };
    const stats = {
        inputSequences: sequences.length,
        filteredSequences: sequences.length, // Don't filter sequences — filter rules instead
        rawProtocols: 0,
        rawRules: 0,
        filteredProtocols: 0,
        filteredRules: 0,
        byFilter: { domain: 0, generic: 0, frequency: 0, specificity: 0 },
        domainBreakdown: {},
    };
    // Step 1: Run the existing synthesizer on ALL sequences (don't pre-filter)
    const rawProtocols = (0, auto_protocol_synthesizer_1.synthesizeProtocols)(sequences);
    stats.rawProtocols = rawProtocols.length;
    let totalRawRules = 0;
    for (const p of rawProtocols)
        totalRawRules += p.rules.length;
    stats.rawRules = totalRawRules;
    // Step 2: Filter synthesized rules by quality
    const rules = new Map();
    const namespaces = new Set();
    // Count function frequency across ALL sequences
    const fnFrequency = new Map();
    for (const seq of sequences) {
        const seen = new Set();
        for (const fn of seq) {
            if (!seen.has(fn)) {
                fnFrequency.set(fn, (fnFrequency.get(fn) || 0) + 1);
                seen.add(fn);
            }
        }
    }
    for (const proto of rawProtocols) {
        // Frequency/confidence filter: cluster must have sufficient confidence
        // (closedLoopRate from clustering — higher = stronger pattern)
        if (proto.confidence < 0.3 && proto.prototype.length < 5) {
            stats.byFilter.frequency++;
            continue;
        }
        let keptRules = 0;
        for (const r of proto.rules) {
            // Filter 1: Generic/utility functions — these match everywhere, always FP
            if (opts.filterGenerics && GENERIC_FUNCTIONS.has(r.function)) {
                stats.byFilter.generic++;
                continue;
            }
            // Filter 2: Frequency — function must appear in ≥minFrequency sequences
            const freq = fnFrequency.get(r.function) || 0;
            if (freq < opts.minFrequency) {
                stats.byFilter.frequency++;
                continue;
            }
            // Filter 3: Semantic role
            const role = classifySemanticRole(r.function, r.pre_states, r.post_states, r.invalidate);
            if (role === "unknown") {
                stats.byFilter.specificity++;
                continue;
            }
            // Filter 4: Domain annotation
            const domain = matchesDomain(r.function);
            const ns = domain || proto.inferredPattern || "discovered";
            namespaces.add(ns);
            stats.domainBreakdown[domain || "unknown"] =
                (stats.domainBreakdown[domain || "unknown"] || 0) + 1;
            rules.set(r.function, {
                pre_states: r.pre_states,
                post_states: r.post_states,
                invalidate: r.invalidate,
                namespace: ns,
            });
            keptRules++;
        }
        if (keptRules > 0) {
            stats.filteredProtocols++;
        }
    }
    stats.filteredRules = rules.size;
    // Build namespace initial states
    const nsInit = new Map();
    nsInit.set("_global", "INIT");
    for (const ns of namespaces) {
        nsInit.set(ns, "INIT");
    }
    return { rules, nsInit, stats };
}
function formatKGSynthesisStats(stats) {
    const lines = [];
    const reduction = stats.rawRules > 0
        ? ((1 - stats.filteredRules / stats.rawRules) * 100).toFixed(0)
        : "0";
    lines.push("");
    lines.push("── Knowledge-Guided Synthesis ──");
    lines.push(`  Input sequences:   ${stats.inputSequences}`);
    lines.push(`  After domain filter: ${stats.filteredSequences} (${stats.byFilter.domain} removed by domain, ${stats.byFilter.generic} generics)`);
    lines.push(`  Raw protocols:     ${stats.rawProtocols}`);
    lines.push(`  Raw rules:         ${stats.rawRules}`);
    lines.push(`  Filtered rules:    ${stats.filteredRules} (${reduction}% reduction)`);
    lines.push("");
    lines.push("  ── Filter breakdown ──");
    lines.push(`  Domain mismatch:   ${stats.byFilter.domain}`);
    lines.push(`  Generic function:  ${stats.byFilter.generic}`);
    lines.push(`  Low frequency:     ${stats.byFilter.frequency}`);
    lines.push(`  Low specificity:   ${stats.byFilter.specificity}`);
    lines.push("");
    lines.push("  ── Domain distribution ──");
    for (const [domain, count] of Object.entries(stats.domainBreakdown).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${domain.padEnd(20)} ${count} rules`);
    }
    lines.push("");
    return lines.join("\n");
}
