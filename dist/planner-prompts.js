"use strict";
/**
 * Phase 6C: Planner — Prompt Builder
 *
 * Builds the LLM system prompt and formats IR function lists,
 * capability chains, and protocol constraints for the planner.
 *
 * Extracted from planner.ts to keep the main planning module focused.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETRY_HINT = exports.SYSTEM_PROMPT = void 0;
exports.buildCompactFuncList = buildCompactFuncList;
exports.semanticMatch = semanticMatch;
exports.buildChainHints = buildChainHints;
exports.buildProtocolChainHint = buildProtocolChainHint;
const semantic_topology_1 = require("./semantic-topology");
// ── Constants ──
exports.SYSTEM_PROMPT = `你是程序合成助手。只输出 JSON 数组，不输出解释。

格式：[{"f":"函数名","to":"变量名","a":[{"n":"参数名","t":"类型","v":值}]},{"r":"变量名"}]

链式调用（最重要！读完再写）：
  前面的 call 产生了 to="sessions"，后面的 call 用 "v":"$sessions" 引用，形成链条。

  示例——3步链：
    {"f":"getAllSessions","to":"sessions","a":[]}
    {"f":"countSessionsWithViolations","to":"v","a":[{"n":"sessions","t":"any[]","v":"$sessions"}]}
    {"f":"suggestRepairs","to":"r","a":[{"n":"violations","t":"ConstraintViolation[]","v":"$v"}]}
    {"r":"r"}
  注意：countSessionsWithViolations 用 $sessions 引用上一步的结果；suggestRepairs 用 $v 引用再上一步。

铁律：
  - 必须用 $变量名 把前一步的输出传给下一步！禁止写 "" 或 [] 作为参数值！
  - 每个 "t" 字段必须原样使用函数签名中的类型——如果有 [] 就必须保留（如 "t":"ConstraintViolation[]"）
  - 每个 call 用 "to" 命名变量，下一个 call 通过 "$变量名" 引用
  - 0 参数函数用 "a":[]，非 0 参数函数绝对不能 "a":[]
  - 最后一个 action 必须是 {"r":"变量名"}
  - 只输出 JSON，不输出解释`;
exports.RETRY_HINT = `输出格式：紧凑 JSON 数组 [{"f":"函数名","to":"变量名","a":[...]}]`;
// ── Formatters ──
/** Build a compact function list with parameter examples for LLM precision. */
function buildCompactFuncList(funcs, allFuncs) {
    // 语义 marker（__progmune_*，提取器注入供规则消费）不是真实可调用函数——
    // 不出现在 LLM 可见函数列表中，防止被生成成真实调用导致编译失败
    funcs = funcs.filter((f) => !String(f.name || "").startsWith("__progmune_"));
    // Example values for each type — helps LLM fill meaningful args
    function exampleValue(type, paramName) {
        const t = (type || "any").replace(/\[\]$/, "").toLowerCase();
        if (t === "string" || t === "str")
            return `"${paramName}"`;
        if (t === "number" || t === "int" || t === "float")
            return paramName === "limit" ? "10" : "1";
        if (t === "boolean" || t === "bool")
            return "false";
        if (t === "any" || t === "object")
            return "{}";
        if (t === "void" || t === "undefined" || t === "null")
            return "null";
        // Known enum types
        if (t === "svl")
            return '"SVL-4"';
        if (t === "rootcause")
            return '"F01"';
        if (t === "branchreason")
            return '"repair_attempt"';
        if (t === "repairstrategy")
            return '"insert"';
        if (t === "constrainttype")
            return '"protocol"';
        if (t.endsWith("[]"))
            return "[]";
        if (t.startsWith("map<"))
            return "new Map()";
        if (t.startsWith("set<"))
            return "new Set()";
        return `{} as ${type}`;
    }
    return funcs.map((f) => {
        const params = (f.params || []).map((p) => {
            const t = p.type || "any";
            const ex = exampleValue(t, p.name || "arg");
            return `${p.name}: ${t} = ${ex}`;
        }).join(", ");
        let line = `${f.name}(${params}) → ${f.returnType || "any"}`;
        const meta = [];
        if (f.score && f.score > 0)
            meta.push(`★${f.score.toFixed(1)}`);
        if (f.purpose)
            meta.push(f.purpose.slice(0, 60));
        if (f.produces && f.produces.length > 0)
            meta.push(`→${f.produces.join(",")}`);
        if (meta.length > 0)
            line += `  // ${meta.join(" | ")}`;
        return line;
    }).join("\n");
}
/** Semantic matching: check if two capability labels are related via SemanticTopology. */
function semanticMatch(a, b) {
    try {
        const topo = (0, semantic_topology_1.getTopology)();
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
function buildChainHints(funcs) {
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
function buildProtocolChainHint(protocols) {
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
