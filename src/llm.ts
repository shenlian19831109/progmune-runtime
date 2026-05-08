import OpenAI from "openai";
const apiKey = process.env.LLM_API_KEY || "sk-xxxx";
const baseURL = process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";
const model = process.env.LLM_MODEL || "deepseek-chat";
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
