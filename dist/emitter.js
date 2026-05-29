"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitCode = emitCode;
const fs = __importStar(require("fs"));
const BASIC_TYPES = new Set([
    "string", "number", "boolean", "any", "void", "undefined", "null",
    "str", "int", "float", "bool", "list", "dict", "tuple", "bytes",
]);
function getImportPath(file) {
    return "./" + file.replace(/\.ts$|\.tsx$/, "");
}
/**
 * 将动作序列编译为目标语言代码。
 * @protocol namespace=dev_pipeline pre_states=["SEQUENCE_VALIDATED"] post_states=["CODE_EMITTED"] invalidate=["SEQUENCE_VALIDATED"]
 */
function emitCode(actions) {
    const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
    const fnIndex = new Map();
    const fnMeta = new Map();
    for (const f of ir) {
        fnIndex.set(f.name, f.file);
        fnMeta.set(f.name, f);
    }
    const imports = new Map();
    const typeImports = new Map();
    const collect = (action) => {
        if (action.kind === "call" && action.function) {
            const file = fnIndex.get(action.function);
            const meta = fnMeta.get(action.function);
            if (file) {
                if (!imports.has(file))
                    imports.set(file, new Set());
                imports.get(file).add(action.function);
                if (meta?.params) {
                    for (const p of meta.params) {
                        if (!BASIC_TYPES.has(p.type)) {
                            if (!typeImports.has(file))
                                typeImports.set(file, new Set());
                            typeImports.get(file).add(p.type);
                        }
                    }
                }
            }
        }
        else if (action.kind === "if") {
            (action.thenActions || []).forEach(collect);
            (action.elseActions || []).forEach(collect);
        }
        else if (action.kind === "for") {
            (action.bodyActions || []).forEach(collect);
        }
    };
    for (const a of actions)
        collect(a);
    let code = "";
    for (const [file, funcSet] of imports)
        code += `import { ${[...funcSet].join(", ")} } from "${getImportPath(file)}";\n`;
    for (const [file, typeSet] of typeImports)
        code += `import type { ${[...typeSet].join(", ")} } from "${getImportPath(file)}";\n`;
    code += "\nexport function main() {\n";
    const declared = new Set();
    let counter = 0;
    const convert = (action, indent = "  ") => {
        if (!action || !action.kind)
            return "";
        if (action.kind === "call") {
            const meta = fnMeta.get(action.function || "");
            const args = (action.args || []).map((a, i) => {
                if (typeof a === "string") {
                    if (declared.has(a))
                        return a;
                    return JSON.stringify(a);
                }
                const val = a?.value;
                if (typeof val === "string" && declared.has(val))
                    return val;
                const paramType = meta?.params?.[i]?.type || "any";
                if (BASIC_TYPES.has(paramType)) {
                    if (paramType === "string" || paramType === "str")
                        return `"defaultStr"`;
                    if (paramType === "number" || paramType === "int" || paramType === "float")
                        return "0";
                    if (paramType === "boolean" || paramType === "bool")
                        return "false";
                    return `"default"`;
                }
                if (paramType === "UserPayload")
                    return `{ id: 1, role: "user" } as UserPayload`;
                if (paramType === "PasswordHash")
                    return `"defaultHash"`;
                if (paramType === "Token")
                    return `"defaultToken"`;
                return `{} as ${paramType}`;
            }).join(", ");
            const varName = action.assignTo || `result_${counter++}`;
            declared.add(varName);
            return `${indent}const ${varName} = ${action.function}(${args});`;
        }
        else if (action.kind === "if") {
            let lines = `${indent}if (${action.condition}) {\n`;
            for (const a of (action.thenActions || []))
                lines += convert(a, indent + "  ") + "\n";
            lines += `${indent}}`;
            if (action.elseActions && action.elseActions.length > 0) {
                lines += ` else {\n`;
                for (const a of action.elseActions)
                    lines += convert(a, indent + "  ") + "\n";
                lines += `${indent}}`;
            }
            return lines;
        }
        else if (action.kind === "for") {
            let lines = `${indent}for (const ${action.variable} of ${action.iterable}) {\n`;
            for (const a of (action.bodyActions || []))
                lines += convert(a, indent + "  ") + "\n";
            lines += `${indent}}`;
            return lines;
        }
        else if (action.kind === "assign") {
            const val = typeof action.value === "string" ? JSON.stringify(action.value) : convert(action.value);
            if (action.target)
                declared.add(action.target);
            return `${indent}const ${action.target} = ${val};`;
        }
        else if (action.kind === "return") {
            const val = typeof action.value === "string" ?
                (declared.has(action.value) ? action.value : JSON.stringify(action.value)) :
                convert(action.value);
            return `${indent}return ${val};`;
        }
        return "";
    };
    for (const a of actions)
        code += convert(a) + "\n";
    code += "}\nmain();\n";
    return code;
}
