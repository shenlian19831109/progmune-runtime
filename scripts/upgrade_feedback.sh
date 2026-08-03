#!/bin/bash
set -e

echo "🚀 开始集成 Runtime Feedback..."

# 1. 创建完整的反馈记录模块
cat > src/feedback.ts << 'EOF'
import * as fs from "fs";
import * as path from "path";

interface RunRecord {
  intent: string;
  functionName: string;
  success: boolean;
  errorType?: string;
  timestamp: string;
}

const FEEDBACK_PATH = path.resolve(__dirname, "../feedback.json");

export function loadFeedback(): RunRecord[] {
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  return JSON.parse(fs.readFileSync(FEEDBACK_PATH, "utf-8"));
}

export function saveFeedback(record: RunRecord) {
  const data = loadFeedback();
  data.push(record);
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2));
}

export function getFunctionSuccessRate(funcName: string): number {
  const records = loadFeedback();
  const funcRecords = records.filter(r => r.functionName === funcName);
  if (funcRecords.length === 0) return 0.5; // 中性值
  const successCount = funcRecords.filter(r => r.success).length;
  return successCount / funcRecords.length;
}

export function recordRun(intent: string, actions: any[], success: boolean, error?: string) {
  for (const action of actions) {
    if (action.kind === "call") {
      saveFeedback({
        intent,
        functionName: action.function,
        success,
        errorType: error ? error.split("\n")[0] : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
EOF

# 2. 更新 Planner，在 prompt 中注入成功率信息
cat > src/planner.ts << 'EOF'
import { generate } from "./llm";
import { Action } from "./actions";
import { validateAction } from "./validator";
import { getFunctionSuccessRate } from "./feedback";
import * as fs from "fs";

export async function plan(userIntent: string): Promise<Action[]> {
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));

  // 构造带成功率标记的函数列表
  const funcList = ir.map((f: any) => {
    const rate = getFunctionSuccessRate(f.name);
    const star = rate > 0.8 ? "⭐" : rate > 0.5 ? "👍" : "⚠️";
    const params = f.params.map((p: any) => `${p.name}: ${p.type}`).join(", ");
    return `${star} ${f.name}(${params}): ${f.returnType} (成功率: ${(rate*100).toFixed(0)}%)`;
  }).join("\n");

  let prompt = `可用函数（成功率标记）：\n${funcList}\n\n需求：${userIntent}\n` +
    `要求：如果后续动作需要前一个动作的输出，请使用变量名（如 result_0）作为参数值（value）。` +
    `变量名由你是用 assignTo 字段指定（如 "assignTo": "pwd_ok"），后续动作中 value 可直接使用该变量名。` +
    `返回纯JSON数组，不要Markdown。格式：[{ "kind": "call", "function": "...", "args": [{"name": "...", "type": "...", "value": "..."}], "assignTo": "变量名" }]`;

  let actions: Action[] = [];
  for (let r = 0; r < 3; r++) {
    let text = await generate(prompt);
    text = text.replace(/```json\s*/gi, '[').replace(/```\s*/g, ']');
    const match = text.match(/\[([\s\S]*)\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          actions = parsed;
          const results = actions.map((a: any) => validateAction(a));
          const invalid = results.filter((r: any) => !r.valid);
          if (invalid.length === 0) break;
          console.log("⚠️ 校验失败:", invalid.map((r: any, i: number) => r.errors).flat());
        }
      } catch {}
    }
    if (actions.length === 0) prompt += "\n\n上次无效，请严格遵循JSON格式。";
  }
  return actions;
}
EOF

# 3. 更新 generate.ts，加入自动记录反馈
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
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

async function main() {
  const args = process.argv.slice(2);
  let lang: "ts" | "python" = "ts";
  let projectPath = "./test-login";
  let plannerType: "llm" | "search" = "llm";
  let intent = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--lang": lang = args[++i] as any; break;
      case "--project": projectPath = args[++i]; break;
      case "--planner": plannerType = args[++i] as any; break;
      default: intent = args[i]; break;
    }
  }

  if (!intent) {
    console.log("用法: npx ts-node src/generate.ts [--lang ts|python] [--project 路径] [--planner llm|search] <需求描述>");
    process.exit(1);
  }

  // 提取 IR
  let fns: any[];
  if (lang === "python") {
    fns = extractIRPython(projectPath);
  } else {
    fns = extractIR(projectPath);
  }
  fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
  console.log(`✅ 函数数量: ${fns.length}`);

  // 规划
  console.log(`🧠 使用 ${plannerType} Planner 规划...`);
  let actions: any[];
  if (plannerType === "search") {
    actions = await searchPlan(intent, 2, 4);
  } else {
    actions = await plan(intent);
  }

  if (!actions || actions.length === 0) {
    console.log("❌ 无法找到合法的动作序列。");
    return;
  }

  const validationResults = actions.map((a: any) => validateAction(a));
  if (validationResults.some((r: any) => !r.valid)) {
    console.log("❌ 存在无效动作，生成失败。");
    return;
  }

  console.log("🎯 动作序列:", JSON.stringify(actions, null, 2));

  // 发射代码
  let code: string;
  if (lang === "python") {
    code = emitPython(actions);
  } else {
    code = emitCode(actions);
  }
  console.log("📝 生成的代码:\n" + code);

  // 运行检查并记录反馈
  let success = false;
  let error: string | undefined;
  if (lang === "python") {
    const tmpFile = path.join(path.resolve(projectPath), "__py_temp.py");
    fs.writeFileSync(tmpFile, code);
    try {
      const output = execSync(`python3 ${tmpFile}`, { timeout: 5000, encoding: "utf-8", cwd: path.resolve(projectPath) });
      console.log("✅ 运行通过！输出:", output.trim());
      success = true;
    } catch (e: any) {
      error = e.stderr?.toString() || e.toString();
      console.log("❌ 运行失败:", error);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  } else {
    const result = runAndCheck(code);
    success = result.success;
    error = result.error;
    if (result.success) console.log("✅ 运行通过！");
    else console.log("❌ 运行失败:", result.error?.split("\n")[0]);
  }

  // 自动记录反馈
  recordRun(intent, actions, success, error);
  console.log("📊 反馈已记录到 feedback.json");
}

main().catch(console.error);
EOF

echo "✅ 升级完成！反馈系统已集成。"
echo "现在运行任何 generate 命令都会自动记录函数成功率，"
echo "Planner 会根据历史成功率推荐函数。"
echo "示例："
echo "  npx ts-node src/generate.ts --lang python --project ./test-login-multi '实现登录，验证密码后生成JWT'"
