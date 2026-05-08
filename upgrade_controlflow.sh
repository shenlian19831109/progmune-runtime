#!/bin/bash
set -e

echo "🚀 升级：控制流动作规划与发射"

# 1. 更新 actions.ts（已包含 if/for，无需改动）

# 2. 更新 planner.ts，加入 if/else 生成指引
cat > src/planner.ts << 'PLANNER_EOF'
import { generate } from "./llm";
import { Action } from "./actions";
import { validateAction } from "./validator";
import { getFunctionSuccessRate } from "./feedback";
import * as fs from "fs";

export async function plan(userIntent: string): Promise<Action[]> {
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));

  const funcList = ir.map((f: any) => {
    const rate = getFunctionSuccessRate(f.name);
    const star = rate > 0.8 ? "⭐" : rate > 0.5 ? "👍" : "⚠️";
    const params = f.params.map((p: any) => `${p.name}: ${p.type}`).join(", ");
    return `${star} ${f.name}(${params}) -> ${f.returnType} (成功率: ${(rate*100).toFixed(0)}%)`;
  }).join("\n");

  // 提取目标函数名，禁止直接调用
  const matchFunc = userIntent.match(/(?:实现|implement|编写|创建)\s*(\w+)\s*(?:函数|function)?/i);
  const forbiddenFuncs: string[] = [];
  if (matchFunc) {
    const targetName = matchFunc[1];
    if (ir.find((f: any) => f.name.toLowerCase() === targetName.toLowerCase())) {
      forbiddenFuncs.push(targetName);
    }
  }

  let prompt = `可用函数（含类型与成功率）：\n${funcList}\n` +
    (forbiddenFuncs.length > 0 ? `\n⚠️ 禁止直接调用：${forbiddenFuncs.join(", ")}。你必须用更底层的函数实现。\n` : "") +
    `\n需求：${userIntent}\n` +
    `规则：\n` +
    `- 使用 assignTo 定义变量，后续动作通过变量名引用输出。\n` +
    `- 引用变量时必须确保类型兼容（如 bool 不能赋给 dict）。\n` +
    `- 类型不兼容时，提供新的字面量值。\n` +
    `- 支持控制流：\n` +
    `  若需要条件判断，可用：\n` +
    `   { "kind": "if", "condition": "变量名或表达式", "thenActions": [...], "elseActions": [...] }\n` +
    `   其中 thenActions 和 elseActions 是动作数组。\n` +
    `- 绝对不能调用禁止列表中的函数。\n` +
    `- 返回纯JSON数组，无需Markdown。\n` +
    `格式示例：\n` +
    `[\n` +
    `  { "kind": "call", "function": "...", "args": [...], "assignTo": "变量" },\n` +
    `  { "kind": "if", "condition": "password_valid", "thenActions": [...], "elseActions": [...] }\n` +
    `]`;

  let actions: Action[] = [];
  for (let r = 0; r < 3; r++) {
    let text = await generate(prompt);
    text = text.replace(/```json\s*/gi, '[').replace(/```\s*/g, ']');
    const match = text.match(/\[([\s\S]*)\]/);
    if (match) {
      try {
        let parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0])) {
          parsed = parsed[0];
        }
        if (Array.isArray(parsed)) {
          parsed = parsed.filter((a: any) => !forbiddenFuncs.includes(a.function));
          if (parsed.length === 0) continue;
          actions = parsed;
          const results = actions.map((a: any) => validateAction(a));
          const invalid = results.filter((r: any) => !r.valid);
          if (invalid.length === 0) break;
          console.log("⚠️ 校验失败:", invalid.map((r: any) => r.errors).flat().join(", "));
        }
      } catch (e) {
        console.log("⚠️ JSON 解析异常:", e);
      }
    }
    if (actions.length === 0) prompt += "\n\n上次无效，请确保只返回JSON数组，且不包含禁止函数。";
  }
  return actions;
}
PLANNER_EOF

# 3. 更新 Python 发射器，支持 if/for
cat > src/python-emitter.ts << 'PYEMIT_EOF'
import { Action } from "./actions";
import * as fs from "fs";
import * as path from "path";

function toPythonModule(filePath: string): string {
  let module = filePath.replace(/\.py$/, "").replace(/\//g, ".");
  module = module.replace(/\.$/, "").replace(/\.__init__$/, "");
  return module;
}

export function emitPython(actions: Action[]): string {
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
  const funcToFile = new Map<string, string>();
  const funcToParams = new Map<string, any[]>();
  for (const f of ir) {
    funcToFile.set(f.name, f.file);
    funcToParams.set(f.name, f.params || []);
  }

  // 收集导入
  const imports = new Map<string, Set<string>>();
  const collectImports = (action: Action) => {
    if (action.kind === "call") {
      const file = funcToFile.get(action.function);
      if (file) {
        const mod = toPythonModule(file);
        if (!imports.has(mod)) imports.set(mod, new Set());
        imports.get(mod)!.add(action.function);
      }
    } else if (action.kind === "if") {
      for (const a of action.thenActions) collectImports(a);
      if (action.elseActions) for (const a of action.elseActions) collectImports(a);
    } else if (action.kind === "for") {
      for (const a of action.bodyActions) collectImports(a);
    }
  };
  for (const a of actions) collectImports(a);

  let code = "";
  for (const [mod, funcs] of imports) {
    code += `from ${mod} import ${Array.from(funcs).join(", ")}\n`;
  }
  code += "\n\ndef main():\n";

  const declared = new Set<string>();
  let counter = 0;

  function defaultValueForType(type: string, hint?: string): string {
    const t = type.toLowerCase();
    if (t === "str" || t === "string") return JSON.stringify(hint || "default");
    if (t === "int" || t === "integer") return "0";
    if (t === "float" || t === "number") return "0.0";
    if (t === "bool" || t === "boolean") return "False";
    if (t === "dict" || t === "dictionary" || t === "userpayload") return "{}";
    if (t === "list" || t === "array") return "[]";
    if (t === "tuple") return "()";
    if (t === "set") return "set()";
    if (t === "none" || t === "nonetype") return "None";
    return JSON.stringify(hint || "placeholder");
  }

  const convert = (action: Action, indent: string = "    "): string => {
    if (action.kind === "call") {
      const params = funcToParams.get(action.function) || [];
      const args = action.args.map((a, idx) => {
        if (typeof a.value === "string") {
          if (declared.has(a.value)) return a.value;
          const paramType = params[idx]?.type || "any";
          return defaultValueForType(paramType, a.value);
        }
        return convert(a.value, indent);
      }).join(", ");
      const resultVar = action.assignTo || `result_${counter++}`;
      const line = `${indent}${resultVar} = ${action.function}(${args})`;
      declared.add(resultVar);
      return line;
    } else if (action.kind === "if") {
      let lines = `${indent}if ${action.condition}:\n`;
      for (const a of action.thenActions) {
        lines += convert(a, indent + "    ") + "\n";
      }
      if (action.elseActions && action.elseActions.length > 0) {
        lines += `${indent}else:\n`;
        for (const a of action.elseActions) {
          lines += convert(a, indent + "    ") + "\n";
        }
      }
      return lines.trimEnd();
    } else if (action.kind === "for") {
      let lines = `${indent}for ${action.variable} in ${action.iterable}:\n`;
      for (const a of action.bodyActions) {
        lines += convert(a, indent + "    ") + "\n";
      }
      return lines.trimEnd();
    } else if (action.kind === "assign") {
      const val = typeof action.value === "string" ? JSON.stringify(action.value) : convert(action.value);
      declared.add(action.target);
      return `${indent}${action.target} = ${val}`;
    } else if (action.kind === "return") {
      const val = typeof action.value === "string" ?
        (declared.has(action.value) ? action.value : JSON.stringify(action.value)) :
        convert(action.value);
      return `${indent}return ${val}`;
    }
    return "";
  };

  for (const a of actions) {
    code += convert(a) + "\n";
  }

  code += "\nif __name__ == '__main__':\n    main()\n";
  return code;
}
PYEMIT_EOF

# 4. 更新 TypeScript 发射器，同样支持 if/for
cat > src/emitter.ts << 'TSEMIT_EOF'
import { Action } from "./actions";
import * as fs from "fs";

const BASIC_TYPES = new Set([
  "string", "number", "boolean", "any", "void", "undefined", "null",
  "str", "int", "float", "bool", "list", "dict", "tuple", "bytes",
]);

function getImportPath(file: string): string {
  return "./" + file.replace(/\.ts$|\.tsx$/, "");
}

export function emitCode(actions: Action[]): string {
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
  const fnIndex = new Map<string, string>();
  const fnMeta = new Map<string, any>();
  for (const f of ir) {
    fnIndex.set(f.name, f.file);
    fnMeta.set(f.name, f);
  }

  const imports = new Map<string, Set<string>>();
  const typeImports = new Map<string, Set<string>>();

  const collect = (action: Action) => {
    if (action.kind === "call") {
      const file = fnIndex.get(action.function);
      const meta = fnMeta.get(action.function);
      if (file) {
        if (!imports.has(file)) imports.set(file, new Set());
        imports.get(file)!.add(action.function);
        if (meta?.params) {
          for (const p of meta.params) {
            if (!BASIC_TYPES.has(p.type)) {
              if (!typeImports.has(file)) typeImports.set(file, new Set());
              typeImports.get(file)!.add(p.type);
            }
          }
        }
      }
    } else if (action.kind === "if") {
      for (const a of action.thenActions) collect(a);
      if (action.elseActions) for (const a of action.elseActions) collect(a);
    } else if (action.kind === "for") {
      for (const a of action.bodyActions) collect(a);
    }
  };
  for (const a of actions) collect(a);

  let code = "";
  for (const [file, funcSet] of imports)
    code += `import { ${[...funcSet].join(", ")} } from "${getImportPath(file)}";\n`;
  for (const [file, typeSet] of typeImports)
    code += `import type { ${[...typeSet].join(", ")} } from "${getImportPath(file)}";\n`;
  code += "\nexport function main() {\n";

  const declared = new Set<string>();
  let counter = 0;

  const convert = (action: Action, indent: string = "  "): string => {
    if (action.kind === "call") {
      const meta = fnMeta.get(action.function);
      const args = action.args.map((a, i) => {
        if (typeof a.value === "string") {
          if (declared.has(a.value)) return a.value;
          const paramType = meta?.params?.[i]?.type || "any";
          if (BASIC_TYPES.has(paramType)) {
            if (paramType === "string" || paramType === "str") return `"defaultStr"`;
            if (paramType === "number" || paramType === "int" || paramType === "float") return "0";
            if (paramType === "boolean" || paramType === "bool") return "false";
            return `"default"`;
          }
          if (paramType === "UserPayload") return `{ id: 1, role: "user" } as UserPayload`;
          if (paramType === "PasswordHash") return `"defaultHash"`;
          if (paramType === "Token") return `"defaultToken"`;
          return `{} as ${paramType}`;
        }
        return convert(a.value, indent);
      }).join(", ");
      const varName = action.assignTo || `result_${counter++}`;
      declared.add(varName);
      return `${indent}const ${varName} = ${action.function}(${args});`;
    } else if (action.kind === "if") {
      let lines = `${indent}if (${action.condition}) {\n`;
      for (const a of action.thenActions) lines += convert(a, indent + "  ") + "\n";
      lines += `${indent}}`;
      if (action.elseActions && action.elseActions.length > 0) {
        lines += ` else {\n`;
        for (const a of action.elseActions) lines += convert(a, indent + "  ") + "\n";
        lines += `${indent}}`;
      }
      return lines;
    } else if (action.kind === "for") {
      let lines = `${indent}for (const ${action.variable} of ${action.iterable}) {\n`;
      for (const a of action.bodyActions) lines += convert(a, indent + "  ") + "\n";
      lines += `${indent}}`;
      return lines;
    } else if (action.kind === "assign") {
      const val = typeof action.value === "string" ? JSON.stringify(action.value) : convert(action.value);
      declared.add(action.target);
      return `${indent}const ${action.target} = ${val};`;
    } else if (action.kind === "return") {
      const val = typeof action.value === "string" ?
        (declared.has(action.value) ? action.value : JSON.stringify(action.value)) :
        convert(action.value);
      return `${indent}return ${val};`;
    }
    return "";
  };

  for (const a of actions) code += convert(a) + "\n";
  code += "}\nmain();\n";
  return code;
}
TSEMIT_EOF

echo "✅ 控制流升级完成！"
echo "测试命令："
echo "npx ts-node src/generate.ts --lang python --project ./test-login-multi \"实现 login 函数，验证密码，成功则生成JWT返回，否则返回错误信息\""
