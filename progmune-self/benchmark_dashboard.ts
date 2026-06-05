// @progmune-generated session=sess_1780681590594_zn2iv timestamp=2026-06-05T17:46:39.863Z
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
