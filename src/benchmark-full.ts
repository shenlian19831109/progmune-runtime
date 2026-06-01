// @progmune-generated session=sess_1780350938098_h5bts timestamp=2026-06-01T21:55:39.709Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 404 functions, 17 protocol rules
import { loadBenchmarks } from "./load-benchmarks";
import { benchmarkCount } from "./benchmark-count";
import { benchmarkReport } from "./benchmark-report";
import { benchmarkSave } from "./benchmark-save";

export function main() {
  const benchmarks = loadBenchmarks();
  const count = benchmarkCount();
  const report = benchmarkReport();
  const savedPath = benchmarkSave(report);
  return savedPath;
}
main();
