// @progmune-generated session=sess_1780350835297_stf8a timestamp=2026-06-01T21:53:57.126Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 401 functions, 17 protocol rules
import { loadBenchmarks } from "./load-benchmarks";
import { benchmarkCount } from "./benchmark-count";
import { benchmarkReport } from "./benchmark-report";

export function main() {
  const tasks = loadBenchmarks();
  const count = benchmarkCount();
  const report = benchmarkReport();
  return report;
}
main();
