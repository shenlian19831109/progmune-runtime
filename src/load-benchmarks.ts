/** Load benchmark tasks from bench/tasks.json
 * @protocol pre_states=[] post_states=["BENCHMARKS_LOADED"]
 */
import * as fs from "fs";
import * as path from "path";

export interface BenchTask {
  id: string;
  intent: string;
  category: string;
  hasInput?: boolean;
}

export function loadBenchmarks(): BenchTask[] {
  const tasksPath = path.resolve(process.cwd(), "bench/tasks.json");
  if (!fs.existsSync(tasksPath)) return [];
  return JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
}
