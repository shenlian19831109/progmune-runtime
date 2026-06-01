/**
 * Progmune Generation Benchmark Runner
 *
 * Runs benchmark tasks through progmune_execute and records:
 *   compile_success, protocol_violations, repair_count, replay_pass, errors
 *
 * Usage: npx ts-node --transpile-only bench/run.ts
 */

import * as fs from "fs";
import * as path from "path";
import { execute, verifyCompiles } from "../src/execute";
import type { ExecuteResult } from "../src/execute";

interface BenchTask {
  id: string;
  intent: string;
  category: string;
  hasInput?: boolean;
}

interface BenchResult {
  id: string;
  intent: string;
  category: string;
  compile_success: boolean;
  repair_applied: boolean;
  repair_count: number;
  violations: number;
  session_id: string;
  errors: string[];
  timestamp: string;
}

async function runBenchmark(tasks: BenchTask[]): Promise<BenchResult[]> {
  const results: BenchResult[] = [];

  for (const task of tasks) {
    const fp = `bench/output/${task.id}.ts`;
    try { fs.mkdirSync("bench/output", { recursive: true }); } catch {}

    console.error(`[${task.id}] ${task.intent.slice(0,60)}`);

    const result: ExecuteResult = await execute(task.intent, ".", fp);

    let compile_success = false;
    let errors: string[] = [];

    if (result.success && result.filePath && fs.existsSync(result.filePath)) {
      const check = verifyCompiles(result.filePath);
      compile_success = check.pass;
      errors = check.errors;
      // Clean up generated file (keep session data)
      try { fs.unlinkSync(result.filePath); } catch {}
    } else {
      errors = [result.error || "unknown"];
    }

    results.push({
      id: task.id,
      intent: task.intent,
      category: task.category,
      compile_success,
      repair_applied: result.repairApplied,
      repair_count: result.repairCount,
      violations: result.violations,
      session_id: result.sessionId,
      errors,
      timestamp: new Date().toISOString(),
    });

    const status = compile_success ? "✅" : "❌";
    const repair = result.repairApplied ? ` 🔧${result.repairCount}` : "";
    console.error(`  ${status}${repair}${errors.length > 0 ? " " + errors[0]?.slice(0,60) : ""}`);
  }

  return results;
}

async function main() {
  const tasks: BenchTask[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "tasks.json"), "utf-8")
  );

  console.error(`Progmune Benchmark: ${tasks.length} tasks\n`);

  const results = await runBenchmark(tasks);

  // Summary
  const passed = results.filter(r => r.compile_success).length;
  const repaired = results.filter(r => r.repair_applied).length;
  const rate = ((passed / results.length) * 100).toFixed(1);

  console.error(`\nResult: ${passed}/${results.length} (${rate}%) compile, ${repaired} repaired`);

  // Save results
  const reportPath = `bench/results-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.error(`Saved: ${reportPath}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
