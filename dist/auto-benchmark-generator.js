"use strict";
/**
 * Auto-benchmark Generator
 *
 * Generates benchmark cases from synthesized protocols + real-world defects.
 * Expands the benchmark suite from 3 to 20+ cases, enabling meaningful
 * behavioral equivalence measurement.
 *
 * Sources:
 *   1. Synthesized protocols → typical lifecycle paths
 *   2. Real-world defects → broken → expected pairs
 *   3. Cross-repo sequences → protocol-specific test cases
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateExpandedBenchmarks = generateExpandedBenchmarks;
exports.printExpandedBenchmarkReport = printExpandedBenchmarkReport;
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
const realworld_benchmark_1 = require("./realworld-benchmark");
const scale_trajectory_collector_1 = require("./scale-trajectory-collector");
const function_synonyms_1 = require("./function-synonyms");
/**
 * Generate benchmarks from synthesized protocols.
 * For each protocol, create a "missing the last step" test case.
 */
function generateFromProtocols(protocols) {
    const cases = [];
    for (const sp of protocols) {
        if (sp.prototype.length < 2)
            continue;
        // Normalize the prototype
        const norm = sp.prototype.map(function_synonyms_1.normalizeFunctionName);
        // Case: broken = remove the last action (resource leak)
        cases.push({
            goal: `cover protocol: ${sp.prototype.join(" → ")}`,
            protocol: "_global",
            broken: norm.slice(0, -1),
            expected: norm,
            violationType: "resource_leak",
            source: `synthesized:${sp.clusterId}`,
        });
        // Case: broken = remove the first action (missing prerequisite)
        if (norm.length >= 3) {
            cases.push({
                goal: `cover prerrequisite: ${sp.prototype.join(" → ")}`,
                protocol: "_global",
                broken: norm.slice(1),
                expected: norm,
                violationType: "missing_prerequisite",
                source: `synthesized:${sp.clusterId}`,
            });
        }
    }
    return cases;
}
/**
 * Convert real-world defects to benchmark cases.
 */
function convertDefects() {
    return realworld_benchmark_1.REAL_WORLD_DEFECTS.map(d => ({
        goal: d.title,
        protocol: d.protocol,
        broken: d.broken.map(function_synonyms_1.normalizeFunctionName),
        expected: d.expected.map(function_synonyms_1.normalizeFunctionName),
        violationType: d.violationType,
        source: `realworld:${d.id}`,
    }));
}
/**
 * Generate benchmarks from the expanded corpus.
 * Take representative sequences and create test cases.
 */
function generateFromCorpus(sequences) {
    const cases = [];
    const seen = new Set();
    for (const seq of sequences) {
        if (seq.length < 3)
            continue;
        const norm = seq.map(function_synonyms_1.normalizeFunctionName);
        const key = norm.join("→");
        if (seen.has(key))
            continue;
        seen.add(key);
        // Take every 5th unique sequence as a benchmark case
        if (seen.size % 5 === 0) {
            cases.push({
                goal: `corpus pattern: ${key}`,
                protocol: "_global",
                broken: norm.slice(0, -1),
                expected: norm,
                violationType: "resource_leak",
                source: "corpus",
            });
        }
    }
    return cases;
}
/**
 * Generate an expanded benchmark suite from all available sources.
 * Target: 20+ cases covering synthesized protocols, real defects, and corpus patterns.
 */
function generateExpandedBenchmarks() {
    const protocols = (0, auto_protocol_synthesizer_1.synthesizeAllKnownProtocols)();
    const { sequences } = (0, scale_trajectory_collector_1.collectTrajectoriesAtScale)();
    const protocolCases = generateFromProtocols(protocols);
    const defectCases = convertDefects();
    const corpusCases = generateFromCorpus(sequences);
    const allCases = [...protocolCases, ...defectCases, ...corpusCases];
    // Deduplicate by expected sequence
    const seen = new Set();
    const unique = [];
    for (const c of allCases) {
        const key = c.expected.join("→");
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(c);
        }
    }
    const bySource = {};
    for (const c of unique) {
        const src = c.source.split(":")[0];
        bySource[src] = (bySource[src] || 0) + 1;
    }
    return {
        cases: unique,
        bySource,
        totalCases: unique.length,
    };
}
function printExpandedBenchmarkReport(suite) {
    console.log("\n─── Expanded Benchmark Suite ───");
    console.log(`  Total Cases: ${suite.totalCases}`);
    console.log("  By Source:");
    for (const [src, count] of Object.entries(suite.bySource)) {
        console.log(`    ${src.padEnd(14)} ${count}`);
    }
    console.log();
}
