"use strict";
/**
 * P3.8: Active Learning Benchmark Generator
 *
 * Prioritizes data acquisition by importance, not just coverage.
 *
 * Coverage analysis tells you WHAT is missing.
 * Difficulty analysis tells you HOW HARD it is.
 * Active Learning tells you WHAT TO GENERATE FIRST.
 *
 * Importance score:
 *   importance = difficulty × protocolUsage × failureFrequency
 *
 * This ensures we generate benchmarks for the transitions that:
 *   1. Are hardest to get right (high difficulty)
 *   2. Appear most often in real usage (high protocol frequency)
 *   3. Cause the most failures (high failure count)
 *
 * Data flow:
 *   Coverage Gaps + Difficulty Map → Importance Ranking → Prioritized Generation
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
exports.generatePrioritizedBenchmarks = generatePrioritizedBenchmarks;
exports.writeTopPriorityBenchmarks = writeTopPriorityBenchmarks;
exports.printActiveLearningReport = printActiveLearningReport;
const benchmark_generator_1 = require("./benchmark-generator");
const difficulty_map_1 = require("./difficulty-map");
const failure_corpus_1 = require("./failure-corpus");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ═══════════════════════════════════════════════════════════════
// Importance Scoring
// ═══════════════════════════════════════════════════════════════
/**
 * Compute protocol usage frequency from trajectory counts.
 */
function computeProtocolUsage(trajectories) {
    const counts = {};
    for (const t of trajectories) {
        const proto = t.protocol === "_global" ? "FileProtocol" : t.protocol;
        counts[proto] = (counts[proto] || 0) + 1;
    }
    const total = Math.max(1, trajectories.length);
    for (const k of Object.keys(counts)) {
        counts[k] /= total;
    }
    return counts;
}
/**
 * Score a missing transition by importance.
 *
 *   importance = difficulty × protocolUsage × failureFrequency
 *
 * All three dimensions normalized to [0,1].
 */
function scoreImportance(transition, protocol, statsMap, protocolUsage) {
    const key = `${protocol}:${transition.from}→${transition.to}`;
    const stats = statsMap.get(key);
    const difficulty = (stats && stats.attempts > 0) ? stats.difficulty : 0.5; // unknown = medium difficulty
    const usage = protocolUsage[protocol] ?? 0.1;
    const failureCount = stats?.failures ?? 0;
    const failureNorm = Math.min(1, failureCount / 10); // cap at 10+
    const importance = difficulty * usage * (0.3 + 0.7 * failureNorm);
    return { importance, difficulty, protocolUsage: usage, failureCount };
}
// ═══════════════════════════════════════════════════════════════
// Prioritized Generation
// ═══════════════════════════════════════════════════════════════
/**
 * Generate benchmarks prioritized by importance.
 *
 * Instead of generating all uncovered transitions equally,
 * this ranks them by how valuable each data point would be
 * for future learning.
 */
function generatePrioritizedBenchmarks(trajectories, decisions) {
    const trajs = trajectories || (0, failure_corpus_1.loadTrajectories)();
    const statsMap = (0, difficulty_map_1.buildDifficultyMap)(trajs, decisions);
    const protocolUsage = computeProtocolUsage(trajs);
    // Get all uncovered transitions with their generated cases
    const allGenerated = (0, benchmark_generator_1.generateMissingBenchmarks)(trajs);
    const prioritized = [];
    const byProtocol = {};
    for (const [protocol, cases] of Object.entries(allGenerated)) {
        const protocolCases = [];
        for (const c of cases) {
            const { importance, difficulty, protocolUsage: usage, failureCount } = scoreImportance(c.targetsTransition, protocol, statsMap, protocolUsage);
            const pc = {
                ...c,
                importance,
                difficulty,
                protocolUsage: usage,
                failureCount,
            };
            protocolCases.push(pc);
        }
        protocolCases.sort((a, b) => b.importance - a.importance);
        byProtocol[protocol] = protocolCases;
        prioritized.push(...protocolCases);
    }
    prioritized.sort((a, b) => b.importance - a.importance);
    return {
        totalGaps: prioritized.length,
        prioritized,
        byProtocol,
    };
}
/**
 * Write only the top-K most important benchmarks.
 */
function writeTopPriorityBenchmarks(report, topK = 10, outputDir) {
    const outDir = outputDir || path.resolve(__dirname, "..", "benchmarks", "priority");
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir, { recursive: true });
    const top = report.prioritized.slice(0, topK);
    const written = [];
    // Group by protocol for organized output
    const grouped = {};
    for (const c of top) {
        const proto = c.targetsTransition.rule.includes("file") ? "FileProtocol" :
            c.targetsTransition.rule.includes("auth") || c.targetsTransition.rule.includes("password") || c.targetsTransition.rule.includes("jwt") || c.targetsTransition.rule.includes("session") || c.targetsTransition.rule.includes("logout") ? "AuthProtocol" :
                c.targetsTransition.rule.includes("db") || c.targetsTransition.rule.includes("connect") || c.targetsTransition.rule.includes("query") ? "DBProtocol" :
                    "IRProtocol";
        if (!grouped[proto])
            grouped[proto] = [];
        grouped[proto].push(c);
    }
    for (const [protocol, cases] of Object.entries(grouped)) {
        const filename = `priority_${protocol.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.json`;
        const filepath = path.join(outDir, filename);
        fs.writeFileSync(filepath, JSON.stringify({
            generatedAt: new Date().toISOString(),
            protocol,
            topK,
            source: "active-learning",
            cases: cases.map(({ importance, difficulty, protocolUsage, failureCount, ...rest }) => ({
                ...rest,
                importance, difficulty,
            })),
        }, null, 2));
        written.push(filepath);
    }
    return written;
}
// ═══════════════════════════════════════════════════════════════
// Report
// ═══════════════════════════════════════════════════════════════
function printActiveLearningReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   Active Learning: Prioritized Benchmarks          ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Total Gaps:            ${report.totalGaps}`);
    console.log(`Prioritized Generated: ${report.prioritized.length}\n`);
    if (report.prioritized.length === 0) {
        console.log("All transitions covered. No gaps to prioritize.\n");
        return;
    }
    console.log("─── Top 10 Priority Benchmarks ───");
    console.log("Import  Diff    Protocol       Transition");
    console.log("────────────────────────────────────────────────────");
    for (const c of report.prioritized.slice(0, 10)) {
        const imp = (c.importance * 100).toFixed(0).padStart(4);
        const diff = (c.difficulty * 100).toFixed(0).padStart(4);
        console.log(`  ${imp}%  ${diff}%   ${c.targetsTransition.rule.padEnd(16)} ${c.targetsTransition.from}→${c.targetsTransition.to}`);
    }
    console.log();
    // Per-protocol summary
    console.log("─── Per Protocol ───");
    for (const [proto, cases] of Object.entries(report.byProtocol)) {
        const top = cases.slice(0, 3);
        const totalImp = cases.reduce((s, c) => s + c.importance, 0);
        console.log(`  ${proto}: ${cases.length} gaps, top importance: ${(totalImp * 100).toFixed(0)}%`);
        for (const c of top) {
            console.log(`    ${c.targetsTransition.from}→${c.targetsTransition.to} (importance: ${(c.importance * 100).toFixed(0)}%)`);
        }
    }
    console.log();
}
