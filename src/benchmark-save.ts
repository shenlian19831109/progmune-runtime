/** Save benchmark results to a timestamped file
 * @protocol pre_states=["BENCHMARKS_LOADED"] post_states=["RESULTS_SAVED"]
 */
import * as fs from "fs";
import * as path from "path";

export function benchmarkSave(data: any): string {
  const dir = path.resolve(process.cwd(), "bench");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const filePath = path.join(dir, `results-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

export function benchmarkLoadLatest(): any | null {
  const dir = path.resolve(process.cwd(), "bench");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("results-") && f.endsWith(".json"))
    .sort().reverse();
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf-8"));
}
