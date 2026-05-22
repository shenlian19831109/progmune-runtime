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
exports.plan = plan;
const llm_1 = require("./llm");
const action_runtime_1 = require("./action-runtime");
const validator_1 = require("./validator");
const semantic_validator_1 = require("./semantic-validator");
const feedback_1 = require("./feedback");
const utils_1 = require("./utils");
const failure_corpus_1 = require("./failure-corpus");
const memory_layer_1 = require("./memory-layer");
const ssg_validator_1 = require("./ssg-validator");
const fs = __importStar(require("fs"));
function enrichActions(actions, ir) {
    return actions.map(a => {
        if (!a || !a.kind)
            return a;
        if (a.kind === "call" && a.function && a.args) {
            const def = ir.find(f => f.name === a.function);
            if (def) {
                a.args = a.args.map((arg, i) => {
                    if (!arg)
                        return { name: `p${i}`, type: 'any', value: null };
                    const paramDef = def.params[i];
                    if (typeof arg === 'object' && arg.value !== undefined) {
                        return { name: paramDef?.name || `p${i}`, type: paramDef?.type || 'any', value: arg.value };
                    }
                    return { name: paramDef?.name || `p${i}`, type: paramDef?.type || 'any', value: arg };
                });
            }
        }
        if (a.kind === "if") {
            a.thenActions = enrichActions(a.thenActions || [], ir);
            a.elseActions = enrichActions(a.elseActions || [], ir);
        }
        return a;
    });
}
function determineSVL(errors) {
    if (errors.some(e => e.includes("不存在")))
        return "SVL-1";
    if (errors.some(e => e.includes("类型不匹配") || e.includes("参数数量")))
        return "SVL-2";
    if (errors.some(e => e.includes("变量") && (e.includes("未定义") || e.includes("引用自身"))))
        return "SVL-3";
    if (errors.some(e => e.includes("协议") || e.includes("状态")))
        return "SVL-4";
    return "SVL-1";
}
function determineConstraintType(svl) {
    switch (svl) {
        case "SVL-1": return "symbol_existence";
        case "SVL-2": return "type_mismatch";
        case "SVL-3": return "dataflow";
        case "SVL-4": return "protocol";
    }
}
/** 加载 IR 中所有带 protocol 的函数为协议规则 */
function loadProtocols(ir) {
    return ir
        .filter((f) => f.protocol)
        .map((f) => ({ function: f.name, protocol: f.protocol }));
}
/** 验证动作序列的协议合法性 */
function validateProtocol(actions, protocols, initialState) {
    const ssv = new ssg_validator_1.StateMachineValidator(protocols, initialState);
    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (a.kind === "call" && a.function) {
            const result = ssv.apply(a.function);
            if (!result.valid) {
                return { valid: false, error: result.error, index: i };
            }
        }
    }
    return { valid: true };
}
async function plan(userIntent) {
    (0, llm_1.resetCallCount)();
    const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
    // 语义模板快速通道
    const cachedTemplate = (0, memory_layer_1.findSemanticTemplate)(userIntent);
    if (cachedTemplate && cachedTemplate.successRate >= 0.8 && cachedTemplate.useCount >= 2) {
        console.error("⚡ 命中语义模板，直接复用已验证序列");
        (0, memory_layer_1.recordEpisode)({ intent: userIntent, actions: cachedTemplate.actionSequence, success: true });
        return cachedTemplate.actionSequence;
    }
    const keywords = (0, utils_1.extractKeywords)(userIntent);
    const scored = ir.map((f) => {
        let score = 0;
        for (const kw of keywords) {
            score += (0, utils_1.jaccardSimilarity)(f.name.toLowerCase(), kw);
            if (f.name.toLowerCase().includes(kw))
                score += 0.5;
        }
        return { ...f, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const topFuncs = scored.slice(0, 15);
    const funcList = topFuncs.map((f) => {
        const rate = (0, feedback_1.getFunctionSuccessRate)(f.name);
        const star = rate > 0.8 ? "⭐" : rate > 0.5 ? "👍" : "⚠️";
        const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
        return `${star} ${f.name}(${params}) [${f.params.length}个参数] -> ${f.returnType} (成功率: ${(rate * 100).toFixed(0)}%)`;
    }).join("\n");
    const matchFunc = userIntent.match(/(?:实现|implement|编写|创建)\s*(\w+)\s*(?:函数|function)?/i);
    const forbiddenFuncs = [];
    if (matchFunc) {
        const targetName = matchFunc[1];
        if (ir.find((f) => f.name.toLowerCase() === targetName.toLowerCase())) {
            forbiddenFuncs.push(targetName);
        }
    }
    const exampleCode = `assign("query_key", "user:123")
callAssign("cache_get", "cached_data", "query_key")
ifElse("cached_data", () => {
  output("cached_data")
}, () => {
  callAssign("query_data", "fresh_data", "query_key")
  call("cache_set", "query_key", "fresh_data")
  output("fresh_data")
})`;
    const basePrompt = `你能使用的函数：
${funcList}

绝对禁止调用列表外函数。

示例（缓存查询，注意 assign 先于条件）：
${exampleCode}

全局函数及用法规则：
- 声明变量：assign("变量名", "值") 或 callAssign("函数", "变量名", ...)
- 条件分支：ifElse("变量名", () => { ... }, () => { ... })
- 简单分支：ifBlock("变量名", () => { ... })
- 调用：call("函数", "arg1", ...)
- 返回：output("值或变量名")

铁律：
1. 必须先 assign 或 callAssign 再使用变量。
2. 参数数量必须与函数声明一致。
3. 条件括号内只能是已声明的变量名。

需求：
${userIntent}

只输出代码。`;
    let finalActions = [];
    let currentPrompt = basePrompt;
    // 加载协议规则，设定初始状态（例如未认证场景）
    const protocols = loadProtocols(ir);
    // 动作掩码：根据 SSG 状态生成当前可用的合法函数列表
    function getMaskedFuncList(currentState) {
        if (protocols.length === 0)
            return funcList;
        const ssv = new ssg_validator_1.StateMachineValidator(protocols, currentState);
        const legalFuncs = topFuncs.filter((f) => {
            const proto = protocols.find((p) => p.function === f.name);
            if (!proto)
                return true; // 无协议约束的函数始终可用
            const result = ssv.apply(f.name);
            return result.valid;
        });
        if (legalFuncs.length === topFuncs.length)
            return funcList;
        return legalFuncs.map((f) => {
            const rate = (0, feedback_1.getFunctionSuccessRate)(f.name);
            const star = rate > 0.8 ? "⭐" : rate > 0.5 ? "👍" : "⚠️";
            const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
            return `${star} ${f.name}(${params}) [${f.params.length}个参数] -> ${f.returnType} (成功率: ${(rate * 100).toFixed(0)}%)`;
        }).join("\n");
    }
    for (let r = 0; r < 3; r++) {
        let text;
        try {
            text = await (0, llm_1.generate)(currentPrompt);
        }
        catch (e) {
            continue;
        }
        if (!text)
            continue;
        text = text.replace(/```javascript\s*/gi, '').replace(/```\s*/g, '').trim();
        console.error("📝 LLM 生成的代码:\n", text);
        const rawActions = (0, action_runtime_1.executeActionCode)(text);
        if (!rawActions || rawActions.length === 0) {
            console.error("⚠️ 代码执行失败，重试...");
            currentPrompt = basePrompt + "\n上一次代码无效，请严格模仿示例。";
            continue;
        }
        const enriched = enrichActions(rawActions, ir);
        const filtered = enriched.filter(a => !forbiddenFuncs.includes(a.function || ''));
        // 1) 基础序列校验
        const seqResult = (0, validator_1.validateActionSequence)(filtered);
        if (!seqResult.valid) {
            const errorsFlat = seqResult.errors.flat();
            console.error("⚠️ 序列校验失败:", errorsFlat.join(", "));
            const svl = determineSVL(errorsFlat);
            (0, failure_corpus_1.recordFailure)({
                intent: userIntent,
                projectFunctions: ir.map((f) => f.name),
                violatedSVL: svl,
                constraintType: determineConstraintType(svl),
                actionSequence: filtered,
                errorDetail: errorsFlat.join("; "),
            });
            (0, memory_layer_1.recordEpisode)({ intent: userIntent, actions: filtered, success: false, svlViolated: svl });
            currentPrompt = basePrompt + `\n错误：${errorsFlat.join("；")}。请修正。`;
            continue;
        }
        // 2) 协议状态机校验 (SSG)
        if (protocols.length > 0) {
            const protoResult = validateProtocol(filtered, protocols, "UNAUTHENTICATED");
            if (!protoResult.valid) {
                console.error("🛡️ SSG 协议违规:", protoResult.error);
                (0, failure_corpus_1.recordFailure)({
                    intent: userIntent,
                    projectFunctions: ir.map((f) => f.name),
                    violatedSVL: "SVL-4",
                    constraintType: "protocol",
                    actionSequence: filtered,
                    errorDetail: protoResult.error,
                });
                (0, memory_layer_1.recordEpisode)({ intent: userIntent, actions: filtered, success: false, svlViolated: "SVL-4" });
                // 动作掩码：根据当前 SSG 状态过滤可用函数列表
                const maskedFuncList = getMaskedFuncList("UNAUTHENTICATED");
                currentPrompt = `当前 SSG 状态要求只有以下函数可用（已按协议过滤）：
${maskedFuncList}

${basePrompt}`;
                continue;
            }
        }
        // 3) 语义合约校验
        const semResult = (0, semantic_validator_1.checkSemantic)(userIntent, filtered);
        if (!semResult.valid) {
            console.error("⚠️ 语义校验失败:", semResult.errors.join(", "));
            (0, failure_corpus_1.recordFailure)({
                intent: userIntent,
                projectFunctions: ir.map((f) => f.name),
                violatedSVL: "SVL-4",
                constraintType: "protocol",
                actionSequence: filtered,
                errorDetail: semResult.errors.join("; "),
            });
            (0, memory_layer_1.recordEpisode)({ intent: userIntent, actions: filtered, success: false, svlViolated: "SVL-4" });
            currentPrompt = basePrompt + `\n错误：${semResult.errors.join("；")}。请修正。`;
            continue;
        }
        finalActions = filtered;
        break;
    }
    if (finalActions.length > 0) {
        (0, memory_layer_1.recordEpisode)({ intent: userIntent, actions: finalActions, success: true });
    }
    else {
        // LLM 3 次重试失败，尝试本地规则回退
        console.error("[降级] LLM 规划失败，尝试本地规则回退");
        const fallback = generateFallbackPlan(userIntent, ir);
        if (fallback.length > 0) {
            console.error(`[降级] 本地规则生成了 ${fallback.length} 个动作`);
            (0, memory_layer_1.recordEpisode)({ intent: userIntent, actions: fallback, success: true });
            return fallback;
        }
        (0, memory_layer_1.recordEpisode)({ intent: userIntent, actions: [], success: false });
    }
    return finalActions;
}
/** 本地规则回退：当 LLM 不可用时，根据意图关键词生成简单动作序列 */
function generateFallbackPlan(intent, ir) {
    const intentLower = intent.toLowerCase();
    const actions = [];
    const keywords = intentLower.split(/[\s,，、]+/).filter(k => k.length > 1);
    const matchedFuncs = [];
    for (const kw of keywords) {
        for (const fn of ir) {
            if (fn.name.toLowerCase().includes(kw) && !matchedFuncs.find((f) => f.name === fn.name)) {
                matchedFuncs.push(fn);
            }
        }
    }
    if (matchedFuncs.length === 0)
        return [];
    for (const fn of matchedFuncs) {
        const args = (fn.params || []).map((p, i) => ({
            name: p.name || `p${i}`,
            type: p.type || 'any',
            value: `{{${p.name || `p${i}`}}}`
        }));
        const assignTo = fn.returnType && fn.returnType !== 'void' && fn.returnType !== 'undefined'
            ? `${fn.name}_result` : undefined;
        if (assignTo) {
            actions.push({ kind: 'call', function: fn.name, args, assignTo });
        }
        else {
            actions.push({ kind: 'call', function: fn.name, args });
        }
    }
    return actions;
}
