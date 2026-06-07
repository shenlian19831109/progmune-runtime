// @progmune-generated session=sess_1780828913656_i4xzr timestamp=2026-06-07T10:41:56.563Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadBenchmarks } from "./load-benchmarks";
import { benchmarkLoadLatest } from "./benchmark-save";
import { runAndCheck } from "./runtime";
import { benchmarkReport } from "./benchmark-report";
import { benchmarkCount } from "./benchmark-count";

export function main() {
  const tasks = loadBenchmarks();
  const latest = benchmarkLoadLatest();
  const result = runAndCheck(tasks);
  const report = benchmarkReport();
  const count = benchmarkCount();
  return { tasks, latest, result, report, count };
}
main();
