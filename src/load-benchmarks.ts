import * as fs from "fs";
import * as path from "path";

export interface BenchTask {
  id: string;
  intent: string;
  category: string;
  hasInput?: boolean;
}

/**
 * Load benchmark tasks from bench/tasks.json.
 * @requires BENCH_DIR @produces BENCHMARK_TASKS
 * @purpose Load benchmark task definitions for execution
 * @tags benchmark, load, data
 * @useWhen running benchmarks, generating benchmark reports
 * @protocol pre_states=[] post_states=["BENCHMARKS_LOADED"]
 */
export function loadBenchmarks(): BenchTask[] {
  const tasksPath = path.resolve(process.cwd(), "bench/tasks.json");
  if (!fs.existsSync(tasksPath)) return [];
  return JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
}
