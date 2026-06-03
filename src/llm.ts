try { require("dotenv/config"); } catch { /* ignore — dotenv is optional */ }

import OpenAI from "openai";

const provider = process.env.LLM_PROVIDER || "deepseek";

const configs: Record<string, { baseURL: string; model: string }> = {
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

const client = new OpenAI({ apiKey, baseURL });

export let callCount = 0;
export function resetCallCount() { callCount = 0; }

const MAX_LLM_CALLS = parseInt(process.env.PROGMUNE_MAX_LLM_CALLS || "50", 10);
const RATE_LIMIT_MS = parseInt(process.env.PROGMUNE_RATE_LIMIT_MS || "0", 10);
let lastCallTime = 0;

function assertCallLimit(): void {
  if (callCount >= MAX_LLM_CALLS) {
    throw new Error(
      `LLM call limit reached (${callCount}/${MAX_LLM_CALLS}). ` +
      `Increase via PROGMUNE_MAX_LLM_CALLS env var or call resetCallCount().`
    );
  }
}

async function applyRateLimit(): Promise<void> {
  if (RATE_LIMIT_MS <= 0) return;
  const elapsed = Date.now() - lastCallTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
}

/** 粗略 token 估算：CJK 字符 ~1.5 token/字，其余 ~0.4 token/字符 */
/** @requires TEXT @produces TOKEN_COUNT */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.5 + other * 0.4);
}

/** @requires PROMPT @produces LLM_RESPONSE */
export async function generate(prompt: string): Promise<string> {
  assertCallLimit();
  await applyRateLimit();
  callCount++;
  lastCallTime = Date.now();
  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
  });
  return resp.choices[0]?.message?.content || "";
}

/** 带 system prompt 的调用：静态规则放 system，动态内容放 user，语义分离便于未来对接各平台缓存策略 */
/** @requires SYSTEM_PROMPT @produces LLM_RESPONSE */
export async function chat(systemPrompt: string, userPrompt: string): Promise<string> {
  assertCallLimit();
  await applyRateLimit();
  callCount++;
  lastCallTime = Date.now();
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
