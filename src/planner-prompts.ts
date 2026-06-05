/**
 * Phase 6C: Planner — Prompt Builder
 *
 * Builds the LLM system prompt and formats IR function lists,
 * capability chains, and protocol constraints for the planner.
 *
 * Extracted from planner.ts to keep the main planning module focused.
 */

import { getTopology } from "./semantic-topology";
import type { FunctionProtocol } from "./ssg-validator";

// ── Constants ──

export const SYSTEM_PROMPT = `你是程序合成助手。只输出 JSON 数组，不输出解释。

格式：[{"f":"函数名","to":"变量名","a":[{"n":"参数名","t":"类型","v":值}]},{"r":"变量名"}]

规则：
- 函数名从可用列表中选择，优先选注释中 purpose 匹配需求的函数
- 0参数函数直接用 "a":[]：{"f":"getAllSessions","to":"s","a":[]}
- 参数值规则（最重要！）：
  - 链式调用：前面的 call 产生了 to="genome"，后面的 call 用 "v":"$genome" 引用
  - 示例：{"f":"getFailureGenome","to":"g","a":[]} → {"f":"computeHealthScore","to":"s","a":[{"n":"failureGenome","t":"any","v":"$g"},{"n":"antibodyStats","t":"any","v":"$stats"}]}
  - 第一个调用的参数用有意义的示例值：文件路径用 "/path/to/file"，ID用 "example-id"
  - 禁止空串 "" 作为参数值！
- 返回值: {"r":"变量名"} — 必须返回最后一个 call 的赋值变量
- 链式调用：看到推荐链时，用 $变量名 把上一步输出传给下一步

铁律：
- 禁止空串参数！每个参数根据函数签名中的 =默认值 填入实际值
- 字符串用具体描述值（不用 ""），数字用合理数值，布尔用 false
- 每个call用"to"命名变量，下一个call通过"$变量名"引用
- 最后一个action必须是{"r":"变量名"}
- 只输出JSON，不输出解释`;

export const RETRY_HINT = `输出格式：紧凑 JSON 数组 [{"f":"函数名","to":"变量名","a":[...]}]`;

// ── Formatters ──

/** Build a compact function list with parameter examples for LLM precision. */
export function buildCompactFuncList(funcs: any[], allFuncs: any[]): string {
  // Example values for each type — helps LLM fill meaningful args
  function exampleValue(type: string, paramName: string): string {
    const t = (type || "any").replace(/\[\]$/, "").toLowerCase();
    if (t === "string" || t === "str") return `"${paramName}"`;
    if (t === "number" || t === "int" || t === "float") return paramName === "limit" ? "10" : "1";
    if (t === "boolean" || t === "bool") return "false";
    if (t === "any" || t === "object") return "{}";
    if (t === "void" || t === "undefined" || t === "null") return "null";
    // Known enum types
    if (t === "svl") return '"SVL-4"';
    if (t === "rootcause") return '"F01"';
    if (t === "branchreason") return '"repair_attempt"';
    if (t === "repairstrategy") return '"insert"';
    if (t === "constrainttype") return '"protocol"';
    if (t.endsWith("[]")) return "[]";
    if (t.startsWith("map<")) return "new Map()";
    if (t.startsWith("set<")) return "new Set()";
    return `{} as ${type}`;
  }

  return funcs.map((f: any) => {
    const params = (f.params || []).map((p: any) => {
      const ex = exampleValue(p.type || "any", p.name || "arg");
      return `${p.name}=${ex}`;
    }).join(", ");
    let line = `${f.name}(${params}) → ${f.returnType || "any"}`;
    const meta: string[] = [];
    if (f.score && f.score > 0) meta.push(`★${f.score.toFixed(1)}`);
    if (f.purpose) meta.push(f.purpose.slice(0, 60));
    if (f.produces && f.produces.length > 0) meta.push(`→${f.produces.join(",")}`);
    if (meta.length > 0) line += `  // ${meta.join(" | ")}`;
    return line;
  }).join("\n");
}

/** Semantic matching: check if two capability labels are related via SemanticTopology. */
export function semanticMatch(a: string, b: string): boolean {
  try {
    const topo = getTopology();
    if (topo.size > 0) return topo.capabilityMatch(a, b);
  } catch { /* topology rebuild — optional */ }
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

/** Build capability chain hints: producer→consumer relationships using semantic matching. */
export function buildChainHints(funcs: any[]): string {
  const chains: string[] = [];
  const seen = new Set<string>();
  for (const f of funcs) {
    if (!f.produces) continue;
    for (const p of f.produces) {
      const consumers = funcs.filter((x: any) =>
        x.name !== f.name &&
        (x.requires || []).some((r: string) => semanticMatch(p, r))
      );
      for (const c of consumers) {
        const key = `${f.name}→${c.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const matchedReq = (c.requires || []).find((r: string) => semanticMatch(p, r));
        chains.push(`${f.name}()→${c.name}()  // ${p} ≈ ${matchedReq || "?"}`);
      }
    }
  }
  if (chains.length === 0) return "";
  return "\n推荐调用链（先调生产者，用 $变量名 传给消费者）:\n" + chains.map(c => `  ${c}`).join("\n");
}

/** Build protocol constraint hints for the LLM prompt. */
export function buildProtocolChainHint(protocols: FunctionProtocol[]): string {
  if (protocols.length === 0) return "";
  const byNs = new Map<string, FunctionProtocol[]>();
  for (const p of protocols) {
    const ns = p.protocol.namespace || "_global";
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns)!.push(p);
  }
  const lines: string[] = ["\n⚠️ 协议约束（必须严格遵循调用顺序）:"];
  for (const [ns, fns] of byNs) {
    if (ns === "_global" || fns.length <= 1) continue;
    lines.push(`  [${ns}] 合法调用链: ${fns.map(p => p.function).join(" → ")}`);
    for (const p of fns) {
      const pre = p.protocol.pre_states?.join(",") || "(无)";
      const post = p.protocol.post_states?.join(",") || "(无)";
      lines.push(`    ${p.function}: 前置状态=[${pre}] → 后置状态=[${post}]`);
    }
  }
  return lines.join("\n");
}
