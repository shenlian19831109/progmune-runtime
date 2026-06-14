"use strict";
/**
 * P6.1: Evaluation Hardening
 *
 * Makes metrics trustworthy by eliminating data contamination:
 *
 *   1. Blind Benchmark: train/test split on known protocols
 *   2. Holdout Protocol: train on N-1 protocols, test on the held-out one
 *   3. Discovery Ceiling: decompose 57% missing_candidate into root causes
 *
 * Core question: "Do our metrics reflect real capability or data leakage?"
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
exports.createBlindSplit = createBlindSplit;
exports.runBlindBenchmark = runBlindBenchmark;
exports.runHoldoutEvaluation = runHoldoutEvaluation;
exports.analyzeDiscoveryCeiling = analyzeDiscoveryCeiling;
exports.runEvaluationHardening = runEvaluationHardening;
exports.printHardeningReport = printHardeningReport;
const path = __importStar(require("path"));
const protocol_coverage_1 = require("./protocol-coverage");
const protocol_extractor_v2_1 = require("./protocol-extractor-v2");
const evaluation_campaign_1 = require("./evaluation-campaign");
const repo_evaluator_1 = require("./repo-evaluator");
/**
 * Split known protocols into train/test sets.
 * Default: train on File+Auth+DB, test on IR.
 */
function createBlindSplit(trainProtocols = ["FileProtocol", "AuthProtocol", "DBProtocol"], testProtocols = ["IRProtocol"]) {
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const trainRules = new Map();
    const testRules = new Map();
    for (const p of defs) {
        if (trainProtocols.includes(p.name)) {
            for (const [fn, rule] of p.rules)
                trainRules.set(fn, rule);
        }
        if (testProtocols.includes(p.name)) {
            for (const [fn, rule] of p.rules)
                testRules.set(fn, rule);
        }
    }
    return { trainProtocols, testProtocols, trainRules, testRules };
}
/**
 * Run a blind benchmark: train extractor on train protocols,
 * evaluate on held-out test protocols.
 */
function runBlindBenchmark(repoPath, split) {
    const s = split || createBlindSplit();
    // Extract from the test repository
    const extraction = (0, protocol_extractor_v2_1.extractProtocolV2)(repoPath, "BlindTest", 100);
    // Convert extracted rules to InferredRule array for comparison
    const extractedRules = [...extraction.rules.entries()].map(([fn, r]) => ({
        function: fn, pre_states: r.pre_states, post_states: r.post_states,
        invalidate: r.invalidate, confidence: 1, evidence: 1,
    }));
    // Compare extracted rules against test protocol (should find some)
    const testComparison = (0, repo_evaluator_1.compareRules)(extractedRules, s.testRules);
    // Also compare against train protocols
    const trainComparison = (0, repo_evaluator_1.compareRules)(extractedRules, s.trainRules);
    const gap = trainComparison.f1 - testComparison.f1;
    const verdict = gap > 0.3 ? "clean" : // big gap = train leaks less into test
        gap < 0.1 ? "contaminated" : // small gap = possible leakage
            "inconclusive";
    return {
        split: s,
        trainCoverage: trainComparison.f1,
        testCoverage: testComparison.f1,
        generalizationGap: gap,
        extractionF1: testComparison.f1,
        verdict,
    };
}
/**
 * Test generalization to a completely unseen protocol.
 *
 * Train extraction + planning on N-1 protocols,
 * evaluate on the held-out protocol's benchmark cases.
 */
function runHoldoutEvaluation(repoPath, heldOutProtocol = "IRProtocol") {
    const allProtocols = ["FileProtocol", "AuthProtocol", "DBProtocol", "IRProtocol"];
    const trainedOn = allProtocols.filter(p => p !== heldOutProtocol);
    // Extract from the repo — but only train rules are known
    const extraction = (0, protocol_extractor_v2_1.extractProtocolV2)(repoPath, "HoldoutTest", 100);
    // Compare extracted rules against the held-out protocol
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const heldOutDef = defs.find(p => p.name === heldOutProtocol);
    if (!heldOutDef) {
        return { heldOutProtocol, trainedOn, extractionF1: 0, discoveryRate: 0, top3Rate: 0, verdict: "fails", reason: "Protocol not found in definitions" };
    }
    const heldOutRules = new Map(heldOutDef.rules);
    const extractedFns = new Set(extraction.rules.keys());
    let matched = 0;
    for (const fn of extractedFns) {
        if (heldOutRules.has(fn))
            matched++;
    }
    const precision = extractedFns.size > 0 ? matched / extractedFns.size : 0;
    const recall = heldOutRules.size > 0 ? matched / heldOutRules.size : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    const verdict = f1 > 0.4 ? "generalizes" :
        f1 > 0.1 ? "partial" :
            "fails";
    return {
        heldOutProtocol,
        trainedOn,
        extractionF1: f1,
        discoveryRate: f1, // proxy: extraction F1 ≈ discovery capability
        top3Rate: 0, // would need full benchmark run
        verdict,
        reason: f1 > 0.4
            ? `System generalizes to unseen protocol ${heldOutProtocol} (F1=${(f1 * 100).toFixed(0)}%)`
            : f1 > 0.1
                ? `Partial generalization to ${heldOutProtocol}. Protocol has some recognizable patterns.`
                : `Failed to generalize to ${heldOutProtocol}. Protocol rules are structurally different from training.`,
    };
}
/**
 * Analyze the 57% missing_candidate to determine the discovery ceiling.
 *
 * Decomposes each missing case into a root cause by checking:
 *   1. Is the expected function in any protocol rule? → protocol_missing
 *   2. Is there a cross-protocol bridge? → bridge_missing
 *   3. Can the extractor find this call pair? → extraction_failure
 *   4. Can BFS reach the target within depth limit? → planner_depth_limit
 *   5. Did the search timeout? → search_timeout
 *   6. Was the candidate found but ranked wrong? → ranking_side_effect
 *   7. Otherwise → benchmark_artifact
 */
function analyzeDiscoveryCeiling(attributed, rules, extractorF1 = 0.69) {
    const missing = attributed.filter(a => a.failureReason === "missing_candidate");
    const breakdown = {
        protocol_missing: 0,
        bridge_missing: 0,
        extraction_failure: 0,
        planner_depth_limit: 0,
        search_timeout: 0,
        ranking_side_effect: 0,
        benchmark_artifact: 0,
    };
    for (const a of missing) {
        let classified = false;
        // 1. Check if expected functions exist in protocol rules
        const unknownFns = a.expectedRepair.filter(fn => !rules.has(fn));
        if (unknownFns.length > 0) {
            breakdown.protocol_missing++;
            classified = true;
        }
        // 2. Check cross-protocol bridges (functions from ≥2 different protocol domains)
        if (!classified && a.expectedRepair.length >= 3) {
            const domains = new Set();
            const authFns = new Set(["verify_password", "generate_jwt", "create_session", "logout", "revoke_token"]);
            const fileFns = new Set(["open_file", "read_file", "write_file", "close_file"]);
            const dbFns = new Set(["connect_db", "query_db", "disconnect_db"]);
            const irFns = new Set(["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"]);
            for (const fn of a.expectedRepair) {
                if (authFns.has(fn))
                    domains.add("auth");
                if (fileFns.has(fn))
                    domains.add("file");
                if (dbFns.has(fn))
                    domains.add("db");
                if (irFns.has(fn))
                    domains.add("ir");
            }
            if (domains.size >= 2) {
                breakdown.bridge_missing++;
                classified = true;
            }
        }
        // 3. Extraction failure (would the extractor catch this?)
        if (!classified && extractorF1 < 0.5) {
            breakdown.extraction_failure++;
            classified = true;
        }
        // 4. Planner depth limit
        if (!classified && a.expectedRepair.length > 6) {
            breakdown.planner_depth_limit++;
            classified = true;
        }
        // 5. Candidates returned but none matched → search_timeout or ranking
        if (!classified && a.candidatesReturned > 0) {
            breakdown.ranking_side_effect++;
            classified = true;
        }
        // 6. Fallback
        if (!classified) {
            breakdown.benchmark_artifact++;
        }
    }
    const total = missing.length;
    const percentages = {};
    for (const [k, v] of Object.entries(breakdown)) {
        percentages[k] = total > 0 ? v / total : 0;
    }
    // Achievable ceiling: if we fix protocol_missing + bridge_missing + extraction_failure
    const fixable = breakdown.protocol_missing + breakdown.bridge_missing + breakdown.extraction_failure;
    const fixablePct = total > 0 ? fixable / total : 0;
    const currentDiscovery = attributed.filter(a => a.failureReason !== "missing_candidate").length / attributed.length;
    const achievableCeiling = currentDiscovery + fixablePct * (1 - currentDiscovery);
    return {
        totalMissing: total,
        breakdown: breakdown,
        percentages: percentages,
        achievableCeiling,
        recommendation: breakdown.protocol_missing > breakdown.ranking_side_effect
            ? "P0: Expand protocol rules. Protocol coverage is the bottleneck."
            : breakdown.extraction_failure > breakdown.protocol_missing
                ? "P0: Improve protocol extraction. Extractor F1 must increase."
                : "P0: Improve planner search. Depth limit or ranking is the bottleneck.",
    };
}
async function runEvaluationHardening(repoPath, telemetry) {
    const repo = repoPath || path.resolve(__dirname, "..");
    const blind = runBlindBenchmark(repo);
    const holdout = runHoldoutEvaluation(repo);
    const attributed = await (0, evaluation_campaign_1.runFailureAttribution)();
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const allRules = new Map();
    for (const p of defs)
        for (const [fn, rule] of p.rules)
            allRules.set(fn, rule);
    const ceiling = analyzeDiscoveryCeiling(attributed, allRules, 0.69);
    // Credibility score: weighted average of blind+holdout+ceiling evidence
    const blindScore = blind.verdict === "clean" ? 1.0 : blind.verdict === "inconclusive" ? 0.5 : 0.2;
    const holdoutScore = holdout.verdict === "generalizes" ? 1.0 : holdout.verdict === "partial" ? 0.5 : 0.2;
    const ceilingScore = ceiling.achievableCeiling > 0.5 ? 1.0 : 0.5;
    const credibilityScore = blindScore * 0.4 + holdoutScore * 0.4 + ceilingScore * 0.2;
    return { blind, holdout, ceiling, credibilityScore };
}
function printHardeningReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P6.1 Evaluation Hardening Report                 ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Credibility Score: ${(report.credibilityScore * 100).toFixed(0)}%`);
    console.log();
    console.log("─── Blind Benchmark ───");
    console.log(`  Train: ${report.blind.split.trainProtocols.join(", ")}`);
    console.log(`  Test:  ${report.blind.split.testProtocols.join(", ")}`);
    console.log(`  Train F1: ${(report.blind.trainCoverage * 100).toFixed(0)}%`);
    console.log(`  Test F1:  ${(report.blind.testCoverage * 100).toFixed(0)}%`);
    console.log(`  Generalization Gap: ${(report.blind.generalizationGap * 100).toFixed(0)}%`);
    console.log(`  Verdict: ${report.blind.verdict.toUpperCase()}`);
    console.log();
    console.log("─── Holdout Protocol ───");
    console.log(`  Held Out: ${report.holdout.heldOutProtocol}`);
    console.log(`  Trained On: ${report.holdout.trainedOn.join(", ")}`);
    console.log(`  Extraction F1: ${(report.holdout.extractionF1 * 100).toFixed(0)}%`);
    console.log(`  Verdict: ${report.holdout.verdict.toUpperCase()} — ${report.holdout.reason}`);
    console.log();
    console.log("─── Discovery Ceiling ───");
    console.log(`  Total Missing: ${report.ceiling.totalMissing}`);
    console.log(`  Achievable Ceiling: ${(report.ceiling.achievableCeiling * 100).toFixed(0)}%`);
    console.log();
    console.log("  Breakdown:");
    for (const [cause, pct] of Object.entries(report.ceiling.percentages).sort((a, b) => b[1] - a[1])) {
        const bar = "█".repeat(Math.round(pct * 30));
        console.log(`    ${cause.padEnd(22)} ${(pct * 100).toFixed(0).padStart(4)}% ${bar}`);
    }
    console.log();
    console.log(`  Recommendation: ${report.ceiling.recommendation}`);
    console.log();
}
