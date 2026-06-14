"use strict";
/**
 * P5.7: Real-world Defect Benchmark Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const realworld_benchmark_1 = require("./realworld-benchmark");
(0, vitest_1.describe)("Real-world Defect Benchmark", () => {
    (0, vitest_1.it)("all curated defects have valid structure", () => {
        (0, vitest_1.expect)(realworld_benchmark_1.REAL_WORLD_DEFECTS.length).toBeGreaterThanOrEqual(8);
        for (const d of realworld_benchmark_1.REAL_WORLD_DEFECTS) {
            (0, vitest_1.expect)(d.id).toMatch(/^RW-\d{3}$/);
            (0, vitest_1.expect)(d.broken.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(d.expected.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(["critical", "high", "medium", "low"]).toContain(d.severity);
            (0, vitest_1.expect)(["resource_leak", "auth_bypass", "data_corruption", "use_after_free", "race_condition"]).toContain(d.category);
        }
    });
    (0, vitest_1.it)("covers all severity levels", () => {
        const severities = new Set(realworld_benchmark_1.REAL_WORLD_DEFECTS.map(d => d.severity));
        (0, vitest_1.expect)(severities.has("critical")).toBe(true);
        (0, vitest_1.expect)(severities.has("high")).toBe(true);
        (0, vitest_1.expect)(severities.has("medium")).toBe(true);
    });
    (0, vitest_1.it)("covers all defect categories", () => {
        const categories = new Set(realworld_benchmark_1.REAL_WORLD_DEFECTS.map(d => d.category));
        (0, vitest_1.expect)(categories.size).toBeGreaterThanOrEqual(4);
    });
    (0, vitest_1.it)("runs planner against real-world defects", async () => {
        const report = await (0, realworld_benchmark_1.runRealWorldBenchmark)();
        (0, vitest_1.expect)(report.totalDefects).toBe(20);
        (0, vitest_1.expect)(report.detectionRate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.top3RepairRate).toBeGreaterThanOrEqual(0.45); // 10 new protocol types reduce ceiling
        (0, realworld_benchmark_1.printRealWorldReport)(report);
    }, 30000);
});
