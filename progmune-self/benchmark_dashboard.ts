// @progmune-generated session=sess_1780731969415_zr46e timestamp=2026-06-06T07:46:20.540Z
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
