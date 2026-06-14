"use strict";
/**
 * P3.5: Planner Benchmark Harness
 *
 * Runs the planner against known repair scenarios and
 * measures: Top-1 accuracy, Top-3 accuracy, avg latency.
 *
 * All future changes to Planner, Ranker, or Reward Model
 * should be evaluated against the same benchmark suite.
 *
 * Usage:
 *   import { runBenchmark } from "./benchmark-harness";
 *   const report = await runBenchmark();
 *   report.print();
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
exports.runBenchmark = runBenchmark;
exports.printBenchmarkReport = printBenchmarkReport;
exports.loadBenchmarkFixtures = loadBenchmarkFixtures;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const counterfactual_engine_1 = require("./counterfactual-engine");
const ssg_validator_1 = require("./ssg-validator");
// ═══════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════
function expectedSignature(expected) {
    return [...expected].sort().join("→");
}
function resultSignature(fixPath) {
    return [...fixPath].sort().join("→");
}
async function runBenchmark(suitePath) {
    const benchmarksDir = suitePath || path.resolve(__dirname, "..", "benchmarks");
    const files = fs.readdirSync(benchmarksDir).filter(f => f.endsWith(".json"));
    // Load protocol rules once
    const protoDef = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "protocols.json"), "utf-8"));
    const protocols = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
    const rules = new Map();
    for (const p of protocols)
        rules.set(p.function, p.protocol);
    const allResults = [];
    for (const file of files) {
        const cases = JSON.parse(fs.readFileSync(path.join(benchmarksDir, file), "utf-8"));
        for (const tc of cases) {
            const start = Date.now();
            let candidatesReturned = 0;
            let top1Hit = false;
            let top3Hit = false;
            let rank = null;
            try {
                // Determine current states after the broken sequence
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
                        description: `${tc.goal}: missing ${tc.expected.slice(tc.broken.length).join(", ")}`,
                    },
                    protocol: tc.protocol,
                    currentState: [...currentStates],
                    targetState: [],
                    constraints: [],
                    rules,
                    goal: tc.goal,
                });
                candidatesReturned = alts.length;
                const expSig = expectedSignature(tc.expected);
                for (let i = 0; i < alts.length; i++) {
                    // Build the full sequence: broken + fixPath, then check if expected is a subset
                    const fullPath = [...tc.broken, ...alts[i].fixPath];
                    const fullSig = expectedSignature(fullPath);
                    if (fullSig === expSig) {
                        if (rank === null)
                            rank = i + 1;
                        if (i === 0)
                            top1Hit = true;
                        if (i < 3)
                            top3Hit = true;
                    }
                }
            }
            catch {
                // Benchmark case failure — count as miss
            }
            allResults.push({
                goal: tc.goal,
                top1Hit,
                top3Hit,
                rank,
                latencyMs: Date.now() - start,
                candidatesReturned,
            });
        }
    }
    const top1Success = allResults.filter(r => r.top1Hit).length;
    const top3Success = allResults.filter(r => r.top3Hit).length;
    const total = allResults.length;
    return {
        suite: files.join(", "),
        cases: total,
        top1Success,
        top1Rate: total > 0 ? top1Success / total : 0,
        top3Success,
        top3Rate: total > 0 ? top3Success / total : 0,
        avgLatencyMs: total > 0
            ? allResults.reduce((s, r) => s + r.latencyMs, 0) / total
            : 0,
        avgCandidates: total > 0
            ? allResults.reduce((s, r) => s + r.candidatesReturned, 0) / total
            : 0,
        results: allResults,
    };
}
// ═══════════════════════════════════════════════════════════════
// Printer
// ═══════════════════════════════════════════════════════════════
function printBenchmarkReport(report) {
    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║   Planner Benchmark Report               ║");
    console.log("╚══════════════════════════════════════════╝\n");
    console.log(`Suite:               ${report.suite}`);
    console.log(`Cases:               ${report.cases}`);
    console.log();
    console.log(`Top-1 Success:       ${report.top1Success}/${report.cases} (${(report.top1Rate * 100).toFixed(0)}%)`);
    console.log(`Top-3 Success:       ${report.top3Success}/${report.cases} (${(report.top3Rate * 100).toFixed(0)}%)`);
    console.log(`Avg Latency:         ${report.avgLatencyMs.toFixed(1)}ms`);
    console.log(`Avg Candidates:      ${report.avgCandidates.toFixed(1)}`);
    if (report.results.length > 0 && report.results.some(r => !r.top3Hit)) {
        console.log("\n─── Misses ───");
        for (const r of report.results) {
            if (!r.top3Hit) {
                console.log(`  ❌ ${r.goal}`);
                console.log(`     rank: ${r.rank ?? "not found"} | candidates: ${r.candidatesReturned} | latency: ${r.latencyMs}ms`);
            }
        }
    }
    console.log();
}
// ═══════════════════════════════════════════════════════════════
// Convenience: Load benchmark fixtures
// ═══════════════════════════════════════════════════════════════
/** Load all benchmark fixture cases from the benchmarks directory. */
function loadBenchmarkFixtures(suitePath) {
    const benchmarksDir = suitePath || path.resolve(__dirname, "..", "benchmarks");
    const files = fs.readdirSync(benchmarksDir).filter(f => f.endsWith(".json"));
    const all = [];
    for (const file of files) {
        try {
            const cases = JSON.parse(fs.readFileSync(path.join(benchmarksDir, file), "utf-8"));
            all.push(...cases);
        }
        catch { /* skip */ }
    }
    return all;
}
