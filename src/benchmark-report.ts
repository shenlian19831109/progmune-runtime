/** Format benchmark results as a readable report
 * @protocol pre_states=["BENCHMARKS_LOADED"] post_states=["REPORT_FORMATTED"]
 */
import * as fs from "fs";
import * as path from "path";

export interface BenchReportItem {
  id: string;
  intent: string;
  compile: boolean;
  repaired: boolean;
}

export function benchmarkReport(): string {
  const resultsDir = path.resolve(process.cwd(), "bench");
  if (!fs.existsSync(resultsDir)) return "No benchmark results.";

  const files = fs.readdirSync(resultsDir)
    .filter(f => f.startsWith("results-") && f.endsWith(".json"))
    .sort().reverse();

  if (files.length === 0) return "No benchmark results.";

  const latest = files[0];
  const results: any[] = JSON.parse(
    fs.readFileSync(path.join(resultsDir, latest), "utf-8")
  );

  const passed = results.filter(r => r.compile_success).length;
  const repaired = results.filter(r => r.repair_applied).length;
  const lines: string[] = [
    `Benchmark: ${results.length} tasks`,
    `Compiled: ${passed}/${results.length} (${((passed/results.length)*100).toFixed(1)}%)`,
    `Repaired: ${repaired}`,
    "",
  ];

  for (const r of results) {
    const icon = r.compile_success ? "✅" : "❌";
    const repair = r.repair_applied ? " 🔧" : "";
    lines.push(`${icon} ${r.id}: ${r.intent.slice(0,60)}${repair}`);
  }

  return lines.join("\n");
}
