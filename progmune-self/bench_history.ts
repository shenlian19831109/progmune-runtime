// @progmune-generated session=sess_1780828927234_hj476 timestamp=2026-06-07T10:42:12.525Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadBenchmarks } from "./load-benchmarks";
import { benchmarkLoadLatest } from "./benchmark-save";
import { benchmarkReport } from "./benchmark-report";

export function main() {
  const tasks = loadBenchmarks();
  const latest = benchmarkLoadLatest();
  const report = benchmarkReport();
  return { tasks, latest, report };
}
main();
