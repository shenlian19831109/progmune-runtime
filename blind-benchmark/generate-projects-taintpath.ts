/**
 * Blind Benchmark — 污点/路径穿越（taintpath）语料族生成器
 *
 * 为什么要有这个族：
 *   TS 795 盲测对「路径穿越标记」连续三次【零覆盖】——语料里没有一个
 *   `不可信根 → 文件 sink` 的流，`__progmune_path_traversal__` 出现次数
 *   前 0 后 0。于是「3086 flags LOST 0 / ADDED 0」这道硬门在这项能力上
 *   是空过的：它证明不了任何关于 PATH_GUARD_EVIDENCE 的结论。
 *
 *   本族把 G1 的判别力要求（哪些形态算已校验、哪些不算）直接编码进盲测语料，
 *   使硬门重新变成真门。同时覆盖 C1/C2/C3（此前同样零覆盖）。
 *
 * 用法：npx ts-node blind-benchmark/generate-projects-taintpath.ts
 * 约定：只写自己前缀的目录，不清理其他语料（generate-projects.ts 会清理
 *       所有含 `_` 的目录，那是它的职责，不是本脚本的）。
 */

import * as fs from "fs";
import * as path from "path";

const GEN_DIR = path.resolve(__dirname, "generated");
const TSCONFIG = JSON.stringify(
  { compilerOptions: { target: "ES2020", module: "commonjs", strict: true, esModuleInterop: true }, include: ["src"] },
  null,
  2
);

export type Expect =
  | "mark"          // 必须标记 __progmune_path_traversal__
  | "suppressed"    // 有校验证据 → 不得标记（G-A..G-D）
  | "no-taint"      // 无污点流入 → 不得标记
  | "known-gap";    // 当前能力缺口：语义上应标记，实测不标记（xu 已知）

export interface TaintCase {
  fn: string;
  expect: Expect;
  why: string;
  /** 函数体（不含签名与收尾大括号） */
  body: string;
  /** 覆盖默认签名 `${fn}(req: any)` */
  sig?: string;
}

/**
 * A 族：HTTP 请求面（req/request 的 params|query|body|headers）
 * 同一个文件里同时放「必须标记」与「不得标记」的形态 —— 顺带验证
 * 守卫判定是【按函数】而不是按文件（若按文件，整族会被一条守卫压成 0）。
 */
export const CASES_A: TaintCase[] = [
  {
    fn: "readDirect",
    expect: "mark",
    why: "最小形态：req.params 直接进 readFileSync",
    body: `  return fs.readFileSync(ROOT_DIR + "/" + req.params.name, "utf-8");`,
  },
  {
    fn: "readViaQuery",
    expect: "mark",
    why: "req.query 进 sink（模板字符串形态）",
    body: `  return fs.readFileSync(\`\${ROOT_DIR}/\${req.query.name}\`, "utf-8");`,
  },
  {
    fn: "readViaLocal",
    expect: "mark",
    why: "污点经局部变量单跳进 sink",
    body: `  const name = req.body.file;
  return fs.readFileSync(ROOT_DIR + "/" + name, "utf-8");`,
  },
  {
    fn: "writeViaHeader",
    expect: "mark",
    why: "写侧 sink + request.headers 根",
    body: `  const name = request.headers["x-file-name"];
  return fs.writeFileSync(ROOT_DIR + "/" + name, reqRaw.body);`,
    sig: "writeViaHeader(request: any, reqRaw: any)",
  },
  {
    fn: "readBasename",
    expect: "known-gap",
    why: "N-A 的原意是「basename 不算守卫」（由 src/extract-ir-taint-guard.test.ts 用有影传播的正对照锁住）；本用例因为 C4 断链当前不标记，故记为 known-gap",
    body: `  const name = path.basename(req.params.name);
  return fs.readFileSync(ROOT_DIR + "/" + name, "utf-8");`,
  },
  {
    fn: "readLengthCheck",
    expect: "mark",
    why: "N-B：长度检查 ≠ 路径包含性检查",
    body: `  const name = req.params.name;
  if (name.length > 255) throw new Error("too long");
  return fs.readFileSync(ROOT_DIR + "/" + name, "utf-8");`,
  },
  {
    fn: "readNullCheck",
    expect: "mark",
    why: "N-D：空值检查 ≠ 路径检查",
    body: `  const name = req.params.name;
  if (!name) throw new Error("missing");
  return fs.readFileSync(ROOT_DIR + "/" + name, "utf-8");`,
  },
  {
    fn: "readResolveOnly",
    expect: "known-gap",
    why: "N-C 的原意是「只有 resolve 没有包含性比较不算守卫」；此处因 C4 断链当前不标记，故记为 known-gap",
    body: `  const base = path.resolve(ROOT_DIR);
  const target = path.resolve(base, req.params.name);
  return fs.readFileSync(target, "utf-8");`,
  },
  {
    fn: "readEnsureDirOnly",
    expect: "mark",
    why: "反例回归：ensureDir() 曾被 G-C 误判为守卫，导致召回归零",
    body: `  const name = req.params.name;
  ensureDir(ROOT_DIR);
  return fs.readFileSync(ROOT_DIR + "/" + name, "utf-8");`,
  },
  {
    fn: "readGuardWithin",
    expect: "suppressed",
    why: "G-A 目录包含性：resolve(p).startsWith(resolve(root))",
    body: `  const base = path.resolve(ROOT_DIR);
  const target = path.resolve(base, req.params.name);
  if (!target.startsWith(base)) throw new Error("outside root");
  return fs.readFileSync(target, "utf-8");`,
  },
  {
    fn: "readGuardFn",
    expect: "suppressed",
    why: "G-C 独立校验函数（fr-007 assertValidFlowId / fr-016 assertWithinDir 形态）",
    body: `  const name = req.params.name;
  assertSafePath(name);
  return fs.readFileSync(ROOT_DIR + "/" + name, "utf-8");`,
  },
  {
    fn: "readGuardPattern",
    expect: "suppressed",
    why: "G-D 锚定字符集白名单（fr-007 FLOW_ID_PATTERN 形态）",
    body: `  const name = req.params.name;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("bad id");
  return fs.readFileSync(ROOT_DIR + "/" + name, "utf-8");`,
  },
  {
    fn: "readGuardTraversal",
    expect: "suppressed",
    why: "G-B 上跳/绝对路径拒绝 —— 形态取自 fr-012 gitlab-mcp 下载侧真实守卫块",
    body: `  const localPath = req.params.local_path;
  const filename = req.params.filename;
  let savePath: string;
  if (localPath) {
    const normalized = path.normalize(localPath);
    if (
      path.isAbsolute(normalized) ||
      normalized === ".." ||
      normalized.startsWith(".." + path.sep) ||
      normalized.includes(path.sep + ".." + path.sep)
    ) {
      throw new Error("directory traversal is not allowed");
    }
    savePath = path.join(normalized, filename);
  } else {
    savePath = filename;
  }
  return fs.readFileSync(savePath, "utf-8");`,
  },
  {
    fn: "readConstant",
    expect: "no-taint",
    why: "无污点：常量路径不得标记（过度标记回归锁）",
    body: `  return fs.readFileSync(ROOT_DIR + "/index.html", "utf-8");`,
  },
  {
    fn: "readJoinWrapped",
    expect: "known-gap",
    why: "C4 召回缺口：污点经 path.join(processRoot, name) 包装后不再传播，当前不标记",
    body: `  const target = path.join(ROOT_DIR, req.params.name);
  return fs.readFileSync(target, "utf-8");`,
  },
  {
    fn: "readNormalizeWrapped",
    expect: "known-gap",
    why: "C4 召回缺口：污点经 path.normalize(x) 包装后不再传播，当前不标记",
    body: `  const target = path.normalize(req.params.name);
  return fs.readFileSync(target, "utf-8");`,
  },
];

/** A 族的辅助文件：把守卫函数与 ensureDir 反例实体化（否则不是合法 TS）。 */
const HELPERS_A = `
function assertSafePath(p: string): void {
  if (p.includes("..")) throw new Error("unsafe path");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
`;

function genProjectA(): string {
  const fns = CASES_A.map((c) => {
    const sig = c.sig || `${c.fn}(req: any)`;
    return `export function ${sig} {\n${c.body}\n}`;
  }).join("\n\n");

  return `// taintpath_A —— HTTP 请求面：不可信根 → 文件 sink 的判别力语料
// 期望详见 blind-benchmark/taintpath-expectations.json
import * as fs from "fs";
import * as path from "path";

const ROOT_DIR = "/srv/data";
${HELPERS_A}
${fns}
`;
}

/** B 族：MCP 工具实参面 + 跨文件/跨函数传播（覆盖 C1 顶层函数 / C2 裸调用） */
const STORE_B = `// taintpath_B —— 被调用方：sink 在形参上，自身不含任何不可信根
import * as fs from "fs";

const TPL_DIR = "/srv/templates";

export function loadTemplate(p: string): string {
  return fs.readFileSync(TPL_DIR + "/" + p, "utf-8");
}

export function writeRendered(p: string, data: string): void {
  fs.writeFileSync(TPL_DIR + "/" + p, data);
}

export class DocStore {
  load(p: string): string {
    return fs.readFileSync(TPL_DIR + "/" + p, "utf-8");
  }
}
`;

const HANDLER_B = `// taintpath_B —— 调用方：污点来自 MCP CallToolRequest.params.arguments
import { loadTemplate, writeRendered, DocStore } from "./store";

export function dispatchToolBare(params: any) {
  const args = params.arguments;
  return loadTemplate(args.name);
}

export function dispatchToolInline(params: any) {
  return loadTemplate(params.arguments.name);
}

export function dispatchToolMethod(params: any) {
  const store = new DocStore();
  return store.load(params.arguments.name);
}

export function dispatchToolWrite(params: any) {
  const args = params.arguments;
  writeRendered(args.name, args.content);
}

export function dispatchToolGuarded(params: any) {
  const args = params.arguments;
  assertTemplateName(args.name);
  return loadTemplate(args.name);
}

function assertTemplateName(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("bad template name");
}
`;

/** B 族期望：跨函数传播后，被调用方（store.ts）应被标记；credential 形态见 JSON */
export const CASES_B: Array<{ fn: string; file: string; expect: Expect; why: string }> = [
  { fn: "loadTemplate", file: "src/store.ts", expect: "mark", why: "C1/C2：污点经调用边流入顶层函数的 sink 形参" },
  { fn: "writeRendered", file: "src/store.ts", expect: "mark", why: "写侧：同上" },
  { fn: "load", file: "src/store.ts", expect: "mark", why: "C1：类方法 sink 形参" },
  { fn: "dispatchToolBare", file: "src/handler.ts", expect: "known-gap", why: "调用方自身无 sink 形参占位亦然，按现行管线不在调用方标记" },
  { fn: "dispatchToolGuarded", file: "src/handler.ts", expect: "known-gap", why: "同上；本用例真正锁的是 store 侧不受此处的守卫传播压制" },
];

function writeProject(id: string, files: Record<string, string>): void {
  const dir = path.join(GEN_DIR, id);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  console.log("wrote", id, "→", Object.keys(files).join(", "));
}

if (require.main === module) {
  writeProject("taintpath_A", { "src/paths.ts": genProjectA() });
  writeProject("taintpath_B", { "src/store.ts": STORE_B, "src/handler.ts": HANDLER_B });
}
