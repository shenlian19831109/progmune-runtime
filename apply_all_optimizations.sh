#!/bin/bash
set -e
echo "🚀 应用 P0-P2 全部优化..."

# ========== P0: 修复测试项目导入 ==========
cat > test-large/utils/helpers.py << 'EOF'
from typing import List, Dict
import time, random
def current_timestamp() -> int: return int(time.time())
def random_id() -> str: return "id_" + str(random.randint(1000,9999))
def retry(func, max_tries=3): 
    for i in range(max_tries):
        try: return func()
        except: pass
    raise Exception("max retries")
def cache_result(key: str, value: str, ttl: int = 60): pass
def get_cached(key: str) -> str: return ""
def log_info(msg: str): print(f"[INFO] {msg}")
def log_error(msg: str): print(f"[ERROR] {msg}")
def measure_time(func): 
    start = time.time(); result = func(); print(f"time: {time.time()-start}"); return result
def chunk_list(lst: List, size: int) -> List[List]: return [lst[i:i+size] for i in range(0, len(lst), size)]
def flatten(list_of_lists: List[List]) -> List: return [item for sub in list_of_lists for item in sub]
def dict_to_list(d: Dict) -> List: return list(d.items())
def unique_values(d: Dict) -> List: return list(set(d.values()))
def safe_divide(a: float, b: float) -> float: return a/b if b else 0.0
def percentage(part: float, total: float) -> float: return (part/total)*100 if total else 0
def clamp(value: float, min_val: float, max_val: float) -> float: return max(min_val, min(value, max_val))
EOF

# ========== P0+P1+P2: 集成优化：智能截断 + 静态评分 + 目标栈加固 ==========

# 1. 工具函数：简单的意图相关性评分（基于关键词）
cat > src/utils.ts << 'EOF'
// 计算两个字符串的简单 Jaccard 相似度（基于字符二元组）
export function jaccardSimilarity(a: string, b: string): number {
  const bigrams = (s: string) => {
    const bgs = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bgs.add(s.substring(i, i+2));
    return bgs;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / (union.size || 1);
}

// 从意图中提取关键词
export function extractKeywords(intent: string): string[] {
  return intent.split(/[\s，。！？,]+/).filter(w => w.length > 1).map(w => w.toLowerCase());
}
EOF

# 2. 更新 LLM Planner：智能截断函数列表
cat > src/planner.ts << 'PLANNER'
import { generate, resetCallCount } from "./llm";
import { Action } from "./actions";
import { validateAction } from "./validator";
import { getFunctionSuccessRate } from "./feedback";
import { jaccardSimilarity, extractKeywords } from "./utils";
import * as fs from "fs";

export async function plan(userIntent: string): Promise<Action[]> {
  resetCallCount();
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
  const keywords = extractKeywords(userIntent);

  // P1: 只保留与意图最相关的前 15 个函数
  const scored = ir.map((f: any) => {
    let score = 0;
    for (const kw of keywords) {
      score += jaccardSimilarity(f.name.toLowerCase(), kw);
      if (f.name.toLowerCase().includes(kw)) score += 0.5;
    }
    return { ...f, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const topFuncs = scored.slice(0, 15);

  const funcList = topFuncs.map((f: any) => {
    const rate = getFunctionSuccessRate(f.name);
    const star = rate > 0.8 ? "⭐" : rate > 0.5 ? "👍" : "⚠️";
    const params = f.params.map((p: any) => `${p.name}: ${p.type}`).join(", ");
    return `${star} ${f.name}(${params}) -> ${f.returnType} (${(rate*100).toFixed(0)}%)`;
  }).join("\n");

  const matchFunc = userIntent.match(/(?:实现|implement|编写|创建)\s*(\w+)\s*(?:函数|function)?/i);
  const forbiddenFuncs: string[] = [];
  if (matchFunc) {
    const targetName = matchFunc[1];
    if (ir.find((f: any) => f.name.toLowerCase() === targetName.toLowerCase())) {
      forbiddenFuncs.push(targetName);
    }
  }

  const strictFormat = 
    `只能使用以下两种动作：
1. 调用：{ "kind": "call", "function": "...", "args": [{"name": "...", "type": "...", "value": "..."}], "assignTo": "变量" }
2. 条件：{ "kind": "if", "condition": "变量", "thenActions": [...], "elseActions": [...] }
只返回纯JSON数组，不要Markdown，不要其他文字。`;

  let prompt = `可用函数：\n${funcList}\n` +
    (forbiddenFuncs.length > 0 ? `\n禁止：${forbiddenFuncs.join(", ")}\n` : "") +
    `\n需求：${userIntent}\n` + strictFormat;

  let actions: Action[] = [];
  for (let r = 0; r < 3; r++) {
    let text = await generate(prompt);
    text = text.replace(/```json\s*/gi, '[').replace(/```\s*/g, ']');
    const match = text.match(/\[([\s\S]*)\]/);
    if (match) {
      try {
        let parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0])) parsed = parsed[0];
        if (Array.isArray(parsed)) {
          parsed = parsed.filter((a: any) => !forbiddenFuncs.includes(a.function));
          actions = parsed;
          const results = actions.map((a: any) => validateAction(a));
          const invalid = results.filter((r: any) => !r.valid);
          if (invalid.length === 0) break;
          console.log("⚠️ 校验失败:", invalid.map((r: any) => r.errors).flat().join(", "));
        }
      } catch (e) { console.log("⚠️ JSON 解析异常:", e); }
    }
    if (actions.length === 0) prompt += "\n上次无效，务必只返回JSON数组。";
  }
  return actions;
}
PLANNER

# 3. 更新搜索 Planner：静态评分 + 嵌入缓存 + 目标栈加固
cat > src/search-planner.ts << 'SEARCH'
import { Action } from "./actions";
import { validateAction } from "./validator";
import { generate, resetCallCount } from "./llm";
import { getFunctionSuccessRate } from "./feedback";
import { jaccardSimilarity, extractKeywords } from "./utils";
import * as fs from "fs";

interface Candidate {
  actions: Action[];
  declaredVars: Map<string, string>;
  currentGoalIndex: number;
  score: number;
}

function loadIR(): any[] {
  return JSON.parse(fs.readFileSync("ir.json", "utf-8"));
}

// 静态评分缓存（避免重复LLM调用）
const staticScoreCache = new Map<string, number>();

function getStaticScore(funcName: string, intent: string, goal: string): number {
  const key = `${funcName}|${intent}|${goal}`;
  if (staticScoreCache.has(key)) return staticScoreCache.get(key)!;
  let s = 0;
  const combined = funcName.toLowerCase();
  const goalWords = goal.toLowerCase().split(/\s+/);
  for (const w of goalWords) {
    if (combined.includes(w)) s += 0.4;
    s += jaccardSimilarity(combined, w) * 0.2;
  }
  s += jaccardSimilarity(combined, intent) * 0.2;
  s = Math.min(1, s);
  staticScoreCache.set(key, s);
  return s;
}

// P2: 加固目标栈分解
async function decomposeGoals(intent: string, functions: any[]): Promise<string[]> {
  const funcNames = functions.map(f => f.name).join(", ");
  const prompt = `将以下需求分解为3个以内的子目标，每个子目标是一个简短语（如“验证密码”）。只返回JSON字符串数组，不要其他文本。\n需求：${intent}\n可用函数：${funcNames}\n子目标：`;
  const text = await generate(prompt);
  try {
    let cleaned = text.replace(/```json\s*/gi, '[').replace(/```\s*/g, ']');
    const match = cleaned.match(/\[([\s\S]*)\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      // 如果是对象数组，提取description字段
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        return parsed.map((o: any) => o.description || o.subgoal || String(o)).slice(0,3);
      }
      if (Array.isArray(parsed)) return parsed.slice(0,3);
    }
  } catch {}
  return [intent];
}

// P0: 只对静态评分 Top-5 的函数调用 LLM
async function functionMatchesGoal(funcName: string, goal: string, intent: string, staticScore: number): Promise<number> {
  if (staticScore > 0.7) return staticScore; // 高静态分直接采用，省去LLM
  const prompt = `${funcName} 对 "${goal}" 的贡献度（0-10整数），只返回数字:`;
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

      // 为当前目标筛选候选函数（P0: 静态排序取Top-5）
      const scoredFuncs = ir.map((f: any) => ({
        ...f,
        staticScore: getStaticScore(f.name, intent, currentGoal)
      })).filter((f: any) => f.staticScore > 0.1)
        .sort((a: any, b: any) => b.staticScore - a.staticScore)
        .slice(0, 5);

      for (const func of scoredFuncs) {
        const alreadyUsed = cand.actions.some(a => a.kind === "call" && a.function === func.name && (a as any)._goalIndex === cand.currentGoalIndex);
        if (alreadyUsed) continue;

        // LLM 评分（高静态分跳过）
        const relevance = await functionMatchesGoal(func.name, currentGoal, intent, func.staticScore);
        if (relevance < 0.3) continue;

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
        const goalCompleted = relevance > 0.7;
        const nextGoalIndex = goalCompleted ? cand.currentGoalIndex + 1 : cand.currentGoalIndex;
        const successRate = getFunctionSuccessRate(func.name);
        const newScore = cand.score + successRate * 0.5 + relevance * 0.5 + (goalCompleted ? 0.3 : 0);

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
SEARCH

echo "✅ P0-P2 优化全部完成！"
echo "可以再次运行压力测试："
echo "  npx ts-node src/generate.ts"
