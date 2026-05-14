import { generate, resetCallCount } from "./llm";
import { Action, executeActionCode } from "./action-runtime";
import { validateActionSequence } from "./validator";
import { checkSemantic } from "./semantic-validator";
import { getFunctionSuccessRate } from "./feedback";
import { jaccardSimilarity, extractKeywords } from "./utils";
import { recordFailure, SVL } from "./failure-corpus";
import { recordEpisode, findSemanticTemplate } from "./memory-layer";
import { StateMachineValidator } from "./ssg-validator";
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

/** 加载 IR 中所有带 protocol 的函数为协议规则 */
function loadProtocols(ir: any[]) {
  return ir
    .filter((f: any) => f.protocol)
    .map((f: any) => ({ function: f.name, protocol: f.protocol }));
}

/** 验证动作序列的协议合法性 */
function validateProtocol(actions: Action[], protocols: any[], initialState: string) {
  const ssv = new StateMachineValidator(protocols, initialState);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.kind === "call" && a.function) {
      const result = ssv.apply(a.function);
      if (!result.valid) {
        return { valid: false, error: result.error!, index: i };
      }
    }
  }
  return { valid: true };
}

export async function plan(userIntent: string): Promise<Action[]> {
  resetCallCount();
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));

  // 语义模板快速通道
  const cachedTemplate = findSemanticTemplate(userIntent);
  if (cachedTemplate && cachedTemplate.successRate >= 0.8 && cachedTemplate.useCount >= 2) {
    console.log("⚡ 命中语义模板，直接复用已验证序列");
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

  const funcList = topFuncs.map((f: any) => {
    const rate = getFunctionSuccessRate(f.name);
    const star = rate > 0.8 ? "⭐" : rate > 0.5 ? "👍" : "⚠️";
    const params = f.params.map((p: any) => `${p.name}: ${p.type}`).join(", ");
    return `${star} ${f.name}(${params}) [${f.params.length}个参数] -> ${f.returnType} (成功率: ${(rate*100).toFixed(0)}%)`;
  }).join("\n");

  const matchFunc = userIntent.match(/(?:实现|implement|编写|创建)\s*(\w+)\s*(?:函数|function)?/i);
  const forbiddenFuncs: string[] = [];
  if (matchFunc) {
    const targetName = matchFunc[1];
    if (ir.find((f: any) => f.name.toLowerCase() === targetName.toLowerCase())) {
      forbiddenFuncs.push(targetName);
    }
  }

  const exampleCode = 
    `assign("query_key", "user:123")
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

  let finalActions: Action[] = [];
  let currentPrompt = basePrompt;

  // 加载协议规则，设定初始状态（例如未认证场景）
  const protocols = loadProtocols(ir);

  for (let r = 0; r < 3; r++) {
    let text: string;
    try { text = await generate(currentPrompt); } catch (e) { continue; }
    if (!text) continue;

    text = text.replace(/```javascript\s*/gi, '').replace(/```\s*/g, '').trim();
    console.log("📝 LLM 生成的代码:\n", text);

    const rawActions = executeActionCode(text);
    if (!rawActions || rawActions.length === 0) {
      console.log("⚠️ 代码执行失败，重试...");
      currentPrompt = basePrompt + "\n上一次代码无效，请严格模仿示例。";
      continue;
    }

    const enriched = enrichActions(rawActions, ir);
    const filtered = enriched.filter(a => !forbiddenFuncs.includes(a.function || ''));

    // 1) 基础序列校验
    const seqResult = validateActionSequence(filtered);
    if (!seqResult.valid) {
      const errorsFlat = seqResult.errors.flat();
      console.log("⚠️ 序列校验失败:", errorsFlat.join(", "));
      const svl = determineSVL(errorsFlat);
      recordFailure({
        intent: userIntent,
        projectFunctions: ir.map((f: any) => f.name),
        violatedSVL: svl,
        constraintType: determineConstraintType(svl),
        actionSequence: filtered,
        errorDetail: errorsFlat.join("; "),
      });
      recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: svl });
      currentPrompt = basePrompt + `\n错误：${errorsFlat.join("；")}。请修正。`;
      continue;
    }

    // 2) 协议状态机校验 (SSG)
    if (protocols.length > 0) {
      const protoResult = validateProtocol(filtered, protocols, "UNAUTHENTICATED");
      if (!protoResult.valid) {
        console.log("🛡️ SSG 协议违规:", protoResult.error);
        recordFailure({
          intent: userIntent,
          projectFunctions: ir.map((f: any) => f.name),
          violatedSVL: "SVL-4",
          constraintType: "protocol",
          actionSequence: filtered,
          errorDetail: protoResult.error!,
        });
        recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: "SVL-4" });
        currentPrompt = basePrompt + `\n协议错误：${protoResult.error}。请按照正确的业务顺序重新生成，确保先通过认证再签发令牌。`;
      continue;        continue;
      }
    }

    // 3) 语义合约校验
    const semResult = checkSemantic(userIntent, filtered);
    if (!semResult.valid) {
      console.log("⚠️ 语义校验失败:", semResult.errors.join(", "));
      recordFailure({
        intent: userIntent,
        projectFunctions: ir.map((f: any) => f.name),
        violatedSVL: "SVL-4",
        constraintType: "protocol",
        actionSequence: filtered,
        errorDetail: semResult.errors.join("; "),
      });
      recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: "SVL-4" });
      currentPrompt = basePrompt + `\n错误：${semResult.errors.join("；")}。请修正。`;
      continue;
    }

    finalActions = filtered;
    break;
  }

  if (finalActions.length > 0) {
    recordEpisode({ intent: userIntent, actions: finalActions, success: true });
  } else {
    recordEpisode({ intent: userIntent, actions: [], success: false });
  }

  return finalActions;
}
