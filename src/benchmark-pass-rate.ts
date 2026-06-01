import * as fs from "fs";
import * as path from "path";

interface BenchResultItem {
  id: string;
  compile_success: boolean;
}

export function benchmarkPassRate(): { total: number; passed: number; rate: number } {
  const resultsDir = path.resolve(process.cwd(), "bench");
  if (!fs.existsSync(resultsDir)) return { total: 0, passed: 0, rate: 0 };

  const files = fs.readdirSync(resultsDir).filter(f => f.startsWith("results-") && f.endsWith(".json"));
  if (files.length === 0) return { total: 0, passed: 0, rate: 0 };

  const latest = files.sort().reverse()[0];
  const results: BenchResultItem[] = JSON.parse(
    fs.readFileSync(path.join(resultsDir, latest), "utf-8")
  );

  const passed = results.filter(r => r.compile_success).length;
  return {
    total: results.length,
    passed,
    rate: results.length > 0 ? passed / results.length : 0,
  };
}
