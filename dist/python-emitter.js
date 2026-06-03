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
exports.emitPython = emitPython;
const fs = __importStar(require("fs"));
const BASIC_TYPES = new Set([
    "str", "int", "float", "bool", "list", "dict", "tuple", "bytes",
    "string", "number", "boolean", "any", "void", "None",
]);
function toPythonModule(filePath) {
    let module = filePath.replace(/\.py$/, "").replace(/\//g, ".");
    module = module.replace(/\.$/, "").replace(/\.__init__$/, "");
    return module;
}
function pythonValue(val) {
    if (typeof val === "string")
        return JSON.stringify(val);
    if (typeof val === "number" || typeof val === "boolean")
        return String(val);
    if (val === null || val === undefined)
        return "None";
    if (typeof val === "object") {
        const entries = Object.entries(val).map(([k, v]) => `${JSON.stringify(k)}: ${pythonValue(v)}`);
        return `{${entries.join(", ")}}`;
    }
    return "None";
}
const STRING_ENUMS = {
    SVL: '"SVL-4"', RootCause: '"F01"', BranchReason: '"repair_attempt"',
    RepairStrategy: '"insert"', ConstraintType: '"protocol"',
};
function emitPython(actions, meta) {
    const irRaw = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
    const ir = irRaw.functions || irRaw;
    const funcToFile = new Map();
    const fnMeta = new Map();
    for (const f of ir) {
        funcToFile.set(f.name, f.file);
        fnMeta.set(f.name, f);
    }
    // ── Collect imports ──
    const imports = new Map();
    const collectImports = (action) => {
        if (action.kind === "call" && action.function) {
            const file = funcToFile.get(action.function);
            const meta = fnMeta.get(action.function);
            if (file && file !== "(external)" && meta?.exported !== false) {
                const mod = toPythonModule(file);
                if (!imports.has(mod))
                    imports.set(mod, new Set());
                imports.get(mod).add(action.function);
            }
        }
        else if (action.kind === "if") {
            (action.thenActions || []).forEach(collectImports);
            (action.elseActions || []).forEach(collectImports);
        }
        else if (action.kind === "for") {
            (action.bodyActions || []).forEach(collectImports);
        }
    };
    for (const a of actions)
        collectImports(a);
    // ── Variable flow: scan all actions to find inputs ──
    const declared = new Set();
    const referenced = new Set();
    const scanAction = (action) => {
        if (action.kind === "call" && action.assignTo)
            declared.add(action.assignTo);
        else if (action.kind === "assign" && action.target)
            declared.add(action.target);
        else if (action.kind === "for" && action.variable)
            declared.add(action.variable);
        if (action.kind === "call" && action.args) {
            for (const arg of action.args) {
                const v = typeof arg === "object" ? arg?.value : arg;
                if (typeof v === "string" && /^[a-zA-Z_]\w*$/.test(v) && v !== "")
                    referenced.add(v);
            }
        }
        if (action.kind === "if") {
            (action.thenActions || []).forEach(scanAction);
            (action.elseActions || []).forEach(scanAction);
        }
        else if (action.kind === "for") {
            (action.bodyActions || []).forEach(scanAction);
        }
    };
    for (const action of actions)
        scanAction(action);
    const rawInputs = [...referenced].filter(v => !declared.has(v) && v !== "");
    // Resolve types from args
    const inputTypes = new Map();
    for (const action of actions) {
        if (action.kind === "call" && action.args) {
            for (const arg of action.args) {
                const v = typeof arg === "object" ? arg?.value : arg;
                const t = typeof arg === "object" ? arg?.type : "str";
                if (typeof v === "string" && rawInputs.includes(v))
                    inputTypes.set(v, t);
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
        if (meta.ruleHash)
            code += ` ruleHash=${meta.ruleHash}`;
        code += "\n";
        const funcs = meta.irFunctionCount ?? ir.length;
        const rules = meta.protocolRuleCount ?? 0;
        code += `# Generated with IR constraint: ${funcs} functions`;
        if (rules > 0)
            code += `, ${rules} protocol rules`;
        code += "\n";
    }
    for (const [mod, funcs] of imports) {
        code += `from ${mod} import ${Array.from(funcs).join(", ")}\n`;
    }
    const paramList = rawInputs.map(v => `${v}: ${inputTypes.get(v) || "str"}`).join(", ");
    code += `\n\ndef main(${paramList}):\n`;
    const argToPython = (action, i, a, meta) => {
        const paramType = meta?.params?.[i]?.type || "str";
        const val = a?.value;
        // Variable reference
        if (typeof val === "string" && declared.has(val))
            return val;
        if (typeof val === "string" && /^[a-zA-Z_]\w*$/.test(val) && val !== "")
            return val;
        // Empty default → use parameter name
        const isEmpty = (v) => v === "" || v === 0 || v === false || v === null;
        if (isEmpty(val) && a?.name) {
            if (rawInputs.includes(a.name)) {
                declared.add(a.name);
                return a.name;
            }
        }
        // String enums
        if (STRING_ENUMS[paramType])
            return STRING_ENUMS[paramType];
        // Basic type defaults
        if (paramType === "string" || paramType === "str")
            return '""';
        if (paramType === "number" || paramType === "int" || paramType === "float")
            return "0";
        if (paramType === "boolean" || paramType === "bool")
            return "False";
        if (paramType.endsWith("[]") || paramType === "list")
            return "[]";
        if (paramType.startsWith("Map<") || paramType === "dict")
            return "{}";
        if (paramType.startsWith("Set<"))
            return "set()";
        return pythonValue(val);
    };
    let counter = 0;
    const convertLines = (action, indentLevel) => {
        const indent = "    ".repeat(indentLevel);
        if (!action || !action.kind)
            return [];
        if (action.kind === "call") {
            const meta = fnMeta.get(action.function || "");
            const args = (action.args || []).map((a, i) => argToPython(action, i, a, meta)).join(", ");
            const resultVar = action.assignTo || `_res${counter++}`;
            declared.add(resultVar);
            return [`${indent}${resultVar} = ${action.function}(${args})`];
        }
        if (action.kind === "if") {
            const lines = [`${indent}if ${action.condition}:`];
            if ((action.thenActions || []).length > 0) {
                for (const a of action.thenActions)
                    lines.push(...convertLines(a, indentLevel + 1));
            }
            else {
                lines.push(`${indent}    pass`);
            }
            if ((action.elseActions || []).length > 0) {
                lines.push(`${indent}else:`);
                for (const a of action.elseActions)
                    lines.push(...convertLines(a, indentLevel + 1));
            }
            return lines;
        }
        if (action.kind === "for") {
            declared.add(action.variable);
            const lines = [`${indent}for ${action.variable} in ${action.iterable}:`];
            for (const a of (action.bodyActions || []))
                lines.push(...convertLines(a, indentLevel + 1));
            return lines;
        }
        if (action.kind === "assign") {
            const val = typeof action.value === "string"
                ? (declared.has(action.value) ? action.value : JSON.stringify(action.value))
                : pythonValue(action.value);
            if (action.target)
                declared.add(action.target);
            return [`${indent}${action.target} = ${val}`];
        }
        if (action.kind === "return") {
            if (typeof action.value === "string") {
                if (declared.has(action.value))
                    return [`${indent}return ${action.value}`];
                return [`${indent}return ${JSON.stringify(action.value)}`];
            }
            return [`${indent}return ${pythonValue(action.value)}`];
        }
        return [];
    };
    const lines = [];
    for (const a of actions)
        lines.push(...convertLines(a, 1));
    code += lines.join("\n") + "\n";
    // Auto-return injection: if LLM forgot to return
    const lastAction = actions[actions.length - 1];
    if (lastAction && lastAction.kind !== "return") {
        const allCalls = actions.filter(a => a.kind === "call" && a.assignTo);
        if (allCalls.length === 1) {
            const c = allCalls[0];
            code += `    return ${c.assignTo}\n`;
        }
        else if (allCalls.length > 1) {
            const vars = allCalls.map(c => c.assignTo).join(", ");
            code += `    return { ${vars} }\n`;
        }
    }
    code += `\nif __name__ == "__main__":\n    main()\n`;
    return code;
}
