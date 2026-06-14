"use strict";
/**
 * Auto-benchmark Generator + Expanded Bootstrap Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const auto_benchmark_generator_1 = require("./auto-benchmark-generator");
const bootstrap_validation_1 = require("./bootstrap-validation");
const scale_trajectory_collector_1 = require("./scale-trajectory-collector");
(0, vitest_1.describe)("Auto-benchmark Generator", () => {
    (0, vitest_1.it)("generates 20+ benchmark cases from all sources", () => {
        const suite = (0, auto_benchmark_generator_1.generateExpandedBenchmarks)();
        (0, vitest_1.expect)(suite.totalCases).toBeGreaterThanOrEqual(20);
        (0, vitest_1.expect)(suite.bySource["synthesized"]).toBeGreaterThan(0);
        (0, vitest_1.expect)(suite.bySource["realworld"]).toBeGreaterThan(0);
        (0, auto_benchmark_generator_1.printExpandedBenchmarkReport)(suite);
    });
    (0, vitest_1.it)("each benchmark case has valid structure", () => {
        const suite = (0, auto_benchmark_generator_1.generateExpandedBenchmarks)();
        for (const c of suite.cases) {
            (0, vitest_1.expect)(c.broken.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.expected.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.expected.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.broken.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(["resource_leak", "missing_prerequisite", "illegal_state_transition"]).toContain(c.violationType);
        }
    });
});
(0, vitest_1.describe)("Expanded Bootstrap Validation", () => {
    (0, vitest_1.it)("with expanded corpus + expanded benchmarks", async () => {
        const { sequences } = (0, scale_trajectory_collector_1.collectTrajectoriesAtScale)();
        const suite = (0, auto_benchmark_generator_1.generateExpandedBenchmarks)();
        // Run bootstrap with expanded corpus
        const result = await (0, bootstrap_validation_1.runBootstrapValidation)(undefined, sequences);
        console.log(`\nExpanded Benchmark Suite: ${suite.totalCases} cases`);
        console.log(`Corpus Size: ${sequences.length} sequences`);
        console.log(`Regenerated Rules: ${result.regeneratedRuleCount}`);
        console.log(`Function Overlap: ${(result.functionOverlap * 100).toFixed(0)}%`);
        console.log(`State Overlap: ${(result.stateOverlap * 100).toFixed(0)}%`);
        console.log(`Behavioral: ${result.behavioralMatch}/${result.behavioralTotal}`);
        // With expanded benchmarks, regenerated rules should be substantial
        (0, vitest_1.expect)(result.regeneratedRuleCount).toBeGreaterThanOrEqual(5);
        (0, vitest_1.expect)(result.functionOverlap).toBeGreaterThan(0.1);
    }, 30000);
});
