/**
 * Phase 6C: Planner — Prompt Builder
 *
 * Builds the LLM system prompt and formats IR function lists,
 * capability chains, and protocol constraints for the planner.
 *
 * Extracted from planner.ts to keep the main planning module focused.
 */
import { getTopology } from "./semantic-topology";
// ── Constants ──
export const SYSTEM_PROMPT = `你是程序合成助手。只输出 JSON 数组，不输出解释。

格式：[{"f":"函数名","to":"变量名","a":[{"n":"参数名","t":"类型","v":值}]},{"r":"变量名"}]

规则：
- 函数名从可用列表中选择，优先选注释中 purpose 匹配需求的函数
- 0参数函数直接用 "a":[]：{"f":"getAllSessions","to":"s","a":[]}
- 参数值规则（重要！）：
  - 字符串: "v":""（空串）或 "v":"SVL-4"（已知枚举值）
  - 数字: "v":0 或 "v":1
  - 布尔: "v":false
  - 对象/数组: "v":{} as Type
  - 上一个函数返回值: "v":"$变量名"（$前缀引用）
- 返回值: {"r":"变量名"} — 必须返回，不能只调用不返回
- 链式调用：看到推荐调用链时，用 $变量名 把生产者输出传给消费者

铁律：
- 函数签名中带引号的参数（如 "SVL-4"）是字符串值，直接 v 中
- 字符串枚举（SVL等）用带引号的值，禁止 {} as Type
- 每个call的返回值用"to"命名变量，下一个call通过"$变量名"引用
- 最后一个action必须是{"r":"变量名"}，不能以call结尾
- 如果你调了函数，必须return它的结果
- 只输出JSON`;
export const RETRY_HINT = `输出格式：紧凑 JSON 数组 [{"f":"函数名","to":"变量名","a":[...]}]`;
// ── Formatters ──
/** Build a compact function list with capability metadata to help LLM understand function semantics. */
export function buildCompactFuncList(funcs, allFuncs) {
    const ENUM_DEFAULTS = {
        SVL: '"SVL-4"', RootCause: '"F01"', BranchReason: '"repair_attempt"',
        RepairStrategy: '"insert"', ConstraintType: '"protocol"',
    };
    return funcs.map((f) => {
        const params = (f.params || []).map((p) => {
            const t = (p.type || "any").replace(/\[\]$/, "");
            const def = ENUM_DEFAULTS[t];
            return def ? `${p.name}: ${def}` : `${p.name}: ${p.type}`;
        }).join(",");
        let line = `${f.name}(${params})->${f.returnType || "any"}`;
        const meta = [];
        if (f.score && f.score > 0)
            meta.push(`★${f.score.toFixed(1)}`);
        if (f.purpose)
            meta.push(f.purpose.slice(0, 50));
        if (f.produces && f.produces.length > 0)
            meta.push(`→${f.produces.join(",")}`);
        if (meta.length > 0)
            line += `  // ${meta.join(" | ")}`;
        return line;
    }).join("\n");
}
/** Semantic matching: check if two capability labels are related via SemanticTopology. */
export function semanticMatch(a, b) {
    try {
        const topo = getTopology();
        if (topo.size > 0)
            return topo.capabilityMatch(a, b);
    }
    catch { /* topology rebuild — optional */ }
    if (a === b)
        return true;
    if (a.includes(b) || b.includes(a))
        return true;
    return false;
}
/** Build capability chain hints: producer→consumer relationships using semantic matching. */
export function buildChainHints(funcs) {
    const chains = [];
    const seen = new Set();
    for (const f of funcs) {
        if (!f.produces)
            continue;
        for (const p of f.produces) {
            const consumers = funcs.filter((x) => x.name !== f.name &&
                (x.requires || []).some((r) => semanticMatch(p, r)));
            for (const c of consumers) {
                const key = `${f.name}→${c.name}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                const matchedReq = (c.requires || []).find((r) => semanticMatch(p, r));
                chains.push(`${f.name}()→${c.name}()  // ${p} ≈ ${matchedReq || "?"}`);
            }
        }
    }
    if (chains.length === 0)
        return "";
    return "\n推荐调用链（先调生产者，用 $变量名 传给消费者）:\n" + chains.map(c => `  ${c}`).join("\n");
}
/** Build protocol constraint hints for the LLM prompt. */
export function buildProtocolChainHint(protocols) {
    if (protocols.length === 0)
        return "";
    const byNs = new Map();
    for (const p of protocols) {
        const ns = p.protocol.namespace || "_global";
        if (!byNs.has(ns))
            byNs.set(ns, []);
        byNs.get(ns).push(p);
    }
    const lines = ["\n⚠️ 协议约束（必须严格遵循调用顺序）:"];
    for (const [ns, fns] of byNs) {
        if (ns === "_global" || fns.length <= 1)
            continue;
        lines.push(`  [${ns}] 合法调用链: ${fns.map(p => p.function).join(" → ")}`);
        for (const p of fns) {
            const pre = p.protocol.pre_states?.join(",") || "(无)";
            const post = p.protocol.post_states?.join(",") || "(无)";
            lines.push(`    ${p.function}: 前置状态=[${pre}] → 后置状态=[${post}]`);
        }
    }
    return lines.join("\n");
}
