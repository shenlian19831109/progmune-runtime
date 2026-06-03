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
/** @requires ACTIONS @produces TYPESCRIPT_CODE */
/** @requires ACTIONS @produces TYPESCRIPT_CODE */
export function emitCode(
  actions: Action[],
  meta?: { sessionId?: string; ruleHash?: string; irFunctionCount?: number; protocolRuleCount?: number }
): string {
  const irRaw = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
  // Support both old format (array) and new format ({typeMap, functions})
  const typeMap: Record<string, string> = irRaw.typeMap || {};
  const ir = irRaw.functions || irRaw;
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
      // Skip non-exported functions — can't import what isn't exported
      if (file && file !== "(external)" && meta?.exported !== false) {
        if (!imports.has(file)) imports.set(file, new Set());
        imports.get(file)!.add(action.function);
        if (meta?.params) {
          for (const p of meta.params) {
            const normalized = normalizeTypeName(p.type);
            if (normalized && !BASIC_TYPES.has(normalized)) {
              // Use typeMap to find the correct module for this type
              const typeFile = typeMap[normalized] || file;
              if (!typeImports.has(typeFile)) typeImports.set(typeFile, new Set());
              typeImports.get(typeFile)!.add(normalized);
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
    // Collect arg value references AND empty-default params
    if (action.kind === "call" && action.args) {
      for (const arg of action.args) {
        const v = typeof arg === "object" ? arg?.value : arg;
        if (typeof v === "string" && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(v) && v !== "") {
          referenced.add(v);
        }
        // Also detect empty defaults: these should become function params
        const isDefault = v === "" || v === 0 || v === false || v === null
          || (Array.isArray(v) && v.length === 0);
        if (isDefault && typeof arg === "object" && arg.name) {
          referenced.add(arg.name);
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
        const n = typeof arg === "object" ? arg?.name : undefined;
        const t = typeof arg === "object" ? arg?.type : "string";
        // Variable reference: value matches input name
        if (typeof v === "string" && inputs.includes(v) && t && t !== "any") {
          inputTypes.set(v, t);
        }
        // Empty default: param name matches input name
        const isDefault = v === "" || v === 0 || v === false || v === null
          || (Array.isArray(v) && v.length === 0);
        if (isDefault && n && inputs.includes(n)) {
          const cleanType = (t || "string").replace(/\[\]$/, "");
          if (!inputTypes.has(n)) inputTypes.set(n, cleanType);
        }
      }
    }
  }

  // If no inputs detected but functions have params with empty defaults,
  // create parameters from function signatures
  if (inputs.length === 0) {
    for (const action of actions) {
      if (action.kind === "call" && action.args && action.args.length > 0) {
        for (const arg of action.args) {
          const name = typeof arg === "object" ? arg.name : "param";
          const type = typeof arg === "object" ? (arg.type || "string") : "string";
          const val = typeof arg === "object" ? arg.value : arg;
          // Only add if value is empty default (not a real value)
          if (val === "" || val === 0 || val === false || val === null || (Array.isArray(val) && val.length === 0)) {
            if (!inputTypes.has(name)) {
              inputs.push(name);
              inputTypes.set(name, type.replace(/\[\]$/, ""));
            }
          }
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
        if (typeof val === "string" && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(val) && val !== "") {
          declared.add(val);
          return val;
        }
        // Empty default value → use function's parameter name (input parameter)
        const isDefault = val === "" || val === 0 || val === false || val === null
          || (Array.isArray(val) && val.length === 0);
        if (isDefault && a?.name && inputs.includes(a.name)) {
          declared.add(a.name);
          return a.name;
        }
        const paramType = meta?.params?.[i]?.type || "any";
        if (BASIC_TYPES.has(paramType)) {
          if (paramType === "string" || paramType === "str") return `""`;
          if (paramType === "number" || paramType === "int" || paramType === "float") return "0";
          if (paramType === "boolean" || paramType === "bool") return "false";
          return `""`;
        }
        // String enum defaults — match param type to sensible value
        const STRING_ENUMS: Record<string, string> = {
          "SVL": '"SVL-4"', "RootCause": '"F01"', "BranchReason": '"repair_attempt"',
          "RepairStrategy": '"insert"', "ConstraintType": '"protocol"',
          "SVLString": '"SVL-4"', "BranchOutcome": '"success"',
        };
        if (STRING_ENUMS[paramType]) return STRING_ENUMS[paramType];
        // Array types: use empty array
        if (paramType.endsWith("[]")) return "[]";
        // Generic Map/Set types: use empty constructor
        if (paramType.startsWith("Map<")) return `new Map()`;
        if (paramType.startsWith("Set<")) return `new Set()`;
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
  // Ensure last action is a return — inject one if LLM forgot
  const lastAction = actions[actions.length - 1];
  if (lastAction && lastAction.kind !== "return") {
    const allCalls = actions.filter(a => a.kind === "call" && a.assignTo);
    if (allCalls.length === 1) {
      code += `  return ${allCalls[0].assignTo};\n`;
    } else if (allCalls.length > 1) {
      // Multiple calls: return all results as an object
      const vars = allCalls.map(c => (c as any).assignTo).join(", ");
      code += `  return { ${vars} };\n`;
    }
  }
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
