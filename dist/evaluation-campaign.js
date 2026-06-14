"use strict";
/**
 * P3.9: Evaluation Campaign
 *
 * Shifts from "building modules" to "validating hypotheses".
 *
 * Three tools:
 *   1. Failure Attribution — classify WHY each benchmark case fails
 *   2. Error Budget Dashboard — aggregate failure reasons
 *   3. Offline Replay Engine — replay history with new rankers, compute accuracy
 *
 * Key metric: Replay Accuracy — how often would the ranker have matched
 * what the user actually chose? If LearningRanker > LinearRanker by 10%+,
 * the Telemetry→Feedback→Learning loop is proven effective.
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
exports.runFailureAttribution = runFailureAttribution;
exports.computeErrorBudget = computeErrorBudget;
exports.printErrorBudget = printErrorBudget;
exports.replayDecisions = replayDecisions;
exports.compareRankers = compareRankers;
exports.printReplayReport = printReplayReport;
exports.printRankerComparison = printRankerComparison;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const counterfactual_engine_1 = require("./counterfactual-engine");
const ssg_validator_1 = require("./ssg-validator");
function expectedSignature(expected) {
    return [...expected].sort().join("→");
}
function resultSignature(fixPath) {
    return [...fixPath].sort().join("→");
}
async function classifyFailure(tc, result, alts) {
    if (result.top1Hit)
        return "success";
    const expSig = expectedSignature(tc.expected);
    // No candidates at all → protocol model can't find the path
    if (alts.length === 0) {
        // Check if it's a resource leak (ProtocolStrategy handles these)
        if (tc.violationType === "resource_leak")
            return "bad_protocol_model";
        return "bad_protocol_model";
    }
    // Check if ANY candidate has the expected repair (even if ranked wrong)
    const anyMatch = alts.some(a => resultSignature(a.fixPath) === expSig);
    if (anyMatch)
        return "bad_ranking";
    // Check if it's a corpus-dependent scenario
    if (tc.violationType === "missing_prerequisite" && alts.length <= 2) {
        return "insufficient_history";
    }
    // If expected includes functions not in protocol rules, goal mismatch
    const protoDef = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "protocols.json"), "utf-8"));
    const allRules = new Set(Object.keys(protoDef.rules));
    const unknownFns = tc.expected.filter(fn => !allRules.has(fn));
    if (unknownFns.length > 0)
        return "goal_mismatch";
    // Otherwise: candidate simply wasn't found
    return "missing_candidate";
}
async function runFailureAttribution(suitePath) {
    const benchmarksDir = suitePath || path.resolve(__dirname, "..", "benchmarks");
    const files = fs.readdirSync(benchmarksDir).filter(f => f.endsWith(".json") && !f.includes("generated") && !f.includes("priority"));
    const protoDef = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "protocols.json"), "utf-8"));
    const protocols = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
    const rules = new Map();
    for (const p of protocols)
        rules.set(p.function, p.protocol);
    const attributed = [];
    for (const file of files) {
        const cases = JSON.parse(fs.readFileSync(path.join(benchmarksDir, file), "utf-8"));
        for (const tc of cases) {
            const currentStates = new Set();
            for (const fn of tc.broken) {
                const rule = rules.get(fn);
                if (rule) {
                    for (const post of rule.post_states)
                        currentStates.add(post);
                    if (rule.invalidate)
                        rule.invalidate.forEach(s => currentStates.delete(s));
                }
            }
            const alts = await (0, counterfactual_engine_1.suggestAlternatives)({
                violation: {
                    svl: 4,
                    violatedConstraint: tc.violationType,
                    actionIndex: tc.broken.length,
                    currentStates: [...currentStates],
                    requiredStates: [],
                    description: `Benchmark: ${tc.goal}`,
                },
                protocol: tc.protocol,
                currentState: [...currentStates],
                targetState: [],
                constraints: [],
                rules,
                goal: tc.goal,
            });
            const expSig = expectedSignature(tc.expected);
            let top1Hit = false;
            let rank = null;
            for (let i = 0; i < alts.length; i++) {
                const fullSig = expectedSignature([...tc.broken, ...alts[i].fixPath]);
                if (fullSig === expSig) {
                    if (rank === null)
                        rank = i + 1;
                    if (i === 0)
                        top1Hit = true;
                }
            }
            const caseResult = {
                goal: tc.goal, top1Hit, top3Hit: rank !== null && rank <= 3,
                rank, latencyMs: 0, candidatesReturned: alts.length,
            };
            const reason = await classifyFailure(tc, caseResult, alts);
            attributed.push({
                caseId: `${file}:${tc.goal}`,
                goal: tc.goal,
                protocol: tc.protocol,
                violationType: tc.violationType,
                expectedRepair: tc.expected,
                plannerTop1: alts.length > 0 ? alts[0].fixPath : undefined,
                plannerTop3: alts.slice(0, 3).map(a => a.fixPath),
                candidatesReturned: alts.length,
                rank,
                failureReason: reason,
            });
        }
    }
    return attributed;
}
function computeErrorBudget(attributed) {
    const total = attributed.length;
    const successes = attributed.filter(a => a.failureReason === "success").length;
    const breakdown = {};
    for (const a of attributed) {
        breakdown[a.failureReason] = (breakdown[a.failureReason] || 0) + 1;
    }
    const percentages = {};
    for (const [k, v] of Object.entries(breakdown)) {
        percentages[k] = total > 0 ? v / total : 0;
    }
    // Generate recommendation
    const missingPct = percentages["missing_candidate"] || 0;
    const rankingPct = percentages["bad_ranking"] || 0;
    const protocolPct = percentages["bad_protocol_model"] || 0;
    let recommendation;
    if (missingPct > 0.3) {
        recommendation = "P0: Fix candidate discovery (ProtocolStrategy BFS). Don't touch Reward Model until candidates are found.";
    }
    else if (rankingPct > 0.3) {
        recommendation = "P0: Improve ranking (LearningRanker, more feedback data). Ranking is the bottleneck.";
    }
    else if (protocolPct > 0.3) {
        recommendation = "P0: Expand protocol rules. Protocol model doesn't cover enough transitions.";
    }
    else {
        recommendation = "Balanced error profile. Proceed with small improvements across all dimensions.";
    }
    return {
        totalCases: total,
        successes,
        successRate: total > 0 ? successes / total : 0,
        breakdown: breakdown,
        percentages: percentages,
        recommendation,
    };
}
function printErrorBudget(budget) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   Error Budget Dashboard                           ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Total Cases:    ${budget.totalCases}`);
    console.log(`Successes:      ${budget.successes} (${(budget.successRate * 100).toFixed(0)}%)`);
    console.log();
    console.log("─── Failure Breakdown ───");
    console.log("Reason                  Count   Pct    Bar");
    console.log("──────────────────────────────────────────────");
    const order = ["missing_candidate", "bad_ranking", "bad_protocol_model", "goal_mismatch", "insufficient_history", "success"];
    for (const reason of order) {
        const count = budget.breakdown[reason] || 0;
        const pct = budget.percentages[reason] || 0;
        const bar = "█".repeat(Math.round(pct * 40));
        const label = reason.padEnd(22);
        const pctStr = (pct * 100).toFixed(0).padStart(3) + "%";
        console.log(`  ${label} ${String(count).padStart(4)}   ${pctStr}  ${bar}`);
    }
    console.log();
    console.log(`─── Recommendation ───`);
    console.log(`  ${budget.recommendation}`);
    console.log();
}
/**
 * Replay historical decisions with a new candidate ranking.
 *
 * Given PlannerTrace data (what was shown to the user and what they chose)
 * and a LearningRanker (which re-scores candidates using feedback data),
 * compute how often the new ranker's top-1 matches the user's choice.
 */
function replayDecisions(traceStore, telemetry) {
    const traces = traceStore.all();
    const withChoice = traces.filter((t) => t.selectedFingerprint && t.candidates.length > 0);
    const results = [];
    for (const trace of withChoice) {
        const userChose = trace.selectedFingerprint;
        // Build RepairCandidate-like objects from snapshots
        const candidates = trace.candidates.map((c) => ({
            fingerprint: c.fingerprint,
            oldRank: c.rank,
            oldScore: c.score,
            source: c.source,
            actions: c.actions,
            evidenceSources: c.evidenceSources,
        }));
        // Re-rank using telemetry acceptance data
        // Higher acceptance = better rank
        const reranked = candidates.map((c) => ({
            ...c,
            acceptance: telemetry.getCandidateAcceptance(c.fingerprint, 1),
        })).sort((a, b) => {
            // Sort by acceptance descending, then by old score
            if (a.acceptance !== b.acceptance)
                return b.acceptance - a.acceptance;
            return b.oldScore - a.oldScore;
        });
        const newRankerChose = reranked[0]?.fingerprint ?? null;
        const matched = newRankerChose === userChose;
        // Find user's choice in new ranking
        const userIdx = reranked.findIndex((c) => c.fingerprint === userChose);
        const userChoiceRank = userIdx >= 0 ? userIdx + 1 : null;
        results.push({
            traceId: trace.traceId,
            goal: trace.goal,
            protocol: trace.protocol,
            userChose,
            userChoseRank: userChoiceRank,
            newRankerChose,
            matched,
            candidates: reranked.map((c, i) => ({
                fingerprint: c.fingerprint,
                oldRank: c.oldRank,
                newRank: i + 1,
                score: c.acceptance,
            })),
        });
    }
    const matches = results.filter(r => r.matched).length;
    const avgRank = results.reduce((s, r) => s + (r.userChoseRank ?? results.length), 0) / Math.max(1, results.length);
    return {
        ranker: "LearningRanker (acceptance-based)",
        totalDecisions: results.length,
        matches,
        matchRate: results.length > 0 ? matches / results.length : 0,
        avgUserChoiceRank: avgRank,
        results,
    };
}
/**
 * Compare two ranking strategies by replay accuracy.
 */
function compareRankers(traceStore, telemetry) {
    const traces = traceStore.all();
    const withChoice = traces.filter((t) => t.selectedFingerprint && t.candidates.length > 0);
    if (withChoice.length === 0) {
        const empty = { ranker: "", totalDecisions: 0, matches: 0, matchRate: 0, avgUserChoiceRank: 0, results: [] };
        return { baseline: empty, learning: empty, delta: 0 };
    }
    // Baseline: original ranker (rank-1 = what planner showed first)
    let baselineMatches = 0;
    for (const trace of withChoice) {
        const top1 = trace.candidates[0]?.fingerprint;
        if (top1 === trace.selectedFingerprint)
            baselineMatches++;
    }
    const baseline = {
        ranker: "LinearRanker (original)",
        totalDecisions: withChoice.length,
        matches: baselineMatches,
        matchRate: baselineMatches / withChoice.length,
        avgUserChoiceRank: 0, // N/A for baseline
        results: [],
    };
    // Learning: acceptance-based reranking
    const learning = replayDecisions(traceStore, telemetry);
    return {
        baseline,
        learning,
        delta: learning.matchRate - baseline.matchRate,
    };
}
function printReplayReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   Offline Replay Report                            ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Ranker:              ${report.ranker}`);
    console.log(`Decisions Replayed:  ${report.totalDecisions}`);
    console.log(`User Choice Matched: ${report.matches}/${report.totalDecisions}`);
    console.log(`Replay Accuracy:     ${(report.matchRate * 100).toFixed(1)}%`);
    console.log(`Avg User Choice Rank: ${report.avgUserChoiceRank.toFixed(1)}`);
    console.log();
}
function printRankerComparison(baseline, learning, delta) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   Ranker A/B Comparison                            ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    const basePct = (baseline.matchRate * 100).toFixed(1);
    const learnPct = (learning.matchRate * 100).toFixed(1);
    const deltaPct = (delta * 100).toFixed(1);
    const sign = delta > 0 ? "+" : "";
    console.log(`  Baseline  (LinearRanker):    ${basePct}%  (${baseline.matches}/${baseline.totalDecisions})`);
    console.log(`  Learning  (Acceptance):      ${learnPct}%  (${learning.matches}/${learning.totalDecisions})`);
    console.log(`  Δ:                           ${sign}${deltaPct}%`);
    console.log();
    if (delta > 0.05) {
        console.log(`  ✅ LearningRanker outperforms baseline by ${sign}${deltaPct}%`);
        console.log("     The Telemetry→Feedback→Learning loop is effective.");
    }
    else if (delta > 0) {
        console.log("  ⚠️  Marginal improvement. More feedback data needed.");
    }
    else {
        console.log("  ❌ No improvement. Check data quality or increase sample size.");
    }
    console.log();
}
