import { Project, Node, FunctionDeclaration, VariableStatement, ArrowFunction, Type, CallExpression, SourceFile } from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";

export interface ParamInfo {
  name: string;
  type: string;          // 保留字符串形式
  typeDetail?: string;   // 结构化类型表示（如 "string | null", "Promise<User>"）
}

export interface FunctionInfo {
  name: string;
  params: ParamInfo[];
  returnType: string;
  returnTypeDetail?: string;
  file: string;
  calls?: string[];
  /** 是否为导出函数（只有导出的才能被 import） */
  exported?: boolean;
  /** 外部导入函数（非本项目声明） */
  external?: boolean;
  /** 外部函数的描述 */
  description?: string;
  /** 声明类名（Java 提取器捕获；用于接收者限定名匹配 Class.method） */
  className?: string;
  /** Phase 7: Capability Graph */
  purpose?: string;           // @purpose JSDoc tag
  tags?: string[];            // @tags JSDoc tag (comma-separated)
  inputs?: string[];          // auto-derived from param types
  outputs?: string[];         // auto-derived from return type
  requires?: string[];        // @requires JSDoc tag — capability prerequisites
  produces?: string[];        // @produces JSDoc tag — capability outcomes
  useWhen?: string[];         // @useWhen JSDoc tag — scenarios when to use this function
  protocol?: {
    pre_states: string[];
    post_states: string[];
    invalidate?: string[];
    namespace?: string;
  };
}

/** 从 JSDoc 注释中解析 capability 注解 (@purpose, @tags, @requires, @produces) */
function parseCapabilityFromJSDoc(node: any): { purpose?: string; tags?: string[]; requires?: string[]; produces?: string[]; useWhen?: string[] } {
  const jsdocs = node.getJsDocs?.();
  if (!jsdocs || jsdocs.length === 0) return {};
  const result: { purpose?: string; tags?: string[]; requires?: string[]; produces?: string[]; useWhen?: string[] } = {};
  for (const doc of jsdocs) {
    // @purpose: full description text (all lines before any @tag)
    const fullText = doc.getFullText?.() || "";
    // Extract description: everything between "/**" and the first "@tag"
    const descMatch = fullText.match(/\/\*\*\s*\n?\s*\*?\s*([^@]*)/);
    if (descMatch) {
      const desc = descMatch[1].replace(/\n\s*\*\s*/g, " ").trim();
      if (desc && !desc.startsWith("@")) {
        result.purpose = desc;
      }
    }
    // Fallback: use getComment()
    if (!result.purpose) {
      const comment = doc.getComment?.() || "";
      if (comment && !comment.startsWith("@")) {
        result.purpose = comment.split("\n")[0].trim();
      }
    }
    // @tags from ts-morph tag system
    const tsTags = doc.getTags?.();
    if (tsTags) {
      for (const t of tsTags) {
        const tn = t.getTagName?.();
        if (tn === "tags" || tn === "tag") {
          const val = t.getCommentText?.() || "";
          result.tags = val.split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean);
        }
        if (tn === "requires") {
          const val = t.getCommentText?.() || "";
          if (!result.requires) result.requires = [];
          result.requires.push(...val.split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean));
        }
        if (tn === "produces") {
          const val = t.getCommentText?.() || "";
          if (!result.produces) result.produces = [];
          result.produces.push(...val.split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean));
        }
        if (tn === "useWhen") {
          const val = t.getCommentText?.() || "";
          if (!result.useWhen) result.useWhen = [];
          result.useWhen.push(...val.split(/[;；]/).map((s: string) => s.trim()).filter(Boolean));
        }
      }
    }
  }
  return result;
}

/** Auto-derive tags from function's source file name */
function deriveTagsFromFile(filePath: string): string[] {
  const name = filePath.replace(/\.ts$/, "").replace(/^src\//, "");
  const tags = name.split(/[\/\-]/).filter(t => t.length > 2 && t !== "src");
  return [...new Set(tags)];
}

/** 从 JSDoc 注释中解析 @protocol 注解 */
function parseProtocolFromJSDoc(node: any): FunctionInfo['protocol'] | undefined {
  const jsdocs = node.getJsDocs?.();
  if (!jsdocs || jsdocs.length === 0) return undefined;
  for (const doc of jsdocs) {
    const tags = doc.getTags?.();
    if (!tags) continue;
    for (const tag of tags) {
      const tagName = tag.getTagName?.();
      if (tagName !== 'protocol') continue;
      const text = tag.getCommentText?.() || '';
      // 解析格式: namespace=file pre_states=["A","B"] post_states=["C"] invalidate=["A"]
      try {
        const nsMatch = text.match(/namespace\s*=\s*(\w+)/);
        const preMatch = text.match(/pre_states\s*=\s*\[([^\]]*)\]/);
        const postMatch = text.match(/post_states\s*=\s*\[([^\]]*)\]/);
        const invMatch = text.match(/invalidate\s*=\s*\[([^\]]*)\]/);
        // 非规则注解（如文件头文档正文中的 "@protocol" 字样被 ts-morph 解析为 tag）
        // → 跳过继续找下一个 @protocol tag，而不是直接放弃
        if (!preMatch || !postMatch) continue;
        const namespace = nsMatch ? nsMatch[1] : undefined;
        const pre_states = preMatch[1].split(',').map((s: string) => s.trim().replace(/["']/g, '')).filter(Boolean);
        const post_states = postMatch[1].split(',').map((s: string) => s.trim().replace(/["']/g, '')).filter(Boolean);
        const invalidate = invMatch
          ? invMatch[1].split(',').map((s: string) => s.trim().replace(/["']/g, '')).filter(Boolean)
          : undefined;
        return { pre_states, post_states, invalidate, namespace };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// 获取类型节点的结构化描述
function getTypeDetail(typeNode: any): string {
  if (!typeNode) return "";
  const text = typeNode.getText();
  // 简单处理联合类型
  if (Node.isUnionTypeNode(typeNode)) {
    return typeNode.getTypeNodes().map((t: any) => getTypeDetail(t)).join(" | ");
  }
  // 处理泛型
  if (Node.isTypeReference(typeNode)) {
    const typeName = typeNode.getTypeName().getText();
    const typeArgs = typeNode.getTypeArguments();
    if (typeArgs.length > 0) {
      const args = typeArgs.map((ta: any) => getTypeDetail(ta)).join(", ");
      return `${typeName}<${args}>`;
    }
    return typeName;
  }
  // 处理数组/元组
  if (Node.isArrayTypeNode(typeNode)) {
    return getTypeDetail(typeNode.getElementTypeNode()) + "[]";
  }
  // 其他类型直接返回文本
  return text;
}

function getParamType(param: any): string {
  const typeNode = param.getTypeNode?.();
  return typeNode ? typeNode.getText() : "any";
}

function getParamTypeDetail(param: any): string {
  const typeNode = param.getTypeNode?.();
  return typeNode ? getTypeDetail(typeNode) : "";
}

function getReturnType(func: FunctionDeclaration | ArrowFunction): string {
  const typeNode = func.getReturnTypeNode?.();
  return typeNode ? typeNode.getText() : "any";
}

function getReturnTypeDetail(func: FunctionDeclaration | ArrowFunction): string {
  const typeNode = func.getReturnTypeNode?.();
  return typeNode ? getTypeDetail(typeNode) : "";
}

/** Derive input types from params (auto-capability graph). */
function deriveInputs(params: any[]): string[] {
  return params.map(p => {
    const t = (p.type || "any").replace(/\[\]$/, "").replace(/<[^>]*>/g, "");
    return t.split("|")[0].trim();
  }).filter(t => t !== "any" && t !== "void");
}

/** Derive output types from return type (auto-capability graph). */
function deriveOutputs(returnType: string): string[] {
  const t = returnType.replace(/\[\]$/, "").replace(/<[^>]*>/g, "").split("|")[0].trim();
  return (t === "void" || t === "any") ? [] : [t];
}

// ═══════════════════════════════════════════════════════════════
// P0: Original tsconfig reader + manual module resolution
// Handles bundler path aliases, NodeNext .js→.ts, extends chain
// ═══════════════════════════════════════════════════════════════

interface OriginalTsConfig {
  paths?: Record<string, string[]>;
  baseUrl?: string;
  moduleResolution?: string;
}

/** Read tsconfig.json resolving the extends chain via TypeScript's config parser. */
function readOriginalTsConfig(tsconfigPath: string): OriginalTsConfig | null {
  try {
    const raw = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (raw.error) return null;
    const parsed = ts.parseJsonConfigFileContent(
      raw.config,
      ts.sys,
      path.dirname(tsconfigPath)
    );
    if (parsed.errors?.length > 0) {
      // Non-fatal — config may still be usable
    }
    const co = parsed.options;
    // Convert numeric ModuleResolutionKind to string
    let modRes: string | undefined;
    if (co.moduleResolution !== undefined && typeof co.moduleResolution === 'number') {
      modRes = ts.ModuleResolutionKind[co.moduleResolution];
    }
    return {
      paths: (co.paths && Object.keys(co.paths).length > 0) ? co.paths as Record<string, string[]> : undefined,
      baseUrl: co.baseUrl,
      moduleResolution: modRes?.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Manual module resolution for bundler/NodeNext projects.
 * Falls back after ts-morph's built-in resolution fails.
 */
function manualResolveModule(
  moduleSpecifier: string,
  sourceFilePath: string,
  projectRoot: string,
  originalConfig: OriginalTsConfig | null
): string | null {
  if (!moduleSpecifier || !moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('@')) {
    return null; // Not a relative or aliased import — skip
  }

  // ── 1. Path alias resolution (bundler) ──
  if (originalConfig?.paths) {
    const baseUrlPath = originalConfig.baseUrl
      ? path.resolve(projectRoot, originalConfig.baseUrl)
      : projectRoot;

    for (const [aliasPattern, targets] of Object.entries(originalConfig.paths)) {
      // Convert TypeScript glob pattern to regex: "@/*" → /^@\/(.*)$/
      // Handle both glob ("@/*") and bare ("libnpmconfig") aliases
      const hasWildcard = aliasPattern.includes('*');
      let wildcard = '';
      let matched = false;

      if (hasWildcard) {
        const aliasRegexSrc = '^' + aliasPattern.replace(/\*/g, '(.*)') + '$';
        const aliasRegex = new RegExp(aliasRegexSrc);
        const match = moduleSpecifier.match(aliasRegex);
        if (!match) continue;
        wildcard = match[1] || '';
        matched = true;
      } else {
        // Bare alias: must be an exact match
        if (moduleSpecifier !== aliasPattern && !moduleSpecifier.startsWith(aliasPattern + '/')) {
          continue;
        }
        matched = true;
        // For bare alias with subpath: "libnpmconfig/foo" → wildcard = "/foo"
        if (moduleSpecifier.startsWith(aliasPattern + '/')) {
          wildcard = moduleSpecifier.slice(aliasPattern.length); // "/foo"
        }
      }

      if (!matched) continue;

      for (const target of targets) {
        const resolvedRel = hasWildcard ? target.replace(/\*/g, wildcard) : (target + wildcard);
        const candidateBase = path.resolve(baseUrlPath, resolvedRel);

        // Try candidate as a file first
        try {
          const st = fs.statSync(candidateBase);
          if (st.isFile()) return candidateBase;
        } catch {}

        // Try adding .ts / .tsx / .d.ts extensions
        for (const ext of ['.ts', '.tsx', '.d.ts']) {
          try {
            const withExt = candidateBase + ext;
            const st = fs.statSync(withExt);
            if (st.isFile()) return withExt;
          } catch {}
        }

        // Try as directory with index file
        try {
          const idxTs = path.join(candidateBase, 'index.ts');
          if (fs.statSync(idxTs).isFile()) return idxTs;
        } catch {}
        try {
          const idxTsx = path.join(candidateBase, 'index.tsx');
          if (fs.statSync(idxTsx).isFile()) return idxTsx;
        } catch {}
      }
      break; // First matching alias pattern wins
    }
  }

  // ── 2. NodeNext .js → .ts mapping ──
  if (moduleSpecifier.startsWith('.')) {
    const sourceDir = path.dirname(sourceFilePath);

    // Try the specifier as-is first (extensionless or explicit)
    for (const suffix of ['', '.ts', '.tsx', '.d.ts']) {
      try {
        const candidate = path.resolve(sourceDir, moduleSpecifier + suffix);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }

    // NodeNext style: "./foo.js" → "./foo.ts"
    if (moduleSpecifier.endsWith('.js') || moduleSpecifier.endsWith('.jsx')) {
      const stripped = moduleSpecifier.replace(/\.jsx?$/, '');
      for (const suffix of ['.ts', '.tsx', '.d.ts']) {
        try {
          const candidate = path.resolve(sourceDir, stripped + suffix);
          if (fs.statSync(candidate).isFile()) return candidate;
        } catch {}
      }
    }

    // Try as directory with index file
    try {
      const idxTs = path.resolve(sourceDir, moduleSpecifier, 'index.ts');
      if (fs.existsSync(idxTs)) return idxTs;
    } catch {}
    try {
      const idxTsx = path.resolve(sourceDir, moduleSpecifier, 'index.tsx');
      if (fs.existsSync(idxTsx)) return idxTsx;
    } catch {}
  }

  return null;
}

function extractDirectCalls(func: FunctionDeclaration | ArrowFunction, preText?: string): string[] {
  const body = func.getBody();
  if (!body) return [];
  const calls: string[] = [];
  body.forEachDescendant((node, traversal) => {
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (Node.isIdentifier(expr)) calls.push(expr.getText());
      else if (Node.isPropertyAccessExpression(expr)) calls.push(expr.getName());
    }
    if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node)) traversal.skip();
  });
  // Semantic markers (mirroring the Python extractor):
  // - token issuance: set_cookie calls or token/session-named assignments —
  //   the Token Security rule's requireMarker precondition consumes it.
  // - inline ownership comparison: ownerId/authorId compared with ==/!== —
  //   the Ownership Check rules' satisfier consumes it (the call-name
  //   interface cannot see inline comparisons).
  const text = preText !== undefined ? preText : func.getText();
  if (/set_cookie\(|setCookie\(|\btoken\s*[:=]|\bsession_token\s*[:=]/.test(text)) {
    calls.push("__progmune_token_issued__");
  }
  if (/ownerId\s*[!=]==?|authorId\s*[!=]==?|createdBy\s*[!=]==?|\.owner\s*[!=]==?|userId\s*[!=]==?/.test(text)) {
    calls.push("__progmune_ownership_checked__");
  }
  return [...new Set(calls)];
}



// ═══════════════════════════════════════════════════════════════
// Path traversal marker（2026-09-11，REALWORLD_FIX_REGRESSION_V1 fr-007）
// 镜像 tools/extract_ir.py 的 request 污点 → 文件 sink 单跳追踪，另补
// 跨函数一跳：调用点把污点实参传给项目方法，该方法体内对应参数流入
// 文件 sink → 在调用方函数注入 __progmune_path_traversal__。
// 消费方：protocol-domain-validator 的 PATH_TRAVERSAL 检查（引擎路径）
// 与 protocol-detector 的同名规则（source-level benchmark 路径）。
// ═══════════════════════════════════════════════════════════════

const PATH_TRAVERSAL_MARKER = "__progmune_path_traversal__";

// ═══════════════════════════════════════════════════════════════
// G1 PATH_GUARD_EVIDENCE —— 路径穿越的「校验识别」（2026-09-19）
//
// 背景：路径穿越标记此前是 `taint → file sink ⇒ 标记`，**不看中间有没有校验**；
// SSRF 侧不是这样（`taint → fetch sink 且无 SSRF_GUARD_EVIDENCE ⇒ 标记`）。
// 两侧数据流同构、判别力差一档 —— 这正是根集合不敢放宽的真正原因。
//
// 本表把路径侧改成与 SSRF 对齐：`taint → file sink 且无校验证据 ⇒ 标记`。
//
// 每条规则的种子都来自语料真实修复的逐字形态（不是拍脑袋设计的词表），
// `source` 字段记录出处，改动词条必须同时更新出处。
// ═══════════════════════════════════════════════════════════════
interface PathGuardRule {
  id: string;
  re: RegExp;
  why: string;
  source: string;
}

const PATH_GUARD_RULES: PathGuardRule[] = [
  {
    id: "G-A",
    // resolve(p).startsWith(resolve(root)+sep) / x.startsWith(baseDir)
    re: /(?:resolve|realpath|normalize)\s*\([^()]*\)\s*\.\s*startsWith\s*\(/,
    why: "目录包含性校验（canonical 形态）：规范化后判断是否落在基目录内",
    source: "设计形态，canonical；fr-016 Redocly 修复的同族（见 G-C）",
  },
  {
    id: "G-A2",
    re: /\.\s*startsWith\s*\(\s*[A-Za-z_$][\w$]*(?:[Bb]ase|[Rr]oot|[Dd]ir|Dir|Root|Base)[\w$]*\s*\)/,
    why: "目录包含性校验（基目录名形态）：startsWith(baseDir/rootDir/...)",
    source: "设计形态，canonical",
  },
  {
    id: "G-B1",
    re: /\b(?:path\.)?isAbsolute\s*\(/,
    why: "绝对路径拒绝：绝对路径不受 join(root, p) 约束",
    source: "fr-012 gitlab-mcp 下载侧 localPath 既有守卫块（pre/post 同一段，@ index.ts:7968）",
  },
  {
    id: "G-B2",
    // startsWith(".." + sep) / includes(sep + ".." + sep) / === ".."
    re: /\.\s*(?:startsWith|includes)\s*\(\s*(?:[^()]*["'`]\.\.)/,
    why: "上跳拒绝：显式检测 .. 段",
    source: "fr-012 gitlab-mcp 下载侧 localPath 既有守卫块（index.ts:7968-7977）",
  },
  {
    id: "G-B3",
    re: /(?:===?|!==)\s*["'`]\.\.["'`]/,
    why: "上跳拒绝：与 .. 字面量直接比较",
    source: "fr-012 gitlab-mcp 下载侧 localPath 既有守卫块（normalizedLocalPath === \"..\"）",
  },
  // 注：G-C 不放在本数组里——它是「按函数名判定」，需要配反例名单
  // （见 PATH_GUARD_FN_CALL_RE / PATH_GUARD_FN_DENY 与下方注释）。
  {
    id: "G-D",
    // /^[A-Za-z0-9_-]+$/ —— 锚定的字符集白名单，天然排除 / \ .
    re: /\/\^\[[^\]]*\]\s*[+*?]\$\//,
    why: "锚定字符集白名单：^…$ 且字符类不含 ./\\ 时无法构造上跳",
    source: "fr-007 openhop `FLOW_ID_PATTERN = /^[A-Za-z0-9_-]+$/`（flow-id.ts）",
  },
];

/**
 * 明确**不算**守卫的形态（反例清单）。
 *
 * N-A `path.basename` 是这张表里最重要的一行：它只去目录、不去 `..`，
 * 却极常被当成「已经 sanitize 过」。fr-012 pre 的实测反例：漏洞态代码里
 * 就有 `path.basename`，漏洞依然成立。一旦把 basename 算作守卫，
 * fr-012 的真值会被自己压掉 —— 见 src/extract-ir-taint-guard.test.ts。
 */
const PATH_NON_GUARD_NOTE =
  "N-A path.basename / N-B 单独出现的 join·resolve / N-C 长度或字符数检查 / N-D if (!p) throw —— 均不计入守卫";

/**
 * G-C：独立校验函数被调用（项目自有命名）。
 *
 * 后缀刻意**不收** `Dir` / `Name` / 裸的 `Valid` —— 实证代价：
 *   - `ensureDir()`（fr-007 openhop store.ts:46）与 `s.isDirectory()` 都会被
 *     `…Dir(` 命中，而它们是**建目录 / 类型判断**，与校验无关；第一版词表
 *     因此把 fr-007 的 pre 侧 5 条全部误压成 0（召回归零）。
 *   - `isValid(x)` / `isSub(a,b)` 同理，会把判别力稀释成猜函数名。
 * 保留 `Id`（fr-007 `assertValidFlowId`）、`Within`（fr-016 `assertWithinDir`）、
 * `Safe|Path|Inside|InDir|Contained|Traversal|Root|Base`。
 */
const PATH_GUARD_FN_CALL_RE =
  /\b(?:assert|ensure|check|validate|verify|sanitize|is)[A-Za-z$]*(?:Safe|Path|Paths|Within|Inside|InDir|Contained|Traversal|Id|Root|Base)[A-Za-z0-9_$]*(?=\s*\()/g;

/** 形态上会命中 G-C 但**确定不是**路径校验的名字（实证反例，逐个加） */
const PATH_GUARD_FN_DENY =
  /^(?:ensureDir|isDirectory|isDir|assertDir|makeDir|mkdir|checkExists|isValid|isRoot|ensureId|getId)$/i;

function callsPathGuardFn(text: string): boolean {
  PATH_GUARD_FN_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_GUARD_FN_CALL_RE.exec(text)) !== null) {
    if (!PATH_GUARD_FN_DENY.test(m[0])) return true;
  }
  return false;
}

/** 返回命中的守卫规则 id；无校验证据返回 null。 */
function hasPathGuardEvidence(text: string): string | null {
  for (const r of PATH_GUARD_RULES) {
    if (r.re.test(text)) return r.id;
  }
  if (callsPathGuardFn(text)) return "G-C";
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 项目内「自身含校验证据」的函数名集合，并向调用方传播一跳（有界）。
 *
 * 为什么必须传播：fr-007 的修复是把 `assertValidFlowId(id)` 放进 `filePath()`，
 * 真正含 sink 的 `FlowStore.get/save/...` 与外层 `flowRoutes` 里**一个校验词汇都没有**——
 * 只看函数体等于没做。传播上限 3 轮（防止公共函数名导致的无限扩散）。
 */
function pathGuardFunctionNames(project: Project): Set<string> {
  const guarded = new Set<string>();
  const bodies: Array<{ names: string[]; text: string }> = [];

  const note = (names: string[], text: string) => {
    if (!text) return;
    bodies.push({ names, text });
    if (hasPathGuardEvidence(text)) for (const n of names) if (n) guarded.add(n);
  };

  for (const sf of project.getSourceFiles()) {
    for (const cls of sf.getClasses()) {
      const cn = cls.getName();
      if (!cn) continue;
      for (const m of cls.getMethods()) {
        const mn = m.getName();
        if (!mn) continue;
        note([mn, `${cn}.${mn}`], m.getText());
      }
    }
    for (const fn of sf.getFunctions()) {
      const fnName = fn.getName();
      if (!fnName) continue;
      note([fnName], fn.getText());
    }
  }

  // 向调用方传播：调用了一个已校验函数 ⇒ 这条流已被拦截（有界 3 轮）
  for (let round = 0; round < 3; round++) {
    const names = [...guarded].filter((n) => !n.includes("."));
    if (names.length === 0) break;
    const re = new RegExp(`\\b(?:${names.map(escapeRe).join("|")})\\s*\\(`, "g");
    let added = false;
    for (const b of bodies) {
      if (b.names.every((n) => guarded.has(n))) continue;
      re.lastIndex = 0;
      if (re.test(b.text)) {
        for (const n of b.names) if (n && !guarded.has(n)) { guarded.add(n); added = true; }
      }
    }
    if (!added) break;
  }

  return guarded;
}

const TS_FILE_SINK_NAMES = [
  "readFile", "readFileSync", "writeFile", "writeFileSync",
  "appendFile", "appendFileSync", "unlink", "unlinkSync", "rm", "rmSync",
  "mkdir", "mkdirSync", "open", "openSync", "createReadStream",
  "createWriteStream", "existsSync", "readdir", "readdirSync",
  "copyFile", "rename", "stat", "lstat", "rmdir", "truncate",
];

// ═══════════════════════════════════════════════════════════════
// 不可信入口根表 —— 污点数据流试点（2026-09-18）
//
// 此前整条污点链路只锚定 Express 形态的
// `(?:req|request)\.(?:params|query|body|headers|cookies)`，
// 即**根集合只有一种来源**。后果是 MCP 工具实参、CLI 参数、URL 解码产物
// 等来源天然不可见：fr-012 的 `args.file_path`（← params.arguments）与
// fr-015 的 `font.path`（← URL 解码）都因此 MISS。往 URL_PARAM_NAME 里加
// 名字解决不了——那只是在已经认错了根的前提下扩充变量名清单（打地鼠）。
//
// 本表改为按**传输面**声明根：判定依据是值的来源性质，而不是变量叫什么。
// 每条根必须窄且可解释，新增需附 `why`（closes #taint-pilot）。
// ═══════════════════════════════════════════════════════════════
const UNTRUSTED_ROOTS: Array<{ id: string; expr: string; why: string }> = [
  {
    id: "http_request",
    expr: String.raw`\b(?:req|request)\.(?:params|query|body|headers|cookies)\b[.[]?`,
    why: "HTTP 请求对象字段，Express/Koa/Fastify/Nest 等通用形态",
  },
  {
    id: "mcp_tool_args",
    expr: String.raw`\bparams\.arguments\b[.[]?`,
    why: "MCP CallToolRequest.params.arguments —— 工具调用实参，调用方可控（fr-012）",
  },
];

/** 所有根的来源片段，供 **无标志** 的布尔探测正则使用 */
const UNTRUSTED_ROOT_SRC = UNTRUSTED_ROOTS.map((r) => `(?:${r.expr})`).join("|");

/** 既有的 request 根语义，改由根表统一提供 */
function hasRequestRootedExpr(text: string): boolean {
  return new RegExp(UNTRUSTED_ROOT_SRC).test(text);
}

function tsSinkCallRegex(): RegExp {
  return new RegExp(
    `(?:^|[^\\w.$])(?:await\\s+)?(?:[\\w$]+\\.)?(${TS_FILE_SINK_NAMES.join("|")})\\s*\\(([\\s\\S]{0,250}?)\\)`,
    "g"
  );
}

/** 函数体内被不可信根污染的局部名（含解构与单跳赋值，深度 ≤2） */
function collectTaintedNames(text: string): Set<string> {
  const tainted = new Set<string>();
  let m: RegExpExecArray | null;
  const root = UNTRUSTED_ROOT_SRC;
  const direct = new RegExp(`(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*(?:await\\s+)?(?:${root})`, "g");
  while ((m = direct.exec(text)) !== null) tainted.add(m[1]);
  const destr = new RegExp(`(?:const|let|var)\\s*\\{\\s*([^}=]*?)\\s*\\}\\s*=\\s*(?:await\\s+)?(?:${root})`, "g");
  while ((m = destr.exec(text)) !== null) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(":")[0].trim();
      if (/^[\w$]+$/.test(name)) tainted.add(name);
    }
  }
  const bareAssign = new RegExp(`(?:^|[^\\w$.])([\\w$]+)\\s*=\\s*(?:await\\s+)?(?:${root})`, "g");
  while ((m = bareAssign.exec(text)) !== null) tainted.add(m[1]);
  // 单跳传播（深度 ≤2）
  for (let depth = 0; depth < 2; depth++) {
    if (tainted.size === 0) break;
    const names = [...tainted].join("|");
    const hop = new RegExp(`(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*\\b(?:${names})\\b`, "g");
    let added = false;
    while ((m = hop.exec(text)) !== null) {
      if (!tainted.has(m[1])) { tainted.add(m[1]); added = true; }
    }
    if (!added) break;
  }
  return tainted;
}

function taintPattern(tainted: Set<string>): RegExp | null {
  const parts: string[] = [UNTRUSTED_ROOT_SRC];
  if (tainted.size > 0) {
    parts.push(`\\b(?:${[...tainted].join("|")})\\b`);
  }
  return new RegExp(parts.join("|"));
}

/** 本函数体内：文件 sink 的实参窗口含 request 污点 → true */
function hasTaintedSinkCall(text: string, tainted: Set<string>): boolean {
  const taint = taintPattern(tainted);
  if (!taint) return false;
  const sinkRe = tsSinkCallRegex();
  let m: RegExpExecArray | null;
  while ((m = sinkRe.exec(text)) !== null) {
    if (taint.test(m[2] || "")) return true;
  }
  return false;
}

/** 深度 0 逗号切分实参窗口（截断窗口内近似；首个参数位置常用于路径） */
function splitArgWindow(win: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of win) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) { args.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

/** 项目方法名 → 方法体内流入文件 sink 的形参下标集合 */
function methodSinkParamMap(
  project: Project,
  absRoot: string
): Map<string, { idxs: Set<number>; entries: Array<{ name: string; file: string }> }> {
  const map = new Map<string, { idxs: Set<number>; entries: Array<{ name: string; file: string }> }>();

  const register = (
    keyName: string,
    fullName: string,
    text: string,
    relPath: string,
    params: string[]
  ) => {
    const sinkRe = tsSinkCallRegex();
    let sm: RegExpExecArray | null;
    while ((sm = sinkRe.exec(text)) !== null) {
      const win = sm[2] || "";
      params.forEach((pname, idx) => {
        if (!pname) return;
        if (!new RegExp(`\\b${pname}\\b`).test(win)) return;
        if (!map.has(keyName)) {
          map.set(keyName, { idxs: new Set(), entries: [] });
        }
        const rec = map.get(keyName)!;
        rec.idxs.add(idx);
        if (!rec.entries.some((e) => e.name === fullName)) {
          rec.entries.push({ name: fullName, file: relPath });
        }
      });
    }
  };

  for (const sf of project.getSourceFiles()) {
    const relPath = path.relative(absRoot, sf.getFilePath());
    for (const cls of sf.getClasses()) {
      const cn = cls.getName();
      if (!cn) continue;
      for (const m of cls.getMethods()) {
        const params = m.getParameters().map((p) => p.getName());
        if (params.length === 0) continue;
        register(m.getName(), `${cn}.${m.getName()}`, m.getText(), relPath, params);
      }
    }
    // ── 污点数据流试点（2026-09-18）──
    // 此前只登记**类方法**。真实 TS 工程大量使用顶层函数声明（MCP handler、
    // Nuxt runtime binding、工具函数），跨函数一跳对它们完全不生效——fr-012 的
    // `markdownUpload` 正是顶层函数，因此从未进入本表，即使上游 taint 已识别，
    // 也无法传导到 sink。这里按同样的「形参 → 文件 sink」规则纳入函数声明。
    for (const fn of sf.getFunctions()) {
      const fnName = fn.getName();
      if (!fnName) continue;
      const params = fn.getParameters().map((p) => p.getName());
      if (params.length === 0) continue;
      register(fnName, fnName, fn.getText(), relPath, params);
    }
  }
  return map;
}


// ═══════════════════════════════════════════════════════════════
// SSRF marker（2026-09-14，REALWORLD_FIX_REGRESSION fr-011/fr-010）
// URL 形参/request 污点 → HTTP fetch sink，函数内无 SSRF 守卫证据
// （private-IP/loopback/denylist/hostname 校验词汇）→ 注入
// __progmune_ssrf_user_url__。库形态（mcp-from-openapi fromURL）与
// Web 形态（req.params）共用同一标记；引擎 IR 层消费。
// ═══════════════════════════════════════════════════════════════

const TS_HTTP_FETCH_SINK =
  /\b(fetch|axios\.(?:get|post|put|delete|head|patch)|http\.request|https\.request|ky\.(?:get|post|put|delete|head|patch)|undici\.request|nodeFetch|got)\s*\(/;

/**
 * 同模式的**全局**版本，仅用于 while-exec 迭代。
 *
 * 2026-09-18 P0 修复：此前 while 循环直接对无 `g` 标志的 TS_HTTP_FETCH_SINK
 * 反复调用 exec()。非全局正则的 exec() 会忽略 lastIndex 并恒返回首个匹配，
 * 一旦首个匹配的 300 字符窗口内不含污点（真实代码里最常见的良性 fetch
 * 形态），循环无出口 → 提取器 100% CPU 死循环。CPU 采样证实：
 * 2193/2193 采样全部落在 Builtins_RegExpPrototypeExec。
 * 该缺陷会使任何含 `fetch(` 且无 SSRF 守卫词汇的 TS 工程挂死提取阶段。
 */
function tsHttpFetchSinkIter(): RegExp {
  return new RegExp(TS_HTTP_FETCH_SINK.source, "g");
}

const SSRF_GUARD_EVIDENCE =
  /127\.0\.0\.1|0\.0\.0\.0|169\.254\.|::1|localhost|isPrivate|isLoopback|hostname|denylist|blocklist|ssrf|validateUrl|isSafeUrl|getAddresses|ipaddress|forbidden_host|private_ip/i;

const URL_PARAM_NAME = /^(url|target|endpoint|link|href|webUrl|web_url|sourceUrl|source_url|remoteUrl|remote_url|fetchUrl|fetch_url|specUrl|spec_url|apiUrl|api_url|origin|baseUrl|base_url)$/i;

function collectUrlParamNames(params: Array<{ name: string }>): string[] {
  return params.map((p) => p.name).filter((n) => URL_PARAM_NAME.test(n));
}



/**
 * 标记增强的内联实现（2026-09-15 性能重构）：消费主循环已获取的
 * 函数文本与形参名，输出该函数应附加的合成标记。
 * - 路径穿越：request 污点 → 文件 sink（本函数内）；或污点实参传入
 *   项目方法体内的文件 sink（跨函数一跳，onMethodHit 回调登记方法条目）
 * - SSRF：URL 形参/request 污点 → HTTP fetch sink，无守卫词汇
 */
function computeMarkerCalls(
  text: string,
  paramNames: string[],
  sinkParams: Map<string, { idxs: Set<number>; entries: Array<{ name: string; file: string }> }>,
  onMethodHit: (rec: { idxs: Set<number>; entries: Array<{ name: string; file: string }> }) => void,
  guardFns?: Set<string>
): string[] {
  const markers: string[] = [];

  // ── 路径穿越 ──
  // G1（2026-09-19）：有流还不够，必须【没有校验证据】才标记——
  // 与 SSRF 侧「无 SSRF_GUARD_EVIDENCE 才标记」对齐。
  // 未传 guardFns（旧调用点/单测）时按「不做校验识别」的旧语义处理。
  if (hasRequestRootedExpr(text)) {
    const tainted = collectTaintedNames(text);
    const selfGuarded = guardFns ? hasPathGuardEvidence(text) !== null : false;
    if (tainted.size > 0 && !selfGuarded) {
      if (hasTaintedSinkCall(text, tainted)) {
        markers.push("__progmune_path_traversal__");
      } else {
        const methodCallRe = new RegExp(
          `\\.([\\w$]+)\\s*\\(([\\s\\S]{0,250}?)\\)`,
          "g"
        );
        // ── 污点数据流试点（2026-09-18）──
        // 此前只识别成员调用（`obj.sink(...)`）。顶层/模块内函数是真实 TS 工程
        // 的主要形态（fr-012 的 `markdownUpload(...)` 就是裸调用），缺这一则
        // 即使该函数的形参已登记为 sink 形参，taint 也无法传导过去。
        const directCallRe = new RegExp(
          `(?:^|[^\\w$.])([\\w$]+)\\s*\\(([\\s\\S]{0,250}?)\\)`,
          "g"
        );
        const taint = taintPattern(tainted);
        if (taint) {
          for (const callRe of [methodCallRe, directCallRe]) {
            callRe.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = callRe.exec(text)) !== null) {
              const rec = sinkParams.get(m[1]);
              if (!rec || rec.idxs.size === 0) continue;
              // G1：被调用方自身已校验 ⇒ 这条跨函数流已被拦截，不标记
              if (guardFns && guardFns.has(m[1])) continue;
              const args = splitArgWindow(m[2] || "");
              const hit = args.some((arg, i) => rec.idxs.has(i) && taint.test(arg));
              if (hit) {
                markers.push("__progmune_path_traversal__");
                onMethodHit(rec);
              }
            }
          }
        }
      }
    }
  }

  // ── SSRF ──
  TS_HTTP_FETCH_SINK.lastIndex = 0;
  if (TS_HTTP_FETCH_SINK.test(text) && !SSRF_GUARD_EVIDENCE.test(text)) {
    const urlParams = paramNames.filter((n) => URL_PARAM_NAME.test(n));
    const reqTainted = collectTaintedNames(text);
    const taintParts: string[] = [];
    if (urlParams.length > 0) taintParts.push(`\\b(?:${urlParams.join("|")})\\b`);
    if (reqTainted.size > 0) taintParts.push(`\\b(?:${[...reqTainted].join("|")})\\b`);
    taintParts.push(UNTRUSTED_ROOT_SRC);
    const taint = new RegExp(taintParts.join("|"));
    const fetchSinkIter = tsHttpFetchSinkIter();
    let m: RegExpExecArray | null;
    while ((m = fetchSinkIter.exec(text)) !== null) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 300);
      if (taint.test(after)) {
        markers.push("__progmune_ssrf_user_url__");
        break;
      }
    }
  }

  return markers;
}

/**
 * 从 TypeScript 项目提取 IR（函数签名、参数、返回值、协议注解）。
 * @protocol namespace=dev_pipeline pre_states=[] post_states=["IR_EXTRACTED"] invalidate=["IR_STALE"]
 */
/** @requires PROJECT_PATH @produces IR_FUNCTIONS */
/** @requires PROJECT_PATH @produces IR_FUNCTIONS */
export function extractIR(projectRoot: string): FunctionInfo[] {
  return extractIRWithTypes(projectRoot).functions;
}

/** Extract both functions and type→file mapping. */
/** @requires PROJECT_PATH @produces IR_WITH_TYPES */
/** @requires PROJECT_PATH @produces IR_WITH_TYPES */
export function extractIRWithTypes(
  projectRoot: string,
  _visited: Set<string> = new Set()
): {
  functions: FunctionInfo[];
  typeMap: Record<string, string>;
} {
  const absRoot = path.resolve(projectRoot);
  const tsconfigPath = path.join(absRoot, "tsconfig.json");

  // Prevent infinite recursion for circular project references
  if (_visited.has(absRoot)) {
    return { functions: [], typeMap: {} };
  }
  _visited.add(absRoot);

  // ── P0: Monorepo / project references detection ──
  let references: string[] = [];
  if (fs.existsSync(tsconfigPath)) {
    try {
      const tsconfigRaw = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      if (tsconfigRaw.references && Array.isArray(tsconfigRaw.references)) {
        references = tsconfigRaw.references
          .map((ref: { path?: string }) => ref.path ? path.resolve(absRoot, ref.path) : null)
          .filter((p: string | null): p is string => p !== null && fs.existsSync(path.join(p, "tsconfig.json")));
      }
    } catch { /* invalid tsconfig JSON */ }
  }

  if (references.length > 0) {
    console.error(`🔧 检测到 monorepo: ${references.length} 个子项目`);
    const allFunctions: FunctionInfo[] = [];
    const allTypeMap: Record<string, string> = {};

    // Only extract from referenced sub-projects — root tsconfig is just a container
    for (const refDir of references) {
      const childResult = extractIRWithTypes(refDir, _visited);
      // Adjust file paths to be relative to the root project
      for (const f of childResult.functions) {
        const absolutePath = path.resolve(refDir, f.file);
        f.file = path.relative(absRoot, absolutePath);
      }
      allFunctions.push(...childResult.functions);
      Object.assign(allTypeMap, childResult.typeMap);
    }

    return { functions: allFunctions, typeMap: allTypeMap };
  }

  return _extractSingleProject(absRoot, tsconfigPath);
}

/** Extract IR from a single project (no references handling). */
function _extractSingleProject(
  absRoot: string,
  tsconfigPath: string
): {
  functions: FunctionInfo[];
  typeMap: Record<string, string>;
} {

  // ── P0: Read original tsconfig (with extends chain) for paths/baseUrl ──
  const originalTsConfig = fs.existsSync(tsconfigPath)
    ? readOriginalTsConfig(tsconfigPath)
    : null;

  if (originalTsConfig?.paths) {
    console.error(`🔧 检测到路径别名: ${Object.keys(originalTsConfig.paths).join(', ')}`);
  }
  const modRes = (originalTsConfig?.moduleResolution || '').toLowerCase();
  if (modRes === 'nodenext' || modRes === 'node16') {
    console.error(`🔧 检测到 ${modRes} — 启用 .js→.ts 映射`);
  }

  const project = new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: false,
    skipFileDependencyResolution: true, // compatible with NodeNext/ESM tsconfigs
    compilerOptions: {
      module: 1,           // CommonJS — overrides project tsconfig for extraction
      moduleResolution: 2, // Classic Node resolution
    },
  });
  if (!fs.existsSync(tsconfigPath)) {
    project.addSourceFilesAtPaths(path.join(absRoot, "**/*.ts"));
  }
  const funcs: FunctionInfo[] = [];
  // 标记增强的共享状态（2026-09-15 内联重构）：
  // sinkParams = 项目方法名 → 方法体内流入文件 sink 的形参下标 + 方法条目；
  // pendingMethodMarks = 跨函数命中待标记的方法条目（主循环后统一应用）
  const sinkParams = methodSinkParamMap(project, absRoot);
  // G1（2026-09-19）：路径校验识别。自身含校验证据的函数名 + 向调用方传播一跳。
  const guardFns = pathGuardFunctionNames(project);
  const pendingMethodMarks = new Set<string>();
  const onMethodHit = (rec: { entries: Array<{ name: string; file: string }> }) => {
    for (const me of rec.entries) pendingMethodMarks.add(`${me.name}\u0000${me.file}`);
  };
  for (const sf of project.getSourceFiles()) {
    if (sf.getFilePath().includes("node_modules")) continue; // lib.d.ts 等声明文件只贡献噪声（2026-09-17 性能）
    const relPath = path.relative(absRoot, sf.getFilePath());
    const _ft0 = Date.now();
    for (const f of sf.getFunctions()) {
      const name = f.getName();
      if (!name) continue;
      const fParams = f.getParameters();
      const fText = f.getText();
      const fCalls = extractDirectCalls(f, fText);
      fCalls.push(...computeMarkerCalls(fText, fParams.map((p: any) => p.getName()), sinkParams, onMethodHit, guardFns));
      funcs.push({
        name,
        params: fParams.map(p => ({
          name: p.getName(),
          type: getParamType(p),
          typeDetail: getParamTypeDetail(p),
        })),
        returnType: getReturnType(f),
        returnTypeDetail: getReturnTypeDetail(f),
        file: relPath,
        calls: fCalls,
        exported: f.isExported(),
        inputs: deriveInputs(f.getParameters().map(p => ({name: p.getName(), type: p.getTypeNode()?.getText() || "any"}))),
        outputs: deriveOutputs(f.getReturnTypeNode()?.getText() || "any"),
        protocol: parseProtocolFromJSDoc(f),
        ...parseCapabilityFromJSDoc(f),
      });
    }
    // 提取箭头函数（const fn = () => {}, export const fn = () => {} 等）
    for (const vd of sf.getVariableDeclarations()) {
      const init = vd.getInitializer();
      if (!init) continue;
      // 直接箭头函数: const fn = () => {}
      if (Node.isArrowFunction(init)) {
        const name = vd.getName();
        const initParams = init.getParameters();
        const initText = init.getText();
        const initCalls = extractDirectCalls(init, initText);
        initCalls.push(...computeMarkerCalls(initText, initParams.map((p: any) => p.getName()), sinkParams, onMethodHit, guardFns));
        funcs.push({
          name,
          params: initParams.map(p => ({
            name: p.getName(),
            type: getParamType(p),
            typeDetail: getParamTypeDetail(p),
          })),
          returnType: getReturnType(init),
          returnTypeDetail: getReturnTypeDetail(init),
          file: relPath,
          exported: vd.isExported(),
          calls: initCalls,
	        protocol: parseProtocolFromJSDoc(vd),
          ...parseCapabilityFromJSDoc(vd),
        });
        continue;
      }
      // 包装的箭头函数: const fn = debounce(() => {})
      if (Node.isCallExpression(init)) {
        for (const arg of init.getArguments()) {
          if (Node.isArrowFunction(arg)) {
            const name = vd.getName();
            const argParams = arg.getParameters();
            const argText = arg.getText();
            const argCalls = extractDirectCalls(arg, argText);
            argCalls.push(...computeMarkerCalls(argText, argParams.map((p: any) => p.getName()), sinkParams, onMethodHit, guardFns));
            funcs.push({
              name,
              params: argParams.map(p => ({
                name: p.getName(),
                type: getParamType(p),
                typeDetail: getParamTypeDetail(p),
              })),
              returnType: getReturnType(arg),
              returnTypeDetail: getReturnTypeDetail(arg),
              file: relPath,
          exported: vd.isExported(),
              calls: argCalls,
	            protocol: parseProtocolFromJSDoc(vd),
            });
            break; // 只取第一个箭头函数参数
          }
        }
      }
    }

    // Extract class methods: ts-morph getFunctions() excludes class members
    // （2026-09-12 修复：此循环此前误置于 VariableDeclaration 循环内——
    //   无顶层变量声明的文件（如 openhop store.ts）方法整体漏提取，
    //   且有变量声明的文件会重复 push。移至 sf 层 + 去重语义。）
    for (const cls of sf.getClasses()) {
      const cn = cls.getName();
      if (!cn) continue;
      for (const m of cls.getMethods()) {
        const mn = m.getName();
        if (!mn) continue;
        const mParams = m.getParameters();
        const mText = m.getText();
        const mCalls = computeMarkerCalls(mText, mParams.map((p: any) => p.getName()), sinkParams, onMethodHit, guardFns);
        funcs.push({
          name: `${cn}.${mn}`,
          params: mParams.map((p: any) => ({ name: p.getName(), type: getParamType(p), typeDetail: getParamTypeDetail(p) })),
          returnType: (m as any).getReturnTypeNode?.()?.getText?.() || "any",
          returnTypeDetail: (m as any).getReturnTypeNode?.()?.getText?.() || "any",
          file: relPath,
          exported: cls.isExported(),
          calls: mCalls,
          ...parseCapabilityFromJSDoc(m),
          protocol: parseProtocolFromJSDoc(m),
        });
      }
    }
    const _ftd = Date.now() - _ft0;
    if (_ftd > 3000) console.error(`[perf-file] ${relPath}: ${_ftd}ms`);
  }

  // ── 标记增强（2026-09-11 fr-007 / 2026-09-14 fr-011）：在下方
  //    主循环内联计算（复用已获取的函数文本，无独立遍历——
  //    2026-09-15 性能重构）；跨函数命中在循环结束后统一应用。
  for (const key of pendingMethodMarks) {
    const idx = key.indexOf("\u0000");
    const mname = key.slice(0, idx);
    const mfile = key.slice(idx + 1);
    const entry = funcs.find((x) => x.name === mname && x.file === mfile);
    if (entry) {
      entry.calls = entry.calls || [];
      if (!entry.calls.includes("__progmune_path_traversal__")) {
        entry.calls.push("__progmune_path_traversal__");
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 5: Dynamic external function resolution
  // Replaces hardcoded knownExternals
  //   includes: npm packages (.d.ts via ts.resolveModuleName), Node.js built-ins (@types/node)
  //   fallback: knownExternals registry for unresolved functions
  //   final fallback: any type with empty params with ts-morph + ts.resolveModuleName
  // ═══════════════════════════════════════════════════════════════

  const declaredNames = new Set(funcs.map(f => f.name));

  // Collect imports for dynamic resolution
  const externalFuncs = new Map<string, { params: ParamInfo[]; returnType: string; description: string }>();
  // Also track namespace imports: import * as X from 'module' → X.method
  const namespaceImports = new Map<string, SourceFile>(); // X → resolved source file

  for (const sf of project.getSourceFiles()) {
    if (sf.getFilePath().includes('node_modules')) continue;
    for (const imp of sf.getImportDeclarations()) {
      const mod = imp.getModuleSpecifierValue();

      // Named imports: import { X } from 'mod'
      for (const ni of imp.getNamedImports()) {
        const name = ni.getName();
        if (declaredNames.has(name)) continue;
        if (externalFuncs.has(name)) continue;

        try {
          const resolved = imp.getModuleSpecifierSourceFile();
          if (resolved) {
            const sig = extractSignatureFromFile(name, resolved);
            if (sig) { externalFuncs.set(name, sig); continue; }
          }

          const tsResult = ts.resolveModuleName(mod, sf.getFilePath(), {}, ts.sys);
          const resolvedPath = tsResult.resolvedModule?.resolvedFileName;
          if (resolvedPath && fs.existsSync(resolvedPath)) {
            const sig = extractSignatureFromDts(name, resolvedPath, project);
            if (sig) { externalFuncs.set(name, sig); continue; }
          }

          // ── P0 fallback: manual resolution for bundler aliases & NodeNext .js→.ts ──
          const manualPath = manualResolveModule(mod, sf.getFilePath(), absRoot, originalTsConfig);
          if (manualPath) {
            try {
              const manualFile = project.addSourceFileAtPathIfExists(manualPath);
              if (manualFile) {
                const sig = extractSignatureFromFile(name, manualFile);
                if (sig) { externalFuncs.set(name, sig); continue; }
              }
            } catch { /* manual file may be a directory or invalid */ }
          }
        } catch { /* IR parse fallback */ }
      }

      // Namespace imports: import * as X from 'mod'
      const nsImport = imp.getNamespaceImport();
      if (nsImport) {
        try {
          const resolved = imp.getModuleSpecifierSourceFile();
          if (resolved) {
            namespaceImports.set(nsImport.getText(), resolved);
          } else {
            const tsResult = ts.resolveModuleName(mod, sf.getFilePath(), {}, ts.sys);
            const resolvedPath = tsResult.resolvedModule?.resolvedFileName;
            if (resolvedPath && fs.existsSync(resolvedPath)) {
              const dtsFile = project.addSourceFileAtPathIfExists(resolvedPath);
              if (dtsFile) namespaceImports.set(nsImport.getText(), dtsFile);
            } else {
              // ── P0 fallback: manual resolution for namespace imports ──
              const manualPath = manualResolveModule(mod, sf.getFilePath(), absRoot, originalTsConfig);
              if (manualPath) {
                try {
                  const manualFile = project.addSourceFileAtPathIfExists(manualPath);
                  if (manualFile) namespaceImports.set(nsImport.getText(), manualFile);
                } catch { /* manual file may be a directory */ }
              } else {
                // Node.js built-in: try @types/node
                const nodeTypesPath = path.join(absRoot, "node_modules/@types/node", mod + ".d.ts");
                if (fs.existsSync(nodeTypesPath)) {
                  const nodeDts = project.addSourceFileAtPathIfExists(nodeTypesPath);
                  if (nodeDts) namespaceImports.set(nsImport.getText(), nodeDts);
                }
              }
            }
          }
        } catch { /* IR parse fallback */ }
      }
    }
  }

  // Resolve namespace calls: fs.readFileSync → look up 'readFileSync' in 'fs' source file
  function tryResolveFromNamespace(callName: string, prefix: string): boolean {
    const sourceFile = namespaceImports.get(prefix);
    if (!sourceFile) return false;
    const sig = extractSignatureFromFile(callName, sourceFile);
    if (sig) {
      externalFuncs.set(callName, sig);
      return true;
    }
    return false;
  }

  // Collect undeclared calls (functions used but not declared and not resolved above)
  const allCalls = new Set<string>();
  for (const f of funcs) {
    for (const c of (f.calls || [])) {
      allCalls.add(c);
    }
  }

  // JS 内置方法和 TypeScript 语法节点，不作为外部函数暴露
  const ignoredBuiltins = new Set([
    "map", "filter", "reduce", "forEach", "find", "some", "every",
    "push", "pop", "shift", "unshift", "slice", "splice", "concat",
    "join", "split", "replace", "match", "search", "trim", "toLowerCase",
    "toUpperCase", "includes", "indexOf", "startsWith", "endsWith",
    "sort", "reverse", "keys", "values", "entries", "has", "get", "set",
    "toString", "toISOString", "getTime", "getFullYear", "getMonth", "getDate",
    "getHours", "getMinutes", "getSeconds", "floor", "ceil", "round",
    "charAt", "charCodeAt", "substring", "substr", "padStart", "padEnd",
    "getJsDocs", "getTags", "getTagName", "getCommentText", "getText",
    "getName", "getType", "getExpression", "getArguments", "getParameters",
    "getSourceFiles", "getFunctions", "getVariableDeclarations",
    "getInitializer", "getReturnType", "isIdentifier", "isArrowFunction",
    "isCallExpression", "isFunctionDeclaration", "isUnionTypeNode",
    "isTypeReference", "isPropertyAccessExpression", "getTypeNodes",
    "getTypeArguments", "getTypeName", "skip", "traversal",
    "addSourceFilesAtPaths", "getFilePath",
    "then", "catch", "resolve", "reject", // Promise
  ]);

  // Minimal fallback registry (Node.js built-ins that ts-morph can't resolve)
  const knownExternals: Record<string, { params: ParamInfo[]; returnType: string; description: string }> = {
    // fs
    "readFileSync": {
      params: [{ name: "path", type: "string" }, { name: "encoding", type: "string" }],
      returnType: "string", description: "同步读取文件内容",
    },
    "writeFileSync": {
      params: [{ name: "path", type: "string" }, { name: "data", type: "string" }],
      returnType: "void", description: "同步写入文件",
    },
    "existsSync": {
      params: [{ name: "path", type: "string" }],
      returnType: "boolean", description: "检查文件是否存在",
    },
    "readdirSync": {
      params: [{ name: "path", type: "string" }],
      returnType: "string[]", description: "读取目录内容",
    },
    "mkdirSync": {
      params: [{ name: "path", type: "string" }, { name: "options", type: "object" }],
      returnType: "void", description: "创建目录",
    },
    "unlinkSync": {
      params: [{ name: "path", type: "string" }],
      returnType: "void", description: "删除文件",
    },
    "statSync": {
      params: [{ name: "path", type: "string" }],
      returnType: "object", description: "获取文件状态",
    },
    // path
    "resolve": {
      params: [{ name: "segments", type: "string[]" }],
      returnType: "string", description: "解析路径段为绝对路径",
    },
    "relative": {
      params: [{ name: "from", type: "string" }, { name: "to", type: "string" }],
      returnType: "string", description: "计算相对路径",
    },
    "dirname": {
      params: [{ name: "path", type: "string" }],
      returnType: "string", description: "获取目录名",
    },
    "basename": {
      params: [{ name: "path", type: "string" }],
      returnType: "string", description: "获取文件名",
    },
    "extname": {
      params: [{ name: "path", type: "string" }],
      returnType: "string", description: "获取文件扩展名",
    },
    // JSON
    "parse": {
      params: [{ name: "text", type: "string" }],
      returnType: "any", description: "解析 JSON 字符串",
    },
    "stringify": {
      params: [{ name: "value", type: "any" }, { name: "replacer", type: "any" }],
      returnType: "string", description: "序列化为 JSON 字符串",
    },
    // console
    "log": {
      params: [{ name: "message", type: "any" }],
      returnType: "void", description: "输出日志",
    },
    "error": {
      params: [{ name: "message", type: "any" }],
      returnType: "void", description: "输出错误日志",
    },
    "warn": {
      params: [{ name: "message", type: "any" }],
      returnType: "void", description: "输出警告日志",
    },
    // Buffer
    "from": {
      params: [{ name: "data", type: "string" }, { name: "encoding", type: "string" }],
      returnType: "Buffer", description: "从字符串创建 Buffer",
    },
    // process
    "exit": {
      params: [{ name: "code", type: "number" }],
      returnType: "void", description: "退出进程",
    },
    "cwd": {
      params: [],
      returnType: "string", description: "获取当前工作目录",
    },
    // child_process
    "execSync": {
      params: [{ name: "command", type: "string" }],
      returnType: "Buffer", description: "同步执行命令",
    },
    // crypto
    "createHash": {
      params: [{ name: "algorithm", type: "string" }],
      returnType: "Hash", description: "创建哈希对象",
    },
    "digest": {
      params: [{ name: "encoding", type: "string" }],
      returnType: "string", description: "输出哈希摘要",
    },
    "update": {
      params: [{ name: "data", type: "string" }],
      returnType: "Hash", description: "更新哈希数据",
    },
    // Date
    "now": {
      params: [],
      returnType: "number", description: "当前时间戳（毫秒）",
    },
    // Object
    "entries": {
      params: [{ name: "obj", type: "object" }],
      returnType: "Array<[string, any]>", description: "返回对象的键值对数组",
    },
    // setTimeout / setInterval
    "setTimeout": {
      params: [{ name: "callback", type: "function" }, { name: "ms", type: "number" }],
      returnType: "number", description: "延迟执行回调",
    },
    // Math
    "random": {
      params: [],
      returnType: "number", description: "生成 0-1 随机数",
    },
    "abs": {
      params: [{ name: "x", type: "number" }],
      returnType: "number", description: "绝对值",
    },
    "max": {
      params: [{ name: "values", type: "number[]" }],
      returnType: "number", description: "最大值",
    },
    "min": {
      params: [{ name: "values", type: "number[]" }],
      returnType: "number", description: "最小值",
    },
  };

  let externalCount = 0;
  let dynamicCount = 0;
  let fallbackCount = 0;

  for (const callName of allCalls) {
    if (declaredNames.has(callName)) continue;
    if (ignoredBuiltins.has(callName)) continue;
    if (callName.startsWith("is") && callName[2] === callName[2]?.toUpperCase()) continue;

    // Try namespace resolution for unresolved calls
    if (!externalFuncs.has(callName) && !knownExternals[callName]) {
      // Check if this function is called as X.method (property access)
      // The callName is already the method name from extractDirectCalls
      // Try each known namespace to find the function
      for (const [nsPrefix] of namespaceImports) {
        if (tryResolveFromNamespace(callName, nsPrefix)) break;
      }
    }

    // ── P0 fallback: try manual resolution for named-import-style unknown calls ──
    // Some imports may not have been resolved as named imports in ts-morph
    // (e.g., when the import declaration itself wasn't parsed correctly)
    if (!externalFuncs.has(callName) && !knownExternals[callName]) {
      // Scan all source file imports again with manual resolution
      for (const sf of project.getSourceFiles()) {
        if (sf.getFilePath().includes('node_modules')) continue;
        for (const imp of sf.getImportDeclarations()) {
          const mod = imp.getModuleSpecifierValue();
          const manualPath = manualResolveModule(mod, sf.getFilePath(), absRoot, originalTsConfig);
          if (!manualPath) continue;
          // Check if this module exports the callName
          let manualFile;
          try {
            manualFile = project.addSourceFileAtPathIfExists(manualPath);
          } catch { continue; }
          if (!manualFile) continue;
          const sig = extractSignatureFromFile(callName, manualFile);
          if (sig) {
            externalFuncs.set(callName, sig);
            dynamicCount++;
            break;
          }
        }
        if (externalFuncs.has(callName)) break;
      }
    }

    // Priority: dynamic resolution > knownExternals fallback > any
    const dynamic = externalFuncs.get(callName);
    const fallback = knownExternals[callName];

    if (dynamic) {
      funcs.push({
        name: callName,
        params: dynamic.params,
        returnType: dynamic.returnType,
        returnTypeDetail: dynamic.returnType,
        file: "(external)",
        calls: [],
        external: true,
        description: dynamic.description,
      });
      dynamicCount++;
    } else if (fallback) {
      funcs.push({
        name: callName,
        params: fallback.params,
        returnType: fallback.returnType,
        returnTypeDetail: fallback.returnType,
        file: "(external)",
        calls: [],
        external: true,
        description: fallback.description,
      });
      fallbackCount++;
    } else {
      funcs.push({
        name: callName,
        params: [],
        returnType: "any",
        returnTypeDetail: "any",
        file: "(external)",
        calls: [],
        external: true,
      });
      externalCount++;
    }
  }

  const totalExternal = dynamicCount + fallbackCount + externalCount;
  console.error(`📦 外部函数: ${totalExternal} (动态=${dynamicCount} 回退=${fallbackCount} 未签名=${externalCount}, from ${allCalls.size} total calls)`);

  // Post-process: auto-derive tags from file names
  for (const f of funcs) {
    if (!f.tags || f.tags.length === 0) {
      const derived = deriveTagsFromFile(f.file);
      if (derived.length > 0) f.tags = derived;
    }
  }

  // Build type→module map for emitter
  const _typeMap: Record<string, string> = {};
  for (const _sf of project.getSourceFiles()) {
    if (_sf.getFilePath().includes("node_modules")) continue;
    const _rp = path.relative(absRoot, _sf.getFilePath());
    for (const _iface of _sf.getInterfaces()) {
      const _n = _iface.getName();
      if (_n && _iface.isExported()) _typeMap[_n] = _rp;
    }
    for (const _ta of _sf.getTypeAliases()) {
      const _n = _ta.getName();
      if (_n && _ta.isExported()) _typeMap[_n] = _rp;
    }
  }

  // ── Post-process: auto-derive missing capability metadata ──

  // Name-based data-flow inference patterns
  const PRODUCER_PREFIXES: [RegExp, string][] = [
    [/^(load|get|fetch|read|find|list|query|select)/i, "DATA"],
    [/^(create|build|generate|make|new)/i, "CREATED"],
    [/^(validate|verify|check|assert)/i, "VALIDATION_RESULT"],
    [/^(format|render|emit|stringify)/i, "FORMATTED"],
    [/^(save|write|persist|store|put)/i, "SAVED"],
    [/^(count|compute|calculate|measure)/i, "RESULT"],
    [/^(extract|parse|scan)/i, "EXTRACTED"],
    [/^(execute|run|invoke|apply)/i, "EXECUTED"],
    [/^(delete|remove|clear|destroy)/i, "DELETED"],
  ];
  const CONSUMER_PREFIXES: [RegExp, string][] = [
    [/^(save|write|persist|store)/i, "DATA"],
    [/^(validate|verify|check|assert)/i, "DATA"],
    [/^(format|render|emit|display)/i, "DATA"],
    [/^(delete|remove|clear)/i, "DATA"],
    [/^(execute|run|apply)/i, "CONFIG"],
    [/^(search|query|filter|sort)/i, "DATA"],
    [/^(merge|combine|concat)/i, "DATA"],
    [/^(compare|diff|match)/i, "DATA"],
    [/^(hash|encode|encrypt|sign)/i, "INPUT"],
  ];

  for (const f of funcs) {
    // Strategy 1: @protocol pre_states → @requires, post_states → @produces
    if (f.protocol) {
      if ((!f.requires || f.requires.length === 0) && f.protocol.pre_states?.length > 0) {
        f.requires = f.protocol.pre_states;
      }
      if ((!f.produces || f.produces.length === 0) && f.protocol.post_states?.length > 0) {
        f.produces = f.protocol.post_states;
      }
    }

    // Strategy 2: Derive purpose from function name if missing
    if (!f.purpose && f.name) {
      f.purpose = f.name
        .replace(/([A-Z])/g, " $1")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }

    // Strategy 3: Derive tags from file path if missing
    if (!f.tags || f.tags.length === 0) {
      const parts = (f.file || "").replace(/\.ts$/, "").replace(/^src\//, "").split("/");
      f.tags = parts.filter(t => t.length > 2 && t !== "src");
    }

    // Strategy 4: Infer requires/produces from function name prefix
    // Mark as derived so Strategy 5 can skip these (name-derived labels are
    // too generic for cross-function data-flow inheritance).
    if (!f.requires || f.requires.length === 0) {
      for (const [re, label] of CONSUMER_PREFIXES) {
        if (re.test(f.name)) {
          f.requires = [label];
          (f as any)._requiresDerived = true;
          break;
        }
      }
    }
    if (!f.produces || f.produces.length === 0) {
      for (const [re, label] of PRODUCER_PREFIXES) {
        if (re.test(f.name)) {
          f.produces = [label];
          (f as any)._producesDerived = true;
          break;
        }
      }
    }
  }

  // Strategy 5: Cross-function data-flow — only inherit from callees
  // with BOTH explicit requires AND produces (true pipeline functions).
  // Single-hop only. Prevents noise: generateAttemptId→CREATED won't propagate.
  const nameToFunc = new Map<string, (typeof funcs)[0]>();
  for (const f of funcs) nameToFunc.set(f.name, f);

  for (const f of funcs) {
    if ((f.requires || []).length > 0 && (f.produces || []).length > 0) continue; // already annotated
    if (!f.calls || f.calls.length === 0) continue;
    let inherited = 0;
    const MAX_INHERIT = 2; // cap edges per function
    for (const calleeName of f.calls) {
      if (inherited >= MAX_INHERIT) break;
      const callee = nameToFunc.get(calleeName);
      if (!callee) continue;
      // Require BOTH explicit requires AND produces — true pipeline node
      const hasExplicitR = callee.requires && callee.requires.length > 0 && !(callee as any)._requiresDerived;
      const hasExplicitP = callee.produces && callee.produces.length > 0 && !(callee as any)._producesDerived;
      if (!hasExplicitR || !hasExplicitP) continue;
      if (!f.requires || f.requires.length === 0) {
        f.requires = [...new Set(callee.requires!)];
        inherited++;
      }
      if (!f.produces || f.produces.length === 0) {
        f.produces = [...new Set(callee.produces!)];
      }
    }
  }

  return { functions: funcs, typeMap: _typeMap };
}

// ═══════════════════════════════════════════════════════════════
// Dynamic external signature extraction helpers
// ═══════════════════════════════════════════════════════════════

/** Extract function signature from a resolved ts-morph source file. */
function extractSignatureFromFile(
  name: string,
  sf: SourceFile
): { params: ParamInfo[]; returnType: string; description: string } | null {
  for (const exp of sf.getExportedDeclarations().entries()) {
    if (exp[0] !== name) continue;
    for (const decl of exp[1]) {
      if (Node.isFunctionDeclaration(decl)) {
        const params = decl.getParameters().map(p => ({
          name: p.getName(),
          type: p.getTypeNode()?.getText() || "any",
        }));
        return {
          params,
          returnType: decl.getReturnTypeNode()?.getText() || "any",
          description: `auto-resolved from ${sf.getFilePath()}`,
        };
      }
      if (Node.isVariableDeclaration(decl)) {
        const init = decl.getInitializer();
        if (init && Node.isArrowFunction(init)) {
          const params = init.getParameters().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || "any",
          }));
          return {
            params,
            returnType: init.getReturnTypeNode()?.getText() || "any",
            description: `auto-resolved arrow from ${sf.getFilePath()}`,
          };
        }
      }
    }
  }
  return null;
}

/** Extract function signature from a .d.ts file using ts-morph. */
function extractSignatureFromDts(
  name: string,
  dtsPath: string,
  project: Project
): { params: ParamInfo[]; returnType: string; description: string } | null {
  try {
    const sf = project.addSourceFileAtPathIfExists(dtsPath);
    if (!sf) return null;
    return extractSignatureFromFile(name, sf);
  } catch {
    return null;
  }
}

// 若直接运行
if (require.main === module) {
  const root = process.argv[2];
  if (!root) { console.error("用法: ts-node extract-ir.ts <项目根>"); process.exit(1); }
  const result = extractIRWithTypes(root);
  const data = { typeMap: result.typeMap, functions: result.functions };
  fs.writeFileSync("ir.json", JSON.stringify(data, null, 2));
  console.log(`✅ IR 提取完成: ${result.functions.length} 个函数, ${Object.keys(result.typeMap).length} 个类型 -> ir.json`);
}
