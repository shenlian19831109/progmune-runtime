"use strict";
/**
 * P2: Lightweight Intent Parser
 *
 * Converts natural language goals to structured tuples:
 *   Goal → (initialState, targetState, constraints)
 *
 * Uses LLM few-shot for primary extraction, keyword fallback as backup.
 * Does NOT need 100% accuracy — Protocol VM will validate downstream.
 *
 * @requires USER_INTENT @produces STRUCTURED_GOAL
 */
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
exports.parseGoal = parseGoal;
exports.parseGoalSync = parseGoalSync;
const llm_1 = require("./llm");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ═══════════════════════════════════════════════════════════════
// Known protocols (from protocols.json for keyword fallback)
// ═══════════════════════════════════════════════════════════════
function loadKnownProtocols() {
    const protoPath = path.resolve(__dirname, "..", "protocols.json");
    if (!fs.existsSync(protoPath))
        return new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
        const map = new Map();
        for (const [fn, rule] of Object.entries(raw)) {
            const ns = rule.namespace || "_global";
            if (!map.has(ns))
                map.set(ns, []);
            map.get(ns).push({
                pre_states: rule.pre_states || [],
                post_states: rule.post_states || [],
            });
        }
        return map;
    }
    catch {
        return new Map();
    }
}
const KNOWN_PROTOCOLS = loadKnownProtocols();
// ═══════════════════════════════════════════════════════════════
// Few-shot LLM extraction
// ═══════════════════════════════════════════════════════════════
const FEWSHOT_PROMPT = `You are a protocol state extractor. Given a natural language goal, output a JSON object with:
{
  "protocol": "<namespace or domain of the goal>",
  "initialState": ["<state1>", "<state2>"],
  "targetState": ["<state1>", "<state2>"],
  "constraints": [
    { "type": "safety|latency|retry|security|maintainability", "value": <0-1 weight>, "description": "<reason>" }
  ]
}

Examples:

Goal: "实现一个安全的文件写入，如果失败要重试3次"
Output: {"protocol":"FileProtocol","initialState":["Closed"],"targetState":["Closed"],"constraints":[{"type":"retry","value":0.9,"description":"失败要重试3次"},{"type":"safety","value":0.8,"description":"安全写入"}]}

Goal: "处理一笔支付，需要审核后才能执行"
Output: {"protocol":"TransactionProtocol","initialState":["Pending"],"targetState":["Settled"],"constraints":[{"type":"safety","value":0.95,"description":"先审核后执行"},{"type":"security","value":0.9,"description":"审核流程"}]}

Goal: "打开数据库连接，执行查询，关闭连接"
Output: {"protocol":"DatabaseProtocol","initialState":["Disconnected"],"targetState":["Disconnected"],"constraints":[{"type":"latency","value":0.6,"description":"执行查询"},{"type":"safety","value":0.7,"description":"关闭连接防止泄漏"}]}

Now parse this goal:
`;
async function parseWithLLM(goal) {
    try {
        const response = await (0, llm_1.generate)(FEWSHOT_PROMPT + `Goal: "${goal}"\nOutput:`);
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            return null;
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            protocol: parsed.protocol || "default",
            initialState: parsed.initialState || ["INIT"],
            targetState: parsed.targetState || ["COMPLETED"],
            constraints: (parsed.constraints || []).map((c) => ({
                type: c.type || "safety",
                value: Math.min(1, Math.max(0, c.value || 0.5)),
                description: c.description || "",
            })),
            source: "llm",
        };
    }
    catch {
        return null;
    }
}
// ═══════════════════════════════════════════════════════════════
// Keyword fallback
// ═══════════════════════════════════════════════════════════════
const KEYWORD_MAP = [
    [/文件|file|write|read|open|close/i, { protocol: "FileProtocol", initialState: ["Closed"], targetState: ["Closed"] }],
    [/交易|transaction|支付|payment|转账|transfer/i, { protocol: "TransactionProtocol", initialState: ["Pending"], targetState: ["Settled"] }],
    [/数据库|database|db|sql|query|连接|connection/i, { protocol: "DatabaseProtocol", initialState: ["Disconnected"], targetState: ["Disconnected"] }],
    [/认证|登录|login|auth|session|token/i, { protocol: "AuthProtocol", initialState: ["LoggedOut"], targetState: ["LoggedOut"] }],
    [/审核|审批|approval|review|workflow/i, { protocol: "ApprovalProtocol", initialState: ["Draft"], targetState: ["Approved"] }],
    [/队列|queue|消息|message|event|pub.*sub/i, { protocol: "QueueProtocol", initialState: ["Idle"], targetState: ["Processed"] }],
    [/加密|encrypt|解密|decrypt|密钥|key/i, { protocol: "EncryptionProtocol", initialState: ["Unlocked"], targetState: ["Locked"] }],
];
function parseByKeyword(goal) {
    for (const [regex, template] of KEYWORD_MAP) {
        if (regex.test(goal)) {
            return {
                protocol: template.protocol || "default",
                initialState: template.initialState || ["INIT"],
                targetState: template.targetState || ["COMPLETED"],
                constraints: extractConstraintsFromGoal(goal),
                source: "keyword",
            };
        }
    }
    // Default fallback
    return {
        protocol: "default",
        initialState: ["INIT"],
        targetState: ["COMPLETED"],
        constraints: extractConstraintsFromGoal(goal),
        source: "keyword",
    };
}
function extractConstraintsFromGoal(goal) {
    const constraints = [];
    if (/重试|retry|重来|再试/i.test(goal)) {
        const match = goal.match(/(\d+)\s*次/);
        constraints.push({
            type: "retry",
            value: 0.9,
            description: `失败重试${match ? match[1] : 'N'}次`,
        });
    }
    if (/安全|安全地|secure|safe|保护|protect/i.test(goal)) {
        constraints.push({ type: "safety", value: 0.8, description: "安全要求" });
    }
    if (/快|性能|高效|fast|quick|speed|latency/i.test(goal)) {
        constraints.push({ type: "latency", value: 0.7, description: "性能优先" });
    }
    if (/审核|审批|检查|验证|verify|approve/i.test(goal)) {
        constraints.push({ type: "security", value: 0.85, description: "需要审核" });
    }
    if (/可维护|可读|clean|readable|maintain/i.test(goal)) {
        constraints.push({ type: "maintainability", value: 0.6, description: "可维护性" });
    }
    return constraints;
}
// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════
/**
 * Parse a natural language goal into a structured goal tuple.
 * Tries LLM first, falls back to keyword matching.
 */
async function parseGoal(goal) {
    // Try LLM
    try {
        const llmResult = await parseWithLLM(goal);
        if (llmResult)
            return llmResult;
    }
    catch {
        // LLM unavailable — use keyword fallback
    }
    return parseByKeyword(goal);
}
/**
 * Synchronous keyword-only parser (safe for non-async contexts).
 */
function parseGoalSync(goal) {
    return parseByKeyword(goal);
}
// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
    const goal = process.argv[2] || "实现一个安全的文件写入，如果失败要重试3次";
    parseGoal(goal).then(result => {
        console.log(JSON.stringify(result, null, 2));
    });
}
