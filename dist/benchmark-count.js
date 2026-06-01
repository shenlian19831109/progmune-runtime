"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.benchmarkCount = benchmarkCount;
const load_benchmarks_1 = require("./load-benchmarks");
function benchmarkCount() {
    return (0, load_benchmarks_1.loadBenchmarks)().length;
}
