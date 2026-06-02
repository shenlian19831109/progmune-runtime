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
exports.searchPlan = searchPlan;
const validator_1 = require("./validator");
const llm_1 = require("./llm");
const feedback_1 = require("./feedback");
const utils_1 = require("./utils");
const fs = __importStar(require("fs"));
// ⚖️ 可调权重（修改这些值后重新运行压力测试即可）
const WEIGHT_STATIC_SCORE = 0.3; // 静态文本相似度的权重
const WEIGHT_LLM_SCORE = 0.7; // LLM 评分的权重
const WEIGHT_HISTORY = 0.4; // 反馈系统成功率的权重
const WEIGHT_GOAL_COMPLETION = 0.5; // 目标完成奖励
const STATIC_HIGH_THRESHOLD = 0.6; // 静态评分超过此值时，跳过LLM调用
function loadIR() {
    const raw = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
    return Array.isArray(raw) ? raw : (raw.functions || []);
}
const staticScoreCache = new Map();
function getStaticScore(funcName, goal) {
    const key = `${funcName}|${goal}`;
    if (staticScoreCache.has(key))
        return staticScoreCache.get(key);
    let s = 0;
    const combined = funcName.toLowerCase();
    const goalWords = goal.toLowerCase().split(/\s+/);
    for (const w of goalWords) {
        if (combined.includes(w))
            s += 0.3;
        s += (0, utils_1.jaccardSimilarity)(combined, w) * 0.1;
    }
    s = Math.min(1, s);
    staticScoreCache.set(key, s);
    return s;
}
async function decomposeGoals(intent, functions) {
    const funcNames = functions.map(f => f.name).join(", ");
    const prompt = `将以下需求分解为2-3个独立的子目标，每个子目标必须是一个简短的动词短语。绝对不能合并。\n需求：${intent}\n可用函数：${funcNames}\n只返回JSON字符串数组，如 ["验证密码","生成JWT","返回错误"]`;
    const text = await (0, llm_1.generate)(prompt);
    try {
        let cleaned = text.replace(/```json\s*/gi, '[').replace(/```\s*/g, ']');
        const match = cleaned.match(/\[([\s\S]*)\]/);
        if (match) {
            let parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
                parsed = parsed.map((o) => o.description || o.subgoal || String(o));
            }
            if (typeof parsed === 'string')
                parsed = [parsed];
            const result = [];
            for (const item of parsed) {
                if (typeof item === 'string' && item.includes(','))
                    result.push(...item.split(',').map(s => s.trim()).filter(s => s));
                else if (typeof item === 'string')
                    result.push(item);
            }
            return result.slice(0, 3);
        }
    }
    catch { }
    return [intent];
}
/** 批量评分：将同一 goal 的所有候选函数打包为一次 LLM 调用 */
async function batchScoreFuncs(funcs, goal) {
    const result = new Map();
    const needsLLM = [];
    for (const f of funcs) {
        if (f.staticScore > STATIC_HIGH_THRESHOLD) {
            result.set(f.name, f.staticScore);
        }
        else {
            needsLLM.push(f);
        }
    }
    if (needsLLM.length === 0)
        return result;
    const funcNames = needsLLM.map(f => f.name).join(", ");
    const prompt = `评估以下每个函数对目标"${goal}"的贡献度（0-10整数）。只返回JSON对象，格式：{"函数名":整数}\n函数：${funcNames}`;
    try {
        const text = await (0, llm_1.generate)(prompt);
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            const scores = JSON.parse(match[0]);
            for (const [name, score] of Object.entries(scores)) {
                const n = typeof score === 'number' ? score : parseFloat(String(score));
                result.set(name, isNaN(n) ? 0.3 : Math.min(1, n / 10));
            }
        }
    }
    catch { }
    for (const f of needsLLM) {
        if (!result.has(f.name))
            result.set(f.name, 0.3);
    }
    return result;
}
/** @requires INTENT @produces ACTION_PLAN */
async function searchPlan(intent, beamWidth = 2, maxDepth = 6) {
    (0, llm_1.resetCallCount)();
    staticScoreCache.clear();
    const ir = loadIR();
    const goals = await decomposeGoals(intent, ir);
    console.log("🎯 目标栈:", goals);
    let beam = [{
            actions: [],
            declaredVars: new Map(),
            currentGoalIndex: 0,
            score: 0,
        }];
    let bestCandidate = null;
    for (let step = 0; step < maxDepth; step++) {
        const newCandidates = [];
        for (const cand of beam) {
            if (cand.currentGoalIndex >= goals.length) {
                newCandidates.push(cand);
                continue;
            }
            const currentGoal = goals[cand.currentGoalIndex];
            const scoredFuncs = ir.map((f) => ({
                ...f,
                staticScore: getStaticScore(f.name, currentGoal)
            })).filter((f) => f.staticScore > 0.05)
                .sort((a, b) => b.staticScore - a.staticScore)
                .slice(0, 5);
            // 批量评分：一次 LLM 调用评估所有候选函数
            const scoreMap = await batchScoreFuncs(scoredFuncs.map(f => ({ name: f.name, staticScore: f.staticScore })), currentGoal);
            for (const func of scoredFuncs) {
                const alreadyUsed = cand.actions.some(a => a.kind === "call" && a.function === func.name && a._goalIndex === cand.currentGoalIndex);
                if (alreadyUsed)
                    continue;
                const relevance = scoreMap.get(func.name) ?? 0.3;
                if (relevance < 0.2)
                    continue;
                const args = func.params.map((p) => ({
                    name: p.name,
                    type: p.type,
                    value: findCompatibleVar(cand.declaredVars, p.type) || `input_${step}_${p.name}`,
                }));
                const action = { kind: "call", function: func.name, args, assignTo: `var_${step}_${func.name}` };
                action._goalIndex = cand.currentGoalIndex;
                const validation = (0, validator_1.validateAction)(action);
                if (!validation.valid)
                    continue;
                const newVars = new Map(cand.declaredVars);
                if (action.assignTo)
                    newVars.set(action.assignTo, func.returnType);
                const goalCompleted = relevance > 0.5; // 降低目标完成门槛
                const nextGoalIndex = goalCompleted ? cand.currentGoalIndex + 1 : cand.currentGoalIndex;
                const successRate = (0, feedback_1.getFunctionSuccessRate)(func.name);
                const finalRelevance = (func.staticScore * WEIGHT_STATIC_SCORE + relevance * WEIGHT_LLM_SCORE) / (WEIGHT_STATIC_SCORE + WEIGHT_LLM_SCORE);
                const newScore = cand.score + successRate * WEIGHT_HISTORY + finalRelevance * (1 - WEIGHT_HISTORY) + (goalCompleted ? WEIGHT_GOAL_COMPLETION : 0);
                newCandidates.push({ actions: [...cand.actions, action], declaredVars: newVars, currentGoalIndex: nextGoalIndex, score: newScore });
                if (newCandidates.length > beamWidth * 10)
                    break;
            }
        }
        newCandidates.sort((a, b) => b.score - a.score);
        beam = newCandidates.slice(0, beamWidth);
        const complete = beam.find(c => c.currentGoalIndex >= goals.length);
        if (complete && (!bestCandidate || complete.score > bestCandidate.score))
            bestCandidate = complete;
        if (beam.length === 0)
            break;
    }
    const winner = bestCandidate || beam[0];
    return winner ? winner.actions : [];
}
function findCompatibleVar(declaredVars, neededType) {
    for (const [name, type] of declaredVars) {
        if (type === neededType || neededType === "any" || type === "any")
            return name;
    }
    return null;
}
