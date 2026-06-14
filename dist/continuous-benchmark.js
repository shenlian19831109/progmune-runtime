"use strict";
/**
 * P5.4: Continuous Benchmark Expansion
 *
 * Auto-generates benchmark cases from auto-approved patches
 * and skill library entries, feeding the coverage flywheel.
 *
 * Loop: Skills/Patches → Benchmark Generation → Run Suite
 *       → Updated Baseline → Coverage Improvement
 *
 * This ensures the system never stops measuring itself,
 * even as it autonomously extends its own knowledge.
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
exports.generateBenchmarksFromPatches = generateBenchmarksFromPatches;
exports.generateBenchmarksFromSkills = generateBenchmarksFromSkills;
exports.runContinuousBenchmark = runContinuousBenchmark;
exports.printContinuousBenchmarkReport = printContinuousBenchmarkReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const benchmark_harness_1 = require("./benchmark-harness");
/**
 * Generate benchmark cases from approved knowledge patches.
 * Each approved patch that adds a virtual rule gets a test case.
 */
function generateBenchmarksFromPatches(patchStore) {
    const cases = [];
    for (const patch of patchStore.approved) {
        const [fnA, fnB] = patch.change.split(" → ");
        // Case 1: missing the bridge (broken = just fnA, expected = fnA → fnB)
        cases.push({
            goal: `cover patch: ${patch.change}`,
            protocol: "_global",
            broken: [fnA],
            expected: fnB ? [fnA, fnB] : [fnA],
            violationType: "missing_prerequisite",
            source: "patch",
            sourceId: patch.id,
        });
        // Case 2: resource cleanup variant if applicable
        if (patch.toState === "∅") {
            cases.push({
                goal: `cover cleanup: ${patch.change}`,
                protocol: "_global",
                broken: [fnA, fnB].filter(Boolean),
                expected: [fnA, fnB].filter(Boolean),
                violationType: "resource_leak",
                source: "patch",
                sourceId: patch.id,
            });
        }
    }
    return cases;
}
/**
 * Generate benchmark cases from skill library entries.
 * Each skill with high confidence gets a test case.
 */
function generateBenchmarksFromSkills(library) {
    const cases = [];
    for (const skill of library.all()) {
        // Only generate for skills with strong evidence
        if (skill.frequency < 5 || skill.successRate < 0.8)
            continue;
        // Case 1: full skill as expected repair
        cases.push({
            goal: `cover skill: ${skill.goal}`,
            protocol: "_global",
            broken: skill.macro.slice(0, Math.max(1, skill.macro.length - 1)), // remove last action
            expected: skill.macro,
            violationType: skill.effects.length > 0 && skill.preconditions.length === 0
                ? "missing_prerequisite"
                : "resource_leak",
            source: "skill",
            sourceId: skill.id,
        });
        // Case 2: resource cleanup (just the last cleanup action)
        if (skill.macro.length >= 2) {
            const cleanupAction = skill.macro[skill.macro.length - 1];
            cases.push({
                goal: `cover cleanup: ${cleanupAction}`,
                protocol: "_global",
                broken: skill.macro.slice(0, skill.macro.length - 1),
                expected: skill.macro,
                violationType: "resource_leak",
                source: "skill",
                sourceId: skill.id,
            });
        }
    }
    return cases;
}
/**
 * Run continuous benchmark expansion: generate → write → measure.
 *
 * 1. Generate new cases from patches + skills
 * 2. Write to benchmarks/expanded/ directory
 * 3. Run full benchmark suite
 * 4. Report updated baseline
 */
async function runContinuousBenchmark(patchStore, library, outputDir) {
    // 1. Generate
    const patchCases = generateBenchmarksFromPatches(patchStore);
    const skillCases = generateBenchmarksFromSkills(library);
    const allCases = [...patchCases, ...skillCases];
    // 2. Write
    const outDir = outputDir || path.resolve(__dirname, "..", "benchmarks", "expanded");
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir, { recursive: true });
    const timestamp = new Date().toISOString().slice(0, 10);
    const filepath = path.join(outDir, `auto_generated_${timestamp}.json`);
    fs.writeFileSync(filepath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: "continuous-benchmark",
        skillsCount: library.size,
        patchesCount: patchStore.approved.length,
        cases: allCases,
    }, null, 2));
    // 3. Run benchmark
    let benchmark;
    try {
        benchmark = await (0, benchmark_harness_1.runBenchmark)(path.resolve(__dirname, "..", "benchmarks"));
    }
    catch {
        // benchmark run can fail if no cases; gracefully skip
    }
    // 4. Report
    return {
        timestamp: new Date().toISOString(),
        existingCases: benchmark?.cases || 0,
        generatedCases: allCases.length,
        sourceBreakdown: {
            skills: skillCases.length,
            patches: patchCases.length,
        },
        writtenFiles: [filepath],
        benchmark,
        summary: allCases.length > 0
            ? `Generated ${allCases.length} new benchmark cases (${skillCases.length} from skills, ${patchCases.length} from patches). Total suite: ${benchmark?.cases || 0} cases.`
            : "No new cases generated. Skills and patches may need more evidence.",
    };
}
function printContinuousBenchmarkReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P5.4 Continuous Benchmark Expansion              ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Timestamp:        ${report.timestamp}`);
    console.log(`Generated Cases:  ${report.generatedCases}`);
    console.log(`  From Skills:    ${report.sourceBreakdown.skills}`);
    console.log(`  From Patches:   ${report.sourceBreakdown.patches}`);
    console.log(`Total Suite:      ${report.existingCases}`);
    console.log();
    console.log(`Summary: ${report.summary}`);
    console.log();
    if (report.benchmark) {
        console.log("─── Updated Benchmark Baseline ───");
        console.log(`  Top-1:  ${(report.benchmark.top1Rate * 100).toFixed(0)}%`);
        console.log(`  Top-3:  ${(report.benchmark.top3Rate * 100).toFixed(0)}%`);
        console.log();
    }
}
