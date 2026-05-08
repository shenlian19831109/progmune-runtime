import { Action } from "./action-runtime";
import * as fs from "fs";
import * as path from "path";

function loadIR() {
  const irPath = path.resolve(__dirname, "../ir.json");
  if (!fs.existsSync(irPath)) return [];
  return JSON.parse(fs.readFileSync(irPath, "utf-8"));
}

const BUILTIN_WHITELIST = new Set([
  "console.log", "setTimeout", "setInterval", "clearTimeout",
  "JSON.stringify", "JSON.parse", "fetch"
]);

function normalizeType(type: string | undefined): string {
  if (!type) return "any";
  const t = type.toLowerCase().trim();
  if (t === "string") return "str";
  if (t === "number" || t === "integer") return "int";
  if (t === "boolean") return "bool";
  if (t === "dictionary" || t === "record" || t === "dict") return "dict";
  if (t === "list") return "list";
  if (t === "tuple") return "tuple";
  if (t === "set") return "set";
  if (t === "any" || t === "variable") return "any";
  return t;
}

function checkVariableFlow(actions: Action[]): string[] {
  const errors: string[] = [];
  const declared = new Map<string, string>();
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.kind === "call") {
      for (const arg of (action.args || [])) {
        if (typeof arg.value === "string" && /^[a-zA-Z_]\w*$/.test(arg.value)) {
          if (declared.has(arg.value)) continue;
          if (arg.value.length < 15 && arg.value[0] === arg.value[0].toLowerCase()) {
            continue;
          }
        }
      }
      if (action.assignTo) {
        if (action.args?.some(a => a.value === action.assignTo)) {
          errors.push(`变量 '${action.assignTo}' 在动作${i}中引用自身`);
        }
        declared.set(action.assignTo, "any");
      }
    } else if (action.kind === "assign") {
      if (action.target) {
        if (typeof action.value === "string" && /^[a-zA-Z_]\w*$/.test(action.value)) {
          if (!declared.has(action.value) && action.value.length < 15) continue;
          if (!declared.has(action.value)) errors.push(`赋值时引用未定义变量 '${action.value}'`);
        }
        declared.set(action.target, "any");
      }
    } else if (action.kind === "return") {
      if (typeof action.value === "string" && /^[a-zA-Z_]\w*$/.test(action.value)) {
        if (!declared.has(action.value) && !/^["']/.test(action.value) && action.value.length < 15) continue;
        if (!declared.has(action.value)) errors.push(`返回未定义变量 '${action.value}'`);
      }
    } else if (action.kind === "if") {
      if (typeof action.condition === "string" && declared.has(action.condition)) continue;
      if (typeof action.condition === "string" && /^(true|false)$/.test(action.condition)) continue;
      if (typeof action.condition === "string" && action.condition.length < 10) {
        // 可能是表达式，放行
      } else {
        errors.push(`条件中引用了未定义的变量 '${action.condition}'`);
      }
      errors.push(...checkVariableFlow(action.thenActions || []));
      errors.push(...checkVariableFlow(action.elseActions || []));
    } else if (action.kind === "for") {
      errors.push(...checkVariableFlow(action.bodyActions || []));
    }
  }
  return errors;
}

export function validateAction(action: Action): { valid: boolean; errors: string[] } {
  const functions = loadIR();
  const errors: string[] = [];

  if (!action || !["call", "if", "for", "assign", "return"].includes(action.kind)) {
    errors.push(`无效动作类型: '${action?.kind}'`);
    return { valid: false, errors };
  }

  if (action.kind === "call") {
    const fn = functions.find((f: any) => f.name === action.function);
    if (!fn) {
      if (action.function && BUILTIN_WHITELIST.has(action.function)) return { valid: true, errors: [] };
      errors.push(`函数 '${action.function}' 不存在`);
      return { valid: false, errors };
    }
    if (!action.args) {
      errors.push(`函数 '${action.function}' 缺少参数列表`);
      return { valid: false, errors };
    }
    if (action.args.length !== fn.params.length) {
      errors.push(`参数数量不匹配: 期望 ${fn.params.length}, 实际 ${action.args.length}`);
    }
    action.args.forEach((arg, i) => {
      if (!arg) {
        errors.push(`函数 '${action.function}' 的第${i}个参数为空`);
        return;
      }
      const expected = normalizeType(fn.params[i]?.type);
      const actual = normalizeType(arg.type);
      if (actual !== "any" && expected !== "any" && actual !== expected) {
        errors.push(`类型不匹配: 参数 '${fn.params[i].name}' 期望 ${expected}, 实际 ${actual}`);
      }
    });
  } else if (action.kind === "if") {
    if (action.thenActions) {
      for (const a of action.thenActions) errors.push(...validateAction(a).errors);
    }
    if (action.elseActions) {
      for (const a of action.elseActions) errors.push(...validateAction(a).errors);
    }
  } else if (action.kind === "for") {
    if (action.bodyActions) {
      for (const a of action.bodyActions) errors.push(...validateAction(a).errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateActionSequence(actions: Action[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const action of actions) {
    const result = validateAction(action);
    if (!result.valid) errors.push(...result.errors);
  }
  if (errors.length === 0) {
    errors.push(...checkVariableFlow(actions));
  }
  return { valid: errors.length === 0, errors };
}
