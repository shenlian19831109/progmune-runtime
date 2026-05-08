import { Action } from "./action-runtime";
import { validateAction } from "./validator";
import { generate, resetCallCount } from "./llm";
import { getFunctionSuccessRate } from "./feedback";
import { jaccardSimilarity } from "./utils";
import * as fs from "fs";

// ⚖️ 可调权重（修改这些值后重新运行压力测试即可）
const WEIGHT_STATIC_SCORE = 0.3;      // 静态文本相似度的权重
const WEIGHT_LLM_SCORE = 0.7;         // LLM 评分的权重
const WEIGHT_HISTORY = 0.4;           // 反馈系统成功率的权重
const WEIGHT_GOAL_COMPLETION = 0.5;   // 目标完成奖励
const STATIC_HIGH_THRESHOLD = 0.6;    // 静态评分超过此值时，跳过LLM调用

interface Candidate {
  actions: Action[];
  declaredVars: Map<string, string>;
  currentGoalIndex: number;
  score: number;
}

function loadIR(): any[] {
  return JSON.parse(fs.readFileSync("ir.json", "utf-8"));
}

const staticScoreCache = new Map<string, number>();

function getStaticScore(funcName: string, goal: string): number {
  const key = `${funcName}|${goal}`;
  if (staticScoreCache.has(key)) return staticScoreCache.get(key)!;
  let s = 0;
  const combined = funcName.toLowerCase();
  const goalWords = goal.toLowerCase().split(/\s+/);
  for (const w of goalWords) {
    if (combined.includes(w)) s += 0.3;
    s += jaccardSimilarity(combined, w) * 0.1;
  }
  s = Math.min(1, s);
  staticScoreCache.set(key, s);
  return s;
}

async function decomposeGoals(intent: string, functions: any[]): Promise<string[]> {
  const funcNames = functions.map(f => f.name).join(", ");
  const prompt = `将以下需求分解为2-3个独立的子目标，每个子目标必须是一个简短的动词短语。绝对不能合并。\n需求：${intent}\n可用函数：${funcNames}\n只返回JSON字符串数组，如 ["验证密码","生成JWT","返回错误"]`;
  const text = await generate(prompt);
  try {
    let cleaned = text.replace(/```json\s*/gi, '[').replace(/```\s*/g, ']');
    const match = cleaned.match(/\[([\s\S]*)\]/);
    if (match) {
      let parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        parsed = parsed.map((o: any) => o.description || o.subgoal || String(o));
      }
      if (typeof parsed === 'string') parsed = [parsed];
      const result: string[] = [];
      for (const item of parsed) {
        if (typeof item === 'string' && item.includes(',')) result.push(...item.split(',').map(s => s.trim()).filter(s => s));
        else if (typeof item === 'string') result.push(item);
      }
      return result.slice(0, 3);
    }
  } catch {}
  return [intent];
}

async function functionMatchesGoal(funcName: string, goal: string, staticScore: number): Promise<number> {
  if (staticScore > STATIC_HIGH_THRESHOLD) return staticScore;
  const prompt = `函数 ${funcName} 对 "${goal}" 的贡献度（0-10整数），只返回数字:`;
  const resp = await generate(prompt);
  const s = parseFloat(resp.trim());
  return isNaN(s) ? 0.3 : Math.min(1, s / 10);
}

export async function searchPlan(intent: string, beamWidth = 2, maxDepth = 6): Promise<Action[]> {
  resetCallCount();
  staticScoreCache.clear();
  const ir = loadIR();
  const goals = await decomposeGoals(intent, ir);
  console.log("🎯 目标栈:", goals);

  let beam: Candidate[] = [{
    actions: [],
    declaredVars: new Map(),
    currentGoalIndex: 0,
    score: 0,
  }];
  let bestCandidate: Candidate | null = null;

  for (let step = 0; step < maxDepth; step++) {
    const newCandidates: Candidate[] = [];
    for (const cand of beam) {
      if (cand.currentGoalIndex >= goals.length) { newCandidates.push(cand); continue; }
      const currentGoal = goals[cand.currentGoalIndex];

      const scoredFuncs = ir.map((f: any) => ({
        ...f,
        staticScore: getStaticScore(f.name, currentGoal)
      })).filter((f: any) => f.staticScore > 0.05)
        .sort((a: any, b: any) => b.staticScore - a.staticScore)
        .slice(0, 5);

      for (const func of scoredFuncs) {
        const alreadyUsed = cand.actions.some(a => a.kind === "call" && a.function === func.name && (a as any)._goalIndex === cand.currentGoalIndex);
        if (alreadyUsed) continue;

        const relevance = await functionMatchesGoal(func.name, currentGoal, func.staticScore);
        if (relevance < 0.2) continue;

        const args = func.params.map((p: any) => ({
          name: p.name,
          type: p.type,
          value: findCompatibleVar(cand.declaredVars, p.type) || `input_${step}_${p.name}`,
        }));
        const action: Action = { kind: "call", function: func.name, args, assignTo: `var_${step}_${func.name}` };
        (action as any)._goalIndex = cand.currentGoalIndex;
        const validation = validateAction(action);
        if (!validation.valid) continue;

        const newVars = new Map(cand.declaredVars);
        if (action.assignTo) newVars.set(action.assignTo, func.returnType);
        const goalCompleted = relevance > 0.5; // 降低目标完成门槛
        const nextGoalIndex = goalCompleted ? cand.currentGoalIndex + 1 : cand.currentGoalIndex;
        const successRate = getFunctionSuccessRate(func.name);
        const finalRelevance = (func.staticScore * WEIGHT_STATIC_SCORE + relevance * WEIGHT_LLM_SCORE) / (WEIGHT_STATIC_SCORE + WEIGHT_LLM_SCORE);
        const newScore = cand.score + successRate * WEIGHT_HISTORY + finalRelevance * (1 - WEIGHT_HISTORY) + (goalCompleted ? WEIGHT_GOAL_COMPLETION : 0);

        newCandidates.push({ actions: [...cand.actions, action], declaredVars: newVars, currentGoalIndex: nextGoalIndex, score: newScore });
        if (newCandidates.length > beamWidth * 10) break;
      }
    }
    newCandidates.sort((a, b) => b.score - a.score);
    beam = newCandidates.slice(0, beamWidth);
    const complete = beam.find(c => c.currentGoalIndex >= goals.length);
    if (complete && (!bestCandidate || complete.score > bestCandidate.score)) bestCandidate = complete;
    if (beam.length === 0) break;
  }
  const winner = bestCandidate || beam[0];
  return winner ? winner.actions : [];
}

function findCompatibleVar(declaredVars: Map<string, string>, neededType: string): string | null {
  for (const [name, type] of declaredVars) {
    if (type === neededType || neededType === "any" || type === "any") return name;
  }
  return null;
}
