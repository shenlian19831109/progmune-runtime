"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callCount = void 0;
exports.resetCallCount = resetCallCount;
exports.generate = generate;
const openai_1 = __importDefault(require("openai"));
const apiKey = process.env.LLM_API_KEY || "sk-xxxx";
const baseURL = process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";
const model = process.env.LLM_MODEL || "deepseek-chat";
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
