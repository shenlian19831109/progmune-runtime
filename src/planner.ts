import { generate, chat, resetCallCount, estimateTokens } from "./llm";
import { Action, executeActionCode } from "./action-runtime";
import { validateActionSequence } from "./validator";
import { checkSemantic } from "./semantic-validator";
import { getFunctionSuccessRate } from "./feedback";
import { jaccardSimilarity, extractKeywords } from "./utils";
import { recordFailure, recordSession, saveCheckpoint, loadCheckpoint, clearCheckpoint, SVL } from "./failure-corpus";
import { recordEpisode, findSemanticTemplate } from "./memory-layer";
import { StateMachineValidator, SSGRejection } from "./ssg-validator";
import * as fs from "fs";

function enrichActions(actions: Action[], ir: any[]): Action[] {
  return actions.map(a => {
    if (!a || !a.kind) return a;
    if (a.kind === "call" && a.function && a.args) {
      const def = ir.find(f => f.name === a.function);
      if (def) {
        a.args = a.args.map((arg: any, i: number) => {
          if (!arg) return { name: `p${i}`, type: 'any', value: null };
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

function determineSVL(errors: string[]): SVL {
  if (errors.some(e => e.includes("不存在"))) return "SVL-1";
  if (errors.some(e => e.includes("类型不匹配") || e.includes("参数数量"))) return "SVL-2";
  if (errors.some(e => e.includes("变量") && (e.includes("未定义") || e.includes("引用自身")))) return "SVL-3";
  if (errors.some(e => e.includes("协议") || e.includes("状态"))) return "SVL-4";
  return "SVL-1";
}

function determineConstraintType(svl: SVL): string {
  switch (svl) {
    case "SVL-1": return "symbol_existence";
    case "SVL-2": return "type_mismatch";
    case "SVL-3": return "dataflow";
    case "SVL-4": return "protocol";
  }
}

/** 构建紧凑函数列表（约节省 50% token） */
function buildCompactFuncList(funcs: any[]): string {
  return funcs.map((f: any) => {
    const params = f.params.map((p: any) => `${p.name}:${p.type}`).join(",");
    return `${f.name}(${params})->${f.returnType}`;
  }).join("\n");
}

const SYSTEM_PROMPT = `你是程序合成助手。只输出 IR 代码，不输出解释。

示例（缓存查询——注意 assign 先于条件）：
assign("query_key","user:123")
callAssign("cache_get","cached_data","query_key")
ifElse("cached_data",()=>{output("cached_data")},()=>{callAssign("query_data","fresh_data","query_key");call("cache_set","query_key","fresh_data");output("fresh_data")})

全局函数：
- assign("变量名","值")——声明变量
- callAssign("函数","变量名",...args)——调用函数并绑定返回值
- ifElse("变量名",()=>{...},()=>{...})——条件分支
- ifBlock("变量名",()=>{...})——简单分支
- call("函数",...args)——调用 void 函数
- output("值或变量名")——返回结果

铁律：
1. 先 assign 或 callAssign 声明变量，再使用
2. 参数数量与函数声明严格一致
3. 条件括号内只能是已声明的变量名
4. 禁止调用可用列表外的任何函数`;

const RETRY_HINT = `输出规则：用 assign("var","val") / callAssign("fn","var",...) / ifElse("var",()=>{},()=>{}) / call("fn",...) / output("var") 格式，只输出代码`;

/** 构建重试 prompt：精简但包含必要的 IR 语法提示 */

/** 加载 IR 中所有带 protocol 的函数为协议规则 */
function loadProtocols(ir: any[]) {
  return ir
    .filter((f: any) => f.protocol)
    .map((f: any) => ({ function: f.name, protocol: f.protocol }));
}

/** 验证动作序列的协议合法性，返回完整 SSG 跟踪 */
function validateProtocol(actions: Action[], protocols: any[], initialState: string): { valid: boolean; rejection?: SSGRejection; index?: number; trace?: { function: string; statesBefore: string[]; statesAfter: string[] }[] } {
  const ssv = new StateMachineValidator(protocols, initialState);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.kind === "call" && a.function) {
      const result = ssv.apply(a.function);
      if (!result.valid) {
        const fullTrace = ssv.getTrace();
        const trace = fullTrace.map(t => ({
          function: t.function,
          statesBefore: t.statesBefore || [],
          statesAfter: t.statesAfter || [],
        }));
        return { valid: false, rejection: result.rejection!, index: i, trace };
      }
    }
  }
  return { valid: true };
}

/** SSG 确定性修复：当协议违规有已知修复路径时，自动插入缺失函数 */
function attemptSSGRepair(
  actions: Action[],
  rejection: SSGRejection,
  ir: any[],
  protocols: any[],
  initialState: string
): Action[] | null {
  if (!rejection.fixPath || rejection.fixPath.length === 0) return null;

  // 找到被拦截函数在序列中的位置
  const blockedIdx = actions.findIndex(a => a.function === rejection.blocked);
  if (blockedIdx === -1) return null;

  // 为修复路径中的每个函数创建合成 Action
  const repairActions: Action[] = [];
  for (const fnName of rejection.fixPath) {
    const def = ir.find((f: any) => f.name === fnName);
    if (!def) return null; // 修复路径引用了不存在的函数，无法修复

    const args = (def.params || []).map((p: any, i: number) => ({
      name: p.name || `p${i}`,
      type: p.type || 'any',
      value: null, // 占位值，由后续 enrich 填充
    }));

    const assignTo = def.returnType && def.returnType !== 'void' && def.returnType !== 'undefined'
      ? `${fnName}_result` : undefined;

    const action: Action = { kind: 'call', function: fnName, args };
    if (assignTo) action.assignTo = assignTo;
    repairActions.push(action);
  }

  // 在被拦截函数前插入修复函数
  const repaired = [
    ...actions.slice(0, blockedIdx),
    ...repairActions,
    ...actions.slice(blockedIdx),
  ];

  // 重新验证
  const recheck = validateProtocol(repaired, protocols, initialState);
  if (recheck.valid) {
    console.error(`🔧 SSG 确定性修复: 自动插入 ${rejection.fixPath.join(' → ')} 以解决协议违规`);
    return repaired;
  }

  // 单步修复不够，尝试递归修复
  if (recheck.rejection && recheck.rejection.fixPath && recheck.rejection.fixPath.length > 0) {
    const nested = attemptSSGRepair(repaired, recheck.rejection, ir, protocols, initialState);
    if (nested) return nested;
  }

  return null;
}

export async function plan(userIntent: string): Promise<Action[]> {
  resetCallCount();
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));

  // 语义模板快速通道
  const cachedTemplate = findSemanticTemplate(userIntent);
  if (cachedTemplate && cachedTemplate.successRate >= 0.8 && cachedTemplate.useCount >= 2) {
    console.error("⚡ 命中语义模板，直接复用已验证序列");
    recordEpisode({ intent: userIntent, actions: cachedTemplate.actionSequence, success: true });
    return cachedTemplate.actionSequence;
  }

  const keywords = extractKeywords(userIntent);
  const scored = ir.map((f: any) => {
    let score = 0;
    for (const kw of keywords) {
      score += jaccardSimilarity(f.name.toLowerCase(), kw);
      if (f.name.toLowerCase().includes(kw)) score += 0.5;
    }
    return { ...f, score };
  });
  scored.sort((a: any, b: any) => b.score - a.score);
  const topFuncs = scored.slice(0, 15);

  const compactFuncList = buildCompactFuncList(topFuncs);

  const userIntentPart = userIntent.match(/(?:实现|implement|编写|创建)\s*(\w+)\s*(?:函数|function)?/i);
  const forbiddenFuncs: string[] = [];
  if (userIntentPart) {
    const targetName = userIntentPart[1];
    if (ir.find((f: any) => f.name.toLowerCase() === targetName.toLowerCase())) {
      forbiddenFuncs.push(targetName);
    }
  }

  const userPrompt = `可用函数：
${compactFuncList}

需求：${userIntent}

只输出代码。`;

  const estimatedTokens = estimateTokens(SYSTEM_PROMPT + userPrompt);
  console.error(`💰 估算 prompt token: ${estimatedTokens}`);

  // ── 执行持久化：检查是否有未完成的 checkpoint ──
  const cp = loadCheckpoint(userIntent);
  let startRetry = 0;
  let finalActions: Action[] = [];
  let currentPrompt = userPrompt;
  let useSystem = true;
  let collectedFailures: any[] = [];

  if (cp) {
    console.error(`📌 恢复 checkpoint: 已完成 ${cp.attemptIndex} 次尝试，从第 ${cp.attemptIndex + 1} 次继续`);
    startRetry = cp.attemptIndex;
    currentPrompt = cp.currentPrompt;
    useSystem = cp.useSystem;
    collectedFailures = cp.collectedFailures || [];
  }

  const protocols = loadProtocols(ir);
  function getMaskedFuncList(currentState: string): string {
    if (protocols.length === 0) return compactFuncList;
    const ssv = new StateMachineValidator(protocols, currentState);
    const legalFuncs = topFuncs.filter((f: any) => {
      const proto = protocols.find((p: any) => p.function === f.name);
      if (!proto) return true;
      const result = ssv.apply(f.name);
      return result.valid;
    });
    if (legalFuncs.length === topFuncs.length) return compactFuncList;
    return buildCompactFuncList(legalFuncs);
  }

  const maxRetries = 3;

  for (let r = startRetry; r < maxRetries; r++) {
    let text: string;
    try {
      text = useSystem
        ? await chat(SYSTEM_PROMPT, currentPrompt)
        : await generate(`你是程序合成助手。\n\n${currentPrompt}`);
    } catch (e) { continue; }
    if (!text) continue;

    text = text.replace(/```javascript\s*/gi, '').replace(/```\s*/g, '').trim();
    console.error("📝 LLM 生成的代码:\n", text);

    const rawActions = executeActionCode(text);
    if (!rawActions || rawActions.length === 0) {
      console.error("⚠️ 代码执行失败，重试...");
      currentPrompt = `可用函数：\n${compactFuncList}\n\n需求：${userIntent}\n\n上一次代码无效，请严格模仿示例。\n${RETRY_HINT}\n只输出代码。`;
      useSystem = false;
      continue;
    }

    const enriched = enrichActions(rawActions, ir);
    const filtered = enriched.filter(a => !forbiddenFuncs.includes(a.function || ''));

    // 1) 基础序列校验
    const seqResult = validateActionSequence(filtered);
    if (!seqResult.valid) {
      const errorsFlat = seqResult.errors.flat();
      console.error("⚠️ 序列校验失败:", errorsFlat.join(", "));
      const svl = determineSVL(errorsFlat);
      // 从错误信息中提取结构化上下文
      const missingFnMatch = errorsFlat.join(" ").match(/函数\s*['"]?(\w+)['"]?\s*不存在/);
      const typeMatch = errorsFlat.join(" ").match(/(\w+)\s*(参数数量不匹配|类型不匹配|参数)/);
      const varMatch = errorsFlat.join(" ").match(/变量\s*['"]?(\w+)['"]?\s*(未定义|在赋值前被引用)/);

      recordFailure({
        intent: userIntent,
        projectFunctions: ir.map((f: any) => f.name),
        violatedSVL: svl,
        constraintType: determineConstraintType(svl),
        actionSequence: filtered,
        errorDetail: errorsFlat.join("; "),
        ssgMissingFunctions: missingFnMatch ? [missingFnMatch[1]] : (typeMatch ? [typeMatch[1]] : (varMatch ? [varMatch[1]] : undefined)),
        plannerAttempt: r + 1,
        plannerRetryTotal: maxRetries,
      });
      collectedFailures.push({
        violatedSVL: svl,
        constraintType: determineConstraintType(svl),
        errorDetail: errorsFlat.join("; "),
        actionSequence: filtered,
        ssgMissingFunctions: missingFnMatch ? [missingFnMatch[1]] : undefined,
        plannerAttempt: r + 1,
        plannerRetryTotal: maxRetries,
      });
      recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: svl });
      currentPrompt = `可用函数：\n${compactFuncList}\n\n需求：${userIntent}\n\n错误：${errorsFlat.join("；")}。请修正。\n${RETRY_HINT}\n只输出代码。`;
      useSystem = false;
      saveCheckpoint(userIntent, { attemptIndex: r + 1, collectedFailures, currentPrompt, useSystem });
      continue;
    }

    // 2) 协议状态机校验 (SSG)
    if (protocols.length > 0) {
      const protoResult = validateProtocol(filtered, protocols, "UNAUTHENTICATED");
      if (!protoResult.valid && protoResult.rejection) {
        const rej = protoResult.rejection;
        const explain = StateMachineValidator.explainRejection(rej);
        console.error(explain);
        recordFailure({
          intent: userIntent,
          projectFunctions: ir.map((f: any) => f.name),
          violatedSVL: "SVL-4",
          constraintType: "protocol",
          actionSequence: filtered,
          errorDetail: JSON.stringify(StateMachineValidator.rejectionToJSON(rej)),
          ssgState: rej.currentState,
          ssgTrace: protoResult.trace,
          ssgFixPath: rej.fixPath,
          ssgMissingFunctions: rej.missingFunctions,
          plannerAttempt: r + 1,
          plannerRetryTotal: maxRetries,
        });
        collectedFailures.push({
          violatedSVL: "SVL-4",
          constraintType: "protocol",
          errorDetail: JSON.stringify(StateMachineValidator.rejectionToJSON(rej)),
          actionSequence: filtered,
          ssgFixPath: rej.fixPath,
          ssgMissingFunctions: rej.missingFunctions,
          plannerAttempt: r + 1,
          plannerRetryTotal: maxRetries,
        });
        recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: "SVL-4" });

        // 尝试确定性修复：用 SSG 的 fixPath 自动插入缺失函数
        const repaired = attemptSSGRepair(filtered, rej, ir, protocols, "UNAUTHENTICATED");
        if (repaired) {
          console.error("🔧 SSG 修复成功，跳过 LLM 重试");
          finalActions = repaired;
          break;
        }

        const maskedFuncList = getMaskedFuncList("UNAUTHENTICATED");
        currentPrompt = `当前协议状态只允许以下函数：\n${maskedFuncList}\n\n需求：${userIntent}\n\n协议违规：${explain.replace(/\n/g, '；')}。请修正。\n${RETRY_HINT}\n只输出代码。`;
        useSystem = false;
        saveCheckpoint(userIntent, { attemptIndex: r + 1, collectedFailures, currentPrompt, useSystem });
      continue;
      }
    }

    // 3) 语义合约校验
    const semResult = checkSemantic(userIntent, filtered);
    if (!semResult.valid) {
      console.error("⚠️ 语义校验失败:", semResult.errors.join(", "));
      recordFailure({
        intent: userIntent,
        projectFunctions: ir.map((f: any) => f.name),
        violatedSVL: "SVL-4",
        constraintType: "protocol",
        actionSequence: filtered,
        errorDetail: semResult.errors.join("; "),
        plannerAttempt: r + 1,
        plannerRetryTotal: maxRetries,
      });
      collectedFailures.push({
        violatedSVL: "SVL-4",
        constraintType: "protocol",
        errorDetail: semResult.errors.join("; "),
        actionSequence: filtered,
        plannerAttempt: r + 1,
        plannerRetryTotal: maxRetries,
      });
      recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: "SVL-4" });
      currentPrompt = `可用函数：\n${compactFuncList}\n\n需求：${userIntent}\n\n语义错误：${semResult.errors.join("；")}。请修正。\n${RETRY_HINT}\n只输出代码。`;
      useSystem = false;
      saveCheckpoint(userIntent, { attemptIndex: r + 1, collectedFailures, currentPrompt, useSystem });
      continue;
    }

    finalActions = filtered;
    break;
  }

  if (finalActions.length > 0) {
    recordEpisode({ intent: userIntent, actions: finalActions, success: true });
    recordSession({
      intent: userIntent,
      timestamp: new Date().toISOString(),
      attempts: collectedFailures,
      successfulAlternative: finalActions,
      totalRetries: collectedFailures.length,
      resolved: true,
    });
    clearCheckpoint(userIntent);
  } else {
    // LLM 3 次重试失败，尝试本地规则回退
    console.error("[降级] LLM 规划失败，尝试本地规则回退");
    const fallback = generateFallbackPlan(userIntent, ir);
    if (fallback.length > 0) {
      console.error(`[降级] 本地规则生成了 ${fallback.length} 个动作`);
      recordEpisode({ intent: userIntent, actions: fallback, success: true });
      recordSession({
        intent: userIntent,
        timestamp: new Date().toISOString(),
        attempts: collectedFailures,
        successfulAlternative: fallback,
        totalRetries: collectedFailures.length,
        resolved: true,
      });
      clearCheckpoint(userIntent);
      return fallback;
    }
    recordEpisode({ intent: userIntent, actions: [], success: false });
    recordSession({
      intent: userIntent,
      timestamp: new Date().toISOString(),
      attempts: collectedFailures,
      totalRetries: collectedFailures.length,
      resolved: false,
    });
    clearCheckpoint(userIntent);
  }

  return finalActions;
}

/** 本地规则回退：当 LLM 不可用时，根据意图关键词生成简单动作序列 */
function generateFallbackPlan(intent: string, ir: any[]): Action[] {
  const intentLower = intent.toLowerCase();
  const actions: Action[] = [];
  const keywords = intentLower.split(/[\s,，、]+/).filter(k => k.length > 1);
  const matchedFuncs: any[] = [];
  for (const kw of keywords) {
    for (const fn of ir) {
      if (fn.name.toLowerCase().includes(kw) && !matchedFuncs.find((f: any) => f.name === fn.name)) {
        matchedFuncs.push(fn);
      }
    }
  }
  if (matchedFuncs.length === 0) return [];
  for (const fn of matchedFuncs) {
    const args = (fn.params || []).map((p: any, i: number) => ({
      name: p.name || `p${i}`,
      type: p.type || 'any',
      value: `{{${p.name || `p${i}`}}}`
    }));
    const assignTo = fn.returnType && fn.returnType !== 'void' && fn.returnType !== 'undefined'
      ? `${fn.name}_result` : undefined;
    if (assignTo) {
      actions.push({ kind: 'call', function: fn.name, args, assignTo } as Action);
    } else {
      actions.push({ kind: 'call', function: fn.name, args } as Action);
    }
  }
  return actions;
}
