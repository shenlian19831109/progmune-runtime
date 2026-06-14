"use strict";
/**
 * P3.18-20: Transition Synthesizer + Candidate Discovery 2.0
 *
 * P3.18: Infer missing protocol transitions from benchmark failures.
 *   When verify_password produces PASSWORD_VERIFIED and generate_jwt
 *   consumes PASSWORD_VERIFIED, the synthesizer detects the connection.
 *
 * P3.19: Gap-driven benchmark generation — each inferred transition
 *   becomes a benchmark case that tests the Planner's ability to use it.
 *
 * P3.20: CandidateOrigin tracking — classify where each candidate came from
 *   so the Error Budget can decompose missing_candidate into root causes.
 *
 * Target: Top-1 ≥25%, Top-3 ≥60%, Missing Candidate ≤30%.
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
exports.trackCandidateOrigin = trackCandidateOrigin;
exports.synthesizeTransitions = synthesizeTransitions;
exports.augmentRulesWithInferences = augmentRulesWithInferences;
exports.generateGapBenchmarks = generateGapBenchmarks;
exports.writeGapBenchmarks = writeGapBenchmarks;
exports.computeEnhancedScores = computeEnhancedScores;
exports.printSynthesizerReport = printSynthesizerReport;
exports.printCandidateOriginStats = printCandidateOriginStats;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const protocol_coverage_1 = require("./protocol-coverage");
function trackCandidateOrigin(candidates, expectedRepair) {
    const stats = new Map();
    for (const c of candidates) {
        const origin = c.metadata?.source || "protocol_bfs";
        const existing = stats.get(origin) || { count: 0, successCount: 0 };
        existing.count++;
        if (expectedRepair) {
            const actions = c.fixPath || c.actions?.map((a) => a.function) || [];
            const match = expectedRepair.every(fn => actions.includes(fn));
            if (match)
                existing.successCount++;
        }
        stats.set(origin, existing);
    }
    return [...stats.entries()].map(([origin, s]) => ({
        origin,
        count: s.count,
        successCount: s.successCount,
        successRate: s.count > 0 ? s.successCount / s.count : 0,
    })).sort((a, b) => b.count - a.count);
}
/**
 * Analyze benchmark failures to infer missing protocol transitions.
 *
 * For each expected repair chain, checks whether consecutive function
 * pairs have a valid state transition in the protocol rules. If not,
 * the pair is recorded as an inferred transition.
 *
 * Confidence = evidenceCount / maxEvidence across all inferences.
 */
function synthesizeTransitions(failures, protocols) {
    const defs = protocols || (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const ruleMap = new Map();
    for (const p of defs)
        ruleMap.set(p.name, p.rules);
    const inferred = new Map();
    for (const f of failures) {
        const chain = f.expectedRepair;
        for (let i = 0; i < chain.length - 1; i++) {
            const fnA = chain[i];
            const fnB = chain[i + 1];
            // Find which protocol these functions belong to
            for (const [protoName, rules] of ruleMap) {
                const ruleA = rules.get(fnA);
                const ruleB = rules.get(fnB);
                if (!ruleA || !ruleB)
                    continue;
                // Check if transition exists: post_states of A → pre_states of B
                const postA = ruleA.post_states;
                const preB = ruleB.pre_states;
                const connected = postA.some(s => preB.includes(s));
                if (connected)
                    continue; // transition already exists
                const key = `${protoName}:${fnA}→${fnB}`;
                const existing = inferred.get(key);
                if (existing) {
                    existing.evidenceCount++;
                    if (!existing.examples.includes(f.goal))
                        existing.examples.push(f.goal);
                }
                else {
                    // Use the first post_state of A as the from-state
                    const fromState = postA[0] || "?";
                    const toState = preB[0] || "?";
                    inferred.set(key, {
                        action: `${fnA} → ${fnB}`,
                        protocol: protoName,
                        evidenceCount: 1,
                        examples: [f.goal],
                    });
                }
            }
        }
    }
    const maxEvidence = Math.max(1, ...[...inferred.values()].map(v => v.evidenceCount));
    const results = [];
    for (const [key, entry] of inferred) {
        const parts = key.split(":");
        const protoAndPair = parts.slice(1).join(":");
        const [fnA, fnB] = entry.action.split(" → ");
        const protoName = entry.protocol;
        const rules = ruleMap.get(protoName);
        const ruleA = rules?.get(fnA);
        const ruleB = rules?.get(fnB);
        const fromState = ruleA?.post_states[0] || "?";
        const toState = ruleB?.pre_states[0] || "?";
        results.push({
            from: fromState,
            to: toState,
            action: entry.action,
            protocol: protoName,
            confidence: entry.evidenceCount / maxEvidence,
            evidenceCount: entry.evidenceCount,
            examples: entry.examples.slice(0, 3),
        });
    }
    return results.sort((a, b) => b.confidence - a.confidence);
}
/**
 * Apply inferred transitions to augment protocol rules.
 * Returns augmented rules with inferred edges added as virtual rules.
 */
function augmentRulesWithInferences(rules, inferences, minConfidence = 0.5) {
    const augmented = new Map(rules);
    for (const inf of inferences) {
        if (inf.confidence < minConfidence)
            continue;
        const [fnA, fnB] = inf.action.split(" → ");
        // Add a virtual bridge rule: fnA_inferred → produces the state fnB needs
        const bridgeName = `_inferred_${fnA}_to_${fnB}`;
        if (!augmented.has(bridgeName)) {
            augmented.set(bridgeName, {
                pre_states: [inf.from],
                post_states: [inf.to],
                namespace: "inferred",
            });
        }
    }
    return augmented;
}
/**
 * Generate benchmark cases from inferred transitions.
 * Each inferred transition becomes a test case that validates
 * the Planner can use the newly discovered edge.
 */
function generateGapBenchmarks(inferences, minConfidence = 0.3) {
    const cases = [];
    for (const inf of inferences) {
        if (inf.confidence < minConfidence)
            continue;
        const [fnA, fnB] = inf.action.split(" → ");
        // Broken: just fnA (missing the connecting edge)
        cases.push({
            goal: `verify transition: ${inf.action}`,
            protocol: "_global",
            broken: [fnA],
            expected: [fnA, fnB],
            violationType: "missing_prerequisite",
            targetsGap: inf.action,
            confidence: inf.confidence,
        });
        // Also generate the resource-cleanup variant if fnB invalidates something
        if (inf.to === "∅" || inf.from === inf.to) {
            cases.push({
                goal: `verify cleanup after: ${inf.action}`,
                protocol: "_global",
                broken: [fnA, fnB],
                expected: [fnA, fnB],
                violationType: "resource_leak",
                targetsGap: `cleanup:${inf.action}`,
                confidence: inf.confidence,
            });
        }
    }
    return cases.sort((a, b) => b.confidence - a.confidence);
}
/** Write generated gap benchmarks to disk. */
function writeGapBenchmarks(cases, outputDir) {
    const outDir = outputDir || path.resolve(__dirname, "..", "benchmarks", "synthesized");
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir, { recursive: true });
    const filepath = path.join(outDir, `transition_gaps_${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(filepath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: "transition-synthesizer",
        count: cases.length,
        cases,
    }, null, 2));
    return filepath;
}
/**
 * Enhanced knowledge score including candidate discovery rate.
 *
 *   score = 0.30*coverage + 0.25*success + 0.20*benchmark
 *         + 0.10*corpus + 0.15*discoveryRate
 */
function computeEnhancedScores(protocolNames, coverageReport, benchmarkStats, candidateStats = {}) {
    return protocolNames.map(name => {
        const cov = coverageReport.find(c => c.protocol === name);
        const bench = benchmarkStats[name] || { total: 0, passed: 0 };
        const cand = candidateStats[name] || { total: 0, found: 0 };
        const coverage = cov ? (cov.stateCoverage + cov.transitionCoverage) / 2 : 0;
        const successRate = bench.total > 0 ? bench.passed / bench.total : 0;
        const benchmarkPassRate = bench.total > 0 ? bench.passed / bench.total : 0;
        const corpusSupport = Math.min(1, bench.total / 50);
        const discoveryRate = cand.total > 0 ? cand.found / cand.total : 0;
        const score = 0.30 * coverage +
            0.25 * successRate +
            0.20 * benchmarkPassRate +
            0.10 * corpusSupport +
            0.15 * discoveryRate;
        return { protocol: name, coverage, successRate, benchmarkPassRate, corpusSupport, discoveryRate, score };
    }).sort((a, b) => b.score - a.score);
}
// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════
function printSynthesizerReport(inferences) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   Transition Synthesizer Report                    ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Inferred Transitions: ${inferences.length}\n`);
    if (inferences.length === 0) {
        console.log("  All transitions covered. No gaps to infer.\n");
        return;
    }
    console.log("─── Top Inferred Transitions ───");
    console.log("Conf    Evidence  Transition");
    console.log("────────────────────────────────────────────────");
    for (const inf of inferences.slice(0, 15)) {
        const conf = (inf.confidence * 100).toFixed(0).padStart(4);
        console.log(`  ${conf}%     ${String(inf.evidenceCount).padStart(2)}       ${inf.protocol}: ${inf.action}  (${inf.from} → ${inf.to})`);
    }
    console.log();
}
function printCandidateOriginStats(stats) {
    console.log("\n─── Candidate Origin Contribution ───");
    console.log("Origin              Count   SuccessRate");
    console.log("────────────────────────────────────────");
    for (const s of stats) {
        const rate = (s.successRate * 100).toFixed(0).padStart(4);
        console.log(`  ${s.origin.padEnd(18)} ${String(s.count).padStart(5)}  ${rate}%`);
    }
    console.log();
}
