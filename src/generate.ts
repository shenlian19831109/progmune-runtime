import { extractIR } from "./extract-ir";
import { extractIRPython } from "./extract-ir-python";
import { plan } from "./planner";
import { searchPlan } from "./search-planner";
import { validateAction } from "./validator";
import { emitCode } from "./emitter";
import { emitPython } from "./python-emitter";
import { runAndCheck } from "./runtime";
import { recordRun } from "./feedback";
import { callCount } from "./llm";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface TestResult {
  intent: string;
  planner: string;
  duration_ms: number;
  llm_calls: number;
  success: boolean;
  error?: string;
}

async function main() {
  const results: TestResult[] = [];
  const intents = [
    "实现 login 函数，验证密码，成功则生成JWT，否则返回错误信息",
    "实现批量处理支付 transactions，对每笔交易校验卡片并记录日志",
    "实现数据报表函数，分页获取活跃用户，按类别分组并排序"
  ];
  const planners = ["llm", "search"] as const;
  const lang = "python";
  const projectPath = "./test-xlarge";

  const fns = extractIRPython(projectPath);
  fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
  console.log(`✅ 项目规模: ${fns.length} 函数\n`);

  for (const intent of intents) {
    for (const planner of planners) {
      const start = Date.now();
      let actions: any[] = [];
      try {
        if (planner === "llm") {
          actions = await plan(intent);
        } else {
          actions = await searchPlan(intent, 2, 4);
        }
      } catch (e) {
        results.push({ intent, planner, duration_ms: Date.now() - start, llm_calls: callCount, success: false, error: String(e) });
        continue;
      }
      const duration = Date.now() - start;

      const validationResults = actions.map((a: any) => validateAction(a));
      const valid = validationResults.every((r: any) => r.valid);
      if (!valid || actions.length === 0) {
        results.push({ intent, planner, duration_ms: duration, llm_calls: callCount, success: false, error: "校验失败" });
        continue;
      }

      const code = emitPython(actions);
      const tmpFile = path.join(path.resolve(projectPath), "__test.py");
      fs.writeFileSync(tmpFile, code);
      let success = false;
      let error: string | undefined;
      try {
        execSync(`python3 ${tmpFile}`, { timeout: 5000, encoding: "utf-8", cwd: path.resolve(projectPath) });
        success = true;
      } catch (e: any) {
        error = e.stderr?.toString() || e.toString();
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }

      recordRun(intent, actions, success, error);
      results.push({ intent, planner, duration_ms: duration, llm_calls: callCount, success, error });
      console.log(`${planner} | ${intent.substring(0,20)}... | ${duration}ms | 调用:${callCount} | ${success ? '✅' : '❌'}`);
    }
  }

  console.log("\n📊 200函数压力测试报告:");
  console.table(results.map(r => ({
    Intent: r.intent.substring(0,30),
    Planner: r.planner,
    Time: r.duration_ms + 'ms',
    LLM: r.llm_calls,
    Success: r.success ? '✅' : '❌'
  })));

  fs.writeFileSync("stress_200_test.json", JSON.stringify(results, null, 2));
  console.log("报告已保存到 stress_200_test.json");

  // 计算统计指标
  const totalLLM = results.reduce((s, r) => s + r.llm_calls, 0);
  const avgTime = results.reduce((s, r) => s + r.duration_ms, 0) / results.length;
  const successRate = results.filter(r => r.success).length / results.length * 100;
  console.log(`\n📈 汇总: 总LLM调用=${totalLLM}, 平均耗时=${avgTime.toFixed(0)}ms, 成功率=${successRate.toFixed(0)}%`);
}

main().catch(console.error);
