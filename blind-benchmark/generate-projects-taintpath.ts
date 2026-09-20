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

/**
 * C 族：文档/配置解析产物面 + 落盘封装（2026-09-19，3.7.38）
 *
 * 为什么必须补这一族：methodology R7 —— 门必须自己有覆盖。
 * fr-016 的两处修复（新增 runtime_key_enum / document_parse 根、methodSinkParamMap
 * 的 wrapper 继承）在既有的盲测语料上是**彻底空过**：实测 413 个 generated .ts
 * 文件里 `Object.keys/values/entries` 出现 **0 次**，也没有任何「自定义写封装 →
 * 内部 fs sink」的两跳结构。也就是说这一轮如果不加语料，TS 盲测的
 * 「LOST 0 / ADDED 0」跟「功能没写」无从区分。
 *
 * 形态种子全部来自 fr-016 真实修复（Redocly/redocly-cli split 命令）：
 *   handler.ts 的上游把 OpenAPI/AsyncAPI 文档 parseYaml 之后**作为形参**传入，
 *   函数体内没有任何解析调用，唯一入口是 `for (const n of Object.keys(doc))`；
 *   sink 侧则必经 writeToFileByExtension → writeYaml → fs.writeFileSync 两层自有封装。
 */
const WRAPPERS_C = `// taintpath_C —— 真实工程的落盘封装层：真正 fs 的是最里面一跳
import * as fs from "fs";
import * as path from "path";

export function writeYaml(data: any, filename: string): void {
  fs.writeFileSync(filename, String(data));
}

// 第 1 层 wrapper：把形参 filePath 原样转发到 writeYaml 的 sink 位
export function writeToFileByExtension(data: any, filePath: string): void {
  writeYaml(data, filePath);
}

// 第 2 层 wrapper：验证 sink 形参继承是有界闭包而非只做一跳
export function writeNested(data: any, filePath: string): void {
  writeToFileByExtension(data, filePath);
}

// 负对照用：形参落在 writeYaml 的【非 sink 位】
export function writeFrom(name: string, data: any): void {
  writeYaml(data, "/srv/out/fixed.yaml");
}

// 负对照用：不写文件的 helper（只是被调用，不构成 sink 继承）
export function touchPath(p: string): number {
  return p.length;
}

// fr-016 真修复新增的守卫函数（pre/post 唯一差别就是有没有调用它）
export function assertWithinDir(baseDir: string, targetPath: string, subject: string): void {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("Refusing to write " + subject + " outside the output directory.");
  }
}
`;

const HANDLER_C = `// taintpath_C —— 污点来自被解析好的外部文档（键名），经两层封装落盘
import { writeToFileByExtension, writeNested, writeFrom, touchPath, assertWithinDir } from "./wrappers";

// fr-016 pre 形态：必须标记
export function splitChannels(channels: Record<string, any>, outDir: string): void {
  for (const channelName of Object.keys(channels)) {
    const channelFile = \`\${outDir}/\${channelName}.yaml\`;
    writeToFileByExtension(channels[channelName], channelFile);
  }
}

// fr-016 post 形态：调了 assertWithinDir，必须不标记
export function splitChannelsGuarded(channels: Record<string, any>, asyncapiDir: string): void {
  for (const channelName of Object.keys(channels)) {
    const channelFile = \`\${asyncapiDir}/\${channelName}.yaml\`;
    assertWithinDir(asyncapiDir, channelFile, channelName);
    writeToFileByExtension(channels[channelName], channelFile);
  }
}

// 解构绑定：Object.entries 的 [k, v] 都要进污点集合
export function emitFromEntries(doc: Record<string, any>, outDir: string): void {
  for (const [name, value] of Object.entries(doc)) {
    const target = \`\${outDir}/\${name}.yaml\`;
    writeToFileByExtension(value, target);
  }
}

// 两层 wrapper：sink 形参继承须能通过闭包传下来
export function splitViaTwoHops(channels: Record<string, any>, outDir: string): void {
  for (const n of Object.keys(channels)) {
    writeNested(channels[n], \`\${outDir}/\${n}.yaml\`);
  }
}

// document_parse 根：JSON.parse 产物直接进 sink
export function emitFromParsed(text: string, outDir: string): void {
  const cfg = JSON.parse(text);
  writeToFileByExtension(cfg.data, \`\${outDir}/\${cfg.name}.yaml\`);
}

// 负对照：名字是代码写死的，不是运行时数据结构的产物
export function splitConstants(outDir: string): void {
  const names = ["users", "orders", "items"];
  for (const n of names) {
    writeToFileByExtension({}, \`\${outDir}/\${n}.yaml\`);
  }
}

// 负对照：helper 不写文件 ⇒ 不构成 sink 继承
export function touchOnly(doc: Record<string, any>, outDir: string): void {
  for (const n of Object.keys(doc)) {
    touchPath(\`\${outDir}/\${n}.yaml\`);
  }
}

// 负对照：形参落在被调用方的【非 sink 位】⇒ 不继承 sink
export function writeSwapped(doc: Record<string, any>): void {
  for (const n of Object.keys(doc)) {
    writeFrom(n, {});
  }
}
`;

/**
 * D 族：C4b（项目自有纯塑形 helper）+ C4c（迭代已被污染的聚合）
 * （2026-09-20，3.7.39）
 *
 * 为什么必须补这一族：还是 R7。这两处在既有盲测语料（含 C 族）上**仍然空过** ——
 * 实测 generated 全量 .ts 里「先收集再迭代」形态 0 处、「自有 path 塑形 helper」
 * 0 处。不加语料的话，TS 盲测的「LOST 0 / ADDED 0」跟「功能没写」无从区分。
 *
 * 形态种子同样来自 fr-016 真实修复：
 *   ① `const filename = getFileNamePath(componentDirPath, componentName, ext)`
 *      —— 项目自有 helper，C4 的塑形词表（node:path + String 原型方法）覆盖不到；
 *   ② `const ks = Object.keys(doc); for (const k of ks)` —— 被迭代对象已是变量。
 *
 * 守卫侧刻意用 `stamp`（不含任何 G-C 后缀）而不是 `assertWithinDir`：
 * 若压制真的发生，依据就只能是被调用方自身的证据（G2 tier-0），不是名字。
 */
const HELPERS_D = `// taintpath_D —— 项目自有的路径塑形 helper（fr-016 getFileNamePath 形态）
import * as fs from "fs";
import * as path from "path";

// 纯塑形：调用只有 path.join，自由标识符只有形参
export function getFileNamePath(dir: string, name: string, ext: string): string {
  return path.join(dir, name) + "." + ext;
}

// 纯塑形（两跳）：调用已认定的 helper，验有界不动点
export function withExt(p: string, ext: string): string {
  return p + "." + ext;
}
export function buildOutPath(dir: string, name: string, ext: string): string {
  return withExt(path.join(dir, name), ext);
}

// 判据②反例：体内有文件 sink ⇒ 不是纯塑形
export function getFileNamePathWithMkdir(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

// 判据③反例：return 引用了非形参的模块常量 ⇒ 认不出（保守导致的已知缺口）
const FIXED_DIR = "/srv/out";
export function getFileNamePathFixed(dir: string, name: string): string {
  return FIXED_DIR + name;
}

// R11 反例：字符过滤不算「纯塑形」的证据（.replace 是净化函数的常见实现）
export function sanitizeName(p: string): string {
  return p.replace(/[^a-z0-9]/gi, "");
}

// 真守卫，但名字不含任何 G-C 后缀 —— 用来验证压制靠的是被调用方自身的证据
export function stamp(baseDir: string, targetPath: string): void {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("path escapes output dir");
  }
}
`;

const HANDLER_D = `// taintpath_D —— C4b：污点穿过项目自有 helper；C4c：迭代已被污染的聚合
import * as fs from "fs";
import {
  getFileNamePath,
  buildOutPath,
  getFileNamePathWithMkdir,
  getFileNamePathFixed,
  sanitizeName,
  stamp,
} from "./helpers";

// C4b 正例：helper 可证明为纯塑形 ⇒ 污点穿过它
export function emitViaHelper(doc: Record<string, any>, outDir: string, ext: string): void {
  for (const name of Object.keys(doc)) {
    const file = getFileNamePath(outDir, name, ext);
    fs.writeFileSync(file, "x");
  }
}

// C4b 正例：helper 调 helper（两跳）
export function emitViaTwoHopHelper(doc: Record<string, any>, outDir: string, ext: string): void {
  for (const name of Object.keys(doc)) {
    const file = buildOutPath(outDir, name, ext);
    fs.writeFileSync(file, "x");
  }
}

// C4b × G2：helper 接通召回之后，守卫仍要压得住（守卫名 stamp 不含 G-C 后缀）
export function emitViaHelperGuarded(doc: Record<string, any>, outDir: string, ext: string): void {
  for (const name of Object.keys(doc)) {
    const file = getFileNamePath(outDir, name, ext);
    stamp(outDir, file);
    fs.writeFileSync(file, "x");
  }
}

// C4c 正例：先收集再迭代 —— 被迭代对象是已被污染的变量，不再是根表达式
export function emitCollectThenIterate(doc: Record<string, any>, outDir: string): void {
  const ks = Object.keys(doc);
  for (const k of ks) {
    fs.writeFileSync(outDir + "/" + k, "x");
  }
}

// C4c 正例：Object.values 收集后迭代，成员取值也要带出去
export function emitFromValues(doc: Record<string, any>, outDir: string): void {
  const vs = Object.values(doc);
  for (const v of vs) {
    fs.writeFileSync(outDir + "/" + v.name, "x");
  }
}

// 负对照：helper 体内有 sink ⇒ 不是纯塑形 ⇒ 不传播
export function emitHelperWithSink(doc: Record<string, any>, outDir: string): void {
  for (const name of Object.keys(doc)) {
    const file = getFileNamePathWithMkdir(outDir, name);
    fs.writeFileSync(file, "x");
  }
}

// 负对照：helper 的 return 引用模块常量 ⇒ 认不出（已知缺口，不是判对了）
export function emitHelperFixed(doc: Record<string, any>, outDir: string): void {
  for (const name of Object.keys(doc)) {
    const file = getFileNamePathFixed(outDir, name);
    fs.writeFileSync(file, "x");
  }
}

// 负对照：字符过滤 helper 不算纯塑形（R11）
export function emitSanitizedHelper(doc: Record<string, any>, outDir: string): void {
  for (const name of Object.keys(doc)) {
    const file = sanitizeName(name);
    fs.writeFileSync(outDir + "/" + file, "x");
  }
}

// 负对照：根在、helper 在，但传进去的是字面量 —— 不是「见到 helper 就标记」
export function emitLiteralArgs(doc: Record<string, any>, outDir: string, ext: string): void {
  const all = Object.keys(doc);
  if (all.length === 0) return;
  const file = getFileNamePath(outDir, "fixed", ext);
  fs.writeFileSync(file, "x");
}

// 负对照：聚合本身无污点（迭代的是字面量数组）
export function emitUntrackedAggregate(doc: Record<string, any>, outDir: string): void {
  const all = Object.keys(doc);
  if (all.length === 0) return;
  const ks = ["a", "b"];
  for (const k of ks) {
    fs.writeFileSync(outDir + "/" + k, "x");
  }
}
`;

/**
 * E 族：高阶枚举方法的回调形参（C4d，2026-09-20）
 *
 * R7 第三次咬人：C4d 在含 A–D 族的既有语料上同样是【空过】——实测 generated
 * 全量 .ts 里 `.forEach/.map/.flatMap/.filter` 回调形参 0 处。所以不加语料，
 * 「LOST 0 / ADDED 0」跟「功能没写」无从区分。
 *
 * 形态种子：`Object.keys(doc).forEach(k => …)` 与 for-of 语义等价（形参 = 被
 * 枚举到的元素），是 fr-016 那类文档导出代码的另一种写法。
 *
 * 两条设计约定：
 *   ① 守卫侧仍用 stamp（不含 G-C 后缀），压制若发生只能依据被调用方自身证据；
 *   ② 负对照 emitForEachIndexOnly 只把【索引】写进路径 —— 用于钉死「只绑第一个
 *      形参」，否则把第二个形参（index）也当元素会立刻产生误报。
 */
const HELPERS_E = `// taintpath_E —— C4d 的守卫侧与塑形侧（与 D 族同名不同文件，保持族自洽）
import * as path from "path";

// 纯塑形 helper（C4b 判据全中）
export function getFileNamePath(dir: string, name: string, ext: string): string {
  return path.join(dir, name) + "." + ext;
}

// 真守卫，名字不含任何 G-C 后缀 —— 压制依据只能是被调用方自身证据（G2 tier-0）
export function stamp(baseDir: string, targetPath: string): void {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("path escapes output dir");
  }
}
`;

const HANDLER_E = `// taintpath_E —— C4d：高阶枚举方法的回调形参必须绑定
import * as fs from "fs";
import { getFileNamePath, stamp } from "./helpers";

// 正例：Object.keys 后接 forEach
export function emitForEachKeys(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    fs.writeFileSync(outDir + "/" + k, "x");
  });
}

// 正例：map 回调（无括号形参形态）
export function emitMapKeys(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).map((k) => {
    fs.writeFileSync(outDir + "/" + k, "x");
    return k;
  });
}

// 正例：entries + 解构形参（两个都是元素）
export function emitEntriesForEach(doc: Record<string, any>, outDir: string): void {
  Object.entries(doc).forEach(([k, v]) => {
    fs.writeFileSync(outDir + "/" + k, String(v));
  });
}

// 正例：先收集再 forEach —— 接收者已是被污染的变量
export function emitCollectThenForEach(doc: Record<string, any>, outDir: string): void {
  const ks = Object.keys(doc);
  ks.forEach((k) => {
    fs.writeFileSync(outDir + "/" + k, "x");
  });
}

// 正例：async 回调（Promise.all + map 的并发写法）
export function emitValuesMapAsync(doc: Record<string, any>, outDir: string): void {
  const vs = Object.values(doc);
  Promise.all(vs.map(async (v) => {
    fs.writeFileSync(outDir + "/" + v.name, "x");
  }));
}

// 正例：C4d × C4b —— 回调形参还要能穿过项目自有 helper
export function emitForEachHelper(doc: Record<string, any>, outDir: string, ext: string): void {
  Object.keys(doc).forEach((k) => {
    const file = getFileNamePath(outDir, k, ext);
    fs.writeFileSync(file, "x");
  });
}

// 压制对照：召回接通后守卫仍要压得住（stamp 不含 G-C 后缀，靠自身证据）
export function emitForEachGuarded(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const file = outDir + "/" + k;
    stamp(outDir, file);
    fs.writeFileSync(file, "x");
  });
}

// 负对照：只把【索引】写进路径 —— 第二个形参不是元素，绑了就是误报
export function emitForEachIndexOnly(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k, i) => {
    fs.writeFileSync(outDir + "/" + i, "x");
  });
}

// 负对照：字面量数组回调 —— 无污点流入
export function emitForEachLiteral(outDir: string): void {
  ["a", "b"].forEach((k) => {
    fs.writeFileSync(outDir + "/" + k, "x");
  });
}

// 负对照：根在、迭代的是干净变量 —— 证明绑的是【接收者是否污】不是「函数里有污点」
export function emitForEachCleanVar(doc: Record<string, any>, outDir: string): void {
  const all = Object.keys(doc);
  if (all.length === 0) return;
  const ks = ["a", "b"];
  ks.forEach((k) => {
    fs.writeFileSync(outDir + "/" + k, "x");
  });
}

// C4d-b：无括号单参箭头 —— 初版正则只认带括号的箭头，这种写法漏
export function emitForEachNoParen(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach(k => {
    fs.writeFileSync(outDir + "/" + k, "x");
  });
}

// C4d-b：ES5 function 回调 —— 不是箭头，但形参同样是元素
export function emitForEachFunctionCb(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach(function (k) {
    fs.writeFileSync(outDir + "/" + k, "x");
  });
}

// C4d-b：接收者隔着一层成员 —— doc 已污，其成员枚举出来的元素同样是污点数据
export function emitMemberChainForEach(raw: string, outDir: string): void {
  const doc = JSON.parse(raw);
  doc.sections.forEach((s: any) => {
    fs.writeFileSync(outDir + "/" + s.name, "x");
  });
}

// 负对照：回调是【函数引用】而不是内联函数 —— handleOne 是别人函数的名字，
// 不是被枚举的元素。初版把这类名字当形参绑进污点集合，于是同名变量（下面
// const handleOne）会被当成污点 → 误标。本条锁住这个修复。
export function emitForEachNamedHandler(doc: Record<string, any>, outDir: string): void {
  const handleOne = outDir + "/fixed";
  Object.keys(doc).forEach(handleOne);
  fs.writeFileSync(handleOne + "/" + "index.md", "x");
}

// 负对照：干净对象的成员链枚举 —— 无污点流入；正对照 = emitMemberChainForEach
export function emitMemberChainClean(outDir: string, cfg: { sections: Array<{ name: string }> }): void {
  cfg.sections.forEach((s) => {
    fs.writeFileSync(outDir + "/" + s.name, "x");
  });
}
`;

// ═══════════════════════════════════════════════════════════════
// taintpath_F —— C4e：helper 的现代写法（箭头 / 函数表达式 / 引用模块常量）
//
// R7 第五次：实测 generated 全量 .ts 里 `export const X = (…) =>` 形态 **0 处**，
// A–E 族对这条能力同样是空过。C4b 落地时只收黎明函数声明
// （sf.getFunctions()），而真实 TS 工程里 helper 主力写就是箭头常量。
//
// 写法约定（与 E 族同源）：sink 实参里**不直接出现**污点变量 k —— 污点只能
// 经 helper 的返回值流进 sink。否则会命中「实参含污点名」的兜底判定，
// 测的就不是 helper 传播了（2026-09-20 第一版探针踩到，全部用例假通过）。
// ═══════════════════════════════════════════════════════════════
const HELPERS_F = `// taintpath_F —— C4e：helper 的现代写法
import * as p from "path";

// 模块级字面量常量 —— helper 的 return 引用它仍是纯塑形
const EXT_DOC = ".doc";

// 箭头 helper（简洁体）
export const withExtArrow = (name: string): string => name + ".md";

// 箭头 helper（块体 + return）
export const withExtBlock = (name: string): string => {
  return name + ".md";
};

// 函数表达式 helper
export const withExtExpr = function (name: string): string { return name + ".md"; };

// 引用模块级字面量常量
export const withConst = (name: string): string => name + EXT_DOC;

// 引用 path 模块的局部别名 —— 别名随项目各异，但出处可确证
export const joinOut = (name: string): string => p.join("out", name);

// 两跳：箭头 helper 调用另一个箭头 helper
export const wrapTwice = (n: string): string => withExtArrow(n);

// 认不出的 helper：调用项目内没有定义的函数 —— 一律不传播
export const viaExternal = (name: string): string => lookupUnknown(name);

// 负例 helper：体内有 sink（判据②）—— 即使是箭头也不得认定为纯塑形
import * as fsx from "fs";
export const sneakyArrow = (name: string): string => {
  fsx.existsSync(name);
  return name + ".md";
};

// 真守卫，名字不含任何 G-C 后缀（G2 tier-0 自身证据）
export function stamp(baseDir: string, targetPath: string): void {
  const base = p.resolve(baseDir);
  const target = p.resolve(targetPath);
  if (target !== base && !target.startsWith(base + p.sep)) {
    throw new Error("path escapes output dir");
  }
}
`;

const HANDLER_F = `// taintpath_F —— C4e：helper 的现代写法必须照样传播
import * as fs from "fs";
import {
  withExtArrow, withExtBlock, withExtExpr, withConst, joinOut,
  wrapTwice, viaExternal, sneakyArrow, stamp,
} from "./helpers";

// 正例：箭头 helper（简洁体）
export function emitArrowHelper(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const rel = withExtArrow(k);
    fs.writeFileSync(outDir + "/" + rel, "x");
  });
}

// 正例：箭头 helper（块体 + return）
export function emitArrowBlockHelper(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const rel = withExtBlock(k);
    fs.writeFileSync(outDir + "/" + rel, "x");
  });
}

// 正例：函数表达式 helper
export function emitFnExprHelper(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const rel = withExtExpr(k);
    fs.writeFileSync(outDir + "/" + rel, "x");
  });
}

// 正例：helper 的 return 引用模块级字面量常量
export function emitModuleConstHelper(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const rel = withConst(k);
    fs.writeFileSync(outDir + "/" + rel, "x");
  });
}

// 正例：path 模块的局部别名
export function emitPathAliasHelper(doc: Record<string, any>): void {
  Object.keys(doc).forEach((k) => {
    const rel = joinOut(k);
    fs.writeFileSync(rel, "x");
  });
}

// 正例：两跳（箭头 → 箭头）
export function emitArrowTwoHop(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const rel = wrapTwice(k);
    fs.writeFileSync(outDir + "/" + rel, "x");
  });
}

// 压制对照：召回放宽到箭头 helper 之后，守卫仍要压得住
export function emitArrowGuarded(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const file = outDir + "/" + withExtArrow(k);
    stamp(outDir, file);
    fs.writeFileSync(file, "x");
  });
}

// 负对照：helper 调用项目内不存在的函数 —— 认不出的一律不传播
export function emitUnknownHelper(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const rel = viaExternal(k);
    fs.writeFileSync(outDir + "/" + rel, "x");
  });
}

// 负对照：helper 体内有 sink（判据②）—— 箭头同样不得豁免
export function emitSinkHelper(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach((k) => {
    const rel = sneakyArrow(k);
    fs.writeFileSync(outDir + "/" + rel, "x");
  });
}

// 负对照：helper 是真塑形，但喂进去的是字面量 —— 无污点流入
export function emitArrowLiteral(doc: Record<string, any>, outDir: string): void {
  Object.keys(doc).forEach(() => {
    const rel = withExtArrow("static");
    fs.writeFileSync(outDir + "/" + rel, "x");
  });
}
`;

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
  writeProject("taintpath_C", { "src/wrappers.ts": WRAPPERS_C, "src/handler.ts": HANDLER_C });
  writeProject("taintpath_D", { "src/helpers.ts": HELPERS_D, "src/handler.ts": HANDLER_D });
  writeProject("taintpath_E", { "src/helpers.ts": HELPERS_E, "src/handler.ts": HANDLER_E });
  writeProject("taintpath_F", { "src/helpers.ts": HELPERS_F, "src/handler.ts": HANDLER_F });
}
