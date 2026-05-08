cd ~
# 如果之前有过残留的 setup_v2.sh，先删除
rm -f setup_v2.sh

cat > setup_v2.sh << 'SETUP_SCRIPT'
#!/bin/bash
set -e

echo "🚀 BrainyCode v2.0 快速搭建"
mkdir -p brainycode-v2
cd brainycode-v2
npm init -y > /dev/null 2>&1
npm install ts-morph typescript @types/node ts-node openai --save

# 生成正确的 tsconfig.json
npx tsc --init --target ES2020 --module commonjs --esModuleInterop true --resolveJsonModule true --verbatimModuleSyntax false --outDir dist --rootDir src > /dev/null 2>&1

mkdir -p src test-login

# ---------- extract-ir.ts ----------
cat > src/extract-ir.ts << 'EOF'
import { Project, Node, FunctionDeclaration, VariableStatement, ArrowFunction } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

interface FunctionInfo {
  name: string;
  params: { name: string; type: string }[];
  returnType: string;
  file: string;
  calls: string[];
}

function getParamType(param: any): string {
  const typeNode = param.getTypeNode?.();
  return typeNode ? typeNode.getText() : "any";
}

function getReturnType(func: FunctionDeclaration | ArrowFunction): string {
  const node = func.getReturnTypeNode?.();
  return node ? node.getText() : "any";
}

function extractDirectCalls(func: FunctionDeclaration | ArrowFunction): string[] {
  const body = func.getBody();
  if (!body) return [];
  const calls: string[] = [];
  body.forEachDescendant((node, traversal) => {
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (Node.isIdentifier(expr)) calls.push(expr.getText());
      else if (Node.isPropertyAccessExpression(expr)) calls.push(expr.getName());
    }
    if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node)) traversal.skip();
  });
  return [...new Set(calls)];
}

export function extractIR(projectRoot: string): FunctionInfo[] {
  const absRoot = path.resolve(projectRoot);
  const project = new Project({
    tsConfigFilePath: path.join(absRoot, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });
  if (!fs.existsSync(path.join(absRoot, "tsconfig.json"))) {
    project.addSourceFilesAtPaths(path.join(absRoot, "**/*.ts"));
  }
  const funcs: FunctionInfo[] = [];
  for (const sf of project.getSourceFiles()) {
    const relPath = path.relative(absRoot, sf.getFilePath());
    for (const f of sf.getFunctions()) {
      const name = f.getName();
      if (!name) continue;
      funcs.push({
        name,
        params: f.getParameters().map(p => ({ name: p.getName(), type: getParamType(p) })),
        returnType: getReturnType(f),
        file: relPath,
        calls: extractDirectCalls(f),
      });
    }
    for (const vs of sf.getVariableStatements()) {
      for (const decl of vs.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init))) continue;
        const name = decl.getName();
        if (!name) continue;
        const af = init as ArrowFunction;
        funcs.push({
          name,
          params: af.getParameters().map(p => ({ name: p.getName(), type: getParamType(p) })),
          returnType: getReturnType(af),
          file: relPath,
          calls: extractDirectCalls(af),
        });
      }
    }
  }
  return funcs;
}

if (require.main === module) {
  const root = process.argv[2];
  if (!root) { console.error("用法: ts-node extract-ir.ts <项目根>"); process.exit(1); }
  const fns = extractIR(root);
  fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
  console.log(`✅ IR 提取完成: ${fns.length} 个函数 -> ir.json`);
}
EOF

# ---------- actions.ts ----------
cat > src/actions.ts << 'EOF'
export type Action =
  | { kind: "call"; function: string; args: Arg[]; assignTo?: string }
  | { kind: "assign"; target: string; value: string | Action }
  | { kind: "return"; value: string | Action };
export type Arg = { name: string; type: string; value: string | Action };
EOF

# ---------- validator.ts ----------
cat > src/validator.ts << 'EOF'
import { Action } from "./actions";
import irData from "../ir.json";

const functions = irData as any[];

export function validateAction(action: Action): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (action.kind === "call") {
    const fn = functions.find(f => f.name === action.function);
    if (!fn) {
      errors.push(`函数 '${action.function}' 不存在`);
      return { valid: false, errors };
    }
    if (action.args.length !== fn.params.length) {
      errors.push(`参数数量不匹配: 期望 ${fn.params.length}, 实际 ${action.args.length}`);
    }
    action.args.forEach((arg, i) => {
      const expected = fn.params[i]?.type || "any";
      if (expected !== "any" && arg.type !== "any" && arg.type !== expected) {
        errors.push(`类型不匹配: 参数 '${fn.params[i].name}' 期望 ${expected}, 实际 ${arg.type}`);
      }
    });
  } else if (action.kind === "assign" && typeof action.value === "object") {
    errors.push(...validateAction(action.value).errors);
  } else if (action.kind === "return" && typeof action.value === "object") {
    errors.push(...validateAction(action.value).errors);
  }
  return { valid: errors.length === 0, errors };
}
EOF

# ---------- llm.ts ----------
cat > src/llm.ts << 'EOF'
import OpenAI from "openai";

const apiKey = process.env.LLM_API_KEY || "sk-xxxx";
const baseURL = process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";
const model = process.env.LLM_MODEL || "deepseek-chat";

const client = new OpenAI({ apiKey, baseURL });

export async function generate(prompt: string): Promise<string> {
  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
  });
  return resp.choices[0].message?.content || "";
}
EOF

# ---------- planner.ts ----------
cat > src/planner.ts << 'EOF'
import { generate } from "./llm";
import { Action } from "./actions";
import { validateAction } from "./validator";
import * as fs from "fs";

export async function plan(userIntent: string): Promise<Action[]> {
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
  const funcList = ir.map((f: any) =>
    `- ${f.name}(${f.params.map((p: any) => `${p.name}: ${p.type}`).join(", ")}): ${f.returnType}`
  ).join("\n");

  let prompt = `可用函数：\n${funcList}\n\n需求：${userIntent}\n返回 JSON 动作数组: [{ "kind": "call", "function": "...", "args": [{"name": "...", "type": "...", "value": "..."}] }, ...] 只返回 JSON。`;
  let actions: Action[] = [];
  for (let r = 0; r < 3; r++) {
    const text = await generate(prompt);
    try {
      actions = JSON.parse(text);
      if (actions.every(a => validateAction(a).valid)) break;
    } catch {}
    prompt += "\n\n上次无效，请修正。";
  }
  return actions;
}
EOF

# ---------- emitter.ts ----------
cat > src/emitter.ts << 'EOF'
import { Action } from "./actions";

function actToCode(a: Action): string {
  if (a.kind === "call") {
    const prefix = a.assignTo ? `const ${a.assignTo} = ` : "";
    return `${prefix}${a.function}(${a.args.map(x => x.value).join(", ")});`;
  } else if (a.kind === "assign") {
    const val = typeof a.value === "string" ? a.value : actToCode(a.value);
    return `const ${a.target} = ${val};`;
  } else if (a.kind === "return") {
    const val = typeof a.value === "string" ? a.value : actToCode(a.value);
    return `return ${val};`;
  }
  return "";
}

export function emitCode(actions: Action[]): string {
  return actions.map(actToCode).join("\n");
}
EOF

# ---------- runtime.ts ----------
cat > src/runtime.ts << 'EOF'
import { execSync } from "child_process";
import * as fs from "fs";

export function runAndCheck(code: string): { success: boolean; error?: string } {
  const f = "_temp_check.ts";
  fs.writeFileSync(f, code);
  try {
    execSync(`npx ts-node ${f}`, { timeout: 5000, encoding: "utf-8" });
    fs.unlinkSync(f);
    return { success: true };
  } catch (e: any) {
    fs.unlinkSync(f);
    return { success: false, error: e.stderr?.toString() || e.toString() };
  }
}
EOF

# ---------- main.ts ----------
cat > src/main.ts << 'EOF'
import { extractIR } from "./extract-ir";
import { plan } from "./planner";
import { emitCode } from "./emitter";
import { runAndCheck } from "./runtime";
import * as fs from "fs";

async function main() {
  console.log("📊 提取 IR...");
  const fns = extractIR("./test-login");
  fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
  console.log(`✅ 函数数量: ${fns.length}`);

  const intent = "实现登录接口，验证密码后返回 JWT";
  console.log("🧠 规划中...");
  const actions = await plan(intent);
  console.log("🎯 动作序列:", JSON.stringify(actions, null, 2));

  const code = emitCode(actions);
  console.log("📝 生成的代码:\n", code);

  const result = runAndCheck(code);
  if (result.success) console.log("✅ 运行通过！");
  else console.log("❌ 运行失败:", result.error);
}

main().catch(console.error);
EOF

# ---------- 测试项目 ----------
cat > test-login/auth.ts << 'EOF'
export type PasswordHash = string;
export type Token = string;
export type UserPayload = { id: number; role: string };

export function verifyPassword(plain: string, hash: PasswordHash): boolean {
  return true;
}
export function generateJWT(payload: UserPayload): Token {
  return "mock-token";
}
EOF

echo '{"compilerOptions":{"target":"ES2020","module":"commonjs","strict":true,"esModuleInterop":true}}' > test-login/tsconfig.json

echo ""
echo "✅ 环境准备完成！"
echo "接下来执行："
echo "  export LLM_API_KEY=你的DeepSeek_API_Key"
echo "  cd ~/brainycode-v2"
echo "  npx ts-node src/main.ts"
SETUP_SCRIPT

chmod +x setup_v2.sh
./setup_v2.sh