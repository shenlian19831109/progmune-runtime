"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780350938098_h5bts timestamp=2026-06-01T21:55:39.709Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 404 functions, 17 protocol rules
const load_benchmarks_1 = require("./load-benchmarks");
const benchmark_count_1 = require("./benchmark-count");
const benchmark_report_1 = require("./benchmark-report");
const benchmark_save_1 = require("./benchmark-save");
function main() {
    const benchmarks = (0, load_benchmarks_1.loadBenchmarks)();
    const count = (0, benchmark_count_1.benchmarkCount)();
    const report = (0, benchmark_report_1.benchmarkReport)();
    const savedPath = (0, benchmark_save_1.benchmarkSave)(report);
    return savedPath;
}
main();
