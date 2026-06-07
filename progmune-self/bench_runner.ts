// @progmune-generated session=sess_1780750774737_558bw timestamp=2026-06-06T12:59:37.718Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { loadBenchmarks } from "./load-benchmarks";
import { benchmarkLoadLatest, benchmarkSave } from "./benchmark-save";
import { runAndCheck } from "./runtime";

export function main() {
  const tasks = loadBenchmarks();
  const latest = benchmarkLoadLatest();
  const result1 = runAndCheck(tasks);
  const saved1 = benchmarkSave(result1);
  return { tasks, latest, result1, saved1 };
}
main();
