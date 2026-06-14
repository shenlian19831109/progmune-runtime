"use strict";
/**
 * P6.0: Protocol Foundation Model
 *
 * Scales protocol extraction from manual rules to automatic,
 * code-driven discovery. The Protocol VM's knowledge base
 * grows organically from real code patterns.
 *
 * Target: Discovery Rate 43% → 70%+
 *
 * Improvements over basic Protocol Extractor (P5.5):
 *   1. Intelligent state naming (FILE_OPEN, not STATE_OPEN)
 *   2. Domain-specific clustering (group related functions)
 *   3. Confidence-weighted rule merging
 *   4. Direct integration with benchmark evaluation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferStateName = inferStateName;
exports.inferEnhancedRules = inferEnhancedRules;
exports.extractProtocolFoundation = extractProtocolFoundation;
exports.enhancedRulesToMap = enhancedRulesToMap;
exports.measureDiscoveryImpact = measureDiscoveryImpact;
exports.printFoundationReport = printFoundationReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const protocol_extractor_1 = require("./protocol-extractor");
const repo_evaluator_1 = require("./repo-evaluator");
const protocol_coverage_1 = require("./protocol-coverage");
const evaluation_campaign_1 = require("./evaluation-campaign");
const discovery_analytics_1 = require("./discovery-analytics");
// ═══════════════════════════════════════════════════════════════
// Intelligent State Naming
// ═══════════════════════════════════════════════════════════════
const DOMAIN_KEYWORDS = {
    FILE: ["file", "fopen", "fread", "fwrite", "fclose", "open", "read", "write", "close", "flush", "sync", "stat"],
    DB: ["db", "connect", "query", "insert", "update", "delete", "disconnect", "sql", "transaction", "commit", "rollback"],
    AUTH: ["auth", "login", "logout", "password", "token", "jwt", "session", "verify", "credential", "authenticate"],
    NET: ["socket", "connect", "bind", "listen", "accept", "send", "recv", "http", "request", "response"],
    MEM: ["alloc", "malloc", "free", "realloc", "mem", "memory", "buffer", "release"],
    PROC: ["fork", "exec", "wait", "kill", "signal", "process", "thread", "mutex", "lock", "unlock"],
};
const STATE_SUFFIXES = {
    open: "_OPEN", close: "_CLOSED", connect: "_CONNECTED", disconnect: "_CLOSED",
    create: "_CREATED", destroy: "_DESTROYED", init: "_INITIALIZED", alloc: "_ALLOCATED",
    free: "_FREED", lock: "_LOCKED", unlock: "_UNLOCKED", start: "_STARTED",
    stop: "_STOPPED", begin: "_ACTIVE", end: "_COMPLETED", login: "_AUTHENTICATED",
    logout: "_UNAUTHENTICATED", read: "_READY", write: "_DIRTY",
    verify: "_VERIFIED", generate: "_ISSUED", send: "_SENT", recv: "_RECEIVED",
};
/** Infer a meaningful state name from a function name and its role. */
function inferStateName(fn, role) {
    const lower = fn.toLowerCase();
    // Find domain
    let domain = "STATE";
    for (const [dom, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) {
            domain = dom;
            break;
        }
    }
    // Find state suffix
    let suffix = "";
    for (const [key, val] of Object.entries(STATE_SUFFIXES)) {
        if (lower.includes(key)) {
            suffix = val;
            break;
        }
    }
    // Default suffixes by role
    if (!suffix) {
        suffix = role === "pre" ? "_REQUIRED" : role === "invalidate" ? "_INVALIDATED" : "_PRODUCED";
    }
    return `${domain}${suffix}`;
}
/**
 * Enhanced protocol rule inference with intelligent state names.
 */
function inferEnhancedRules(pairs, minFrequency = 3) {
    // Count transition frequencies
    const transitions = new Map();
    const fnFreq = new Map();
    for (const p of pairs) {
        const key = `${p.from}→${p.to}`;
        transitions.set(key, (transitions.get(key) || 0) + 1);
        fnFreq.set(p.from, (fnFreq.get(p.from) || 0) + 1);
        fnFreq.set(p.to, (fnFreq.get(p.to) || 0) + 1);
    }
    const maxFreq = Math.max(1, ...[...transitions.values()]);
    const rules = [];
    // Build per-function state maps
    const fnStates = new Map();
    for (const [key, freq] of transitions) {
        if (freq < minFrequency)
            continue;
        const [fnA, fnB] = key.split("→");
        const confidence = freq / maxFreq;
        // Infer state name from the PRODUCER (fnA), not consumer
        const stateName = inferStateName(fnA, "post");
        // fnA produces it, fnB requires it
        // Track for fnA
        const aStates = fnStates.get(fnA) || { produced: new Set(), required: new Set(), invalidated: new Set() };
        aStates.produced.add(stateName);
        fnStates.set(fnA, aStates);
        // Track for fnB
        const bStates = fnStates.get(fnB) || { produced: new Set(), required: new Set(), invalidated: new Set() };
        bStates.required.add(stateName);
        fnStates.set(fnB, bStates);
    }
    // Second pass: detect invalidation patterns
    for (const [key, freq] of transitions) {
        if (freq < minFrequency)
            continue;
        const [fnA, fnB] = key.split("→");
        // Check if fnB is a "closer" that invalidates fnA's produced state
        const aStates = fnStates.get(fnA);
        const bStates = fnStates.get(fnB);
        if (!aStates || !bStates)
            continue;
        const isCloser = ["close", "disconnect", "logout", "free", "destroy", "release", "stop", "end", "finish"]
            .some(kw => fnB.includes(kw));
        const isOpener = ["open", "connect", "login", "create", "alloc", "init", "start", "begin"]
            .some(kw => fnA.includes(kw));
        if (isCloser && isOpener) {
            // fnB invalidates what fnA produced
            for (const state of aStates.produced) {
                bStates.invalidated.add(state);
            }
        }
    }
    // Convert to rules
    const maxFnFreq = Math.max(1, ...[...fnFreq.values()]);
    for (const [fn, states] of fnStates) {
        const freq = fnFreq.get(fn) || 1;
        const confidence = Math.min(1, freq / maxFnFreq);
        const domain = inferDomain(fn);
        rules.push({
            function: fn,
            pre_states: [...states.required],
            post_states: [...states.produced],
            invalidate: states.invalidated.size > 0 ? [...states.invalidated] : undefined,
            confidence,
            evidence: freq,
            domain,
            stateNames: {
                pre: [...states.required],
                post: [...states.produced],
                invalidate: [...states.invalidated],
            },
        });
    }
    return rules.sort((a, b) => b.confidence - a.confidence);
}
function inferDomain(fn) {
    const lower = fn.toLowerCase();
    for (const [dom, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw)))
            return dom;
    }
    return "GENERAL";
}
/**
 * Extract a protocol foundation from a repository.
 *
 * Uses enhanced rule inference with intelligent state naming
 * and frequency-based confidence scoring.
 */
function extractProtocolFoundation(repoPath, protocolName, maxFiles = 200, minFrequency = 3) {
    const files = (0, repo_evaluator_1.scanRepository)(repoPath, maxFiles);
    const allPairs = [];
    for (const fp of files) {
        try {
            const code = fs.readFileSync(fp, "utf-8");
            allPairs.push(...(0, protocol_extractor_1.extractCallPairs)(code, fp));
        }
        catch { /* skip */ }
    }
    const rules = inferEnhancedRules(allPairs, minFrequency);
    const states = new Set();
    for (const r of rules) {
        for (const s of r.pre_states)
            states.add(s);
        for (const s of r.post_states)
            states.add(s);
        if (r.invalidate)
            for (const s of r.invalidate)
                states.add(s);
    }
    // Compare against hand-written baseline
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const handWrittenFns = new Set();
    for (const p of defs)
        for (const fn of p.rules.keys())
            handWrittenFns.add(fn);
    const extractedFns = new Set(rules.map(r => r.function));
    let overlap = 0;
    for (const fn of extractedFns) {
        if (handWrittenFns.has(fn))
            overlap++;
    }
    const avgConf = rules.length > 0 ? rules.reduce((s, r) => s + r.confidence, 0) / rules.length : 0;
    return {
        protocol: protocolName || path.basename(repoPath),
        rules,
        states: [...states],
        sourceFiles: files,
        totalPairs: allPairs.length,
        avgConfidence: avgConf,
        handWrittenOverlap: overlap,
        novelRulesCount: extractedFns.size - overlap,
    };
}
/**
 * Convert enhanced rules to SSG-compatible StateAnnotation map.
 */
function enhancedRulesToMap(rules) {
    const map = new Map();
    for (const r of rules) {
        map.set(r.function, {
            pre_states: r.pre_states,
            post_states: r.post_states,
            invalidate: r.invalidate,
        });
    }
    return map;
}
/**
 * Measure the Discovery Rate impact of adding extracted protocol rules.
 */
async function measureDiscoveryImpact(extractedRules) {
    // Baseline: current hand-written rules
    const baselineAttr = await (0, evaluation_campaign_1.runFailureAttribution)();
    const baselineBudget = (0, evaluation_campaign_1.computeErrorBudget)(baselineAttr);
    const baselineDiscovery = (0, discovery_analytics_1.computeDiscoveryMetrics)(baselineAttr);
    // Note: full integration requires running suggestAlternatives with merged rules
    // For now, compare rule coverage
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const handWrittenFns = new Set();
    for (const p of defs)
        for (const fn of p.rules.keys())
            handWrittenFns.add(fn);
    const newFns = [...extractedRules.keys()].filter(fn => !handWrittenFns.has(fn));
    return {
        baseline: {
            discoveryRate: baselineDiscovery.overall,
            top3Rate: baselineBudget.successRate,
            missingCandidate: baselineBudget.percentages.missing_candidate || 0,
        },
        rulesAdded: newFns.length,
    };
}
function printFoundationReport(result, impact) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P6.0 Protocol Foundation Model                   ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Protocol:         ${result.protocol}`);
    console.log(`Source Files:     ${result.sourceFiles.length}`);
    console.log(`Call Pairs:       ${result.totalPairs}`);
    console.log(`Rules Extracted:  ${result.rules.length}`);
    console.log(`States Inferred:  ${result.states.length}`);
    console.log(`Avg Confidence:   ${(result.avgConfidence * 100).toFixed(0)}%`);
    console.log(`Hand-written Overlap: ${result.handWrittenOverlap} functions`);
    console.log(`Novel Rules:      ${result.novelRulesCount}`);
    console.log();
    if (result.rules.length > 0) {
        console.log("─── Top Extracted Rules ───");
        console.log("Conf    Domain    Function              Pre → Post               Inv");
        console.log("────────────────────────────────────────────────────────────────────");
        for (const r of result.rules.slice(0, 15)) {
            const conf = (r.confidence * 100).toFixed(0).padStart(4);
            const dom = r.domain.padEnd(8);
            const fn = r.function.padEnd(22);
            const pre = `[${r.pre_states.join(",") || "none"}]`.padEnd(22);
            const post = `[${r.post_states.join(",") || "none"}]`.padEnd(22);
            const inv = r.invalidate ? `[${r.invalidate.join(",")}]` : "—";
            console.log(`  ${conf}%  ${dom} ${fn} ${pre} → ${post} ${inv}`);
        }
        console.log();
    }
    if (impact) {
        console.log("─── Discovery Impact ───");
        console.log(`  Baseline Discovery:     ${(impact.baseline.discoveryRate * 100).toFixed(0)}%`);
        console.log(`  Baseline Missing Cand:  ${(impact.baseline.missingCandidate * 100).toFixed(0)}%`);
        console.log(`  New Rules Added:        ${impact.rulesAdded}`);
        if (impact.rulesAdded > 0) {
            console.log(`  → Potential discovery improvement from ${impact.rulesAdded} new protocol functions`);
        }
        console.log();
    }
}
