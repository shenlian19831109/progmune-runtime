import type { Action } from "./runtime-types";
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

// ========== 重写的变量流向分析：基于声明追踪的确定性检查 ==========
function checkVariableFlow(actions: Action[]): string[] {
  const errors: string[] = [];
  const declared = new Map<string, string>();

  const isLiteral = (val: any): boolean => {
    if (typeof val !== 'string') return true;
    if (/^["'`]/.test(val) || /["'`]$/.test(val)) return true;
    if (/^\d+$/.test(val)) return true;
    if (val === 'true' || val === 'false' || val === 'null' || val === 'undefined') return true;
    if (/\s/.test(val) || /[^\w]/.test(val)) return true;
    return false;
  };

  const processAction = (action: Action) => {
    if (action.kind === "call") {
      // call 动作的参数值来自结构化 {name, type, value}，都是字面量，不做变量引用检查
      if (action.assignTo) {
        declared.set(action.assignTo, "any");
      }
    } else if (action.kind === "assign") {
      if (typeof action.value === "string") {
        const val = action.value;
        if (!isLiteral(val) && /^[a-zA-Z_]\w*$/.test(val)) {
          if (!declared.has(val)) {
            errors.push(`变量 '${val}' 在赋值前未声明`);
          }
        }
      }
      if (action.target) {
        declared.set(action.target, "any");
      }
    } else if (action.kind === "return") {
      if (typeof action.value === "string") {
        const val = action.value;
        if (!isLiteral(val) && /^[a-zA-Z_]\w*$/.test(val)) {
          if (!declared.has(val)) {
            errors.push(`返回语句引用了未声明的变量 '${val}'`);
          }
        }
      }
    } else if (action.kind === "if") {
      if (typeof action.condition === "string") {
        const cond = action.condition;
        if (!isLiteral(cond) && /^[a-zA-Z_]\w*$/.test(cond)) {
          if (!declared.has(cond) && cond !== 'true' && cond !== 'false') {
            errors.push(`条件中引用了未声明的变量 '${cond}'`);
          }
        }
      }
      for (const a of (action.thenActions || [])) {
        processAction(a);
      }
      for (const a of (action.elseActions || [])) {
        processAction(a);
      }
    } else if (action.kind === "for") {
      if (action.variable) declared.set(action.variable, "any");
      for (const a of (action.bodyActions || [])) {
        processAction(a);
      }
    }
  };

  for (const action of actions) {
    processAction(action);
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
