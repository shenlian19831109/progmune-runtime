// @progmune-generated session=sess_1780750790802_7tpef timestamp=2026-06-06T13:05:06.383Z
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
