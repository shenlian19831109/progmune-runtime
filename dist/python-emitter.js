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
function toPythonModule(filePath) {
    let module = filePath.replace(/\.py$/, "").replace(/\//g, ".");
    module = module.replace(/\.$/, "").replace(/\.__init__$/, "");
    return module;
}
function pythonValue(val) {
    if (typeof val === 'string')
        return JSON.stringify(val);
    if (typeof val === 'number' || typeof val === 'boolean')
        return String(val);
    if (val === null || val === undefined)
        return 'None';
    if (typeof val === 'object') {
        const entries = Object.entries(val).map(([k, v]) => `${JSON.stringify(k)}: ${pythonValue(v)}`);
        return `{${entries.join(', ')}}`;
    }
    return 'None';
}
function emitPython(actions) {
    const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
    const funcToFile = new Map();
    const funcToParams = new Map();
    for (const f of ir) {
        funcToFile.set(f.name, f.file);
        funcToParams.set(f.name, f.params || []);
    }
    const imports = new Map();
    const collectImports = (action) => {
        if (action.kind === "call" && action.function) {
            const file = funcToFile.get(action.function);
            if (file) {
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
    };
    for (const a of actions)
        collectImports(a);
    let code = "";
    for (const [mod, funcs] of imports) {
        code += `from ${mod} import ${Array.from(funcs).join(", ")}\n`;
    }
    code += "\n\ndef main():\n";
    // 使用全局变量跟踪已声明的变量
    const declaredVars = new Set();
    const argToPython = (val) => {
        if (typeof val === 'string') {
            if (declaredVars.has(val))
                return val;
            return JSON.stringify(val);
        }
        return pythonValue(val);
    };
    // 转换为 Python 代码行，使用数字缩进级别以确保一致性
    const convertLines = (action, indentLevel) => {
        const indent = "    ".repeat(indentLevel);
        if (!action || !action.kind)
            return [];
        if (action.kind === "call") {
            const fname = action.function || "unknown";
            const args = (action.args || []).map((a) => argToPython(a.value)).join(", ");
            const resultVar = action.assignTo || `_res`;
            declaredVars.add(resultVar);
            return [`${indent}${resultVar} = ${fname}(${args})`];
        }
        if (action.kind === "if") {
            const lines = [];
            lines.push(`${indent}if ${action.condition}:`);
            const thenActions = action.thenActions || [];
            const elseActions = action.elseActions || [];
            if (thenActions.length > 0) {
                for (const a of thenActions) {
                    lines.push(...convertLines(a, indentLevel + 1));
                }
            }
            else {
                // 防止空块
                lines.push(`${indent}    pass`);
            }
            if (elseActions.length > 0) {
                lines.push(`${indent}else:`);
                for (const a of elseActions) {
                    lines.push(...convertLines(a, indentLevel + 1));
                }
            }
            return lines;
        }
        if (action.kind === "return") {
            const val = action.value;
            if (typeof val === 'string') {
                if (declaredVars.has(val))
                    return [`${indent}return ${val}`];
                return [`${indent}return ${JSON.stringify(val)}`];
            }
            return [`${indent}return ${pythonValue(val)}`];
        }
        return [];
    };
    const lines = [];
    for (const a of actions) {
        lines.push(...convertLines(a, 1));
    }
    code += lines.join("\n") + "\n";
    code += "\nif __name__ == '__main__':\n    main()\n";
    return code;
}
