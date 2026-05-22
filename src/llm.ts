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

export async function generate(prompt: string): Promise<string> {
  callCount++;
  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
  });
  return resp.choices[0]?.message?.content || "";
}
