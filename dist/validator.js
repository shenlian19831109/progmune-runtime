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
exports.validateAction = validateAction;
exports.validateActionSequence = validateActionSequence;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function loadIR() {
    const irPath = path.resolve(__dirname, "../ir.json");
    if (!fs.existsSync(irPath))
        return [];
    const raw = JSON.parse(fs.readFileSync(irPath, "utf-8"));
    return Array.isArray(raw) ? raw : (raw.functions || []);
}
const BUILTIN_WHITELIST = new Set([
    "console.log", "setTimeout", "setInterval", "clearTimeout",
    "JSON.stringify", "JSON.parse", "fetch"
]);
function normalizeType(type) {
    if (!type)
        return "any";
    const t = type.toLowerCase().trim();
    if (t === "string")
        return "str";
    if (t === "number" || t === "integer")
        return "int";
    if (t === "boolean")
        return "bool";
    if (t === "dictionary" || t === "record" || t === "dict")
        return "dict";
    if (t === "list")
        return "list";
    if (t === "tuple")
        return "tuple";
    if (t === "set")
        return "set";
    if (t === "any" || t === "variable")
        return "any";
    return t;
}
// ========== 重写的变量流向分析：基于声明追踪的确定性检查 ==========
function checkVariableFlow(actions) {
    const errors = [];
    const declared = new Map();
    const isLiteral = (val) => {
        if (typeof val !== 'string')
            return true;
        if (/^["'`]/.test(val) || /["'`]$/.test(val))
            return true;
        if (/^\d+$/.test(val))
            return true;
        if (val === 'true' || val === 'false' || val === 'null' || val === 'undefined')
            return true;
        if (/\s/.test(val) || /[^\w]/.test(val))
            return true;
        return false;
    };
    const processAction = (action) => {
        if (action.kind === "call") {
            // call 动作的参数值来自结构化 {name, type, value}，都是字面量，不做变量引用检查
            if (action.assignTo) {
                declared.set(action.assignTo, "any");
            }
        }
        else if (action.kind === "assign") {
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
        }
        else if (action.kind === "return") {
            if (typeof action.value === "string") {
                const val = action.value;
                if (!isLiteral(val) && /^[a-zA-Z_]\w*$/.test(val)) {
                    if (!declared.has(val)) {
                        errors.push(`返回语句引用了未声明的变量 '${val}'`);
                    }
                }
            }
        }
        else if (action.kind === "if") {
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
        }
        else if (action.kind === "for") {
            if (action.variable)
                declared.set(action.variable, "any");
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
/**
 * 校验单个动作的合法性（函数存在、类型匹配、参数数量）。
 * @protocol namespace=dev_pipeline pre_states=["IR_EXTRACTED"] post_states=["ACTION_VALIDATED"]
 */
function validateAction(action, actionIndex) {
    const functions = loadIR();
    const errors = [];
    const violations = [];
    const idx = actionIndex ?? 0;
    if (!action || !["call", "if", "for", "assign", "return"].includes(action.kind)) {
        const msg = `无效动作类型: '${action?.kind}'`;
        errors.push(msg);
        violations.push({ svl: 1, violatedConstraint: "symbol_existence", actionIndex: idx, description: msg });
        return { valid: false, errors, violations };
    }
    if (action.kind === "call") {
        const fn = functions.find((f) => f.name === action.function);
        if (!fn) {
            if (action.function && BUILTIN_WHITELIST.has(action.function))
                return { valid: true, errors: [], violations: [] };
            const msg = `函数 '${action.function}' 不存在`;
            errors.push(msg);
            violations.push({ svl: 1, violatedConstraint: "symbol_existence", actionIndex: idx, missingStates: [action.function], description: msg });
            return { valid: false, errors, violations };
        }
        if (!action.args) {
            const msg = `函数 '${action.function}' 缺少参数列表`;
            errors.push(msg);
            violations.push({ svl: 2, violatedConstraint: "type_mismatch", actionIndex: idx, description: msg });
            return { valid: false, errors, violations };
        }
        if (action.args.length !== fn.params.length) {
            const msg = `参数数量不匹配: 期望 ${fn.params.length}, 实际 ${action.args.length}`;
            errors.push(msg);
            violations.push({ svl: 2, violatedConstraint: "type_mismatch", actionIndex: idx, description: msg });
        }
        action.args.forEach((arg, i) => {
            if (!arg) {
                const msg = `函数 '${action.function}' 的第${i}个参数为空`;
                errors.push(msg);
                violations.push({ svl: 2, violatedConstraint: "type_mismatch", actionIndex: idx, description: msg });
                return;
            }
            const expected = normalizeType(fn.params[i]?.type);
            const actual = normalizeType(arg.type);
            if (actual !== "any" && expected !== "any" && actual !== expected) {
                const msg = `类型不匹配: 参数 '${fn.params[i].name}' 期望 ${expected}, 实际 ${actual}`;
                errors.push(msg);
                violations.push({ svl: 2, violatedConstraint: "type_mismatch", actionIndex: idx, description: msg });
            }
        });
    }
    else if (action.kind === "if") {
        if (action.thenActions) {
            for (const a of action.thenActions) {
                const r = validateAction(a, idx);
                errors.push(...r.errors);
                violations.push(...r.violations);
            }
        }
        if (action.elseActions) {
            for (const a of action.elseActions) {
                const r = validateAction(a, idx);
                errors.push(...r.errors);
                violations.push(...r.violations);
            }
        }
    }
    else if (action.kind === "for") {
        if (action.bodyActions) {
            for (const a of action.bodyActions) {
                const r = validateAction(a, idx);
                errors.push(...r.errors);
                violations.push(...r.violations);
            }
        }
    }
    return { valid: errors.length === 0, errors, violations };
}
/**
 * 批量校验动作序列 + 变量流向分析。
 * @protocol namespace=dev_pipeline pre_states=["ACTION_VALIDATED"] post_states=["SEQUENCE_VALIDATED"] invalidate=["ACTION_VALIDATED"]
 */
/** @requires ACTIONS @produces VALIDATION_RESULT */
function validateActionSequence(actions) {
    const errors = [];
    const violations = [];
    for (let i = 0; i < actions.length; i++) {
        const result = validateAction(actions[i], i);
        if (!result.valid) {
            errors.push(...result.errors);
            violations.push(...result.violations);
        }
    }
    if (errors.length === 0) {
        const flowErrors = checkVariableFlow(actions);
        if (flowErrors.length > 0) {
            errors.push(...flowErrors);
            for (const msg of flowErrors) {
                violations.push({ svl: 3, violatedConstraint: "dataflow", actionIndex: 0, description: msg });
            }
        }
    }
    return { valid: errors.length === 0, errors, violations };
}
