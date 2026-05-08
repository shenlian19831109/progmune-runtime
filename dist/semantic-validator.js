"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSemantic = checkSemantic;
let irCache = null;
function loadContracts() {
    if (irCache)
        return irCache;
    const raw = JSON.parse(require("fs").readFileSync("ir.json", "utf-8"));
    irCache = raw;
    return raw;
}
function matchIntent(intent, keywords) {
    return keywords.some(kw => intent.includes(kw));
}
function checkSemantic(intent, actions) {
    const ir = loadContracts();
    const errors = [];
    const callActions = actions.filter((a) => a.kind === "call");
    for (const action of callActions) {
        const funcDef = ir.find(f => f.name === action.function);
        if (!funcDef || !funcDef.contracts)
            continue;
        for (const contract of funcDef.contracts) {
            if (contract.when_intent && !matchIntent(intent, contract.when_intent))
                continue;
            switch (contract.type) {
                case "require_param": {
                    const arg = action.args?.find((a) => a.name === contract.param);
                    if (arg && typeof arg.value === "string") {
                        if (contract.not_empty && (arg.value.includes("{}") || arg.value.trim() === "")) {
                            errors.push(`${action.function}: ${contract.description}`);
                        }
                    }
                    break;
                }
                case "must_be_checked": {
                    if (action.assignTo) {
                        const usedInIf = actions.some(a => a.kind === "if" && a.condition === action.assignTo);
                        if (!usedInIf) {
                            errors.push(`${action.function}: ${contract.description} (变量 ${action.assignTo} 未用于if条件)`);
                        }
                    }
                    else {
                        errors.push(`${action.function}: ${contract.description} (未使用assignTo保存返回值)`);
                    }
                    break;
                }
                case "sequence_after": {
                    const mustBefore = contract.function;
                    const idxCurrent = callActions.indexOf(action);
                    const idxBefore = callActions.findIndex(a => a.function === mustBefore);
                    if (idxBefore === -1 || idxBefore > idxCurrent) {
                        errors.push(`${action.function}: ${contract.description}`);
                    }
                    break;
                }
                case "param_from": {
                    const arg = action.args?.find((a) => a.name === contract.param);
                    if (arg && typeof arg.value === "string") {
                        const sourceAction = callActions.find(a => a.function === contract.function && a.assignTo === arg.value);
                        if (!sourceAction) {
                            errors.push(`${action.function}: ${contract.description} (参数 ${arg.value} 未引用 ${contract.function} 的输出)`);
                        }
                    }
                    break;
                }
            }
        }
    }
    return { valid: errors.length === 0, errors };
}
