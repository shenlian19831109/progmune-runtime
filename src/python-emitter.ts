import type { Action } from "./runtime-types";
import * as fs from "fs";
import * as path from "path";

const BASIC_TYPES = new Set([
  "str", "int", "float", "bool", "list", "dict", "tuple", "bytes",
  "string", "number", "boolean", "any", "void", "None",
]);

function toPythonModule(filePath: string): string {
  let module = filePath.replace(/\.py$/, "").replace(/\//g, ".");
  module = module.replace(/\.$/, "").replace(/\.__init__$/, "");
  return module;
}

function pythonValue(val: any): string {
  if (typeof val === "string") return JSON.stringify(val);
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (val === null || val === undefined) return "None";
  if (typeof val === "object") {
    const entries = Object.entries(val).map(([k, v]) => `${JSON.stringify(k)}: ${pythonValue(v)}`);
    return `{${entries.join(", ")}}`;
  }
  return "None";
}

const STRING_ENUMS: Record<string, string> = {
  SVL: '"SVL-4"', RootCause: '"F01"', BranchReason: '"repair_attempt"',
  RepairStrategy: '"insert"', ConstraintType: '"protocol"',
};

export function emitPython(
  actions: Action[],
  meta?: { sessionId?: string; ruleHash?: string; irFunctionCount?: number; protocolRuleCount?: number },
): string {
  const irRaw = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
  const ir = irRaw.functions || irRaw;
  const funcToFile = new Map<string, string>();
  const fnMeta = new Map<string, any>();
  for (const f of ir) {
    funcToFile.set(f.name, f.file);
    fnMeta.set(f.name, f);
  }

  // ── Collect imports ──
  const imports = new Map<string, Set<string>>();
  const collectImports = (action: Action) => {
    if (action.kind === "call" && action.function) {
      const file = funcToFile.get(action.function);
      const meta = fnMeta.get(action.function);
      if (file && file !== "(external)" && meta?.exported !== false) {
        const mod = toPythonModule(file);
        if (!imports.has(mod)) imports.set(mod, new Set());
        imports.get(mod)!.add(action.function);
      }
    } else if (action.kind === "if") {
      (action.thenActions || []).forEach(collectImports);
      (action.elseActions || []).forEach(collectImports);
    } else if (action.kind === "for") {
      (action.bodyActions || []).forEach(collectImports);
    }
  };
  for (const a of actions) collectImports(a);

  // ── Variable flow: scan all actions to find inputs ──
  const declared = new Set<string>();
  const referenced = new Set<string>();

  const scanAction = (action: Action) => {
    if (action.kind === "call" && action.assignTo) declared.add(action.assignTo);
    else if (action.kind === "assign" && action.target) declared.add(action.target);
    else if (action.kind === "for" && action.variable) declared.add(action.variable);

    if (action.kind === "call" && action.args) {
      for (const arg of action.args) {
        const v = typeof arg === "object" ? arg?.value : arg;
        if (typeof v === "string" && /^[a-zA-Z_]\w*$/.test(v) && v !== "") referenced.add(v);
      }
    }
    if (action.kind === "if") {
      (action.thenActions || []).forEach(scanAction);
      (action.elseActions || []).forEach(scanAction);
    } else if (action.kind === "for") {
      (action.bodyActions || []).forEach(scanAction);
    }
  };
  for (const action of actions) scanAction(action);

  const rawInputs = [...referenced].filter(v => !declared.has(v) && v !== "");
  // Resolve types from args
  const inputTypes = new Map<string, string>();
  for (const action of actions) {
    if (action.kind === "call" && action.args) {
      for (const arg of action.args) {
        const v = typeof arg === "object" ? arg?.value : arg;
        const t = typeof arg === "object" ? arg?.type : "str";
        if (typeof v === "string" && rawInputs.includes(v)) inputTypes.set(v, t);
      }
    }
  }

  // ── Parameter bloat guard ──
  const MAX_PARAMS = 10;
  if (rawInputs.length > MAX_PARAMS) {
    return `# REFINEMENT_NEEDED: ${rawInputs.length} params detected (max ${MAX_PARAMS}). Split into smaller functions.`;
  }

  // ── Build code ──
  let code = "";

  // Generation marker
  if (meta?.sessionId) {
    code += `# @progmune-generated session=${meta.sessionId} timestamp=${new Date().toISOString()}`;
    if (meta.ruleHash) code += ` ruleHash=${meta.ruleHash}`;
    code += "\n";
    const funcs = meta.irFunctionCount ?? ir.length;
    const rules = meta.protocolRuleCount ?? 0;
    code += `# Generated with IR constraint: ${funcs} functions`;
    if (rules > 0) code += `, ${rules} protocol rules`;
    code += "\n";
  }

  for (const [mod, funcs] of imports) {
    code += `from ${mod} import ${Array.from(funcs).join(", ")}\n`;
  }

  const paramList = rawInputs.map(v => `${v}: ${inputTypes.get(v) || "str"}`).join(", ");
  code += `\n\ndef main(${paramList}):\n`;

  const argToPython = (action: Action, i: number, a: any, meta?: any): string => {
    const paramType = meta?.params?.[i]?.type || "str";
    const val = a?.value;
    // Variable reference
    if (typeof val === "string" && declared.has(val)) return val;
    if (typeof val === "string" && /^[a-zA-Z_]\w*$/.test(val) && val !== "") return val;
    // Empty default → use parameter name
    const isEmpty = (v: any) => v === "" || v === 0 || v === false || v === null;
    if (isEmpty(val) && a?.name) {
      if (rawInputs.includes(a.name)) { declared.add(a.name); return a.name; }
    }
    // String enums
    if (STRING_ENUMS[paramType]) return STRING_ENUMS[paramType];
    // Basic type defaults
    if (paramType === "string" || paramType === "str") return '""';
    if (paramType === "number" || paramType === "int" || paramType === "float") return "0";
    if (paramType === "boolean" || paramType === "bool") return "False";
    if (paramType.endsWith("[]") || paramType === "list") return "[]";
    if (paramType.startsWith("Map<") || paramType === "dict") return "{}";
    if (paramType.startsWith("Set<")) return "set()";
    return pythonValue(val);
  };

  let counter = 0;
  const convertLines = (action: Action, indentLevel: number): string[] => {
    const indent = "    ".repeat(indentLevel);
    if (!action || !action.kind) return [];

    if (action.kind === "call") {
      const meta = fnMeta.get(action.function || "");
      const args = (action.args || []).map((a: any, i: number) => argToPython(action, i, a, meta)).join(", ");
      const resultVar = action.assignTo || `_res${counter++}`;
      declared.add(resultVar);
      return [`${indent}${resultVar} = ${action.function}(${args})`];
    }

    if (action.kind === "if") {
      const lines: string[] = [`${indent}if ${action.condition}:`];
      if ((action.thenActions || []).length > 0) {
        for (const a of action.thenActions!) lines.push(...convertLines(a, indentLevel + 1));
      } else {
        lines.push(`${indent}    pass`);
      }
      if ((action.elseActions || []).length > 0) {
        lines.push(`${indent}else:`);
        for (const a of action.elseActions!) lines.push(...convertLines(a, indentLevel + 1));
      }
      return lines;
    }

    if (action.kind === "for") {
      declared.add(action.variable);
      const lines: string[] = [`${indent}for ${action.variable} in ${action.iterable}:`];
      for (const a of (action.bodyActions || [])) lines.push(...convertLines(a, indentLevel + 1));
      return lines;
    }

    if (action.kind === "assign") {
      const val = typeof action.value === "string"
        ? (declared.has(action.value) ? action.value : JSON.stringify(action.value))
        : pythonValue(action.value);
      if (action.target) declared.add(action.target);
      return [`${indent}${action.target} = ${val}`];
    }

    if (action.kind === "return") {
      if (typeof action.value === "string") {
        if (declared.has(action.value)) return [`${indent}return ${action.value}`];
        return [`${indent}return ${JSON.stringify(action.value)}`];
      }
      return [`${indent}return ${pythonValue(action.value)}`];
    }

    return [];
  };

  const lines: string[] = [];
  for (const a of actions) lines.push(...convertLines(a, 1));

  code += lines.join("\n") + "\n";

  // Auto-return injection: if LLM forgot to return
  const lastAction = actions[actions.length - 1];
  if (lastAction && lastAction.kind !== "return") {
    const allCalls = actions.filter(a => a.kind === "call" && a.assignTo);
    if (allCalls.length === 1) {
      const c = allCalls[0] as any;
      code += `    return ${c.assignTo}\n`;
    } else if (allCalls.length > 1) {
      const vars = allCalls.map(c => (c as any).assignTo).join(", ");
      code += `    return { ${vars} }\n`;
    }
  }

  code += `\nif __name__ == "__main__":\n    main()\n`;
  return code;
}
