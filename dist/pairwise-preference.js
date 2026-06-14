"use strict";
/**
 * P3.11-13: Pairwise Preference System
 *
 * Upgrades from pointwise (accepted/rejected) to pairwise (A > B)
 * preference data — the primitive format for RLHF.
 *
 * P3.11: RepairPreference data structure + collection
 * P3.12: Enhanced benchmark with acceptableTop3 + unacceptableRepairs
 * P3.13: PreferenceRanker using pairwise win rates
 *
 * Key insight: Top-3 (37%) vs Top-1 (12%) gap = 25%.
 * Correct answers are in the candidate pool but ranked wrong.
 * Pairwise preference is how we fix this.
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
exports.PAIRWISE_BENCHMARK_CASES = exports.PreferenceRanker = void 0;
exports.createPreferenceStore = createPreferenceStore;
exports.recordPreference = recordPreference;
exports.getWinRate = getWinRate;
exports.savePreferences = savePreferences;
exports.runRankerStressTest = runRankerStressTest;
exports.printRankerStressReport = printRankerStressReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const planner_telemetry_1 = require("./planner-telemetry");
const repair_ranker_1 = require("./repair-ranker");
function createPreferenceStore() {
    return {
        preferences: [],
        winCounts: new Map(),
        comparisonCounts: new Map(),
    };
}
/** Record a pairwise preference: winner > loser. */
function recordPreference(store, winner, loser, goal, protocol) {
    const pref = { winner, loser, goal, protocol, timestamp: Date.now() };
    store.preferences.push(pref);
    store.winCounts.set(winner, (store.winCounts.get(winner) || 0) + 1);
    store.comparisonCounts.set(winner, (store.comparisonCounts.get(winner) || 0) + 1);
    store.comparisonCounts.set(loser, (store.comparisonCounts.get(loser) || 0) + 1);
}
/** Win rate: wins / total comparisons. Default 0.5 for unknowns. */
function getWinRate(store, fingerprint, minComparisons = 3) {
    const wins = store.winCounts.get(fingerprint) || 0;
    const total = store.comparisonCounts.get(fingerprint) || 0;
    if (total < minComparisons)
        return 0.5;
    return wins / total;
}
/** Persist preferences to disk. */
function savePreferences(store, dir) {
    const outDir = dir || path.resolve(process.cwd(), ".progmune_corpus", "preferences");
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `prefs-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(store.preferences, null, 2));
}
/**
 * Run a stress test: how well does the ranker distinguish
 * acceptable repairs from unacceptable ones?
 */
function runRankerStressTest(cases, candidateGenerator, ranker) {
    const results = [];
    for (const tc of cases) {
        const candidates = candidateGenerator(tc.goal, tc.protocol);
        let ranked = candidates;
        if (ranker) {
            const ctx = { protocol: tc.protocol, currentState: [], targetState: [], violationType: tc.violationType, constraints: [], rules: new Map() };
            const features = candidates.map(c => (0, repair_ranker_1.extractFeatures)(c, ctx));
            ranked = ranker(candidates, features);
        }
        const top1 = ranked[0];
        const top3 = ranked.slice(0, 3);
        const top1Correct = top1
            ? tc.expectedTop1.every(fn => top1.actions.some(a => a.kind === "call" && a.function === fn))
            : false;
        // Count acceptable patterns in top 3
        let acceptableFound = 0;
        for (const pattern of tc.acceptableTop3) {
            const found = top3.some(c => pattern.every(fn => c.actions.some(a => a.kind === "call" && a.function === fn)));
            if (found)
                acceptableFound++;
        }
        const top3Coverage = tc.acceptableTop3.length > 0 ? acceptableFound / tc.acceptableTop3.length : 0;
        // Check for unacceptable repairs
        const unacceptableFound = tc.unacceptableRepairs.some(pattern => ranked.some(c => pattern.every(fn => c.actions.some(a => a.kind === "call" && a.function === fn))));
        results.push({
            goal: tc.goal,
            top1Correct,
            top3Coverage,
            unacceptableFound,
            totalCandidates: candidates.length,
            preferenceRankerWinRate: 0,
        });
    }
    return {
        cases: cases.length,
        top1Accuracy: results.filter(r => r.top1Correct).length / Math.max(1, cases.length),
        top3Acceptability: results.reduce((s, r) => s + r.top3Coverage, 0) / Math.max(1, cases.length),
        unacceptableFiltered: results.filter(r => !r.unacceptableFound).length / Math.max(1, cases.length),
        avgCandidates: results.reduce((s, r) => s + r.totalCandidates, 0) / Math.max(1, cases.length),
    };
}
function printRankerStressReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   Ranker Stress Test Report                        ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Cases:                 ${report.cases}`);
    console.log(`Top-1 Accuracy:        ${(report.top1Accuracy * 100).toFixed(0)}%`);
    console.log(`Top-3 Acceptability:   ${(report.top3Acceptability * 100).toFixed(0)}%`);
    console.log(`Unacceptable Filtered: ${(report.unacceptableFiltered * 100).toFixed(0)}%`);
    console.log(`Avg Candidates:        ${report.avgCandidates.toFixed(1)}`);
    const top3Top1Gap = report.top3Acceptability - report.top1Accuracy;
    console.log(`\n  Top-3/Top-1 Gap:    ${(top3Top1Gap * 100).toFixed(0)}%`);
    if (top3Top1Gap > 0.2) {
        console.log("  ⚠️  Large gap: candidates found but ranked wrong. Priority = ranking.");
    }
    else {
        console.log("  ✅ Small gap: ranking is working well.");
    }
    console.log();
}
// ═══════════════════════════════════════════════════════════════
// P3.13: Preference Ranker
// ═══════════════════════════════════════════════════════════════
/**
 * PreferenceRanker: ranks candidates by pairwise win rate.
 *
 * Given historical preference data (A > B, B > C, ...),
 * computes Elo-like scores from pairwise comparisons.
 *
 *   score = winRate * 0.6 + heuristicScore * 0.4
 *
 * Where winRate comes from the preference store and
 * heuristicScore comes from the base LinearRanker.
 */
class PreferenceRanker {
    constructor(store, minComparisons = 3) {
        this.store = store || createPreferenceStore();
        this.minComparisons = minComparisons;
    }
    /** Get the pairwise win rate for a candidate's fingerprint. */
    winRate(candidate, protocol, violationType) {
        const actions = candidate.actions
            .filter(a => a.kind === "call")
            .map(a => a.function);
        const fp = (0, planner_telemetry_1.candidateFingerprint)(protocol, actions, violationType);
        return getWinRate(this.store, fp, this.minComparisons);
    }
    /**
     * Rank candidates by combining pairwise win rate with heuristic score.
     *
     *   score = winRate * 0.6 + heuristicScore * 0.4
     *
     * Where heuristicScore comes from LinearRanker (protocolSafety, performance, etc.)
     * and winRate comes from historical pairwise preferences.
     */
    rank(candidates, features, protocol, violationType) {
        const baseRanker = (0, repair_ranker_1.createLinearRanker)();
        const heuristicScores = features.map(f => baseRanker.score(f));
        const scored = candidates.map((c, i) => ({
            candidate: c,
            score: this.winRate(c, protocol, violationType) * 0.6 +
                heuristicScores[i] * 0.4,
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.candidate);
    }
    get preferences() {
        return this.store.preferences;
    }
}
exports.PreferenceRanker = PreferenceRanker;
// ═══════════════════════════════════════════════════════════════
// Pairwise Preference Benchmarks
// ═══════════════════════════════════════════════════════════════
/** Pre-built pairwise benchmark cases for ranker stress testing. */
exports.PAIRWISE_BENCHMARK_CASES = [
    {
        goal: "safely write config file",
        protocol: "FileProtocol",
        expectedTop1: ["open_file", "write_file", "close_file"],
        acceptableTop3: [
            ["open_file", "write_file", "close_file"],
            ["open_file", "write_file", "flush", "close_file"],
        ],
        unacceptableRepairs: [
            ["write_file"], // skip open
            ["open_file", "write_file"], // missing close
        ],
        violationType: "resource_leak",
    },
    {
        goal: "authenticate user",
        protocol: "AuthProtocol",
        expectedTop1: ["verify_password", "generate_jwt", "create_session"],
        acceptableTop3: [
            ["verify_password", "generate_jwt", "create_session"],
            ["verify_password", "generate_jwt"],
        ],
        unacceptableRepairs: [
            ["generate_jwt"], // skip verify
            ["create_session"], // skip verify+jwt
            ["logout"], // wrong direction
        ],
        violationType: "missing_prerequisite",
    },
    {
        goal: "logout user",
        protocol: "AuthProtocol",
        expectedTop1: ["verify_password", "generate_jwt", "create_session", "logout"],
        acceptableTop3: [
            ["verify_password", "generate_jwt", "create_session", "logout"],
        ],
        unacceptableRepairs: [
            ["logout"], // skip prerequisites entirely
        ],
        violationType: "illegal_state_transition",
    },
    {
        goal: "query database safely",
        protocol: "DBProtocol",
        expectedTop1: ["connect_db", "query_db", "disconnect_db"],
        acceptableTop3: [
            ["connect_db", "query_db", "disconnect_db"],
        ],
        unacceptableRepairs: [
            ["query_db"], // no connection
            ["connect_db", "query_db"], // missing disconnect
        ],
        violationType: "missing_prerequisite",
    },
    {
        goal: "extract IR and validate",
        protocol: "IRProtocol",
        expectedTop1: ["extractIR", "validateAction"],
        acceptableTop3: [
            ["extractIR", "validateAction"],
            ["extractIR", "validateAction", "validateActionSequence"],
        ],
        unacceptableRepairs: [
            ["validateAction"], // skip extract
            ["emitCode"], // skip entire pipeline
        ],
        violationType: "missing_prerequisite",
    },
    {
        goal: "full IR pipeline",
        protocol: "IRProtocol",
        expectedTop1: ["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"],
        acceptableTop3: [
            ["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"],
            ["extractIR", "validateAction", "validateActionSequence", "emitCode"],
        ],
        unacceptableRepairs: [
            ["extractIR", "emitCode"], // skip validation
            ["recordSession"], // skip everything
        ],
        violationType: "missing_prerequisite",
    },
];
