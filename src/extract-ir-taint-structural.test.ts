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

/**
 * C5（2026-09-19）：不可信根**直接写在 sink 实参里**（无中间变量）此前不标记。
 *
 * 发现途径：新建的 blind-benchmark taintpath 语料族里有两条最朴素的用例
 * （`readFileSync("/d/" + req.params.name)`、模板字符串形态）跑出「不标记」。
 * 根因是外层 `tainted.size > 0` 的闸门——而 SSRF 侧从来不要求中间变量。
 *
 * 按 R6：**每条「不得标记」都要配正对照**。这里的负对照是同形状无污点的常量路径。
 */
describe("C5：内联不可信根（不经中间变量）必须标记", () => {
  const cases: Array<{ name: string; fn: string; code: string; expectMark: boolean; why: string }> = [
    {
      name: "字符串拼接直连",
      fn: "readInline",
      code: `export function readInline(req: any) {
  return fs.readFileSync("/srv/data/" + req.params.name, "utf-8");
}`,
      expectMark: true,
      why: "真实 Express 工程最常见的写法",
    },
    {
      name: "模板字符串直连",
      fn: "readTemplate",
      code: "export function readTemplate(req: any) {\n  return fs.readFileSync(`/srv/data/${req.query.name}`, \"utf-8\");\n}",
      expectMark: true,
      why: "query 根 + 模板插值",
    },
    {
      name: "写侧 header 根",
      fn: "writeHeader",
      code: `export function writeHeader(request: any, data: any) {
  return fs.writeFileSync("/srv/data/" + request.headers["x-name"], data);
}`,
      expectMark: true,
      why: "写 sink + request.headers 根",
    },
    {
      name: "MCP 实参直连",
      fn: "writeMcp",
      code: `export function writeMcp(params: any, data: any) {
  return fs.writeFileSync(params.arguments.path, data);
}`,
      expectMark: true,
      why: "传输面里的第二个根：MCP 工具实参",
    },
    {
      name: "负对照：常量路径不得标记",
      fn: "readConstant",
      code: `export function readConstant() {
  return fs.readFileSync("/srv/data/index.html", "utf-8");
}`,
      expectMark: false,
      why: "R6：证明前面的用例不是靠「只要有 fs sink 就标记」蒙对",
    },
    {
      name: "负对照：有守卫时内联根仍不标记",
      fn: "readInlineGuarded",
      code: `export function readInlineGuarded(req: any) {
  const target = path.resolve("/srv/data", req.params.name);
  if (!target.startsWith("/srv/data")) throw new Error("outside");
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: false,
      why: "C5 只补召回，不得绕过 G1 的判别力",
    },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject({ "a.ts": `import * as fs from "fs";\nimport * as path from "path";\n\n${c.code}\n` });
      try {
        const marks = marksFor(dir, c.fn);
        if (c.expectMark) expect(marks).toContain(PATH_MARK);
        else expect(marks).not.toContain(PATH_MARK);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 150_000);
  }
});

// ═══════════════════════════════════════════════════════════════
// C4（2026-09-19）：污点经「路径塑形表达式」包装后仍应传播
//
// 缺口实证：taintpath_A 的 readBasename / readResolveOnly / readJoinWrapped /
// readNormalizeWrapped 四条，语义上应标记、实测不标记 —— 传播只认 `x = <污点>`
// 直赋，而 `path.join/resolve/normalize/basename` 是真实工程构造路径的**默认
// 写法**，这条断链等于把最常见的形态整片漏掉。
//
// 政策是**白名单传播**：只经 path.* 家族与保值的字符串方法传播，认不出的调用
// 不传播。于是 `const safe = sanitizeName(p)` 天然不污染 —— 未知函数默认站在
// 精度一侧。代价是项目自有 helper（buildPath(p)）仍不传播（缺口 C4b）。
// ═══════════════════════════════════════════════════════════════
describe("C4：污点经路径塑形表达式包装后仍传播", () => {
  const cases: Array<{
    name: string;
    fn: string;
    code: string;
    expectMark: boolean;
    why: string;
  }> = [
    {
      name: "path.join 包装",
      fn: "readJoin",
      code: `export function readJoin(req: any) {
  const target = path.join("/data", req.params.name);
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: true,
      why: "最基础的塑形包装：join(root, taint) 不得断链",
    },
    {
      name: "path.normalize 包装",
      fn: "readNormalize",
      code: `export function readNormalize(req: any) {
  const target = path.normalize(req.params.name);
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: true,
      why: "normalize 只规范化、不改变来源",
    },
    {
      name: "path.basename 包装（N-A）",
      fn: "readBasename",
      code: `export function readBasename(req: any) {
  const name = path.basename(req.params.name);
  return fs.readFileSync("/data/" + name, "utf-8");
}`,
      expectMark: true,
      why: "N-A：basename 不算守卫（fr-012 pre 实测反例），包装后污点仍须流动",
    },
    {
      name: "resolve 无包含性比较（N-C）",
      fn: "readResolveOnly",
      code: `export function readResolveOnly(req: any) {
  const base = path.resolve("/data");
  const target = path.resolve(base, req.params.name);
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: true,
      why: "N-C：只有 resolve、没有 startsWith(base) 比较，不算守卫",
    },
    {
      name: "链式两跳塑形",
      fn: "readChained",
      code: `export function readChained(req: any) {
  const norm = path.normalize(req.params.dir);
  const target = path.join(norm, "index.html");
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: true,
      why: "fr-012 下载侧就是这个形状：normalize → join 两跳，须接上",
    },
    {
      name: "模板字面量拼接",
      fn: "readTemplate",
      code: `export function readTemplate(req: any) {
  const target = \`/data/\${req.params.name}\`;
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: true,
      why: "模板字面量只塑形、不改来源",
    },
    {
      name: "字符串方法 trim（须先经 C4 才能到这一步）",
      fn: "readTrim",
      // 注意形态：不能写成 `const n = req.params.name.trim()` —— 那样根就在
      // 开头、旧版也能标记，用例就失去判别力了（反向验证时实测通过，白锁一场）。
      // 必须先经一次塑形调用，trim 才是 C4 链条上的第二跳。
      code: `export function readTrim(req: any) {
  const normalized = path.normalize(req.params.name);
  const trimmed = normalized.trim();
  return fs.readFileSync("/data/" + trimmed, "utf-8");
}`,
      expectMark: true,
      why: "保值的字符串方法不得断链；本条同时验证 C4 的迭代（normalize → trim 两跳）",
    },
    // ── 负向：每一条都有同形状的正对照（方法学规则 R6）──
    {
      name: "负对照：守卫仍在（startsWith(base) 形态）",
      fn: "readGuardWithinBase",
      code: `export function readGuardWithinBase(req: any) {
  const base = path.resolve("/data");
  const target = path.resolve(base, req.params.name);
  if (!target.startsWith(base)) throw new Error("outside");
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: false,
      why: "正对照 = readResolveOnly（同形状去掉 startsWith 必须重新报出）",
    },
    {
      name: "负对照：常量路径不因塑形而标记",
      fn: "readConstantJoin",
      code: `export function readConstantJoin() {
  const target = path.join("/data", "index.html");
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: false,
      why: "正对照 = readJoin（把 \"index.html\" 换成 req.params.name 必须报出）",
    },
    {
      name: "负对照：未知 helper 不传播（白名单的精度代价，缺口 C4b）",
      fn: "readUnknownHelper",
      code: `function buildPath(name: string): string {
  return "/data/" + name;
}
export function readUnknownHelper(req: any) {
  const target = buildPath(req.params.name);
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: false,
      why: "白名单外一律不传播（精度优先）；正对照 = readJoin 必须报出",
    },
    {
      name: "负对照：净化函数不传播",
      fn: "readSanitized",
      code: `function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "");
}
export function readSanitized(req: any) {
  const safe = sanitizeName(req.params.name);
  return fs.readFileSync("/data/" + safe, "utf-8");
}`,
      expectMark: false,
      why: "未知（疑似净化）调用默认不传播——这是白名单相对黑名单的决定性优势",
    },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject({ "a.ts": `import * as fs from "fs";\nimport * as path from "path";\n\n${c.code}\n` });
      try {
        const marks = marksFor(dir, c.fn);
        if (c.expectMark) expect(marks).toContain(PATH_MARK);
        else expect(marks).not.toContain(PATH_MARK);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 150_000);
  }
});
