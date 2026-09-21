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
      // 2026-09-20 由负对照翻正：C4b 上线后，helper 的函数体可证明为纯塑形
      // （无调用、自由标识符只有形参 name）⇒ 污点穿过它。此前这条是登记在册的
      // 缺口 C4b，翻正说明缺口闭合，不是断言写错。
      name: "helper 可证明为纯塑形 ⇒ 传播（C4b，3.7.39）",
      fn: "readUnknownHelper",
      code: `function buildPath(name: string): string {
  return "/data/" + name;
}
export function readUnknownHelper(req: any) {
  const target = buildPath(req.params.name);
  return fs.readFileSync(target, "utf-8");
}`,
      expectMark: true,
      why: "判据三条全中（有形参 / 有带表达式的 return / 体内无 sink / 自由标识符只有形参）；负对照 = readSanitized",
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


// ═══════════════════════════════════════════════════════════════
// fr-016 两处断点（2026-09-19，3.7.38）
//
// 真实修复语料 fr-016（Redocly/redocly-cli split 命令）在连续三轮票据
// （C4 塑形传播 → G2 调用点抑制 → fr-016）之后仍然 pre 0 / post 0。
// 逐点拆开才发现流量断在**两个独立缺陷**上，两侧对称：
//   ① 来源侧：污点根表里没有「外部文档」。文档本体由上游 parseYaml 解析好后
//      作为形参传入（`channels: Record<string, any>`），函数体内唯一可见的入口
//      就是 `for (const channelName of Object.keys(channels))` 这次枚举。
//   ② sink 侧：落盘必经 `writeToFileByExtension → writeYaml → fs.writeFileSync`
//      两层自有封装，而 methodSinkParamMap 只做「形参 → 本函数体内 fs sink」
//      的一跳登记，整层 wrapper 从未入表。
// 只补一侧语料纹丝不动——这也是为什么要把它们放在同一个 describe 里。
//
// 方法学提醒（R6）：每条负向断言都必须配正对照。本组把「记」
// 写在 why 里，避免后人把漏报当成通过。
// ═══════════════════════════════════════════════════════════════

/** 真实工程的落盘封装层：写文件的是最里面一跳，外层只是转发 */
const WRITE_LAYER = [
  'import * as fs from "fs";',
  "export function writeYaml(data: any, filename: string) {",
  '  fs.writeFileSync(filename, "x");',
  "}",
  "export function writeToFileByExtension(data: unknown, filePath: string) {",
  "  writeYaml(data, filePath);",
  "}",
].join("\n");

describe("fr-016：文档解析产物根 + sink 形参继承（两侧对称，缺一不可）", () => {
  type Case = {
    name: string;
    fn: string;
    files: Record<string, string>;
    expectMark: boolean;
    why: string;
  };

  const cases: Case[] = [
    {
      name: "正例·fr-016 形态（两侧都在位）",
      fn: "iterate",
      files: {
        "misc.ts": WRITE_LAYER,
        "it.ts": [
          'import * as path from "path";',
          'import { writeToFileByExtension } from "./misc";',
          "export function iterate(channels: Record<string, any>, outDir: string) {",
          "  for (const n of Object.keys(channels)) {",
          '    const f = `${outDir}/${n}.yaml`;',
          "    writeToFileByExtension(channels[n], f);",
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "Object.keys 枚举（根）+ 模板字面量（C4）+ wrapper 继承 sink 位（新）—— 三环齐全才动",
    },
    {
      name: "负对照·键列表是字面量",
      fn: "iterate",
      files: {
        "misc.ts": WRITE_LAYER,
        "it.ts": [
          'import { writeToFileByExtension } from "./misc";',
          "export function iterate(outDir: string) {",
          '  const names = ["a", "b", "c"];',
          "  for (const n of names) {",
          '    const f = `${outDir}/${n}.yaml`;',
          "    writeToFileByExtension({}, f);",
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "名字由代码写死，不是运行时数据结构的产物 —— 根必须认得出「数据来源」这一点",
    },
    {
      name: "正例·Object.entries 解构绑定",
      fn: "iterate",
      files: {
        "misc.ts": WRITE_LAYER,
        "it.ts": [
          'import { writeToFileByExtension } from "./misc";',
          "export function iterate(doc: Record<string, any>, outDir: string) {",
          "  for (const [name, value] of Object.entries(doc)) {",
          '    const f = `${outDir}/${name}.yaml`;',
          "    writeToFileByExtension(value, f);",
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "for-of 的解构绑定也要收进污点集合，不能只认单个标识符",
    },
    {
      name: "正例·JSON.parse 产物进 sink",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(text: string, outDir: string) {",
          "  const cfg = JSON.parse(text);",
          '  fs.writeFileSync(outDir + "/" + cfg.name, "x");',
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "外部文档解析产物：值的内容由被解析输入决定，这是「传输面」而不是变量名猜测",
    },
    {
      name: "负对照·常量配置不经解析",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          'const DEFAULT = { name: "out" };',
          "export function emit(outDir: string) {",
          "  const cfg = DEFAULT;",
          '  fs.writeFileSync(outDir + "/" + cfg.name, "x");',
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "同形状但没有解析调用 —— 证明上一个用例不是「见到 cfg 就标记」",
    },
    {
      name: "负对照·helper 不写文件 ⇒ 不继承 sink",
      fn: "iterate",
      files: {
        "misc.ts": [
          "export function touchPath(p: string) { return p.length; }",
        ].join("\n"),
        "it.ts": [
          'import { touchPath } from "./misc";',
          "export function iterate(doc: Record<string, any>, outDir: string) {",
          "  for (const n of Object.keys(doc)) {",
          '    const f = `${outDir}/${n}.yaml`;',
          "    touchPath(f);",
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "sink 形参继承必须真的落到 fs sink —— 只是被传进某个 helper 不构成继承",
    },
    {
      name: "负对照·形参落在非 sink 位 ⇒ 不继承",
      fn: "iterate",
      files: {
        "misc.ts": [
          'import * as fs from "fs";',
          "export function writeYaml(data: any, filename: string) {",
          '  fs.writeFileSync(filename, "x");',
          "}",
          "export function writeFrom(name: string, data: unknown) {",
          '  writeYaml(data, "/fixed/out.yaml");',
          "}",
        ].join("\n"),
        "it.ts": [
          'import { writeFrom } from "./misc";',
          "export function iterate(doc: Record<string, any>) {",
          "  for (const n of Object.keys(doc)) {",
          "    writeFrom(n, {});",
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "writeFrom 的 name 被传进 writeYaml 的【非 sink 位】（第 0 位）⇒ 不该继承第 1 位的 sink",
    },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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
// C4b / C4c（2026-09-20，3.7.39）
//
// C4b：项目自有的「纯塑形」helper 此前不传播污点 —— fr-016 因此少两条真阳性：
//   const filename = getFileNamePath(dir, componentName, ext);   // 污点断在这一跳
//   writeToFileByExtension(data, filename);
//   // getFileNamePath(a, b, c) { return path.join(a, b) + `.${c}`; }
// C4 的塑形词表是 node:path + String 原型方法的【固定清单】，不可能覆盖每个
// 项目自己的封装。修法不是放宽词表（那是打地鼠），而是**按函数体证明它只做
// 塑形**：有形参、有带表达式的 return、体内无文件 sink、return 里所有调用都是
// 塑形调用且所有自由标识符都是形参 —— 三条全中才传播，认不出就留着漏报。
//
// C4c：`const ks = Object.keys(o); for (const k of ks)` —— 被迭代对象已经是
//   【被污染的变量】，不再是根表达式。枚举绑定此前只按根匹配，于是这种
//   「先收集、再迭代」的写法一根都收不到。
//
// 方向提醒：传播是**放宽召回**，与 G2 的抑制方向相反，所以判据要严。
// 每条负向断言都配正对照（R6）—— 否则「不标记」可能是没跑通而不是判对了。
// ═══════════════════════════════════════════════════════════════

describe("C4b：项目自有纯塑形 helper 的传播", () => {
  type Case = {
    name: string;
    fn: string;
    files: Record<string, string>;
    expectMark: boolean;
    why: string;
  };

  const cases: Case[] = [
    {
      name: "正例·helper 只做塑形",
      fn: "emit",
      files: {
        "misc.ts": [
          'import * as path from "path";',
          "export function getFileNamePath(dir: string, name: string, ext: string) {",
          '  return path.join(dir, name) + `.${ext}`;',
          "}",
        ].join("\n"),
        "it.ts": [
          'import * as fs from "fs";',
          'import { getFileNamePath } from "./misc";',
          "export function emit(doc: Record<string, any>, outDir: string, ext: string) {",
          "  for (const name of Object.keys(doc)) {",
          "    const filename = getFileNamePath(outDir, name, ext);",
          '    fs.writeFileSync(filename, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "path.join(dir,name) + 模板串：调用与自由标识符全在白名单内 ⇒ 认定为纯塑形，污点穿过它",
    },
    {
      name: "负对照·同形状但实参是字面量",
      fn: "emit",
      files: {
        "misc.ts": [
          'import * as path from "path";',
          "export function getFileNamePath(dir: string, name: string, ext: string) {",
          '  return path.join(dir, name) + `.${ext}`;',
          "}",
        ].join("\n"),
        "it.ts": [
          'import * as fs from "fs";',
          'import { getFileNamePath } from "./misc";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  const names = Object.keys(doc);",
          "  if (names.length === 0) return;",
          '  const filename = getFileNamePath(outDir, "fixed", "yaml");',
          '  fs.writeFileSync(filename, "x");',
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "根在（names）、helper 也在（证明门是开的），但传进去的是字面量 —— 不是「见到 helper 就标记」",
    },
    {
      name: "正例·helper 的 return 引用模块级字面量常量（原判据③缺口，C4e 闭合）",
      fn: "emit",
      files: {
        "misc.ts": [
          'const FIXED = "/safe";',
          "export function getFileNamePath(dir: string, name: string) {",
          "  return FIXED + name;",
          "}",
        ].join("\n"),
        "it.ts": [
          'import * as fs from "fs";',
          'import { getFileNamePath } from "./misc";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  for (const name of Object.keys(doc)) {",
          "    const filename = getFileNamePath(outDir, name);",
          '    fs.writeFileSync(filename, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "原判据③的【保守缺口】，2026-09-20 C4e 闭合：初值是【字面量】的模块级常量放行 —— 出处可确证。注意这里放任必须有界：见下一条「非字面量模块常量」",
    },
    {
      // 上一条把按钮松了一格，这条负责钉死松到哪一格为止：常量初值若是【任意表达式】，
      // 就退回到「看不见 ⇒ 拦死」。否则 helper 能把别处的污点藏在一个模块常量后面
      // （跨函数常量摘要一旦放行非字面量，等于给任意数据流发了通行证）。
      name: "负对照·helper 的 return 引用非字面量模块常量",
      fn: "emit",
      files: {
        "misc.ts": [
          'import * as path from "path";',
          'const ROOT = path.resolve(process.cwd(), "runs");',
          "export function getFileNamePath(dir: string, name: string) {",
          "  return ROOT + name;",
          "}",
        ].join("\n"),
        "it.ts": [
          'import * as fs from "fs";',
          'import { getFileNamePath } from "./misc";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  for (const name of Object.keys(doc)) {",
          "    const filename = getFileNamePath(outDir, name);",
          '    fs.writeFileSync(filename, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "ROOT 的初值是表达式不是字面量 ⇒ 仍按判据③拦死；正对照 = 上一条（同名 fixtures，只有常量初值不同）",
    },
    {
      // 本条锁的是 C4b 的【收窄决定】：字符过滤不算「纯塑形」的证据。
      // C4 的内联规则里 `.replace` 是算塑形的，但 helper 形式看不见实参窗口，
      // 判据必须更严 —— `.replace(/[^a-z0-9]/gi, "")` 就是净化函数的标准写法，
      // 把它判成「确定不净化」正是 C4 用白名单避开的那类错误。
      name: "负对照·helper 体内是字符过滤 ⇒ 不算纯塑形",
      fn: "emit",
      files: {
        "misc.ts": [
          "export function toSlug(p: string) {",
          '  return p.replace(/[^a-z0-9]/gi, "").toLowerCase();',
          "}",
        ].join("\n"),
        "it.ts": [
          'import * as fs from "fs";',
          'import { toSlug } from "./misc";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  for (const name of Object.keys(doc)) {",
          "    const filename = toSlug(name);",
          '    fs.writeFileSync(outDir + "/" + filename, "x");',
          "  }",
        ].join("\n"),
      },
      expectMark: false,
      why: "字符过滤是净化函数的常见实现，不能作为「只做塑形」的证据；正对照 = 上一条 path.join 形态必须报出",
    },
    {
      name: "负对照·helper 体内有文件 sink ⇒ 不是纯塑形",
      fn: "emit",
      files: {
        "misc.ts": [
          'import * as fs from "fs";',
          'import * as path from "path";',
          "export function getFileNamePath(dir: string, name: string) {",
          '  fs.mkdirSync(dir, { recursive: true });',
          "  return path.join(dir, name);",
          "}",
        ].join("\n"),
        "it.ts": [
          'import * as fs from "fs";',
          'import { getFileNamePath } from "./misc";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  for (const name of Object.keys(doc)) {",
          "    const filename = getFileNamePath(outDir, name);",
          '    fs.writeFileSync(filename, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "判据②：含 sink 说明它不只是塑形。副作用型 helper 不参与传播（避免把副作用函数当管道）",
    },
    {
      name: "正例·helper 调 helper（两跳，验不动点第二轮）",
      fn: "emit",
      files: {
        "misc.ts": [
          'import * as path from "path";',
          "export function withExt(p: string, ext: string) {",
          '  return p + `.${ext}`;',
          "}",
          "export function getFileNamePath(dir: string, name: string, ext: string) {",
          "  return withExt(path.join(dir, name), ext);",
          "}",
        ].join("\n"),
        "it.ts": [
          'import * as fs from "fs";',
          'import { getFileNamePath } from "./misc";',
          "export function emit(doc: Record<string, any>, outDir: string, ext: string) {",
          "  for (const name of Object.keys(doc)) {",
          "    const filename = getFileNamePath(outDir, name, ext);",
          '    fs.writeFileSync(filename, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "withExt 先被认定（它只用到 p 与 ext），第二轮才轮到 getFileNamePath —— 有界两轮，不追环",
    },
    {
      name: "负对照·helper 没有 return ⇒ 认不出",
      fn: "emit",
      files: {
        "misc.ts": [
          'import * as path from "path";',
          "export function getFileNamePath(dir: string, name: string): void {",
          "  path.join(dir, name);",
          "}",
        ].join("\n"),
        "it.ts": [
          'import * as fs from "fs";',
          'import { getFileNamePath } from "./misc";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  for (const name of Object.keys(doc)) {",
          "    const filename = path.join(outDir, name);",
          "    getFileNamePath(outDir, name);",
          '    fs.writeFileSync(filename, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "正对照：helper 认不出（无 return）不影响本函数自己的 path.join 传播 —— 门本身是开的",
    },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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

describe("C4c：迭代已被污染的聚合", () => {
  type Case = {
    name: string;
    fn: string;
    files: Record<string, string>;
    expectMark: boolean;
    why: string;
  };

  const cases: Case[] = [
    {
      name: "正例·先收集再迭代",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  const ks = Object.keys(doc);",
          "  for (const k of ks) {",
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "被迭代对象 ks 是【已被污染的变量】而非根表达式 —— 此前枚举绑定只按根匹配，这种写法一根都收不到",
    },
    {
      name: "正对照·直接迭代根（已有能力不退化）",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  for (const k of Object.keys(doc)) {",
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "fr-016 原始形态，确认补 C4c 没有把它改坏",
    },
    {
      name: "负对照·聚合本身无污点",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  const all = Object.keys(doc);",
          "  if (all.length === 0) return;",
          '  const ks = ["a", "b"];',
          "  for (const k of ks) {",
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "根在（all 已被污染）、sink 也在，但迭代的是字面量数组 —— 证明绑定看的是【被迭代对象是否污】，不是「函数里有污点就标」",
    },
    {
      name: "正例·Object.values 收集后迭代",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  const vs = Object.values(doc);",
          "  for (const v of vs) {",
          '    fs.writeFileSync(outDir + "/" + v.name, "x");',
          "  }",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "values 与 keys 同族，成员取值（v.name）也要能带出去",
    },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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

describe("C4d：高阶枚举方法的回调形参必须绑定", () => {
  type Case = { name: string; fn: string; files: Record<string, string>; expectMark: boolean; why: string };

  const cases: Case[] = [
    {
      name: "正例·Object.keys(doc).forEach",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  Object.keys(doc).forEach((k) => {",
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "回调形参 = 被枚举到的元素，与 for-of 语义等价 —— 此前只绑 for-of/for-in，这种写法整片漏",
    },
    {
      name: "正例·map 回调 + entries 解构形参",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  Object.entries(doc).map(([k, v]) => {",
          '    fs.writeFileSync(outDir + "/" + k, String(v));',
          "    return k;",
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "[k, v] 解构的两个名字都是元素，都要绑（只绑一个会让 entries 形态半残）",
    },
    {
      name: "正例·先收集再 forEach（C4c × C4d）",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  const ks = Object.keys(doc);",
          "  ks.forEach((k) => {",
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "接收者是被污染的变量而非根表达式 —— 必须走不动点的变量形态，只按根匹配收不到",
    },
    {
      name: "正例·async 回调（Promise.all + map）",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  const vs = Object.values(doc);",
          "  Promise.all(vs.map(async (v) => {",
          '    fs.writeFileSync(outDir + "/" + v.name, "x");',
          "  }));",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "并发写法里形参前有个 async —— 不能被它挡住",
    },
    {
      name: "负对照·只用索引（第二个形参）",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  Object.keys(doc).forEach((k, i) => {",
          '    fs.writeFileSync(outDir + "/" + i, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "第二个形参是索引不是元素 —— 绑了它就是误报；本条钉死「只绑第一个形参」",
    },
    {
      name: "负对照·字面量数组回调",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(outDir: string) {",
          '  ["a", "b"].forEach((k) => {',
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "无污点流入；正对照是同形状的 Object.keys(doc).forEach —— 证明不是「见到回调就标」",
    },
    {
      name: "负对照·被枚举的是干净变量",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  const all = Object.keys(doc);",
          "  if (all.length === 0) return;",
          '  const ks = ["a", "b"];',
          "  ks.forEach((k) => {",
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "根在、回调也在，但接收者不污 —— 证明绑定看的是【接收者是否污】，不是「函数里有污点就标」",
    },
    {
      name: "正例·无括号单参箭头",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  Object.keys(doc).forEach(k => {",
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "TS/JS 里单参数箭头常常不写括号 —— 初版正则只认 `(k) =>`，这种写法漏",
    },
    {
      name: "正例·ES5 function 回调",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          "  Object.keys(doc).forEach(function (k) {",
          '    fs.writeFileSync(outDir + "/" + k, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "不是箭头函数，但形参同样是被枚举到的元素 —— 形态不同不该区别对待",
    },
    {
      name: "正例·成员链接收者 + 形参带类型标注",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(raw: string, outDir: string) {",
          "  const doc = JSON.parse(raw);",
          "  doc.sections.forEach((s: any) => {",
          '    fs.writeFileSync(outDir + "/" + s.name, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: true,
      why: "两处都得通：接收者隔着一层成员（doc.sections）、形参带 TS 类型标注（`: any` 曾经让整环不匹配）",
    },
    {
      name: "负对照·回调是函数引用",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(doc: Record<string, any>, outDir: string) {",
          '  const handleOne = outDir + "/fixed";',
          "  Object.keys(doc).forEach(handleOne);",
          '  fs.writeFileSync(handleOne + "/" + "index.md", "x");',
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "回调写成函数引用时，那个名字是【别人的函数名】不是元素 —— 初版把它当形参绑进污点集合，同名局部变量随即被误标（真实误报，本条锁住修复）",
    },
    {
      name: "负对照·干净对象的成员链枚举",
      fn: "emit",
      files: {
        "it.ts": [
          'import * as fs from "fs";',
          "export function emit(outDir: string, cfg: { sections: Array<{ name: string }> }) {",
          "  cfg.sections.forEach((s) => {",
          '    fs.writeFileSync(outDir + "/" + s.name, "x");',
          "  });",
          "}",
        ].join("\n"),
      },
      expectMark: false,
      why: "放开了成员链接收者，就要跟着锁住「链的根不污时不标」 —— 正对照是同形状的 emitMemberChain 形态",
    },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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

describe("C4e：helper 的现代写法（箭头 / 函数表达式 / 模块常量）必须照样传播", () => {
  type Case = { name: string; fn: string; files: Record<string, string>; expectMark: boolean; why: string };

  // 隔离写法：sink 实参里**不出现**污点变量本身，污点只能经 helper 的返回值流进去。
  // 否则会命中「sink 实参含污点名」的兜底判定，正负对照一次性全绿 —— 测的就不是传播了。
  const emit = (relExpr: string, extraImport = "") =>
    [
      'import * as fs from "fs";',
      extraImport,
      "export function emit(doc: Record<string, any>, outDir: string) {",
      "  Object.keys(doc).forEach((k) => {",
      `    const rel = ${relExpr};`,
      '    fs.writeFileSync(outDir + "/" + rel, "x");',
      "  });",
      "}",
    ]
      .filter((l) => l !== "")
      .join("\n");

  const cases: Case[] = [
    {
      name: "正例·箭头 helper（简洁体）",
      fn: "emit",
      files: {
        "helpers.ts": [`export const withExtArrow = (name: string): string => name + ".md";`].join("\n"),
        "it.ts": emit("withExtArrow(k)", 'import { withExtArrow } from "./helpers";'),
      },
      expectMark: true,
      why: "`export const f = (x) => …` 是现代 TS 里 helper 的主力写法，而收集只走 getFunctions() ⇒ 整片漏",
    },
    {
      name: "正例·箭头 helper（块体 + return）",
      fn: "emit",
      files: {
        "helpers.ts": [
          "export const withExtBlock = (name: string): string => {",
          '  return name + ".md";',
          "};",
        ].join("\n"),
        "it.ts": emit("withExtBlock(k)", 'import { withExtBlock } from "./helpers";'),
      },
      expectMark: true,
      why: "块体箭头没有「简洁返回值」，必须从 return 语句取 —— 与简洁体必须走同一条通路",
    },
    {
      name: "正例·函数表达式 helper",
      fn: "emit",
      files: {
        "helpers.ts": [`export const withExtExpr = function (name: string): string { return name + ".md"; };`].join("\n"),
        "it.ts": emit("withExtExpr(k)", 'import { withExtExpr } from "./helpers";'),
      },
      expectMark: true,
      why: "函数表达式同样不是函数声明，getFunctions() 收不到 —— 与箭头同因",
    },
    {
      name: "正例·return 引用模块级字面量常量",
      fn: "emit",
      files: {
        "helpers.ts": [
          'const EXT_DOC = ".doc";',
          "export function withConst(name: string): string { return name + EXT_DOC; }",
        ].join("\n"),
        "it.ts": emit("withConst(k)", 'import { withConst } from "./helpers";'),
      },
      expectMark: true,
      why: "原 C4b 判据③的已知缺口：自由标识符一律拦死。现只放行【初值是字面量】的模块级常量 —— 出处可确证",
    },
    {
      name: "正例·path 模块的局部别名",
      fn: "emit",
      files: {
        "helpers.ts": [
          'import * as p from "path";',
          'export const joinOut = (name: string): string => p.join("out", name);',
        ].join("\n"),
        "it.ts": emit("joinOut(k)", 'import { joinOut } from "./helpers";'),
      },
      expectMark: true,
      why: "白名单里写死 'path' 一个名字不够 —— `import * as p` / `import nodePath from 'node:path'` 都要能认",
    },
    {
      name: "正例·箭头两跳",
      fn: "emit",
      files: {
        "helpers.ts": [
          'export const innerArrow = (n: string): string => n + ".md";',
          "export const wrapTwice = (n: string): string => innerArrow(n);",
        ].join("\n"),
        "it.ts": emit("wrapTwice(k)", 'import { wrapTwice } from "./helpers";'),
      },
      expectMark: true,
      why: "箭头之间互为调用方，要靠有界两轮不动点接上 —— 第一轮认不出，第二轮才有机会",
    },
    {
      name: "负对照·helper 调用项目内不存在的函数",
      fn: "emit",
      files: {
        "helpers.ts": ["export const viaExternal = (name: string): string => lookupUnknown(name);"].join("\n"),
        "it.ts": emit("viaExternal(k)", 'import { viaExternal } from "./helpers";'),
      },
      expectMark: false,
      why: "认不出的一律站在精度一侧 —— 放宽到箭头之后这条仍必须不传播；正对照 = 正例·箭头 helper",
    },
    {
      name: "负对照·helper 体内有 sink（箭头形态）",
      fn: "emit",
      files: {
        "helpers.ts": [
          'import * as fsx from "fs";',
          "export const sneakyArrow = (name: string): string => {",
          "  fsx.existsSync(name);",
          '  return name + ".md";',
          "};",
        ].join("\n"),
        "it.ts": emit("sneakyArrow(k)", 'import { sneakyArrow } from "./helpers";'),
      },
      expectMark: false,
      why: "判据②对箭头同样成立 —— 体内有 IO 就不得假定它只是塑形",
    },
    {
      name: "负对照·helper 真塑形但实参是字面量",
      fn: "emit",
      files: {
        "helpers.ts": [`export const withExtArrow = (name: string): string => name + ".md";`].join("\n"),
        "it.ts": emit('withExtArrow("static")', 'import { withExtArrow } from "./helpers";'),
      },
      expectMark: false,
      why: "传播得靠实参带污点，不能因为 helper 长得像塑形就一路放行",
    },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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

describe("C4f：只有落在「返回值真依赖的形参位」上的污点才算流过去", () => {
  type Case = { name: string; fn: string; files: Record<string, string>; expectMark: boolean; why: string };

  // 与 C4e 同源的隔离写法：sink 实参里不出现污点变量 k，污点只能经 helper 返回值进来。
  const emit = (relExpr: string) =>
    [
      'import * as fs from "fs";',
      'import { dropParam, pickFirst, withExt, wrapDrop, wrapPick, swapPick } from "./helpers";',
      "export function emit(doc: Record<string, any>, outDir: string) {",
      "  Object.keys(doc).forEach((k) => {",
      `    const rel = ${relExpr};`,
      '    fs.writeFileSync(outDir + "/" + rel, "x");',
      "  });",
      "}",
    ].join("\n");

  const HELPERS = [
    '// 依赖集为空：丢弃形参，返回常量',
    'export const dropParam = (n: string): string => "fixed.md";',
    '// 只依赖第一个形参',
    'export const pickFirst = (a: string, b: string): string => a + ".md";',
    '// 常规塑形（正对照）',
    'export const withExt = (name: string): string => name + ".md";',
    '// 两跳丢弃',
    'export const wrapDrop = (n: string): string => dropParam(n);',
    '// 两跳对齐',
    'export const wrapPick = (a: string, b: string): string => pickFirst(a, b);',
    '// 换序两跳：真正被依赖的是第二个形参',
    'export const swapPick = (x: string, y: string): string => pickFirst(y, x);',
  ].join("\n");

  const cases: Case[] = [
    { name: "正例·常规塑形", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit("withExt(k)") },
      expectMark: true, why: "收精度不得收过头 —— 这条必须照标" },
    { name: "正例·污点在被依赖的形参位", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('pickFirst(k, "safe")') },
      expectMark: true, why: "第一个形参真的影响返回值" },
    { name: "正例·两跳仍在被依赖的位置", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('wrapPick(k, "safe")') },
      expectMark: true, why: "依赖集要能跨函数传递" },
    { name: "正例·换序两跳", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('swapPick("safe", k)') },
      expectMark: true, why: "swapPick 真正依赖的是 y（第二个形参），位置对齐要跟着换" },
    { name: "负对照·helper 丢弃形参", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit("dropParam(k)") },
      expectMark: false, why: "return 常量 —— 实参带污点也流不出来；这是收窄前的真实误报" },
    { name: "负对照·污点在不被依赖的形参位", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('pickFirst("safe", k)') },
      expectMark: false, why: "第二个形参进了函数也出不来；正对照 = 正例·污点在被依赖的形参位" },
    { name: "负对照·嵌套在 concat 里", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('path.join("out", dropParam(k))') },
      expectMark: false, why: "整条 rhs 含 k，但那条支路不流出 —— 证据必须按支路算，不能整行一锅端" },
    { name: "负对照·两跳后依赖集为空", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit("wrapDrop(k)") },
      expectMark: false, why: "wrapDrop(n) = dropParam(n)，依赖集同样为空（跨函数对齐）" },
    { name: "负对照·两跳位置不对齐", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('wrapPick("safe", k)') },
      expectMark: false, why: "正对照 = 正例·两跳仍在被依赖的位置" },
    { name: "负对照·换序的反向", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('swapPick(k, "safe")') },
      expectMark: false, why: "k 落在不被依赖的 x 位；正对照 = 正例·换序两跳" },
    { name: "负对照·实参本身无污点", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('dropParam("lit")') },
      expectMark: false, why: "无污点流入" },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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

describe("C4g：helper 换个载体（对象字面量方法 / 类方法 / 解构形参）也要能传播", () => {
  type Case = { name: string; fn: string; files: Record<string, string>; expectMark: boolean; why: string };

  const emit = (relExpr: string, pre = "") =>
    [
      'import * as fs from "fs";',
      'import { Util, Drop, Renderer, viaName } from "./helpers";',
      "export function emit(doc: Record<string, any>, outDir: string) {",
      ...(pre ? [`  ${pre}`] : []),
      "  Object.keys(doc).forEach((k) => {",
      `    const rel = ${relExpr};`,
      '    fs.writeFileSync(outDir + "/" + rel, "x");',
      "  });",
      "}",
    ].join("\n");

  const HELPERS = [
    "export const Util = {",
    '  toPath(n: string): string { return n + ".md"; },',
    "};",
    "export const Drop = {",
    '  fixed(n: string): string { return "fixed.md"; },',
    "};",
    "export class Renderer {",
    '  inst(n: string): string { return n + ".md"; }',
    // 原名 stat —— **stat 在 fs sink 名单里**，调用点会被 sink 兜底直接标中，
    // 这条用例于是变成假通过（测的根本不是 helper 传播，R13）。改名后才测得准。
    '  static toFile(n: string): string { return n + ".txt"; }',
    "}",
    'export function viaName({ name }: any): string { return name + ".md"; }',
  ].join("\n");

  const cases: Case[] = [
    { name: "正例·对象字面量方法", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit("Util.toPath(k)") },
      expectMark: true, why: "宿主名可确证 ⇒ 走限定名 Owner.method" },
    { name: "正例·类实例方法", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit("r.inst(k)", "const r = new Renderer();") },
      expectMark: true, why: "宿主是变量，限定名对不上 ⇒ 靠方法名唯一 + 成员调用位" },
    { name: "正例·静态类方法", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit("Renderer.toFile(k)") },
      expectMark: true, why: "与对象字面量同形，走限定名（方法名刻意避开 sink 名单，否则用例是假通过）" },
    { name: "正例·解构形参", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit("viaName({ name: k })") },
      expectMark: true, why: "形参名要从绑定模式里抽出来 —— getName() 给的是整个模式而不是 name" },
    { name: "负对照·对象字面量方法丢弃形参", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit("Drop.fixed(k)") },
      expectMark: false, why: "召回放宽到方法之后，C4f 的收窄也要跟得上新载体；正对照 = 正例·对象字面量方法" },
    { name: "负对照·解构形参喂字面量", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('viaName({ name: "lit" })') },
      expectMark: false, why: "无污点流入；正对照 = 正例·解构形参" },
    { name: "负对照·方法是真塑形但实参是字面量", fn: "emit", files: { "helpers.ts": HELPERS, "it.ts": emit('Util.toPath("static")') },
      expectMark: false, why: "传播得靠实参带污点" },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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

// ══════════════════════════════════════════════════════════════════════
// C4h（2026-09-20）：三件都在「名录 ↔ 调用点」交界上的事
//
//   ① 调用点常量代入 —— helper 的 return 走三元，本次调用喂的是常量 ⇒ 返回值
//      其实是字面量。名录里的依赖集是**跨调用点**的并集，收不住这种个案
//      （探针实测：`viaFlag(k, true)` 误标）。按位置把常量代回去、解掉可判定的
//      三元，判不出就退回原结论（保守侧）。
//   ② 同名成员多处 —— 旧规则要求方法名全项目唯一才登记 `.method(`。唯一性只是
//      「不可能认错」的充分条件：同名两处**都被确证**时同样不可能认错。
//      顺带修掉一处真实缺陷：旧代码在确证之前就把裸名塞进了成员名录。
//   ③ 属性承载的箭头 helper —— `const Util = { toPath: (n) => … }` 与
//      `Util.toPath = (n) => …`，这两种既不是方法声明也不是变量声明。
//
// 写法约定（与前几族同源）：sink 实参里**不直接出现**污点变量 k。
// ══════════════════════════════════════════════════════════════════════
describe("C4h：名录之外的三处收口（调用点常量 / 同名成员 / 属性箭头）", () => {
  type Case = { name: string; fn: string; files: Record<string, string>; expectMark: boolean; why: string };

  const emit = (relExpr: string, pre = "", imports = "", helpers = "") => ({
    "helpers.ts": helpers,
    "it.ts": [
      'import * as fs from "fs";',
      ...(imports ? [`import { ${imports} } from "./helpers";`] : []),
      "export function emit(doc: Record<string, any>, outDir: string) {",
      ...(pre ? [`  ${pre}`] : []),
      "  Object.keys(doc).forEach((k) => {",
      `    const rel = ${relExpr};`,
      '    fs.writeFileSync(outDir + "/" + rel, "x");',
      "  });",
      "}",
    ].join("\n"),
  });

  // ── ① 调用点常量代入 ───────────────────────────────────────────────
  const H_CONST = [
    'export const viaFlag = (n: string, flag: boolean): string => (flag ? "fixed.md" : n + ".md");',
    // 两支都含形参 —— 收精度不能收到这儿
    "export const eitherWay = (n: string, flag: boolean): string => (flag ? n : n + '.md');",
    "export const pickMode = (n: string, mode: string): string => (mode === 'raw' ? n : 'fixed.md');",
    // 两跳：折叠要能穿过 helper 之间的嵌套调用
    'export const wrapFlag = (n: string, flag: boolean): string => viaFlag(n, flag);',
  ].join("\n");

  // ── ② 同名成员多处 ─────────────────────────────────────────────────
  const H_TWICE_OK = [
    "export class Uploader { toPath(n: string): string { return n + '.md'; } }",
    "export class Downloader { toPath(n: string): string { return n + '.tmp'; } }",
  ].join("\n");
  const H_TWICE_DROP = [
    "export class DropA { still(n: string): string { return 'fixed.md'; } }",
    "export class DropB { still(n: string): string { return 'other.md'; } }",
  ].join("\n");
  // 一处引用了模块级**非字面量**对象 ⇒ 判据③不成立 ⇒ 整个同名组都不许放行。
  // 刻意不含 sink —— 否则会被跨函数 sink 形参映射标中，归因就不干净了（R13）。
  const H_TWICE_BAD = [
    "export class Uploader { toPath(n: string): string { return n + '.md'; } }",
    "export const dict: Record<string, string> = {};",
    "export class Weird { toPath(n: string): string { return dict[n]; } }",
  ].join("\n");
  const H_SOLO = [
    "export class Solo { toPath(n: string): string { return n + '.md'; } }",
  ].join("\n");

  // ── ③ 属性承载的箭头 ───────────────────────────────────────────────
  const H_PROP = [
    "export const Util2 = {",
    "  toPath: (n: string): string => n + '.md',",
    "};",
    "export const NS = {",
    "  path: {",
    "    toPath: (n: string): string => n + '.md',",
    "  },",
    "};",
    "export const Patched: any = {};",
    "Patched.toPath = (n: string): string => n + '.md';",
    "export const DropProp = {",
    "  fixed: (n: string): string => 'fixed.md',",
    "};",
  ].join("\n");

  // ── 缺陷回归门：非塑形方法的成员调用位不能算塑形 ────────────────────
  const H_NONSHAPER = [
    "export const registry: Record<string, string> = {};",
    "export class Reg {",
    "  lookup(n: string): string { return registry[n]; }",
    "}",
  ].join("\n");
  const H_SHAPER_LOOKUP = [
    "export class RegSafe {",
    "  lookup(n: string): string { return n + '.md'; }",
    "}",
  ].join("\n");

  const cases: Case[] = [
    // ① —— 精度侧
    { name: "正例·① 走真流出分支", fn: "emit", files: emit("viaFlag(k, false)", "", "viaFlag", H_CONST),
      expectMark: true, why: "flag=false ⇒ 走的是含 n 的那支" },
    { name: "正例·① 两支都含形参", fn: "emit", files: emit("eitherWay(k, true)", "", "eitherWay", H_CONST),
      expectMark: true, why: "收精度不许收过头 —— 选中的分支里仍有 n" },
    { name: "正例·① 字符串比较命中", fn: "emit", files: emit('pickMode(k, "raw")', "", "pickMode", H_CONST),
      expectMark: true, why: "mode === 'raw' 命中 ⇒ 返回 n" },
    { name: "正例·① 第二参是变量（判不出就照标）", fn: "emit", files: emit("viaFlag(k, dyn)", "const dyn = Math.random() > 0;", "viaFlag", H_CONST),
      expectMark: true, why: "保守侧：实参不是常量 ⇒ 一律退回名录结论，不许假装看得懂" },
    { name: "负对照·① 常量把分支钉死成字面量", fn: "emit", files: emit("viaFlag(k, true)", "", "viaFlag", H_CONST),
      expectMark: false, why: "本次调用的返回值就是 'fixed.md' —— 名录级依赖集收不住这种个案；正对照 = ① 走真流出分支" },
    { name: "负对照·① 字符串比较没命中", fn: "emit", files: emit('pickMode(k, "cooked")', "", "pickMode", H_CONST),
      expectMark: false, why: "mode 不是 'raw' ⇒ 走常量支；正对照 = ① 字符串比较命中" },
    { name: "负对照·① 嵌套在 path.join 里", fn: "emit", files: emit('path.join("out", viaFlag(k, true))', "", "viaFlag", H_CONST),
      expectMark: false, why: "整条 rhs 含 k，但那条支路不流出 —— 折叠要能作用在嵌套的内层" },
    { name: "负对照·① 两跳 + 常量", fn: "emit", files: emit("wrapFlag(k, true)", "", "wrapFlag", H_CONST),
      expectMark: false, why: "wrapFlag(n, flag) = viaFlag(n, flag)，折叠要穿过一层 helper" },
    { name: "正对照·① 两跳走流出分支", fn: "emit", files: emit("wrapFlag(k, false)", "", "wrapFlag", H_CONST),
      expectMark: true, why: "与上一条镜像：常量改变量 ⇒ 立刻转红，证明归因在这条机制上" },

    // ② —— 召回侧
    { name: "正例·② 同名成员两处均塑形", fn: "emit", files: emit("u.toPath(k)", "const u = new Uploader();", "Uploader", H_TWICE_OK),
      expectMark: true, why: "两处都被确证 ⇒ `.toPath(` 不可能落到别的实现上（唯一性换成全组确证）" },
    { name: "正例·② 另一处同名也被识别", fn: "emit", files: emit("d.toPath(k)", "const d = new Downloader();", "Downloader", H_TWICE_OK),
      expectMark: true, why: "合并是对称的：同组的另一个宿主同样要接得上" },
    { name: "正例·② 单处同名的老对照组", fn: "emit", files: emit("s.toPath(k)", "const s = new Solo();", "Solo", H_SOLO),
      expectMark: true, why: "全组确证是旧唯一性规则的上位，老行为必须还在" },
    { name: "负对照·② 同名两处都丢弃形参", fn: "emit", files: emit("a.still(k)", "const a = new DropA();", "DropA", H_TWICE_DROP),
      expectMark: false, why: "合并后的依赖集按位取并集 —— 两处都丢 ⇒ 仍为空，精度不许丢" },
    { name: "负对照·② 同名一处非塑形", fn: "emit", files: emit("u.toPath(k)", "const u = new Uploader();", "Uploader", H_TWICE_BAD),
      expectMark: false, why: "整组不放行（R11 的不变量：必须在每一种实现上都成立）；正对照 = ② 同名成员两处均塑形" },

    // ③ —— 召回侧
    { name: "正例·③ 属性箭头 helper", fn: "emit", files: emit("Util2.toPath(k)", "", "Util2", H_PROP),
      expectMark: true, why: "`{ toPath: (n) => … }` 既不是方法声明也不是变量声明 —— 旧名录整片漏" },
    { name: "正例·③ 嵌套对象的属性箭头", fn: "emit", files: emit("NS.path.toPath(k)", "", "NS", H_PROP),
      expectMark: true, why: "限定名要能沿 owner 链一路拼到最外层变量" },
    { name: "正例·③ 属性赋值箭头", fn: "emit", files: emit("Patched.toPath(k)", "", "Patched", H_PROP),
      expectMark: true, why: "`Obj.method = (n) => …` 这种后挂写法同属一族" },
    { name: "负对照·③ 属性箭头丢弃形参", fn: "emit", files: emit("DropProp.fixed(k)", "", "DropProp", H_PROP),
      expectMark: false, why: "召回放宽到新载体，C4f/C4h-① 的收窄要跟得上；正对照 = ③ 属性箭头 helper" },
    { name: "负对照·③ 属性箭头喂字面量", fn: "emit", files: emit('Util2.toPath("lit")', "", "Util2", H_PROP),
      expectMark: false, why: "无污点流入" },

    // 缺陷回归门（旧行为：确证之前就把裸名登记进成员名录）
    { name: "负对照·非塑形方法的成员调用位不算塑形", fn: "emit", files: emit("r.lookup(k)", "const r = new Reg();", "Reg", H_NONSHAPER),
      expectMark: false, why: "lookup 引用了模块级非字面量对象 ⇒ 三条判据不成立 ⇒ 成员调用位不许进名录" },
    { name: "正对照·同一个名字换成塑形版", fn: "emit", files: emit("r.lookup(k)", "const r = new RegSafe();", "RegSafe", H_SHAPER_LOOKUP),
      expectMark: true, why: "与上一条镜像 ⇒ 不标是因为判据，不是因为这条路压根走不通" },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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

// C4i（2026-09-21）：六个缺口 —— 三个是精度、三个是召回载体
//   精度 ① 短路运算符（|| / && / ?? 与三元同形，只是判据换成左操作数的真假）
//        ② 模板串内嵌的三元（${} 内部是独立表达式，折叠要能进去）
//   召回 ③ 柯里化高阶 helper    ④ namespace 内的函数声明
//        ⑤ rest 形参            ⑥ IIFE 定义 / 计算属性名
// 每组都配「判不出 ⇒ 退回保守」与「helper 真丢弃 ⇒ 仍不标」两条镜像（R14/R15）。
describe("C4i：helper 的又一批载体与又一批可判定分支", () => {
  type Case = { name: string; fn: string; files: Record<string, string>; expectMark: boolean; why: string };

  const emit = (relExpr: string, pre = "", imports = "", helpers = "") => ({
    "helpers.ts": helpers,
    "it.ts": [
      'import * as fs from "fs";',
      ...(imports ? [`import { ${imports} } from "./helpers";`] : []),
      "export function emit(doc: Record<string, any>, outDir: string) {",
      ...(pre ? [`  ${pre}`] : []),
      "  Object.keys(doc).forEach((k) => {",
      `    const rel = ${relExpr};`,
      '    fs.writeFileSync(outDir + "/" + rel, "x");',
      "  });",
      "}",
    ].join("\n"),
  });

  // ── ① 短路 + ② 模板串 ─────────────────────────────────────────────
  const H_FOLD = [
    'export const viaOr = (n: string, s: any): string => s || n + ".md";',
    'export const viaAnd = (n: string, s: any): string => s && n + ".md";',
    'export const viaNull = (n: string, s: any): string => s ?? n + ".md";',
    'export const viaTpl = (n: string, f: boolean): string => `${f ? "fixed" : n}.md`;',
  ].join("\n");

  // ── ③ 柯里化 ─────────────────────────────────────────────────────
  const H_CURRY = [
    'export const withExt = (ext: string) => (n: string): string => n + ext;',
    'export const dropExt = (_ext: string) => (_n: string): string => "fixed.md";',
    'export function curriedFn(ext: string) { return (n: string): string => n + ext; }',
  ].join("\n");

  // ── ④ namespace ──────────────────────────────────────────────────
  const H_NS = [
    'import * as fs from "fs";',
    "export namespace P {",
    "  export function toPath(n: string): string { return n + '.md'; }",
    "  export function dropPath(_n: string): string { return 'fixed.md'; }",
    "}",
    "export namespace L {",
    "  export function leakPath(n: string): string { fs.readFileSync(n); return 'x'; }",
    "}",
  ].join("\n");

  // ── ⑤ rest 形参 ──────────────────────────────────────────────────
  const H_REST = [
    'export function joinAll(...parts: string[]): string { return parts.join("/"); }',
    'export function fixedAll(..._parts: string[]): string { return "fixed.md"; }',
  ].join("\n");

  // ── ⑥ IIFE 定义 ──────────────────────────────────────────────────
  const H_IIFE = [
    'import * as fs from "fs";',
    'export const toPathIife = (() => (n: string): string => n + ".md")();',
    'export const dropIife = (() => (_n: string): string => "fixed.md")();',
    'export const leakIife = (() => (n: string): string => { fs.readFileSync(n); return "x"; })();',
  ].join("\n");

  // ── ⑦ 计算属性名（只有 KEY 是模块级字面量常量才解得出来）────────────
  const H_COMPUTED = [
    'const KEY = "toPath";',
    'const DROP = "toFile";',
    "export const Box: any = { [KEY]: (n: string): string => n + '.md' };",
    "export const DropBox: any = { [DROP]: (_n: string): string => 'fixed.md' };",
  ].join("\n");
  // 刻意**单独一个文件**：成员调用位 `.toPath(` 的匹配与宿主无关（C4g 的保守策略），
  // 把它和上面那个可解的 Box 放进同一个文件，会被 Box 登记的成员名顺带命中 ——
  // 那条期望就得改成 mark，测的也就不是「算不出」了（2026-09-21 实测踩到）。
  const H_DYN = [
    "const RANDOM = String(Math.random());",
    "export const DynBox: any = { [RANDOM]: (n: string): string => n + '.md' };",
  ].join("\n");

  const cases: Case[] = [
    // ① 短路 —— 精度侧
    { name: "正例·① ||左为假值 ⇒ 取右支", fn: "emit", files: emit('viaOr(k, "")', "", "viaOr", H_FOLD),
      expectMark: true, why: "空串 falsy ⇒ 真的会走到含 n 的那支" },
    { name: "负对照·① ||左为真值 ⇒ 取左支", fn: "emit", files: emit('viaOr(k, "fixed.md")', "", "viaOr", H_FOLD),
      expectMark: false, why: "返回值就是左值常量；正对照 = 上一条" },
    { name: "正例·① &&左为真值 ⇒ 取右支", fn: "emit", files: emit('viaAnd(k, "pre")', "", "viaAnd", H_FOLD),
      expectMark: true, why: "truthy ⇒ 走到形参那支" },
    { name: "负对照·① &&左为假值 ⇒ 取左支", fn: "emit", files: emit('viaAnd(k, "")', "", "viaAnd", H_FOLD),
      expectMark: false, why: "短路在左值就结束了；正对照 = 上一条" },
    { name: "负对照·① ??左非 null ⇒ 取左支", fn: "emit", files: emit('viaNull(k, "fixed.md")', "", "viaNull", H_FOLD),
      expectMark: false, why: "?? 的判据是「非空」而不是「真」，两种语义不能混" },
    { name: "正例·① ??左为 null ⇒ 取右支", fn: "emit", files: emit("viaNull(k, null)", "", "viaNull", H_FOLD),
      expectMark: true, why: "与上一条镜像 ⇒ 归因确实落在 ?? 的判定上" },
    { name: "保守侧·① 实参是变量 ⇒ 判不出就照标", fn: "emit", files: emit("viaOr(k, dyn)", "const dyn = Math.random() > 0;", "viaOr", H_FOLD),
      expectMark: true, why: "认不出就不收精度 —— 这条守的是保守侧的底线" },

    // ② 模板串 —— 精度侧
    { name: "正例·② 模板串里走流出分支", fn: "emit", files: emit("viaTpl(k, false)", "", "viaTpl", H_FOLD),
      expectMark: true, why: "f=false ⇒ ${} 里取 n" },
    { name: "负对照·② 模板串里走常量分支", fn: "emit", files: emit("viaTpl(k, true)", "", "viaTpl", H_FOLD),
      expectMark: false, why: "折叠必须能进 ${} 内部；正对照 = 上一条" },
    { name: "保守侧·② 模板串的 flag 是变量", fn: "emit", files: emit("viaTpl(k, dyn)", "const dyn = Math.random() > 0;", "viaTpl", H_FOLD),
      expectMark: true, why: "判不出 ⇒ 退回保守" },

    // ③ 柯里化 —— 召回侧
    { name: "正例·③ 柯里化·污点在第二跳", fn: "emit", files: emit('withExt(".md")(k)', "", "withExt", H_CURRY),
      expectMark: true, why: "真正塑形的是被返回出来的内层函数" },
    { name: "正例·③ 柯里化·污点在第一跳", fn: "emit", files: emit('withExt(k)("name")', "", "withExt", H_CURRY),
      expectMark: true, why: "外层实参被闭包捕获，同样是流进去的" },
    { name: "正例·③ 柯里化·函数声明写法", fn: "emit", files: emit('curriedFn(".md")(k)', "", "curriedFn", H_CURRY),
      expectMark: true, why: "return 箭头不只出现在箭头 helper 上" },
    { name: "负对照·③ 柯里化·内层丢弃形参", fn: "emit", files: emit('dropExt(".md")(k)', "", "dropExt", H_CURRY),
      expectMark: false, why: "召回放宽到新载体，收窄要跟得上；正对照 = ③ 污点在第二跳" },
    { name: "负对照·③ 柯里化·两边都是常量", fn: "emit", files: emit('withExt(".md")("fixed")', "", "withExt", H_CURRY),
      expectMark: false, why: "根本没有污点进来" },

    // ④ namespace —— 召回侧
    { name: "正例·④ namespace 内的 helper", fn: "emit", files: emit("P.toPath(k)", "", "P", H_NS),
      expectMark: true, why: "旧收集只走 sf.getFunctions() ⇒ namespace 里整片漏" },
    { name: "负对照·④ namespace 内丢弃形参", fn: "emit", files: emit("P.dropPath(k)", "", "P", H_NS),
      expectMark: false, why: "限定名也要走依赖分析；正对照 = 上一条" },
    { name: "负对照·④ namespace 内有 sink", fn: "emit", files: emit("L.leakPath(k)", "", "L", H_NS),
      expectMark: false, why: "判据③照旧生效 —— 载体换了不等于放水" },

    // ⑤ rest —— 召回侧
    { name: "正例·⑤ rest 形参吃掉剩余实参", fn: "emit", files: emit('joinAll("out", k)', "", "joinAll", H_REST),
      expectMark: true, why: "rest 位是**一批**实参，按位截断会把第二位当成越界抹掉" },
    { name: "负对照·⑤ rest 但丢弃", fn: "emit", files: emit('fixedAll("out", k)', "", "fixedAll", H_REST),
      expectMark: false, why: "召回放宽后精度不许丢；正对照 = 上一条" },

    // ⑥ IIFE —— 召回侧
    { name: "正例·⑥ IIFE 定义 helper", fn: "emit", files: emit("toPathIife(k)", "", "toPathIife", H_IIFE),
      expectMark: true, why: "初值是**调用**不是箭头 —— 真正的 helper 在返回值里" },
    { name: "负对照·⑥ IIFE 内丢弃形参", fn: "emit", files: emit("dropIife(k)", "", "dropIife", H_IIFE),
      expectMark: false, why: "收窄要跟得上；正对照 = 上一条" },
    { name: "负对照·⑥ IIFE 体内有 sink", fn: "emit", files: emit("leakIife(k)", "", "leakIife", H_IIFE),
      expectMark: false, why: "declText 取的是整条 IIFE ⇒ sink 检查仍覆盖得到" },

    // ⑦ 计算属性名 —— 召回侧
    { name: "正例·⑦ 计算属性名可解", fn: "emit", files: emit("Box.toPath(k)", "", "Box", H_COMPUTED),
      expectMark: true, why: "KEY 是模块级字面量常量 ⇒ 名字解得出来" },
    { name: "负对照·⑦ 计算属性名里的 helper 丢弃形参", fn: "emit", files: emit("DropBox.toFile(k)", "", "DropBox", H_COMPUTED),
      expectMark: false, why: "收窄要跟得上；正对照 = 上一条" },
    { name: "负对照·⑦ 属性名算不出来", fn: "emit", files: emit("DynBox.toPath(k)", "", "DynBox", H_DYN),
      expectMark: false, why: "`String(Math.random())` 不是常量 ⇒ 不登记（认不出就不传播）" },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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

// C4j（2026-09-21）：再一批载体 + 一条判据误杀 + 一处**既有**缺陷的回归门
//   召回 ① 运算符关键字（typeof）不再让整条 helper 落选
//        ② getter 返回出来的箭头（类 / 对象字面量）
//        ③ as / satisfies / 类型断言包住箭头
//        ④ 柯里化多跳（≥3 跳）+ 首跳实参是污点
//        ⑤ 工厂形态：返回的对象字面量里再取方法
//        ⑥ export default 匿名箭头（名字只能来自导入方）
//   回归 ⑦ 成员组必须**记全**：同名三处里只要有一处判据不成立，成员调用位就不许放行
//        （C4h-② 的"全组确证"漏掉了"进不了组"的实现 —— 探针 B4/B6 实测挖到）
// 每条真缺口都配镜像负对照（R14/R15）。
describe("C4j：载体收口的最后一批 + 成员组完整性回归", () => {
  type Case = { name: string; fn: string; files: Record<string, string>; expectMark: boolean; why: string };

  const emit = (relExpr: string, pre = "", imports = "", helpers = ""): Record<string, string> => ({
    "helpers.ts": helpers,
    "it.ts": [
      'import * as fs from "fs";',
      ...(imports ? [`import { ${imports} } from "./helpers";`] : []),
      "export function emit(doc: Record<string, any>, outDir: string, mode: string) {",
      ...(pre ? [`  ${pre}`] : []),
      "  Object.keys(doc).forEach((k) => {",
      `    const rel = ${relExpr};`,
      '    fs.writeFileSync(outDir + "/" + rel, "x");',
      "  });",
      "}",
    ].join("\n"),
  });

  /** 默认导出形态：helpers.ts 里 default 导出，it.ts 里真的 import 它 */
  const emitDef = (relExpr: string, importLine: string, helpers: string): Record<string, string> => ({
    "helpers.ts": helpers,
    "it.ts": [
      'import * as fs from "fs";',
      importLine,
      "export function emit(doc: Record<string, any>, outDir: string, mode: string) {",
      "  Object.keys(doc).forEach((k) => {",
      `    const rel = ${relExpr};`,
      '    fs.writeFileSync(outDir + "/" + rel, "x");',
      "  });",
      "}",
    ].join("\n"),
  });

  // ── ① 关键字判据 ─────────────────────────────────────────────────
  const H_KW = [
    'export const viaKw = (n: string, m: string): any => typeof m === "string" || n + ".md";',
    'export const viaKwDrop = (n: string, m: string): any => typeof m === "string" || "fixed.md";',
  ].join("\n");

  // ── ② getter 返回箭头（含同名三处的组成员完整性）─────────────────
  const H_GET = [
    "import * as fs from 'fs';",
    // 同一个文件里三个同名 getter，覆盖三类命运：
    //   无形参（判据①不收）/ 好 helper（确证）/ 体内有 sink（判据③不收）
    'export const ONoParam: any = { get mk() { return (): string => "fixed.md"; } };',
    'export const OSideCall: any = { get mk() { return (n: string): string => { __audit(n); return n + ".md"; }; } };',
    'export const OWithSink: any = { get mk() { return (n: string): void => { fs.writeFileSync(n, ""); }; } };',
  ].join("\n");
  const H_GET_CLS = [
    'export class CfgMk { get mk(): (n: string) => string { return (n: string): string => n + ".md"; } }',
  ].join("\n");
  const H_GET_DROP = [
    'export const OGet2: any = { get mk() { return (_n: string): string => "fixed.md"; } };',
  ].join("\n");

  // ── ③ 断言解包 ───────────────────────────────────────────────────
  const H_ASSERT = [
    'export const toPathAs = ((n: string): string => n + ".md") as (n: string) => string;',
    'export const toPathSat = ((n: string): string => n + ".md") satisfies (n: string) => string;',
    'export const ObjAs: any = { toPath: ((n: string): string => n + ".md") as any };',
    'export const notFn = (("x") as any);',
  ].join("\n");

  // ── ④ 柯里化多跳 ─────────────────────────────────────────────────
  const H_LVL = [
    'export const lvl3 = (a: string) => (b: string) => (n: string): string => n + a + b;',
    'export const lvl4 = (a: string) => (b: string) => (c: string) => (n: string): string => n + a + b + c;',
    'export const dropLast = (a: string) => (b: string) => (_n: string): string => "fixed.md";',
  ].join("\n");

  // ── ⑤ 工厂形态 ───────────────────────────────────────────────────
  const H_FACT = [
    "import * as fs from 'fs';",
    'export const factory = (ext: string) => ({ toPath: (n: string): string => n + ext });',
    'export const factoryDrop = (_ext: string) => ({ toPath: (_n: string): string => "fixed.md" });',
    'export const factorySink = (ext: string) => ({ toPath: (n: string): string => { fs.readFileSync(n); return ext; } });',
  ].join("\n");
  // 一个工厂返回含**两个**方法的对象：一个塑形、一个丢弃。
  // 这守的是「一个名字 → 多条链，按成员名选链」——选错就等于张冠李戴。
  const H_MIX = [
    'export const makeMixed = (ext: string) => ({',
    '  mix: (n: string): string => n + ext,',
    '  skip: (_n: string): string => "fixed.md",',
    '});',
  ].join("\n");

  // ── ⑥ 默认导出 ───────────────────────────────────────────────────
  const H_DEF = 'export default (n: string): string => n + ".md";';
  const H_DEF_DROP = 'export default (_n: string): string => "fixed.md";';
  const H_DEF_NOTFN = 'export default "fixed.md";';

  const cases: Case[] = [
    // ① 关键字
    { name: "正例·① 含 typeof 的 helper 要能进名录", fn: "emit", files: emit("viaKw(k, mode)", "", "viaKw", H_KW),
      expectMark: true, why: "旧代码把 typeof 当成未知自由标识符 ⇒ 整条判据不通过 ⇒ 漏报" },
    { name: "负对照·① 同形但返回值是常量", fn: "emit", files: emit("viaKwDrop(k, mode)", "", "viaKwDrop", H_KW),
      expectMark: false, why: "关键字放行不等于放水：依赖分析照旧；正对照 = 上一条" },

    // ② getter
    { name: "正例·② 类 getter 返回的箭头", fn: "emit", files: emit("new CfgMk().mk(k)", "", "CfgMk", H_GET_CLS),
      expectMark: true, why: "getter 不是方法声明（没有形参）⇒ 旧收集整族漏" },
    { name: "正例·② 对象 getter 返回的箭头", fn: "emit", files: emit("OSideCall.mk(k)", "", "OSideCall", H_GET),
      expectMark: true, why: "靠限定名 OSideCall.mk 接上（裸名 mk 因组里有未确证的实现而不放行）" },
    { name: "回归·⑦ 同名 getter 有一处无形参 ⇒ 成员位不许放行", fn: "emit", files: emit("ONoParam.mk(k)", "", "ONoParam", H_GET),
      expectMark: false, why: "组必须记全：进不了组的实现（判据①不成立）也算「不是全组确证」" },
    { name: "回归·⑦ 同名 getter 有一处体内有 sink ⇒ 成员位不许放行", fn: "emit", files: emit("OWithSink.mk(k)", "", "OWithSink", H_GET),
      expectMark: false, why: "同上，判据③不成立的那一处同样要进组" },
    { name: "负对照·② getter 返回的箭头丢弃形参", fn: "emit", files: emit("OGet2.mk(k)", "", "OGet2", H_GET_DROP),
      expectMark: false, why: "载体换了，收窄照旧；正对照 = ② 对象 getter" },

    // ③ 断言解包
    { name: "正例·③ as 断言包住箭头", fn: "emit", files: emit("toPathAs(k)", "", "toPathAs", H_ASSERT),
      expectMark: true, why: "初值是 AsExpression，旧代码只认「初值就是箭头」" },
    { name: "正例·③ satisfies 断言包住箭头", fn: "emit", files: emit("toPathSat(k)", "", "toPathSat", H_ASSERT),
      expectMark: true, why: "同族另一种写法" },
    { name: "正例·③ 成员位也要解断言", fn: "emit", files: emit("ObjAs.toPath(k)", "", "ObjAs", H_ASSERT),
      expectMark: true, why: "属性位的初值同样被断言包着" },
    { name: "负对照·③ as 包住的不是函数", fn: "emit", files: emit("notFn(k)", "", "notFn", H_ASSERT),
      expectMark: false, why: "解断言不等于把任意 as 表达式当 helper" },

    // ④ 柯里化多跳
    { name: "正例·④ 三跳柯里化", fn: "emit", files: emit('lvl3("a")("b")(k)', "", "lvl3", H_LVL),
      expectMark: true, why: "旧代码只吃两跳 ⇒ 三跳整条不展" },
    { name: "正例·④ 四跳柯里化", fn: "emit", files: emit('lvl4("a")("b")("c")(k)', "", "lvl4", H_LVL),
      expectMark: true, why: "链式消费各跳实参，跳数不设上限（爬取有界 4 层）" },
    { name: "正例·④ 三跳·污点在第一跳", fn: "emit", files: emit('lvl3(k)("a")("b")', "", "lvl3", H_LVL),
      expectMark: true, why: "首跳实参被闭包一路捕获" },
    { name: "负对照·④ 三跳·最后一跳丢弃形参", fn: "emit", files: emit('dropLast("a")("b")(k)', "", "dropLast", H_LVL),
      expectMark: false, why: "多跳之下依赖分析仍要生效；正对照 = ④ 三跳" },

    // ⑤ 工厂形态
    { name: "正例·⑤ 返回对象再取方法", fn: "emit", files: emit('factory(".md").toPath(k)', "", "factory", H_FACT),
      expectMark: true, why: "真正塑形的是返回出来的那个成员方法" },
    { name: "负对照·⑤ 工厂里方法丢弃形参", fn: "emit", files: emit('factoryDrop(".md").toPath(k)', "", "factoryDrop", H_FACT),
      expectMark: false, why: "镜像" },
    { name: "负对照·⑤ 工厂里方法体内有 sink", fn: "emit", files: emit('factorySink(".md").toPath(k)', "", "factorySink", H_FACT),
      expectMark: false, why: "判据③在链的最内层照旧生效" },
    { name: "正例·⑤ 工厂返回多个方法·取塑形那个", fn: "emit", files: emit('makeMixed(".md").mix(k)', "", "makeMixed", H_MIX),
      expectMark: true, why: "一个工厂名对多条链，按**成员名**选链" },
    { name: "负对照·⑤ 工厂返回多个方法·取丢弃那个", fn: "emit", files: emit('makeMixed(".md").skip(k)', "", "makeMixed", H_MIX),
      expectMark: false, why: "同名工厂的另条链返回常量 ⇒ 不许张冠李戴；正对照 = 上一条" },

    // ⑥ 默认导出
    { name: "正例·⑥ 匿名默认导出（名字来自导入方）", fn: "emit", files: emitDef("toPath(k)", 'import toPath from "./helpers";', H_DEF),
      expectMark: true, why: "匿名 default 没有名字可登记 ⇒ 只能用导入它的文件里起的本地名" },
    { name: "负对照·⑥ 匿名默认导出·丢弃形参", fn: "emit", files: emitDef("toPath(k)", 'import toPath from "./helpers";', H_DEF_DROP),
      expectMark: false, why: "镜像" },
    { name: "负对照·⑥ 默认导出的不是函数", fn: "emit", files: emitDef("toPath(k)", 'import toPath from "./helpers";', H_DEF_NOTFN),
      expectMark: false, why: "边界：不许乱收" },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
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
// E1：类方法的**真实调用**必须进 IR（2026-09-21）
//
// 命名说明：C4k 已被占用（容器承载轴「属性写入 ⇒ 容器传播」，实测收益上限 0，
// 判定不修，见设计稿 §十七）。本组是**提取器主干**，另开 E（Extractor）系列。
//
// 背景（Claude 补充的历史事实）：主 IR 循环的类方法分支自该功能诞生之日起
// 只调 computeMarkerCalls（产 __progmune_* 语义标记），从未调 extractDirectCalls
// （产真实调用名）；函数声明 / 箭头 / 包装箭头三个分支都是两行齐全。
// 结果：类方法的 calls 里永远只有标记、没有真实调用 ⇒ **状态机在 OO 代码上
// 拿不到输入**。FP 观测池实测：NestJS 切片 61 个函数里 59 个 calls 为空（97%），
// 池合计 197 个里 140 个空。此前未暴露是因为 taintpath 十一族语料全是函数载体。
//
// 判据：类方法条目的 calls 必须同时含「真实调用名」与「语义标记」——
//      本轮是**补**真实调用，不是拿它替换标记（负对照·②守这条）。
// ═══════════════════════════════════════════════════════════════

describe("E1：类方法的真实调用必须进 IR（此前只有标记，状态机拿不到输入）", () => {
  const cases: Array<{
    name: string;
    fn: string;
    files: Record<string, string>;
    /** 必须出现的调用名 */
    want: string[];
    /** 必须**不**出现的调用名（防修过头 / 守既有口径） */
    dontWant?: string[];
    why: string;
  }> = [
    // ── 正例：此前全空的五种已知形态 ──────────────────────────
    {
      name: "正例·① 类方法（同步）",
      fn: "C.m",
      files: {
        "a.ts": `
function helper() { return 1; }
export class C { m() { helper(); } }
`,
      },
      want: ["helper"],
      why: "最基础的类方法；此前 calls 为空",
    },
    {
      name: "正例·② 类方法（async / await）",
      fn: "C.m",
      files: {
        "a.ts": `
function helper() { return 1; }
export class C { async m() { await helper(); } }
`,
      },
      want: ["helper"],
      why: "async 方法体同样是 Block，此前一样空",
    },
    {
      name: "正例·③ 类方法经 this 成员调用",
      fn: "C.m",
      files: {
        "a.ts": `
export class C { private repo: any; m() { this.repo.save(); } }
`,
      },
      want: ["save"],
      why: "NestJS/TypeORM 的实际写法；属性访问取末端名",
    },
    {
      name: "正例·④ 类方法带装饰器",
      fn: "C.m",
      files: {
        "a.ts": `
function helper() { return 1; }
function Get(): any { return () => {}; }
export class C { @Get() m() { helper(); } }
`,
      },
      want: ["helper"],
      why: "装饰器不得影响方法体遍历",
    },
    {
      name: "正例·⑤ 构造函数注入（方法用注入进来的依赖）",
      fn: "C.m",
      files: {
        "a.ts": `
export class C { constructor(private repo: any) {} m() { this.repo.save(); } }
`,
      },
      want: ["save"],
      why: "DI 形态；探针里五种已知失效形态之一",
    },
    // ── 正例：顺手测到的、没人提过的形状 ──────────────────────
    {
      name: "正例·⑥ static 方法",
      fn: "C.m",
      files: {
        "a.ts": `
function helper() { return 1; }
export class C { static m() { helper(); } }
`,
      },
      want: ["helper"],
      why: "static 也在 getMethods() 内，同属本轮",
    },
    {
      name: "正例·⑦ private 方法",
      fn: "C.m",
      files: {
        "a.ts": `
function helper() { return 1; }
export class C { private m() { helper(); } }
`,
      },
      want: ["helper"],
      why: "可见性修饰符不得影响提取",
    },
    {
      name: "正例·⑧ 抽象类里的实现方法",
      fn: "C.m",
      files: {
        "a.ts": `
function helper() { return 1; }
export abstract class C { abstract a(): void; m() { helper(); } }
`,
      },
      want: ["helper"],
      why: "abstract 无体，但有体的方法照旧要提",
    },
    {
      name: "正例·⑨ 链式调用 this.a.b()",
      fn: "C.m",
      files: {
        "a.ts": `
export class C { a: any; m() { this.a.b(); } }
`,
      },
      want: ["b"],
      why: "末端名即被调用的方法名",
    },
    {
      name: "正例·⑩ 计算属性名方法",
      fn: "C.[K]",
      files: {
        "a.ts": `
function helper() { return 1; }
const K = "m";
export class C { [K]() { helper(); } }
`,
      },
      want: ["helper"],
      why: "名字解不解得出是另一回事，calls 不该受名字影响",
    },
    // ── 正对照：既有载体不得被误伤 ────────────────────────────
    {
      name: "正对照·⑪ 函数声明（基线）",
      fn: "plain",
      files: {
        "a.ts": `
function helper() { return 1; }
export function plain() { helper(); }
`,
      },
      want: ["helper"],
      why: "本轮只补类方法，函数声明分支不得回归",
    },
    {
      name: "正对照·⑫ 箭头函数（基线）",
      fn: "arrow",
      files: {
        "a.ts": `
function helper() { return 1; }
export const arrow = () => { helper(); };
`,
      },
      want: ["helper"],
      why: "同上；箭头分支不得回归",
    },
    // ── 负对照：防修过头 ─────────────────────────────────────
    {
      name: "负对照·① 嵌套箭头回调里的调用仍不提取",
      fn: "C.m",
      files: {
        "a.ts": `
function helper() { return 1; }
export class C { m() { setTimeout(() => { helper(); }, 0); } }
`,
      },
      want: ["setTimeout"],
      dontWant: ["helper"],
      why:
        "既有设计：extractDirectCalls 遇嵌套函数即 skip。已实测函数声明/箭头/类方法三者口径一致 ⇒ 本轮不动",
    },
    {
      name: "负对照·② 真实调用不得挤掉语义标记",
      fn: "Uploader.read",
      files: {
        "handler.ts": `
import * as fs from "fs";
export class Uploader {
  read(filePath: string) {
    return fs.readFileSync(filePath, "utf-8");
  }
}
export function dispatchTool(args: any) {
  const target = params.arguments.file_path;
  return new Uploader().read(target);
}
`,
      },
      want: ["readFileSync", PATH_MARK],
      why:
        "本轮是**补**真实调用，标记必须仍在——否则污点轴会整体倒退。" +
        "（写这条用例时先跑探针确认判据：marker 只在**调用方把污点传进来**时才注入到" +
        "被调用方，无调用方的类方法本就无 marker —— 探针 ①/④ 一致、②/③ 一致）",
    },
  ];

  for (const c of cases) {
    it(`${c.name} —— ${c.why}`, () => {
      const dir = makeProject(c.files);
      try {
        const calls = marksFor(dir, c.fn);
        for (const w of c.want) expect(calls).toContain(w);
        for (const d of c.dontWant ?? []) expect(calls).not.toContain(d);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 150_000);
  }
});
