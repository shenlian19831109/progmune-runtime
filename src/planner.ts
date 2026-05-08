import { generate, resetCallCount } from "./llm";
import { Action, executeActionCode } from "./action-runtime";
import { validateActionSequence } from "./validator";
import { checkSemantic } from "./semantic-validator";
import { getFunctionSuccessRate } from "./feedback";
import { jaccardSimilarity, extractKeywords } from "./utils";
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

export async function plan(userIntent: string): Promise<Action[]> {
  resetCallCount();
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
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

  // 示例中显式 assign 后立即使用 ifBlock
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
- 条件分支：ifElse("变量名", () => { ... }, () => { ... })  —— 只能在已声明的变量上使用
- 简单分支：ifBlock("变量名", () => { ... })
- 调用：call("函数", "arg1", ...)
- 返回：output("值或变量名")

铁律（每违反一条就会重试）：
1. 使用 if/else 前，必须先在同一作用域内用 assign 或 callAssign 声明条件里提到的变量。
2. 参数数量必须与函数声明完全一致。
3. 条件括号内只能是已声明的变量名，不能是表达式。

需求：
${userIntent}

只输出代码。`;

  let finalActions: Action[] = [];
  let currentPrompt = basePrompt;

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

    const seqResult = validateActionSequence(filtered);
    if (!seqResult.valid) {
      console.log("⚠️ 序列校验失败:", seqResult.errors.flat().join(", "));
      currentPrompt = basePrompt + `\n错误：${seqResult.errors.flat().join("；")}。请修正。`;
      continue;
    }

    const semResult = checkSemantic(userIntent, filtered);
    if (!semResult.valid) {
      console.log("⚠️ 语义校验失败:", semResult.errors.join(", "));
      currentPrompt = basePrompt + `\n错误：${semResult.errors.join("；")}。请修正。`;
      continue;
    }

    finalActions = filtered;
    break;
  }

  return finalActions;
}
