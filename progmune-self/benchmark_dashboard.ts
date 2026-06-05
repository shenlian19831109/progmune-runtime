// @progmune-generated session=sess_1780688983426_93od1 timestamp=2026-06-05T19:49:54.904Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadBenchmarks } from "./load-benchmarks";
import { benchmarkPassRate } from "./benchmark-pass-rate";
import { benchmarkReport } from "./benchmark-report";

export function main() {
  const benchmarks = loadBenchmarks();
  const passRate = benchmarkPassRate();
  const report = benchmarkReport();
  return report;
}
main();
