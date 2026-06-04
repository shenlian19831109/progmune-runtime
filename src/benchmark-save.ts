/** Save benchmark results to a timestamped file.
 * @requires BENCHMARK_RESULT @produces SAVED_FILE_PATH
 * @purpose Persist benchmark execution results to disk
 * @tags benchmark, save, persistence
 * @useWhen saving benchmark run outputs
 * @protocol pre_states=["BENCHMARKS_LOADED"] post_states=["RESULTS_SAVED"]
 */
import * as fs from "fs";
import * as path from "path";

/**
 * @requires BENCHMARK_RESULT @produces SAVED_FILE_PATH
 * @purpose Write benchmark data to a timestamped JSON file
 */
export function benchmarkSave(data: any): string {
  const dir = path.resolve(process.cwd(), "bench");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const filePath = path.join(dir, `results-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

/**
 * @requires BENCH_DIR @produces BENCHMARK_RESULT
 * @purpose Load the most recent benchmark results from disk
 * @tags benchmark, load, data
 */
export function benchmarkLoadLatest(): any | null {
  const dir = path.resolve(process.cwd(), "bench");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("results-") && f.endsWith(".json"))
    .sort().reverse();
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf-8"));
}
