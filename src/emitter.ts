import { Action } from "./action-runtime";
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
    if (action.kind === "call" && action.function) {
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
      (action.thenActions || []).forEach(collect);
      (action.elseActions || []).forEach(collect);
    } else if (action.kind === "for") {
      (action.bodyActions || []).forEach(collect);
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
  code += "}\nmain();\n";
  return code;
}
