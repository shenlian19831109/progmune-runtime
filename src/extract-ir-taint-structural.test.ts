/**
 * 污点标记管线三处结构性修复（C1/C2/C3）的定向回归（2026-09-19）。
 *
 * 立项背景：这三处是从「污点源数据流试点 V1」里拆出来的**正确性修复**——
 * 它们让标记管线对真实 TS 工程「看得见」，但不改变判别逻辑（判别力是 G1
 * PATH_GUARD_EVIDENCE 的事，另一个条目）。
 *
 * 为什么必须有本文件（重要）：
 *   TS 795 盲测对这三处【零覆盖】——实测把整份 generated 语料重跑后，
 *   per-function calls 差异 0、__progmune 标记 826 vs 826、flags 3086 LOST 0/ADDED 0。
 *   即「TS 795 零漂移」在这里是**空过**（vacuous pass）：它不是说这三处没风险，
 *   而是说盲测语料根本走不到这些分支。因此真正的门是本文件的定向用例。
 *
 * 三处修复：
 *   C3 UNTRUSTED_ROOTS   —— 污点根由「Express 专属变量名」改为「按传输面声明」
 *   C1 methodSinkParamMap—— 除类方法外，纳入**顶层函数**的 sink 形参
 *   C2 directCallRe      —— 跨函数传播除成员调用外，识别**裸调用** func(x)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-taint-struct-"));
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

function marksFor(dir: string, fnName: string): string[] {
  const fns = extractIR(dir);
  const f = fns.find((x) => x.name === fnName);
  return f ? (f.calls ?? []) : [];
}

const PATH_MARK = "__progmune_path_traversal__";

describe("C3：污点根按传输面声明（不再只认 Express 的 req.*）", () => {
  it(
    "Express 形态仍必须标记（不得因改表回归）",
    () => {
      const dir = makeProject({
        "legacy.ts": `
import * as fs from "fs";
export function read(req: any) {
  const name = req.params.name;
  return fs.readFileSync("/data/" + name, "utf-8");
}
`,
      });
      try {
        expect(marksFor(dir, "read")).toContain(PATH_MARK);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000
  );

  it(
    "MCP 工具实参 params.arguments 作为根（fr-012 形态）",
    () => {
      const dir = makeProject({
        "mcp.ts": `
import * as fs from "fs";
export function uploadMarkdown(args: any) {
  const filePath = params.arguments.file_path;
  return fs.readFileSync(filePath, "utf-8");
}
`,
      });
      try {
        expect(marksFor(dir, "uploadMarkdown")).toContain(PATH_MARK);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000
  );

  it(
    "反例：常量路径不得标记（防止根表放宽后过度标记）",
    () => {
      const dir = makeProject({
        "benign.ts": `
import * as fs from "fs";
export function readDocs() {
  return fs.readFileSync("/data/terms.md", "utf-8");
}
`,
      });
      try {
        expect(marksFor(dir, "readDocs")).not.toContain(PATH_MARK);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000
  );
});

describe("C1：顶层函数的 sink 形参必须入表（此前只登记类方法）", () => {
  it(
    "顶层函数 + 污点实参 → 跨函数传导后被标记",
    () => {
      const dir = makeProject({
        "handler.ts": `
import * as fs from "fs";
export function markdownUpload(filePath: string) {
  return fs.readFileSync(filePath, "utf-8");
}
export function dispatchTool(args: any) {
  const target = params.arguments.file_path;
  return markdownUpload(target);
}
`,
      });
      try {
        expect(marksFor(dir, "markdownUpload")).toContain(PATH_MARK);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000
  );
});

describe("C2：裸调用形态的跨函数传播（此前只匹配 obj.sink(...)）", () => {
  it(
    "顶层函数被裸调用且传入污点 → 标记（fr-012 的 markdownUpload 形态）",
    () => {
      const dir = makeProject({
        "store.ts": `
import * as fs from "fs";
export function save(name: string, content: string) {
  fs.writeFileSync("/flows/" + name, content);
}
`,
        "route.ts": `
import { save } from "./store";
export function createFlow(req: any) {
  const name = req.body.name;
  save(name, "{}");
}
`,
      });
      try {
        expect(marksFor(dir, "createFlow")).toContain(PATH_MARK);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000
  );

  it(
    "反例：给裸调用传常量不得标记",
    () => {
      const dir = makeProject({
        "store.ts": `
import * as fs from "fs";
export function save(name: string, content: string) {
  fs.writeFileSync("/flows/" + name, content);
}
`,
        "route.ts": `
import { save } from "./store";
export function seedFlow() {
  save("default.json", "{}");
}
`,
      });
      try {
        expect(marksFor(dir, "seedFlow")).not.toContain(PATH_MARK);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000
  );
});
