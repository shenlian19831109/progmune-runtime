"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callCount = void 0;
exports.resetCallCount = resetCallCount;
exports.estimateTokens = estimateTokens;
exports.generate = generate;
exports.chat = chat;
try {
    require("dotenv/config");
}
catch { }
const openai_1 = __importDefault(require("openai"));
const provider = process.env.LLM_PROVIDER || "deepseek";
const configs = {
    deepseek: {
        baseURL: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
    },
    openai: {
        baseURL: "https://api.openai.com/v1",
        model: "gpt-4",
    },
    ollama: {
        baseURL: "http://localhost:11434/v1",
        model: "llama3",
    },
};
const selected = configs[provider] || configs.deepseek;
const apiKey = process.env.LLM_API_KEY || "sk-xxxx";
const baseURL = process.env.LLM_BASE_URL || selected.baseURL;
const model = process.env.LLM_MODEL || selected.model;
const client = new openai_1.default({ apiKey, baseURL });
exports.callCount = 0;
function resetCallCount() { exports.callCount = 0; }
/** 粗略 token 估算：CJK 字符 ~1.5 token/字，其余 ~0.4 token/字符 */
/** @requires TEXT @produces TOKEN_COUNT */
function estimateTokens(text) {
    const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    const other = text.length - cjk;
    return Math.ceil(cjk * 1.5 + other * 0.4);
}
/** @requires PROMPT @produces LLM_RESPONSE */
async function generate(prompt) {
    exports.callCount++;
    const resp = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.0,
    });
    return resp.choices[0]?.message?.content || "";
}
/** 带 system prompt 的调用：静态规则放 system，动态内容放 user，语义分离便于未来对接各平台缓存策略 */
/** @requires SYSTEM_PROMPT @produces LLM_RESPONSE */
async function chat(systemPrompt, userPrompt) {
    exports.callCount++;
    const resp = await client.chat.completions.create({
        model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        temperature: 0.0,
    });
    return resp.choices[0]?.message?.content || "";
}
