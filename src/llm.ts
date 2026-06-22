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

// ── API Key validation ──
const KNOWN_KEY_PREFIXES: Record<string, string> = {
  "ghp_":        "GitHub Personal Access Token (classic)",
  "github_pat_": "GitHub Personal Access Token (fine-grained)",
  "glpat-":      "GitLab Personal Access Token",
  "sk-xxxx":     "placeholder / default value",
  "your-key":    "placeholder / default value",
};

function validateApiKey(key: string): string[] {
  const warnings: string[] = [];
  if (!key || key === "sk-xxxx" || key === "your-key") {
    warnings.push("❌ LLM_API_KEY is not set or is a placeholder. Configure via .env: LLM_API_KEY=your-deepseek-key");
    return warnings;
  }
  for (const [prefix, label] of Object.entries(KNOWN_KEY_PREFIXES)) {
    if (key.startsWith(prefix)) {
      warnings.push(`⚠️  LLM_API_KEY looks like a ${label} (prefix: "${prefix}"), not an LLM API key. DeepSeek keys start with "sk-". Get one at https://platform.deepseek.com/api_keys`);
      break;
    }
  }
  if (key.length < 20) {
    warnings.push(`⚠️  LLM_API_KEY is unusually short (${key.length} chars). Most API keys are 30+ characters.`);
  }
  return warnings;
}

const keyWarnings = validateApiKey(apiKey);
for (const w of keyWarnings) {
  console.error(w);
}

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

// ── Verbose debug logging ──
const VERBOSE = process.env.PROGMUNE_VERBOSE === "1";
function vlog(label: string, content: string, maxLen = 2000): void {
  if (!VERBOSE) return;
  const truncated = content.length > maxLen
    ? content.slice(0, maxLen) + `\n... [truncated, ${content.length} total chars]`
    : content;
  console.error(`\n${"═".repeat(60)}\n🔍 [VERBOSE] ${label}\n${"─".repeat(60)}\n${truncated}\n${"═".repeat(60)}`);
}

export function isVerbose(): boolean { return VERBOSE; }

/** @requires PROMPT @produces LLM_RESPONSE */
export async function generate(prompt: string): Promise<string> {
  assertCallLimit();
  await applyRateLimit();
  callCount++;
  lastCallTime = Date.now();
  vlog(`LLM Call #${callCount} (generate) | Model: ${model} | Prompt (${estimateTokens(prompt)} est. tokens)`, prompt);
  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
  });
  const content = resp.choices[0]?.message?.content || "";
  vlog(`LLM Response #${callCount} (${estimateTokens(content)} est. tokens, finish=${resp.choices[0]?.finish_reason})`, content);
  return content;
}

/** 带 system prompt 的调用：静态规则放 system，动态内容放 user，语义分离便于未来对接各平台缓存策略 */
/** @requires SYSTEM_PROMPT @produces LLM_RESPONSE */
export async function chat(systemPrompt: string, userPrompt: string): Promise<string> {
  assertCallLimit();
  await applyRateLimit();
  callCount++;
  lastCallTime = Date.now();
  const totalTokens = estimateTokens(systemPrompt) + estimateTokens(userPrompt);
  vlog(`LLM Call #${callCount} (chat) | Model: ${model} | System (${estimateTokens(systemPrompt)}t) + User (${estimateTokens(userPrompt)}t) = ${totalTokens} est. tokens`,
    `── SYSTEM ──\n${systemPrompt}\n── USER ──\n${userPrompt}`);
  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.0,
  });
  const content = resp.choices[0]?.message?.content || "";
  vlog(`LLM Response #${callCount} (${estimateTokens(content)} est. tokens, finish=${resp.choices[0]?.finish_reason})`, content);
  return content;
}
