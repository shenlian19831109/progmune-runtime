import { loadBenchmarks } from "./load-benchmarks";

/**
 * @requires BENCHMARK_TASKS @produces TASK_COUNT
 * @purpose Count benchmark tasks available
 * @tags benchmark, count, statistics
 */
export function benchmarkCount(): number {
  return loadBenchmarks().length;
}
