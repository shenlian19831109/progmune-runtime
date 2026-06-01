import { loadBenchmarks } from "./load-benchmarks";

export function benchmarkCount(): number {
  return loadBenchmarks().length;
}
