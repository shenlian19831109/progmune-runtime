/**
 * SSRF 标记提取的死循环回归（2026-09-18，P0）。
 *
 * 根因：computeMarkerCalls 的 SSRF 分支对一个**无 `g` 标志**的正则
 * TS_HTTP_FETCH_SINK 做 while-exec 迭代。非全局正则的 exec() 忽略
 * lastIndex 并恒返回首个匹配，因此只要首个 fetch 调用后的 300 字符窗口
 * 内不含污点——真实代码里最常见的「良性 fetch」形态——循环就没有出口，
 * 提取阶段 100% CPU 死循环。CPU 采样佐证：2193/2193 采样全部落在
 * Builtins_RegExpPrototypeExec。
 *
 * 影响面：任何含 `fetch(` 且函数体内无 SSRF 守卫词汇的 TS 工程都会挂死
 * 提取阶段（实测 nuxt og-image、tinacms、gitlab-mcp 三个独立仓库均触发）。
 *
 * 本文件锁定两端：
 *   1. 良性 fetch 必须正常返回（修复前永不返回）；
 *   2. 真正的 SSRF 污点仍必须注入 __progmune_ssrf_user_url__（修复不得削弱检出）。
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIR } from "./extract-ir";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    module: "commonjs",
    moduleResolution: "node",
    strict: false,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["**/*.ts"],
});

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ssrf-loop-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", private: true })
  );
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

describe("SSRF 标记提取：良性 fetch 不得使提取器死循环", () => {
  it(
    "无守卫词汇、无污点的 fetch 调用应正常完成提取",
    () => {
      const dir = makeProject({
        "api.ts": `
export async function ping(): Promise<any> {
  const response = await fetch("https://x.example/uploads", { method: "POST" });
  return response.json();
}

export async function pong(): Promise<any> {
  return fetch("https://x.example/other");
}
`,
      });
      try {
        const fns = extractIR(dir);
        const names = fns.map((f) => f.name);
        expect(names).toContain("ping");
        expect(names).toContain("pong");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000
  );

  it(
    "URL 形参直接流入 fetch 仍应注入 __progmune_ssrf_user_url__",
    () => {
      const dir = makeProject({
        "proxy.ts": `
export async function proxy(target: string): Promise<any> {
  const response = await fetch(target);
  return response;
}
`,
      });
      try {
        const fns = extractIR(dir);
        const proxy = fns.find((f) => f.name === "proxy");
        expect(proxy).toBeDefined();
        expect(proxy!.calls ?? []).toContain("__progmune_ssrf_user_url__");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000
  );
});
