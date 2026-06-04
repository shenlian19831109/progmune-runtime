"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.benchmarkCount = benchmarkCount;
const load_benchmarks_1 = require("./load-benchmarks");
/**
 * @requires BENCHMARK_TASKS @produces TASK_COUNT
 * @purpose Count benchmark tasks available
 * @tags benchmark, count, statistics
 */
function benchmarkCount() {
    return (0, load_benchmarks_1.loadBenchmarks)().length;
}
