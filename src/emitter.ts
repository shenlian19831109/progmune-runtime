import type { Action } from "./runtime-types";
import * as fs from "fs";

const BASIC_TYPES = new Set([
  "string", "number", "boolean", "any", "void", "undefined", "null",
  "str", "int", "float", "bool", "list", "dict", "tuple", "bytes",
]);

/** Normalize a type string to an importable type name.
 *  Strips [], <...>, unions, and typeof expressions.
 *  e.g. "StateTransition[]" → "StateTransition"
 *       "Map<string, string>" → "Map"
 *       "Action | null" → "Action"
 *       "ReturnType<typeof fn>" → null (complex, skip) */
function normalizeTypeName(raw: string): string | null {
  let t = raw.trim();
  // Skip function types and complex expressions
  if (t.includes("=>") || t.includes("typeof")) return null;
  // Strip array brackets
  t = t.replace(/\[\]/g, "");
  // Strip generic parameters
  t = t.replace(/<[^>]*>/g, "");
  // Take first part of union/intersection
  t = t.split("|")[0].split("&")[0].trim();
  // Must be a simple identifier
  if (/^[A-Z][a-zA-Z0-9_]*$/.test(t)) return t;
  return null;
}

function getImportPath(file: string): string {
  // Normalize: strip common src/ prefix since generated code lives in src/
  let clean = file.replace(/\.ts$|\.tsx$/, "");
  if (clean.startsWith("src/")) clean = clean.slice(4);
  return "./" + clean;
}

/**
 * 将动作序列编译为目标语言代码。
 * @protocol namespace=dev_pipeline pre_states=["SEQUENCE_VALIDATED"] post_states=["CODE_EMITTED"] invalidate=["SEQUENCE_VALIDATED"]
 */
export function emitCode(
  actions: Action[],
  meta?: { sessionId?: string; ruleHash?: string; irFunctionCount?: number; protocolRuleCount?: number }
): string {
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
    if (action.kind === "call" && action.function) {
      const file = fnIndex.get(action.function);
      const meta = fnMeta.get(action.function);
      // Skip external functions — they are global/standard library (fs, path, etc.)
      if (file && file !== "(external)") {
        if (!imports.has(file)) imports.set(file, new Set());
        imports.get(file)!.add(action.function);
        if (meta?.params) {
          for (const p of meta.params) {
            const normalized = normalizeTypeName(p.type);
            if (normalized && !BASIC_TYPES.has(normalized)) {
              if (!typeImports.has(file)) typeImports.set(file, new Set());
              typeImports.get(file)!.add(normalized);
            }
          }
        }
      }
    } else if (action.kind === "if") {
      (action.thenActions || []).forEach(collect);
      (action.elseActions || []).forEach(collect);
    } else if (action.kind === "for") {
      (action.bodyActions || []).forEach(collect);
    }
  };
  for (const a of actions) collect(a);

  // ── Generation marker (provable usage) ──
  let code = "";
  if (meta?.sessionId) {
    const ts = new Date().toISOString();
    code += `// @progmune-generated session=${meta.sessionId} timestamp=${ts}`;
    if (meta.ruleHash) code += ` ruleHash=${meta.ruleHash}`;
    code += `\n`;
    const funcs = meta.irFunctionCount ?? ir.length;
    const rules = meta.protocolRuleCount ?? 0;
    code += `// Generated with IR constraint: ${funcs} functions`;
    if (rules > 0) code += `, ${rules} protocol rules`;
    code += `\n`;
  }
  for (const [file, funcSet] of imports)
    code += `import { ${[...funcSet].join(", ")} } from "${getImportPath(file)}";\n`;
  for (const [file, typeSet] of typeImports)
    code += `import type { ${[...typeSet].join(", ")} } from "${getImportPath(file)}";\n`;

  // Pre-scan: find input variables (referenced but never assigned via call/assign)
  const declared = new Set<string>();
  const referenced = new Set<string>();
  let counter = 0;

  // First pass: collect declared and referenced variables
  for (const action of actions) {
    if (action.kind === "call" && action.assignTo) {
      declared.add(action.assignTo);
    } else if (action.kind === "assign" && action.target) {
      declared.add(action.target);
    }
    // Collect arg value references
    if (action.kind === "call" && action.args) {
      for (const arg of action.args) {
        const v = typeof arg === "object" ? arg?.value : arg;
        if (typeof v === "string" && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(v) && v !== "") {
          referenced.add(v);
        }
      }
    }
  }

  // Inputs = referenced but not declared — add as typed parameters
  const inputs = [...referenced].filter(v => !declared.has(v) && v !== "");
  const inputTypes = new Map<string, string>();
  for (const action of actions) {
    if (action.kind === "call" && action.args) {
      for (const arg of action.args) {
        const v = typeof arg === "object" ? arg?.value : arg;
        const t = typeof arg === "object" ? arg?.type : "string";
        if (typeof v === "string" && inputs.includes(v) && t && t !== "any") {
          inputTypes.set(v, t);
        }
      }
    }
  }
  const paramList = inputs.map(v => `${v}: ${inputTypes.get(v) || "string"}`).join(", ");

  code += `\nexport function main(${paramList}) {\n`;

  const convert = (action: Action, indent: string = "  "): string => {
    if (!action || !action.kind) return "";
    if (action.kind === "call") {
      const meta = fnMeta.get(action.function || "");
      const args = (action.args || []).map((a: any, i: number) => {
        if (typeof a === "string") {
          if (declared.has(a)) return a;
          return JSON.stringify(a);
        }
        const val = a?.value;
        if (typeof val === "string" && declared.has(val)) return val;
        // If value looks like a variable name (valid JS identifier), pass it through
        if (typeof val === "string" && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(val) && val !== "") {
          declared.add(val);
          return val;
        }
        const paramType = meta?.params?.[i]?.type || "any";
        if (BASIC_TYPES.has(paramType)) {
          if (paramType === "string" || paramType === "str") return `""`;
          if (paramType === "number" || paramType === "int" || paramType === "float") return "0";
          if (paramType === "boolean" || paramType === "bool") return "false";
          return `""`;
        }
        if (paramType === "UserPayload") return `{ id: 1, role: "user" } as UserPayload`;
        if (paramType === "PasswordHash") return `"defaultHash"`;
        if (paramType === "Token") return `"defaultToken"`;
        return `{} as ${paramType}`;
      }).join(", ");
      const varName = action.assignTo || `result_${counter++}`;
      declared.add(varName);
      return `${indent}const ${varName} = ${action.function}(${args});`;
    } else if (action.kind === "if") {
      let lines = `${indent}if (${action.condition}) {\n`;
      for (const a of (action.thenActions || [])) lines += convert(a, indent + "  ") + "\n";
      lines += `${indent}}`;
      if (action.elseActions && action.elseActions.length > 0) {
        lines += ` else {\n`;
        for (const a of action.elseActions) lines += convert(a, indent + "  ") + "\n";
        lines += `${indent}}`;
      }
      return lines;
    } else if (action.kind === "for") {
      let lines = `${indent}for (const ${action.variable} of ${action.iterable}) {\n`;
      for (const a of (action.bodyActions || [])) lines += convert(a, indent + "  ") + "\n";
      lines += `${indent}}`;
      return lines;
    } else if (action.kind === "assign") {
      const val = typeof action.value === "string" ? JSON.stringify(action.value) : convert(action.value);
      if (action.target) declared.add(action.target);
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
  code += "}\n";
  // Call main with params if it has inputs, otherwise no-arg call
  if (inputs.length > 0) {
    // Don't call — the user provides the arguments
    // Just export the function for external use
  } else {
    code += "main();\n";
  }
  return code;
}
