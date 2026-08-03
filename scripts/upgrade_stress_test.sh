#!/bin/bash
set -e

echo "⚙️ 升级压力测试环境..."

# 更新 llm.ts (加入计数器)
cat > src/llm.ts << 'EOF'
import OpenAI from "openai";
const apiKey = process.env.LLM_API_KEY || "sk-xxxx";
const baseURL = process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";
const model = process.env.LLM_MODEL || "deepseek-chat";
const client = new OpenAI({ apiKey, baseURL });
export let callCount = 0;
export function resetCallCount() { callCount = 0; }
export async function generate(prompt: string): Promise<string> {
  callCount++;
  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
  });
  return resp.choices[0]?.message?.content || "";
}
EOF

# 更新 planner.ts (加入 resetCallCount)
cat > src/planner.ts << 'EOF'
import { generate, resetCallCount } from "./llm";
import { Action } from "./actions";
import { validateAction } from "./validator";
import { getFunctionSuccessRate } from "./feedback";
import * as fs from "fs";

export async function plan(userIntent: string): Promise<Action[]> {
  resetCallCount();
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
  const funcList = ir.map((f: any) => {
    const rate = getFunctionSuccessRate(f.name);
    const star = rate > 0.8 ? "⭐" : rate > 0.5 ? "👍" : "⚠️";
    const params = f.params.map((p: any) => `${p.name}: ${p.type}`).join(", ");
    return `${star} ${f.name}(${params}) -> ${f.returnType} (成功率: ${(rate*100).toFixed(0)}%)`;
  }).join("\n");

  const matchFunc = userIntent.match(/(?:实现|implement|编写|创建)\s*(\w+)\s*(?:函数|function)?/i);
  const forbiddenFuncs: string[] = [];
  if (matchFunc) {
    const targetName = matchFunc[1];
    if (ir.find((f: any) => f.name.toLowerCase() === targetName.toLowerCase())) {
      forbiddenFuncs.push(targetName);
    }
  }

  const strictFormat = 
    `严格规定：只能使用以下两种动作对象格式：
1. 函数调用：{ "kind": "call", "function": "函数名", "args": [ {"name": "参数名", "type": "类型", "value": "值"} ], "assignTo": "变量名" }
2. 条件判断：{ "kind": "if", "condition": "变量名", "thenActions": [动作数组], "elseActions": [动作数组] }
动作数组必须由上述两种对象组成，绝对不能包含其他格式。`;

  let prompt = `可用函数：\n${funcList}\n` +
    (forbiddenFuncs.length > 0 ? `\n⚠️ 禁止直接调用：${forbiddenFuncs.join(", ")}。\n` : "") +
    `\n需求：${userIntent}\n` +
    strictFormat +
    `\n返回纯JSON数组，不要Markdown。`;

  let actions: Action[] = [];
  for (let r = 0; r < 3; r++) {
    let text = await generate(prompt);
    text = text.replace(/```json\s*/gi, '[').replace(/```\s*/g, ']');
    const match = text.match(/\[([\s\S]*)\]/);
    if (match) {
      try {
        let parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0])) parsed = parsed[0];
        if (Array.isArray(parsed)) {
          function filterForbidden(acts: any[]): any[] {
            return acts.filter((a: any) => !forbiddenFuncs.includes(a.function)).map((a: any) => {
              if (a.kind === "if") {
                a.thenActions = filterForbidden(a.thenActions || []);
                a.elseActions = filterForbidden(a.elseActions || []);
              }
              return a;
            });
          }
          parsed = filterForbidden(parsed);
          if (parsed.length === 0) continue;
          actions = parsed;
          const results = actions.map((a: any) => validateAction(a));
          const invalid = results.filter((r: any) => !r.valid);
          if (invalid.length === 0) break;
          console.log("⚠️ 校验失败:", invalid.map((r: any) => r.errors).flat().join(", "));
        }
      } catch (e) { console.log("⚠️ JSON 解析异常:", e); }
    }
    if (actions.length === 0) prompt += "\n\n上次完全无效，请严格按照规定的两种动作格式生成JSON数组。";
  }
  return actions;
}
EOF

# 更新 search-planner.ts (加入计数器重置)
cat > src/search-planner.ts << 'EOF'
import { Action } from "./actions";
import { validateAction } from "./validator";
import { generate, resetCallCount } from "./llm";
import { getFunctionSuccessRate } from "./feedback";
import * as fs from "fs";

interface Candidate {
  actions: Action[];
  declaredVars: Map<string, string>;
  currentGoalIndex: number;
  score: number;
}

function loadIR(): any[] {
  return JSON.parse(fs.readFileSync("ir.json", "utf-8"));
}

async function decomposeGoals(intent: string, functions: any[]): Promise<string[]> {
  const funcNames = functions.map(f => f.name).join(", ");
  const prompt = `任务规划器。将需求分解为2-5个有序子目标。可用函数：${funcNames}。需求：${intent}。只返回JSON数组，不要其他文本。`;
  const text = await generate(prompt);
  try {
    const cleaned = text.replace(/```json\s*/gi, '[').replace(/```\s*/g, ']');
    const match = cleaned.match(/\[([\s\S]*)\]/);
    if (match) return JSON.parse(match[0]).slice(0, 5);
  } catch {}
  return [intent];
}

async function functionMatchesGoal(funcName: string, goal: string, intent: string): Promise<number> {
  const keywords = goal.toLowerCase().split(/\s+/);
  const nameLower = funcName.toLowerCase();
  const quickScore = keywords.filter(kw => nameLower.includes(kw) || kw.includes(nameLower)).length;
  if (quickScore > 0) return 0.8 + quickScore * 0.1;
  const prompt = `用户意图: "${intent}"\n当前子目标: "${goal}"\n候选函数: ${funcName}\n贡献度（0-10整数）只返回数字:`;
  const resp = await generate(prompt);
  const s = parseFloat(resp.trim());
  return isNaN(s) ? 0.3 : Math.min(1, s / 10);
}

export async function searchPlan(intent: string, beamWidth = 3, maxDepth = 6): Promise<Action[]> {
  resetCallCount();
  const ir = loadIR();
  const goals = await decomposeGoals(intent, ir);
  console.log("🎯 目标栈:", goals);

  let beam: Candidate[] = [{
    actions: [],
    declaredVars: new Map(),
    currentGoalIndex: 0,
    score: 0,
  }];
  let bestCandidate: Candidate | null = null;

  for (let step = 0; step < maxDepth; step++) {
    const newCandidates: Candidate[] = [];
    for (const cand of beam) {
      if (cand.currentGoalIndex >= goals.length) { newCandidates.push(cand); continue; }
      const currentGoal = goals[cand.currentGoalIndex];
      for (const func of ir) {
        const alreadyUsed = cand.actions.some(a => a.kind === "call" && a.function === func.name && (a as any)._goalIndex === cand.currentGoalIndex);
        if (alreadyUsed) continue;

        const relevance = await functionMatchesGoal(func.name, currentGoal, intent);
        if (relevance < 0.3) continue;

        const args = func.params.map((p: any) => ({
          name: p.name,
          type: p.type,
          value: findCompatibleVar(cand.declaredVars, p.type) || `input_${step}_${p.name}`,
        }));
        const action: Action = { kind: "call", function: func.name, args, assignTo: `var_${step}_${func.name}` };
        (action as any)._goalIndex = cand.currentGoalIndex;
        const validation = validateAction(action);
        if (!validation.valid) continue;

        const newVars = new Map(cand.declaredVars);
        if (action.assignTo) newVars.set(action.assignTo, func.returnType);
        const goalCompleted = relevance > 0.7;
        const nextGoalIndex = goalCompleted ? cand.currentGoalIndex + 1 : cand.currentGoalIndex;
        const successRate = getFunctionSuccessRate(func.name);
        const newScore = cand.score + successRate * 0.5 + relevance * 0.5 + (goalCompleted ? 0.3 : 0);

        newCandidates.push({ actions: [...cand.actions, action], declaredVars: newVars, currentGoalIndex: nextGoalIndex, score: newScore });
        if (newCandidates.length > beamWidth * 10) break;
      }
    }
    newCandidates.sort((a, b) => b.score - a.score);
    beam = newCandidates.slice(0, beamWidth);
    const complete = beam.find(c => c.currentGoalIndex >= goals.length);
    if (complete && (!bestCandidate || complete.score > bestCandidate.score)) bestCandidate = complete;
    if (beam.length === 0) break;
  }
  const winner = bestCandidate || beam[0];
  return winner ? winner.actions : [];
}

function findCompatibleVar(declaredVars: Map<string, string>, neededType: string): string | null {
  for (const [name, type] of declaredVars) {
    if (type === neededType || neededType === "any" || type === "any") return name;
  }
  return null;
}
EOF

# 更新 generate.ts，添加耗时和调用次数统计，写入测试报告
cat > src/generate.ts << 'EOF'
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
    "实现 login 函数，验证密码，成功则生成JWT，否则返回错误",
    "实现批量处理支付 transactions，需要校验卡片并记录日志",
    "实现数据报表函数，分页获取活跃用户，按类别分组并排序"
  ];
  const planners = ["llm", "search"] as const;
  const lang = "python";
  const projectPath = "./test-large";

  // 提取 IR 一次
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
        results.push({ intent, planner, duration_ms: duration, llm_calls: callCount, success: false, error: "校验失败或无动作" });
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
      console.log(`${planner} | ${intent.substring(0,20)}... | ${duration}ms | LLM调用: ${callCount} | ${success ? '✅' : '❌'}` );
    }
  }

  // 输出测试报告
  console.log("\n📊 测试报告:");
  console.table(results.map(r => ({
    Intent: r.intent.substring(0,30),
    Planner: r.planner,
    Duration: r.duration_ms + 'ms',
    LLM: r.llm_calls,
    Success: r.success ? '✅' : '❌'
  })));

  fs.writeFileSync("stress_test_report.json", JSON.stringify(results, null, 2));
  console.log("报告已保存到 stress_test_report.json");
}

main().catch(console.error);
EOF

echo "✅ 压力测试环境已就绪"
