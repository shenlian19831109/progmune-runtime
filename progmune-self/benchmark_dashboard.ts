// @progmune-generated session=sess_1780672454020_sr34r timestamp=2026-06-05T15:14:36.437Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadBenchmarks } from "../src/load-benchmarks";
import { benchmarkPassRate } from "../src/benchmark-pass-rate";
import { benchmarkReport } from "../src/benchmark-report";

export function main() {
  const benchmarks = loadBenchmarks();
  const passRate = benchmarkPassRate();
  const report = benchmarkReport();
  return { loaded: benchmarks.length, passRate, report };
}
main();
