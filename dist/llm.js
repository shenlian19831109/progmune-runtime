"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callCount = void 0;
exports.resetCallCount = resetCallCount;
exports.generate = generate;
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
async function generate(prompt) {
    exports.callCount++;
    const resp = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.0,
    });
    return resp.choices[0]?.message?.content || "";
}
