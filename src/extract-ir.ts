import { Project, Node, FunctionDeclaration, FunctionExpression, VariableStatement, ArrowFunction, MethodDeclaration, Type, CallExpression, SourceFile } from "ts-morph";
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

/**
 * 提取函数体内**真实出现的调用名**（区别于 computeMarkerCalls 产出的语义标记）。
 *
 * 2026-09-21（类方法空转修复）：形参类型补 MethodDeclaration。
 *   此前本函数只对函数声明 / 箭头 / 包装箭头三个载体调用过；主 IR 循环里的
 *   **类方法分支从来没调过它**，只调了 computeMarkerCalls ⇒ 类方法的 calls 里
 *   永远只有标记、没有真实调用 ⇒ 状态机在 OO 代码上拿不到输入（FP 观测池实测：
 *   NestJS 切片 61 个函数里 59 个 calls 为空）。该空转自类方法提取功能诞生即存在，
 *   因 taintpath 十一族语料全是函数载体而从未现形。
 *   MethodDeclaration 与 FunctionDeclaration 一样具备 getBody() / getText()，
 *   遍历逻辑无需改动。
 */
function extractDirectCalls(
  func: FunctionDeclaration | ArrowFunction | MethodDeclaration,
  preText?: string,
): string[] {
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
  /**
   * 可选：比 `re` 更精确的定案函数（re 只做粗筛）。
   * 存在时以本函数为准 —— 有些形态（如「startsWith 的实参是不是基目录名」）
   * 用单条正则写不出既不全收、又不漏掉 canonical 形态的判定。
   */
  decide?: (text: string) => boolean;
}

/**
 * 标识符是否「看起来像基目录」—— G-A2 的定案依据。
 *
 * 判定：以 base / root / dir 结尾（大小写与 camel、下划线均可），
 * 前缀任意（`base` / `baseDir` / `allowedRoot` / `root_dir` 都算）。
 *
 * 反例名单是实证加的：`database` 以 base 结尾但与目录无关，若不排除，
 * 一旦有人写 `p.startsWith(database)` 就会被当成守卫 —— 那是精度漏洞。
 */
const BASE_DIR_IDENT_DENY = /^(?:database|databases|codebase|knowledgebase|base64|basename|dirname|basenames)$/i;

function isBaseDirIdent(id: string): boolean {
  if (BASE_DIR_IDENT_DENY.test(id)) return false;
  return /^(?:[A-Za-z_$][\w$]*)?(?:base|root|dir)$/i.test(id);
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
    // 粗筛：任意 `.startsWith(<ident>)`；定案交给 decide —— 实参名是否像基目录。
    re: /\.\s*startsWith\s*\(\s*([^)]*?)\s*\)/,
    // 2026-09-19 两次修订，都是被 C4「顶出来」的真问题（C4 之前相关用例
    // 的「不标记」是空过——污点根本没走到 sink，见方法学规则 R7）：
    //  ① 原正则 `[A-Za-z_$][\w$]*(?:[Bb]ase|…)` 要求标识符在 base/root/dir
    //     **之外**还至少有一个前导字符，于是最朴素的 `startsWith(base)`
    //     （taintpath_A readGuardWithin）匹配不上；
    //  ② `startsWith("/srv/data")` —— 基目录写成**字符串字面量**——同样匹配
    //     不上（C5 负对照 readInlineGuarded 就是这形态）。
    // 故改为：先取出 startsWith 的整个实参，再判定它是「基目录名」还是
    // 「绝对路径字面量」。
    decide: (text: string) => {
      const re = /\.\s*startsWith\s*\(\s*([^)]*?)\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const arg = m[1] || "";
        // 形参里的标识符：`base` / `base + path.sep` / `rootDir + "/"`
        const idm = /([A-Za-z_$][\w$]*)/.exec(arg);
        if (idm && isBaseDirIdent(idm[1])) return true;
        // 绝对路径字面量：`"/srv/data"`。长度 >1 是为了排除 `startsWith("/")`
        // —— 那只是「是否绝对路径」，不构成包含性。
        if (/["'`]\/[^"'`]+["'`]/.test(arg)) return true;
      }
      return false;
    },
    why: "目录包含性校验（基目录名或绝对路径字面量）：startsWith(base / baseDir / \"/srv/data\" / base + sep）",
    source: "设计形态，canonical；2026-09-19 补 `base` 单标识符（taintpath_A readGuardWithin）与绝对路径字面量（C5 负对照 readInlineGuarded）",
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
    if (r.decide ? r.decide(text) : r.re.test(text)) return r.id;
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
function pathGuardFunctionNames(project: Project): { all: Set<string>; direct: Set<string> } {
  const guarded = new Set<string>();
  /** tier-0：函数体自身含校验证据的名字（G1 原语义） */
  const direct = new Set<string>();
  const bodies: Array<{ names: string[]; text: string }> = [];

  const note = (names: string[], text: string) => {
    if (!text) return;
    bodies.push({ names, text });
    if (hasPathGuardEvidence(text)) {
      for (const n of names) if (n) { guarded.add(n); direct.add(n); }
    }
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

  return { all: guarded, direct };
}

// ═══════════════════════════════════════════════════════════════
// G2（2026-09-19）：调用点抑制 —— 污点【表达式级】净化
// ═══════════════════════════════════════════════════════════════
// 缺口实证（taintpath_B，2026-09-19 measured）：
//   `assertTemplateName(args.name); return loadTemplate(args.name);`
// 仍被标记。`assertTemplateName` 的函数体内是锚定字符集白名单（G-D），
// 是**真的**校验，但它的名字不含路径语义后缀 —— `Name` 在修 `ensureDir()`
// 误判时被整体移出了 G-C 守卫后缀表，于是调用点侧认不出来。
//
// 为什么不直接放宽后缀表：那是按【名字】猜语义，会把判别力稀释成猜函数名
// （G-C 的实证代价已经量过一次：放宽 ⇒ fr-007 pre 侧召回归零）。
// 本实现改为按【被调用方的实际证据】定案：
//   函数体内调用了 tier-0 守卫函数（自身含校验证据），且污点表达式被当作
//   实参传进去 ⇒ 该表达式视为已净化，再流进 sink 不算污点。
//
// 精度取舍（关键点）：净化作用在【表达式】上，不是整函数。
//   G1 的 selfGuarded 是函数级的（一个校验词汇压掉整个函数体所有流）；
//   G2 只净化真正被传进守卫调用的那个表达式 —— 同函数体里另一条未被校验
//   的流仍会标记。这是 G2 相对 G1 的收窄，而不是又一次放宽。
// ═══════════════════════════════════════════════════════════════

/**
 * 收集函数体内「被传进 tier-0 守卫函数」的实参表达式，编译成一个判定正则。
 *
 * 边界：只收**简单取值表达式**（标识符 / 成员 / 下标 / 字符串字面量），
 * 复杂表达式（模板串、拼接、调用）不收 —— 那些形态无法在 sink 侧可靠比对。
 */
function collectSanitizedExprs(text: string, directGuardFns?: Set<string>): RegExp | null {
  if (!directGuardFns || directGuardFns.size === 0) return null;
  const names = [...directGuardFns].filter((n) => !n.includes("."));
  if (names.length === 0) return null;
  const callRe = new RegExp(
    `(?:^|[^\\w$.])(?:${names.map(escapeRe).join("|")})\\s*\\(([\\s\\S]{0,250}?)\\)`,
    "g"
  );
  const exprs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    for (const a of splitArgWindow(m[1] || "")) {
      const t = a.trim();
      if (t && /^[A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+|\[[^\]]*\])*$/.test(t)) exprs.add(t.replace(/\s+/g, ""));
    }
  }
  if (exprs.size === 0) return null;
  // 前缀 `(?:^|[^\w$.])` 是精度关键：`name` 不能匹配 `other.name` 里的 name，
  // 但 `args.name` 能匹配 `path.join(DIR, args.name)` 里的 args.name。
  return new RegExp([...exprs].map((e) => `(?:^|[^\\w$.])${escapeRe(e)}\\b`).join("|"));
}

// ═══════════════════════════════════════════════════════════════
// C4b（2026-09-20）：项目自有的「纯塑形」helper —— 补齐 C4 的最后一跳
//
// 缺口形态（fr-016 真实语料，iterateAsyncApiComponents / iterateComponents）：
//   const filename = getFileNamePath(componentDirPath, componentName, ext);
//   writeToFileByExtension(componentData, filename);      // sink 侧已继承（fr-016）
//   // getFileNamePath(a, b, c) { return path.join(a, b) + `.${c}`; }
// `componentName` 已被 Object.keys 污染，但 `getFileNamePath` 不在
// TS_PATH_SHAPER_RE 里（那是 node:path 家族 + String 原型方法的固定清单），
// 于是 `filename` 收不到污点 —— 整条流断在最后一跳。
//
// 判据（三条同时成立才认，宁可漏、不可错）：
//   ① 有形参，且有带表达式的 return（void / 只写文件的函数不算）
//   ② 函数体内没有文件 sink —— 含 sink 说明它不只是塑形
//   ③ 每个 return 表达式里：所有调用都是塑形调用（node:path 家族 / 保值字符串
//      方法 / 已认定的纯塑形 helper），且所有自由标识符都是自己的形参
// ③ 的后半句是精度核心：return 里只要出现任何**不是形参**的自由标识符
//   （模块常量、闭包变量、别的调用结果），就不认。
//
// 这与 C4 是同一条原则（白名单优于黑名单）：只对**能证明**的形态传播。
// 认不出来的 helper 不传播 —— 那是可见的漏报，比不可见的误报便宜（R9）。
// 有界：两轮不动点，允许 helper 调用已认定的 helper，但不追环。
// ═══════════════════════════════════════════════════════════════

/** node:path 家族里只做塑形、不做校验的方法名 */
const PATH_SHAPER_METHODS = new Set([
  "join", "resolve", "normalize", "basename", "dirname",
  "extname", "relative", "format", "toNamespacedPath",
]);

/**
 * 字符过滤方法 —— **故意不进** C4b 的证据集。
 *
 * C4 的内联规则里 `.replace/.trim/...` 是算塑形的（TS_PATH_SHAPER_RE 第二组），
 * 但那是「参数窗口里看得见整个表达式」时的取舍。helper 形式看不见实参窗口，
 * 判据就该更严：`.replace(/[^a-z0-9]/gi, "")` 恰恰是净化函数最常见的写法，
 * 把字符过滤当成「确定不净化」的证据，正是 C4 当初用白名单避开的那类错误
 * （`readSanitized` 用例锁的就是它）。
 * 代价：`toSlug(p) { return p.trim().toLowerCase(); }` 仍不传播（已知缺口）。
 */
const VALUE_STRING_METHODS = new Set([
  "trim", "trimStart", "trimEnd", "replace", "replaceAll",
  "toLowerCase", "toUpperCase", "toString", "slice", "substring",
  "substr", "padStart", "padEnd", "concat", "normalize",
]);

/** return 表达式里允许出现的非形参自由标识符（语言/模块级常量） */
const SHAPER_ALLOWED_FREE_IDENTS = new Set([
  "path", "sep", "undefined", "null", "true", "false", "String", "Number",
]);

/**
 * C4j：**运算符关键字**——本身不携带数据，出现在 return 表达式里不该让整条 helper 落选。
 *
 * 缺陷实证（2026-09-21 探针 G1/G2）：`(n, m) => typeof m === "string" || n + ".md"`
 * 整条判据不通过 —— 单趟标识符扫描把 `typeof` 当成"未知的自由标识符"给否了。
 * 后果不是"少收一点精度"，而是**整个 helper 不进名录** ⇒ 调用点拿不到任何证据 ⇒ 漏报。
 * 差别只在 typeof：G2 同形去掉 typeof 后 MARKED，G1 不标。
 *
 * `this` / `super` 刻意**不放行**：它们是接收者，可能携带数据（`this.prefix + n`），
 * 属于另一个话题（要不要把接收者纳入证据），不能靠"关键字"这条口子捎带进来。
 */
const SHAPER_ALLOWED_KEYWORDS = new Set([
  "typeof", "void", "delete", "in", "instanceof", "keyof", "as", "satisfies",
  "is", "asserts", "readonly", "infer", "new", "await", "yield", "of",
]);

/** 允许出现在调用位的值转换函数（不改变路径语义） */
const VALUE_CONVERTER_CALLS = new Set(["String", "Number", "Boolean"]);

/**
 * 判断 return 表达式是不是「纯塑形」：
 * 所有调用都在塑形白名单内，且所有自由标识符都是形参（或模块级字面量常量）。
 *
 * 实现上刻意做**单趟标识符扫描**（看每个标识符的紧邻字符），而不是
 * `NAME(?!\s*\()` 这种前瞻 —— 前瞻会被正则回溯绕过：
 * 对 `withExt(...)`，`([A-Za-z_$][\w$]*)(?!\s*\()` 可以退化成匹配 `withEx`
 * 让前瞻通过，于是把调用名误判成自由标识符（2026-09-20 实测踩到）。
 */
function isPureShaperExpr(
  expr: string,
  params: Set<string>,
  shapers: Set<string>,
  extraIdents?: Set<string>
): boolean {
  // 先抹掉字符串与模板字面量：里面的 `${...}` 可能带花括号，会干扰后续扫描；
  // 抹掉后如果表达式里还有别的自由标识符，仍会被下面的检查拦住。
  const s = expr
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

  const idRe = /[A-Za-z_$][\w$]*/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(s)) !== null) {
    const n = m[0];
    // 紧前一个非空字符 / 紧后一个非空字符
    let i = m.index - 1;
    while (i >= 0 && /\s/.test(s[i])) i--;
    const before = i >= 0 ? s[i] : "";
    let j = m.index + n.length;
    while (j < s.length && /\s/.test(s[j])) j++;
    const after = j < s.length ? s[j] : "";

    if (before === ".") continue; // 成员名（`.join` / `.name`），不参与判定
    if (after === "(") {
      // 调用位：必须落在塑形白名单。字符过滤方法（`VALUE_STRING_METHODS`）
      // **不算**证据 —— 见其定义处注释。
      if (!PATH_SHAPER_METHODS.has(n) && !VALUE_CONVERTER_CALLS.has(n) && !shapers.has(n)) {
        return false;
      }
      continue;
    }
    // 自由标识符：必须是自己的形参、语言级常量白名单，或**已确证的字面量常量 / path 别名**
    if (params.has(n) || SHAPER_ALLOWED_FREE_IDENTS.has(n)) continue;
    if (SHAPER_ALLOWED_KEYWORDS.has(n)) continue; // C4j：运算符关键字不携带数据
    if (extraIdents && extraIdents.has(n)) continue;
    return false;
  }
  return true;
}

/**
 * 收集模块级（top-level）**字面量**常量：名字 → 字面量文本（引号已脱）。
 *
 * 两个用途：
 *   ① helper 的 return 引用它们仍是纯塑形（C4e）；
 *   ② C4i：`{ [KEY]: (n) => … }` 这种计算属性名，只有 KEY 是字面量常量才解得
 *      出来 —— 解不出一律不登记（与「看不见就不传播」同一条政策）。
 */
function moduleConstTexts(project: Project): Map<string, string> {
  const out = new Map<string, string>();
  for (const sf of project.getSourceFiles()) {
    for (const vd of sf.getVariableDeclarations()) {
      // 只要模块作用域：VariableStatement 的父节点必须是 SourceFile
      const stmt = vd.getVariableStatement();
      if (!stmt || !Node.isSourceFile(stmt.getParent())) continue;
      const init = vd.getInitializer();
      if (!init) continue;
      // 只收「字面量」—— 一旦允许任意表达式，helper 就能把别处的污点藏在常量后面
      // （C4e 政策：看不见的一律不传播）
      const isLiteral =
        Node.isStringLiteral(init) ||
        Node.isNoSubstitutionTemplateLiteral(init) ||
        Node.isNumericLiteral(init) ||
        init.getKind() === ts.SyntaxKind.TrueKeyword ||
        init.getKind() === ts.SyntaxKind.FalseKeyword;
      if (isLiteral) out.set(vd.getName(), init.getText().replace(/^["'`]|["'`]$/g, ""));
    }
  }
  return out;
}

/**
 * C4e：`import * as p from "path"` / `import nodePath from "node:path"` /
 * `import { join } from "path"` —— 这些局部名随项目各异，但**出处可确证**是
 * path 模块，helper 的 return 引用它们仍是纯塑形。
 * 只放行 path 模块本身（含 node: 前缀），不放行 fs/os —— 后者会被 helper 用来把
 * IO 藏进 return（判据②只扫 sink 调用，覆盖不到「返回内嵌读写」这一类）。
 */
function pathModuleAliases(project: Project): Set<string> {
  const out = new Set<string>(["path"]);
  for (const sf of project.getSourceFiles()) {
    for (const id of sf.getImportDeclarations()) {
      const spec = id.getModuleSpecifierValue();
      if (spec !== "path" && spec !== "node:path") continue;
      // 实测（ts-morph 本仓库版本）：NamespaceImport 上既无 getName() 也无
      // getNameNode()，只有 getText() —— 返回的就是别名本身。
      const ns = id.getNamespaceImport(); // `import * as X`
      if (ns) out.add(ns.getText().replace(/[^\w$]/g, ""));
      const def = id.getDefaultImport();
      if (def) out.add(def.getText());
      for (const nb of id.getNamedImports()) out.add(nb.getName());
    }
  }
  return out;
}

/**
 * 柯里化 / 工厂形态 helper 的调用链。
 *
 * C4i 只会两跳（外层吃掉第一批实参、返回的内层再吃掉第二批）。C4j 把它推广成
 * **一串跳**，每跳声明自己吃哪批实参、以及这一跳是普通调用还是成员调用：
 *
 *   `const lvl3 = (a) => (b) => (n) => n + a + b`
 *     outerParams=[a]，hops=[call[b], call[n]]
 *   `const factory = (ext) => ({ toPath: (n) => n + ext })`
 *     outerParams=[ext]，hops=[member toPath [n]]
 *
 * `allParams` = 所有层次形参的并集，给 isPureShaperExpr 判据用；
 * `rets` = 最内层（真正塑形那一层）的 return 表达式。
 */
type CurryHop = { kind: "call" | "member"; name: string; params: string[] };
type CurrySpec = {
  outerParams: string[];
  hops: CurryHop[];
  allParams: string[];
  rets: string[];
};

/**
 * 一个纯塑形 helper 的形参表（有序）+「返回值真正依赖哪些形参」+ 原始 return 表达式。
 *
 * restAt —— C4i：形参表里 rest 形参（`...parts`）的位置，没有则 -1。rest 形参
 *           吃掉**从它开始的所有剩余实参**（位置对齐不能按位截断，否则
 *           `joinAll("out", k)` 会把 k 当成「越界的实参」抹掉 ⇒ 漏报）。
 */
type ShaperInfo = {
  params: string[]; deps: Set<string>; rets: string[]; restAt: number;
};
/**
 * names       —— 可按裸调用位匹配的（`withExt(` / `Util.toPath(`）
 * memberNames —— 只按成员调用位匹配的（`.toPath(`）：对象是哪个不确定，
 *                只有该方法名在全项目唯一时才登记，避免同名方法张冠李戴（R11）
 * curried     —— C4i/C4j：柯里化 / 工厂形态 helper，按名字索引；一个名字可以对
 *                多条链（工厂返回含多个方法的对象，每个方法一条）
 */
type ShaperTable = {
  names: Set<string>;
  memberNames: Set<string>;
  info: Map<string, ShaperInfo>;
  curried: Map<string, CurrySpec[]>;
};

/**
 * 形参名列表：解构形参（`function f({ name }) {…}`）不能用 getName() 直接取，
 * ts-morph 给的是整个绑定模式，要把里面的 BindingElement 名字逐个抽出来。
 */
function paramNamesOf(p: { getNameNode(): Node }): string[] {
  const nn = p.getNameNode();
  if (Node.isIdentifier(nn)) return [nn.getText()];
  const out: string[] = [];
  for (const be of nn.getDescendantsOfKind(ts.SyntaxKind.BindingElement)) {
    const n = be.getNameNode();
    if (Node.isIdentifier(n)) out.push(n.getText());
  }
  return out;
}

/**
 * 属性名：普通标识符 / 字符串字面量直接取；**计算属性名** `[KEY]` 只有在 KEY 是
 * 模块级字面量常量时才解（C4i）。解不出返回 null —— 认不出的一律不登记。
 */
function propertyNameOf(
  pa: Node & { getNameNode(): Node },
  constTexts: Map<string, string>
): string | null {
  const nn = pa.getNameNode();
  if (Node.isIdentifier(nn)) return nn.getText();
  if (Node.isStringLiteral(nn) || Node.isNoSubstitutionTemplateLiteral(nn)) {
    return nn.getText().replace(/^["'`]|["'`]$/g, "");
  }
  if (Node.isComputedPropertyName(nn)) {
    const e = nn.getExpression();
    // `const KEY = "toPath"; … { [KEY]: (n) => … }` —— KEY 的值必须看得见；
    // `[key()]` 这种算不出来的，宁可整个不收（探针 K2 守的就是这条）。
    if (Node.isIdentifier(e)) return constTexts.get(e.getText()) ?? null;
  }
  return null;
}

/**
 * 方法声明的宿主限定名：`const Util = { toPath(){} }` ⇒ "Util"、
 * `const Cfg = { inner: { toPath(){} } }` ⇒ "Cfg.inner"、`class Paths {…}` ⇒ "Paths"。
 * 取不出来就返回 null —— 认不出宿主的宁可不登记（保守侧）。
 */
function ownerQualifier(
  md: Node & { getParent(): Node | undefined },
  constTexts: Map<string, string> = new Map()
): string | null {
  const parent = md.getParent();
  if (!parent) return null;
  if (Node.isClassDeclaration(parent)) return parent.getName() ?? null;
  if (!Node.isObjectLiteralExpression(parent)) return null;
  const parts: string[] = [];
  let cur: Node = parent;
  for (let guard = 0; guard < 5; guard++) {
    const up = cur.getParent();
    if (!up) return null;
    if (Node.isPropertyAssignment(up)) {
      const keyName = propertyNameOf(up, constTexts);
      if (keyName === null) return null;
      parts.unshift(keyName);
      cur = up.getParent();
      if (!cur) return null;
      continue;
    }
    if (Node.isVariableDeclaration(up)) {
      parts.unshift(up.getName());
      return parts.join(".");
    }
    return null;
  }
  return null;
}

/**
 * C4i：函数声明的命名空间限定名 —— `namespace P { export function toPath(){} }` ⇒ "P"
 * （嵌套 namespace 拼成 "A.B"）。只认**纯 namespace 链**：函数套函数那种 helper
 * 作用域与调用点不同，按同一名字发布会张冠李戴，一律返回 null 交给调用方跳过。
 */
function moduleQualifier(fn: FunctionDeclaration): string | null {
  const parts: string[] = [];
  let cur: Node = fn;
  for (let guard = 0; guard < 6; guard++) {
    const up = cur.getParent();
    if (!up) return null;
    // 注意（实测）：`namespace P { export function f(){} }` 里函数的父节点是
    // **ModuleBlock**（namespace 的体），ModuleDeclaration 在它的上一层。
    if (Node.isModuleBlock(up)) {
      const decl = up.getParent();
      if (!decl || !Node.isModuleDeclaration(decl)) return null;
      const n = decl.getName();
      if (!n) return null;
      parts.unshift(n);
      cur = decl;
      continue;
    }
    if (Node.isModuleDeclaration(up)) {
      const n = up.getName();
      if (!n) return null;
      parts.unshift(n);
      cur = up;
      continue;
    }
    if (Node.isSourceFile(up)) return parts.length > 0 ? parts.join(".") : null;
    return null; // 函数体内的嵌套声明：作用域不同，不收
  }
  return null;
}

/**
 * 剥掉包在**函数体外面的**那几层壳，露出真正的箭头 / 函数表达式：
 * 括号 `((n) => …)`、类型断言 `((n) => …) as Fn`、`satisfies Fn`、`<Fn>(…)`。
 *
 * C4j 补后三种。实测（探针 F3b/F3c）：`export const toPath = ((n) => n + ".md")
 * satisfies Fn` 与 `{ toPath: ((n) => n + ".md") as any }` 都不传播 ——
 * 旧代码只认「初值就是箭头」，断言把它们包了一层，整族漏。
 */
function unwrapFns(n: Node | undefined): Node | undefined {
  let cur = n;
  for (let i = 0; i < 6 && cur; i++) {
    if (Node.isParenthesizedExpression(cur)) { cur = cur.getExpression(); continue; }
    if (Node.isAsExpression(cur)) { cur = cur.getExpression(); continue; }
    if (Node.isSatisfiesExpression(cur)) { cur = cur.getExpression(); continue; }
    if (Node.isTypeAssertion(cur)) { cur = cur.getExpression(); continue; }
    break;
  }
  return cur;
}

/**
 * C4i：变量初值承载的 helper 体。除箭头 / 函数表达式外，再解一层 IIFE ——
 * `const toPath = (() => (n) => n + ".md")();` 的初值是**调用**不是箭头，
 * 真正的 helper 是被 IIFE 返回出来的那个内层箭头（旧代码整条族漏）。
 */
function functionLikeOf(init: Node): ArrowFunction | FunctionExpression | null {
  // 实测：`(() => (n) => n + ".md")()` 里被括号包住的**不止**内层箭头 ——
  // 连被调用的 callee 都是 ParenthesizedExpression。两处都得脱。
  const base = unwrapFns(init);
  if (!base) return null;
  if (Node.isArrowFunction(base) || Node.isFunctionExpression(base)) return base;
  if (Node.isCallExpression(base)) {
    const callee = unwrapFns(base.getExpression());
    if (!Node.isArrowFunction(callee) && !Node.isFunctionExpression(callee)) return null;
    const b = callee.getBody();
    if (!Node.isBlock(b)) {
      // 简洁体：`(() => (n) => n + ".md")()` —— 括号包着也算（unparen）
      const e = unwrapFns(b);
      return e && (Node.isArrowFunction(e) || Node.isFunctionExpression(e)) ? e : null;
    }
    for (const rs of b.getDescendantsOfKind(ts.SyntaxKind.ReturnStatement)) {
      const e = unwrapFns(rs.getExpression());
      if (e && (Node.isArrowFunction(e) || Node.isFunctionExpression(e))) return e;
    }
  }
  return null;
}

/** 按顶层逗号切分实参串（跳过字符串与已配平的括号，后者由调用方保证不含嵌套） */
function splitTopLevelArgs(argText: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < argText.length; i++) {
    const ch = argText[i];
    if (quote) {
      cur += ch;
      if (ch === quote && argText[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim() !== "" || out.length > 0) out.push(cur);
  return out;
}

/**
 * C4i：形参表里 rest 形参（`...parts`）的位置；没有返回 -1。
 * rest 形参对应的是【一批】实参，不是一位 —— 位置对齐必须让它吃掉末尾所有位。
 */
function restIndexOf(ps: Array<{ isRestParameter(): boolean }>): number {
  return ps.findIndex((p) => p.isRestParameter());
}

/** 实参位 ⇒ 形参位（rest 形参吃掉从它开始的剩余位） */
function paramIndexOf(si: ShaperInfo, argIndex: number): number {
  return si.restAt >= 0 && argIndex >= si.restAt ? si.restAt : argIndex;
}

/**
 * C4i/C4j：柯里化 helper —— 函数体【返回】另一个函数
 * （`(ext) => (n) => n + ext`、`(a) => (b) => (n) => n + a + b`）。
 * 被调用的不是最外层，而是它一路返回出来的最内层；真正塑形在那里，
 * 外层只负责捕获自己那一批实参。返回的不是函数（含返回对象字面量的工厂形态）
 * 一律返回 null，交给 currySpecsOf 的另一条路。
 */
function curryChainOf(outerParams: string[], body: Node): CurrySpec | null {
  const ret = returnedValueOf(body);
  if (!ret) return null;
  if (!Node.isArrowFunction(ret) && !Node.isFunctionExpression(ret)) return null;

  const hops: CurryHop[] = [];
  let cur: Node | undefined = ret;
  for (let depth = 0; depth < 4; depth++) {
    if (!cur) break;
    if (!Node.isArrowFunction(cur) && !Node.isFunctionExpression(cur)) return null;
    const fbody = cur.getBody();
    if (!fbody) return null;
    const params = cur.getParameters().flatMap(paramNamesOf).filter(Boolean);
    hops.push({ kind: "call", name: "", params });
    const next = returnedFunctionOf(fbody);
    if (!next) {
      const rets = returnExprsOf(fbody);
      if (rets.length === 0) return null;
      // 内层无形参 ⇒ 没有「经内层实参进来」的污点，外层按普通 helper 处理
      if (hops[hops.length - 1].params.length === 0) return null;
      const allParams = new Set(outerParams);
      for (const h of hops) for (const p of h.params) allParams.add(p);
      return { outerParams, hops, allParams: [...allParams], rets };
    }
    cur = next;
  }
  return null;
}

/**
 * C4j：一个函数体对应的全部调用链。
 *   - 「返回函数」形态 ⇒ 0 或 1 条（沿返回值爬到最内层）；
 *   - 「返回对象字面量」形态 ⇒ 每个**函数属性**各一条（工厂 / builder 的常态，
 *     `factory(".md").toPath(k)` 里的 `toPath` 才是塑形那一层）。
 * 属性名算不出（计算属性名而常量不可见）或无形参 / 无返回的，跳过该条。
 */
function currySpecsOf(outerParams: string[], body: Node): CurrySpec[] {
  const ret = returnedValueOf(body);
  if (!ret) return [];
  if (!Node.isObjectLiteralExpression(ret)) {
    const one = curryChainOf(outerParams, body);
    return one ? [one] : [];
  }
  const specs: CurrySpec[] = [];
  for (const prop of ret.getProperties()) {
    let name: string | null = null;
    let fn: ArrowFunction | FunctionExpression | MethodDeclaration | undefined;
    if (Node.isPropertyAssignment(prop)) {
      name = prop.getName().replace(/^["'`]|["'`]$/g, "");
      const inner = unwrapFns(prop.getInitializer());
      if (inner && (Node.isArrowFunction(inner) || Node.isFunctionExpression(inner))) {
        fn = inner;
      }
    } else if (Node.isMethodDeclaration(prop)) {
      name = prop.getName();
      fn = prop;
    }
    if (!fn || !name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    const fbody = fn.getBody();
    if (!fbody) continue; // 重载签名 / declare
    const params = fn.getParameters().flatMap(paramNamesOf).filter(Boolean);
    if (params.length === 0) continue; // 判据①
    const rets = returnExprsOf(fbody);
    if (rets.length === 0) continue;
    specs.push({
      outerParams,
      hops: [{ kind: "member", name, params }],
      allParams: [...outerParams, ...params],
      rets,
    });
  }
  return specs;
}

/** 函数体返回出来的那个值（简洁体本身 / return 语句的表达式，都先解断言与括号） */
function returnedValueOf(body: Node): Node | undefined {
  if (!Node.isBlock(body)) return unwrapFns(body);
  for (const rs of body.getDescendantsOfKind(ts.SyntaxKind.ReturnStatement)) {
    const e = unwrapFns(rs.getExpression());
    if (e) return e;
  }
  return undefined;
}

/** 函数体返回出来的那个箭头 / 函数表达式（没有则 null） */
function returnedFunctionOf(body: Node): ArrowFunction | FunctionExpression | null {
  if (!Node.isBlock(body)) {
    // 箭头简洁体本身就是要返回的函数：`(ext) => (n) => n + ext`（可能被括号包住）
    const e = unwrapFns(body);
    return e && (Node.isArrowFunction(e) || Node.isFunctionExpression(e)) ? e : null;
  }
  for (const rs of body.getDescendantsOfKind(ts.SyntaxKind.ReturnStatement)) {
    const e = unwrapFns(rs.getExpression());
    if (e && (Node.isArrowFunction(e) || Node.isFunctionExpression(e))) return e;
  }
  return null;
}

/**
 * C4i/C4j：柯里化与工厂形态的调用点展开。`withExt(".md")(k)`、`lvl4(a)(b)(c)(k)`、
 * `factory(".md").toPath(k)` 里真正塑形的是链的**最后一跳** —— 这里按各跳的实参把
 * 最内层 return 表达式代入后原地摊开，之后的污点检测直接看摊开后的串：
 *   `withExt(".md")(k)` ⇒ `k + ".md"`；`factory(".md").toPath(k)` ⇒ `k + ".md"`。
 * 丢形参的最后一跳（`(_n) => "fixed.md"`）摊开后是常量 ⇒ 自然不传播。
 */
function expandCurried(text: string, curried: Map<string, CurrySpec[]>): string {
  if (curried.size === 0) return text;
  let cur = text;
  for (let round = 0; round < 4; round++) {
    const next = expandCurriedOnce(cur, curried);
    if (next === null) break;
    cur = next;
  }
  return cur;
}

/** 摊开**一处**柯里化 / 工厂形态调用；没有可摊的返回 null（供调用方收敛） */
function expandCurriedOnce(text: string, curried: Map<string, CurrySpec[]>): string | null {
  for (const [name, specs] of curried) {
    const re = new RegExp(`(?:^|[^\\w$.])${escapeRe(name)}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const open1 = m.index + m[0].length - 1;
      const close1 = matchingParen(text, open1);
      if (close1 < 0) continue;
      const args0 = splitTopLevelArgs(text.slice(open1 + 1, close1));
      for (const cs of specs) {
        const map = new Map<string, string>();
        args0.forEach((a, i) => {
          const p = cs.outerParams[i];
          if (p !== undefined) map.set(p, stripOuterParens(a.trim()));
        });
        // 沿链一路吃掉各跳：普通跳是紧跟的 `(`，成员跳是 `.name(`
        let cursor = close1 + 1;
        let ok = true;
        for (const hop of cs.hops) {
          let j = cursor;
          while (j < text.length && /\s/.test(text[j])) j++;
          if (hop.kind === "member") {
            if (text[j] === "?") j++; // 可选链 `?.toPath(`
            if (text[j] !== ".") { ok = false; break; }
            j++;
            const nm = /^[A-Za-z_$][\w$]*/.exec(text.slice(j));
            if (!nm || nm[0] !== hop.name) { ok = false; break; }
            j += nm[0].length;
            while (j < text.length && /\s/.test(text[j])) j++;
          }
          if (text[j] !== "(") { ok = false; break; }
          const cl = matchingParen(text, j);
          if (cl < 0) { ok = false; break; }
          splitTopLevelArgs(text.slice(j + 1, cl)).forEach((a, i) => {
            const p = hop.params[i];
            if (p !== undefined && !map.has(p)) map.set(p, stripOuterParens(a.trim()));
          });
          cursor = cl + 1;
        }
        if (!ok) continue;
        const inner = cs.rets.length === 1 ? cs.rets[0] : cs.rets.join(" + ");
        const expanded = foldDecidableTernary(substituteParams(inner, map));
        const nameStart = m.index + (m[0].startsWith(name) ? 0 : 1);
        return text.slice(0, nameStart) + expanded + text.slice(cursor);
      }
    }
  }
  return null;
}

/**
 * C4f：把 helper 调用里【返回值不依赖的那些实参】抹掉。
 *
 * 名字级传播的老问题是：`discard(k) { return "fixed.md"; }` 明明把形参丢了，
 * 只要 `k` 出现在赋值右侧就会被当成污点证据 ⇒ 误标。返回值既然不依赖那个形参，
 * 那条支路就没有数据流。按形参-实参位置对齐后：
 *
 *   discard(k)          ⇒ `""`          （不依赖任何形参）
 *   pick("safe", k)     ⇒ `("safe")`    （只依赖第一个形参）
 *
 * 只处理实参里不再嵌套括号的调用（最内层优先），有界 3 轮向外。
 * 抹掉的是**证据**，`shaped` 判定仍看原式 —— helper 是不是塑形，与它的返回值
 * 依不依赖实参是两件事。
 */
function maskNonDependentArgs(
  text: string,
  info: Map<string, ShaperInfo>,
  memberNames: Set<string> = new Set()
): string {
  if (info.size === 0) return text;
  let cur = text;
  for (let round = 0; round < 3; round++) {
    const next = maskNonDependentArgsOnce(cur, info, memberNames);
    if (next === null) break;
    cur = next;
  }
  return cur;
}

/** 抹掉**一个**最内层调用；没有任何调用需要抹时返回 null（供调用方收敛） */
function maskNonDependentArgsOnce(
  text: string,
  info: Map<string, ShaperInfo>,
  memberNames: Set<string>
): string | null {
  for (const [name, si] of info) {
    const re = memberNames.has(name)
      ? new RegExp(`\\.${escapeRe(name)}\\s*\\(`, "g")
      : new RegExp(
          `(?:^|[${name.includes(".") ? "^\\w$" : "^\\w$."}])${escapeRe(name)}\\s*\\(`,
          "g"
        );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // 成员形态的匹配从 `.` 起算，替换也连点一起换掉
      const nameStart = memberNames.has(name) ? m.index : m.index + (m[0].startsWith(name) ? 0 : 1);
      const open = m.index + m[0].length - 1; // 开括号位置
      let depth = 0;
      let close = -1;
      for (let i = open; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") { depth--; if (depth === 0) { close = i; break; } }
      }
      if (close < 0) continue;
      const argText = text.slice(open + 1, close);
      if (/[([{]/.test(argText)) continue; // 还嵌着别的调用 —— 下一轮再处理
      const args = splitTopLevelArgs(argText);
      // C4h-①：按【本次调用】重算一下哪些位置会流出去 —— 名录里的 deps 是对所有
      // 实参形状都成立的最宽结论，本次若喂了常量，可能一个都流不出来。
      const flags = callSiteKeepFlags(si, args, info, memberNames);
      const kept = args.filter((_, i) => {
        const pi = paramIndexOf(si, i); // C4i：rest 形参吃掉剩余位
        return si.params[pi] !== undefined && flags[pi] === true;
      });
      if (kept.length === args.length) continue; // 每个形参都被依赖 ⇒ 无需抹
      const replacement = kept.length > 0 ? `(${kept.join(" + ")})` : `""`;
      return text.slice(0, nameStart) + replacement + text.slice(close + 1);
    }
  }
  return null;
}

/**
 * C4h-①（2026-09-20）：调用点专用的「哪些实参会流到返回值里」。
 *
 * 名录里的 deps 是**跨调用点**的并集 —— 对所有实参形状都成立的最宽结论。
 * 但本次调用喂的可能是常量：
 *
 *   viaFlag(n, flag) { return flag ? "fixed.md" : n + ".md"; }
 *   viaFlag(k, true)  ⇒ 返回值就是字面量 —— n 位虽然进了函数也出不来。
 *
 * 于是按位置把**字面量实参**代进 return 表达式，试着解掉 cond 可判定的三元，
 * 再看还有哪些形参活着。两种情形一律退回名录的 deps（保守侧，宁可不收精度）：
 *   - 实参一个常量都没有；
 *   - cond 代入后判不出真假 —— 认不出就不收精度。
 */
function callSiteKeepFlags(
  si: ShaperInfo,
  args: string[],
  info: Map<string, ShaperInfo>,
  memberNames: Set<string>
): boolean[] {
  const fallback = si.params.map((p) => si.deps.has(p));
  if (si.rets.length === 0) return fallback;
  const litArgs = new Map<string, string>();
  args.forEach((a, i) => {
    // C4i：rest 形参拿到的是【一批】实参，不等于任意一个 —— 不代，否则
    // `parts.join("/")` 会被代成 `"out".join("/"` 从而误判「不依赖 parts」
    if (si.restAt >= 0 && i >= si.restAt) return;
    const p = si.params[i];
    if (p === undefined) return;
    const t = stripOuterParens(a.trim());
    // 只代【字面量】—— 变量名进来不等于知道它的值
    if (litKind(t) !== null) litArgs.set(p, t);
  });
  if (litArgs.size === 0) return fallback;
  const subbed = si.rets.map((r) => foldDecidableTernary(substituteParams(r, litArgs)));
  const remaining = si.params.filter((p) => p !== undefined && !litArgs.has(p));
  // 嵌套 helper 的支路仍由 returnDeps 负责抹
  const deps = returnDeps(subbed, remaining, info, memberNames);
  return si.params.map((p) => deps.has(p));
}

/** 把形参名替换成实参文本（跳字符串与模板字面量内部 —— 判不出就保守地留着形参） */
function substituteParams(expr: string, litArgs: Map<string, string>): string {
  let out = "";
  let quote = "";
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += expr[i + 1] ?? ""; i += 2; continue; }
      if (ch === quote) quote = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; i++; continue; }
    // C4i：模板串不能像普通字符串那样整段跳过 —— `${flag ? "fixed" : n}` 里的
    // flag 是要代的。字面量部分照抄，只对 `${}` 内部递归代入。
    if (ch === "`") {
      out += ch;
      i++;
      while (i < expr.length) {
        const c = expr[i];
        if (c === "`") break; // 模板串内不可能有裸反引号（转义的已被下面处理）
        if (c === "\\") { out += expr.slice(i, i + 2); i += 2; continue; }
        if (c === "$" && expr[i + 1] === "{") {
          let k = i + 2;
          let brace = 0;
          let inner = "";
          while (k < expr.length) {
            const d = expr[k];
            if (d === "{") brace++;
            else if (d === "}") { if (brace === 0) break; brace--; }
            inner += d;
            k++;
          }
          out += "${" + substituteParams(inner, litArgs) + "}";
          i = k + 1;
          continue;
        }
        out += c;
        i++;
      }
      if (i < expr.length && expr[i] === "`") { out += "`"; i++; }
      continue;
    }
    const m = /^[A-Za-z_$][\w$]*/.exec(expr.slice(i));
    if (m && expr[i - 1] !== "." && litArgs.has(m[0])) {
      // 不加括号：代进去的永远是【原子字面量】（字符串/数字/布尔/null），
      // 不会改变优先级；而加括号会让 maskNonDependentArgsOnce 把参数串误判成嵌套
      // 调用（它的判据是「实参里还有 `(`」），内层就再也轮不到它来处理。
      out += litArgs.get(m[0]);
      i += m[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * 递归解掉 cond 可判定的三元 / 短路；判不出就保持原样（保守侧）。
 *
 * C4i（2026-09-21）补两类：
 *   - 模板串内部的 `${...}` 是独立表达式，折叠必须能进去 —— 否则
 *     `` `${flag ? "fixed" : n}.md` `` 这种写法（现代代码里比裸三元更常见）
 *     永远收不住；
 *   - 短路运算符 `||` / `&&` / `??`：与三元同形，只是判据从 cond 换成了
 *     左操作数的真假。JS 求值是从左到右，短路一发生右边整段根本不执行。
 */
function foldDecidableTernary(expr: string, depth = 0): string {
  if (depth > 4) return expr;
  // 先脱掉包住整串的括号 —— 不脱的话 `(()flag ? a : b)` 这种写法切出来的 cond
  // 是 `((true)`，括号不配对 ⇒ 判不出真假 ⇒ 白白丢掉一次收精度的机会
  // （2026-09-20 探针：viaFlag(k, true) 一直没收住，根因就是这个）。
  const s = stripOuterParens(expr);

  // ① 模板串：先处理 `${}` 内部（外面那层字面量部分不参与判定）
  const tpl = foldTemplateSubsts(s, depth);
  if (tpl !== s) return tpl;

  // ② 三元
  const t = topLevelTernary(s);
  if (t) {
    const v = truthOf(t.cond);
    if (v !== null) return foldDecidableTernary(v ? t.a : t.b, depth + 1);
  }
  // ③ 短路
  const lg = topLevelLogical(s);
  if (lg) {
    const v = lg.op === "??" ? notNullish(lg.left) : truthOf(lg.left);
    if (v !== null) {
      // `||` 左为真 ⇒ 取左；`&&` 左为真 ⇒ 取右；`??` 左非空 ⇒ 取左
      const takeLeft = lg.op === "&&" ? !v : v;
      return foldDecidableTernary(takeLeft ? lg.left : lg.right, depth + 1);
    }
  }
  return expr === s ? expr : s;
}

/**
 * 折叠模板串里每个 `${...}` 的内部；没有任何一处可折叠就**原样返回**（让调用方
 * 知道这一层没做事，好继续试三元/短路）。
 */
function foldTemplateSubsts(expr: string, depth: number): string {
  if (!expr.includes("`")) return expr;
  let out = "";
  let changed = false;
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch !== "`") { out += ch; i++; continue; }
    let seg = "";
    let j = i + 1;
    while (j < expr.length) {
      const c = expr[j];
      if (c === "\\") { seg += expr.slice(j, j + 2); j += 2; continue; }
      if (c === "`") break;
      if (c === "$" && expr[j + 1] === "{") {
        // 找与 `${` 配对的 `}`（`${ {a:1}.a }` 里的花括号要跳过）
        let brace = 0;
        let k = j + 2;
        let inner = "";
        while (k < expr.length) {
          const d = expr[k];
          if (d === "{") brace++;
          else if (d === "}") { if (brace === 0) break; brace--; }
          inner += d;
          k++;
        }
        const folded = foldDecidableTernary(inner, depth + 1);
        if (folded !== inner) changed = true;
        seg += "${" + folded + "}";
        j = k + 1;
        continue;
      }
      seg += c;
      j++;
    }
    out += "`" + seg + "`";
    i = j + 1;
  }
  return changed ? out : expr;
}

/**
 * 顶层短路运算符：**最左边**的一个。优先级从低到高依次找 `||` → `??` → `&&`
 * （TS 里 `??` 与 `||`/`&&` 同级混用必须加括号，加了括号就不是顶层了）。
 * 只认左右都非空的那一个。
 */
function topLevelLogical(expr: string): { left: string; right: string; op: "||" | "&&" | "??" } | null {
  for (const op of ["||", "??", "&&"] as const) {
    let paren = 0;
    let quote = "";
    let i = 0;
    while (i < expr.length) {
      const ch = expr[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
      if (ch === "(" || ch === "[" || ch === "{") paren++;
      else if (ch === ")" || ch === "]" || ch === "}") paren--;
      else if (paren === 0 && expr.startsWith(op, i)) {
        // `??`/`||`/`&&` 各占两字符，注意别把 `a ||= b` 这类当短路（赋值语义不同）
        if (expr[i + 2] === "=") { i += 3; continue; }
        const left = expr.slice(0, i).trim();
        const right = expr.slice(i + 2).trim();
        if (left !== "" && right !== "") return { left, right, op };
      }
      i++;
    }
  }
  return null;
}

/** 左操作数**确定不是** null/undefined 时返回 true；判不出返回 null */
function notNullish(s: string): boolean | null {
  const lit = litOf(s);
  if (!lit) return null;
  return lit.k !== "null";
}

/**
 * 顶层三元的三段。要点是"顶层"：`a ? b ? c : d : e` 里第一个顶层 `:` 属于内层
 * 三元，不能拿来切 —— 否则会把 b 误当成整个真值分支。
 */
function topLevelTernary(expr: string): { cond: string; a: string; b: string } | null {
  let paren = 0;
  let qDepth = 0;
  let qPos = -1;
  let cPos = -1;
  let quote = "";
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
    if (ch === "(" || ch === "[" || ch === "{") paren++;
    else if (ch === ")" || ch === "]" || ch === "}") paren--;
    else if (paren === 0) {
      if (ch === "?") { if (qDepth === 0) qPos = i; qDepth++; }
      else if (ch === ":" && qDepth > 0) {
        if (qDepth === 1) { cPos = i; break; }
        qDepth--;
      }
    }
    i++;
  }
  if (qPos < 0 || cPos < 0) return null;
  return { cond: expr.slice(0, qPos), a: expr.slice(qPos + 1, cPos), b: expr.slice(cPos + 1) };
}

/**
 * 脱掉**包住整串**的括号（`(x)` ⇒ `x`，可能多层）。只脱真的配到串尾的那种 ——
 * `(a) + (b)` 的首个括号不到底，不会被误脱。
 */
function stripOuterParens(expr: string): string {
  let cur = expr.trim();
  for (let guard = 0; guard < 8; guard++) {
    if (!cur.startsWith("(")) break;
    const close = matchingParen(cur, 0);
    if (close !== cur.length - 1) break;
    const inner = cur.slice(1, -1).trim();
    if (inner === "") break;
    cur = inner;
  }
  return cur;
}

/** 判得出来就返回 true/false，判不出返回 null */
function truthOf(cond: string): boolean | null {
  const s = stripOuterParens(cond);
  if (/^!\s*\S/.test(s)) {
    const v = truthOf(s.replace(/^!\s*/, ""));
    return v === null ? null : !v;
  }
  const lit = litOf(s);
  if (lit) {
    if (lit.k === "bool") return lit.v === "true";
    if (lit.k === "null") return false; // null / undefined
    if (lit.k === "num") return Number(lit.v) !== 0;
    return lit.v.length > 0; // 字符串
  }
  const eq = /^(.+?)\s*(===|!==)\s*(.+)$/.exec(s);
  if (eq) {
    const l = litOf(eq[1]);
    const r = litOf(eq[3]);
    // 两边都是字面量但类型不同（`"1" === 1`）—— JS 语义下也是 false/true，可判
    if (l && r) {
      const same = l.k === r.k && l.v === r.v;
      return eq[2] === "===" ? same : !same;
    }
  }
  return null;
}

/** 字面量种类：字符串 / 数字 / 布尔 / null-undefined；不是字面量返回 null */
function litOf(s: string): { k: "str" | "num" | "bool" | "null"; v: string } | null {
  const clean = stripOuterParens(s.trim()); // 代入时实参被套了括号：`(true) === true`
  return litKind(clean);
}

function litKind(s: string): { k: "str" | "num" | "bool" | "null"; v: string } | null {
  if (/^"(?:\\.|[^"\\])*"$/.test(s) || /^'(?:\\.|[^'\\])*'$/.test(s) || /^`(?:\\.|[^`\\])*`$/.test(s)) {
    return { k: "str", v: s.slice(1, -1) };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return { k: "num", v: s };
  if (s === "true" || s === "false") return { k: "bool", v: s };
  if (s === "null" || s === "undefined") return { k: "null", v: s };
  return null;
}

/** s[open] 是开括号时，返回与之配对的闭括号下标；不配对返回 -1 */
function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * 同名多处的依赖集合并：按**形参位**取并集（OR）—— 任何一个实现在某个位置
 * 会流出污点，那个位置就得当成会流出（合并到保守侧）。
 * 形参表不一致时不合并 return 表达式（`rets=[]` ⇒ 调用点折叠自动退回，
 * 只按并集传播），因为把 A 的形参名代进 B 的 return 是错的。
 */
function mergeShapers(infos: ShaperInfo[]): ShaperInfo {
  if (infos.length === 0) return { params: [], deps: new Set<string>(), rets: [], restAt: -1 };
  const widest = infos.reduce((a, b) => (b.params.length > a.params.length ? b : a));
  const params = widest.params;
  const flags = params.map(() => false);
  let sameShape = true;
  for (const si of infos) {
    if (si.params.length !== params.length || si.params.some((p, i) => p !== params[i])) sameShape = false;
    si.params.forEach((p, i) => { if (i < flags.length && si.deps.has(p)) flags[i] = true; });
  }
  const rets = sameShape ? infos.flatMap((si) => si.rets) : [];
  return { params, deps: new Set(params.filter((_, i) => flags[i])), rets, restAt: widest.restAt };
}

/** return 表达式真正依赖哪些形参：把「已知 helper 调用里不被依赖的实参」抹掉后，
 * 剩下的形参名就是会流进返回值的那些。`wrap(n) { return discard(n); }` ⇒ 空集。
 */
function returnDeps(
  exprs: string[],
  params: string[],
  info: Map<string, ShaperInfo>,
  memberNames: Set<string> = new Set()
): Set<string> {
  const deps = new Set<string>();
  for (const raw of exprs) {
    const masked = maskNonDependentArgs(raw, info, memberNames);
    for (const p of params) {
      if (new RegExp(`(?:^|[^\\w$.])${escapeRe(p)}(?:[^\\w$]|$)`).test(masked)) deps.add(p);
    }
  }
  return deps;
}

/** return 表达式列表：块体取 return 语句，箭头简洁体把整个体当作返回值 */
function returnExprsOf(body: Node): string[] {
  if (!Node.isBlock(body)) return [body.getText()]; // 箭头简洁体
  const rets: string[] = [];
  for (const rs of body.getDescendantsOfKind(ts.SyntaxKind.ReturnStatement)) {
    const e = rs.getExpression();
    if (e) rets.push(e.getText());
  }
  return rets;
}

/**
 * C4j：`export default (n) => n + ".md"` 这种**匿名**默认导出没有名字可登记，
 * 能用的名字只有「别的文件 import 它时起的本地名」。用 ts-morph 的模块解析找到
 * 真正指向该文件的默认导入（解析不出的模块一律跳过 —— 认不出就不收）。
 */
function defaultImportLocalNames(project: Project, target: SourceFile): Set<string> {
  const out = new Set<string>();
  const targetPath = target.getFilePath();
  for (const sf of project.getSourceFiles()) {
    if (sf.getFilePath() === targetPath) continue;
    for (const imp of sf.getImportDeclarations()) {
      let resolved: SourceFile | undefined;
      try {
        resolved = imp.getModuleSpecifierSourceFile() ?? undefined;
      } catch {
        continue; // 解析不了（路径写错 / 别名没配）—— 跳过
      }
      if (!resolved || resolved.getFilePath() !== targetPath) continue;
      const d = imp.getDefaultImport();
      if (d) out.add(d.getText());
    }
  }
  return out;
}

/** 扫描全项目，收集「纯塑形」helper 的名字 + 返回值依赖（有界两轮不动点） */
function pureShaperFunctionNames(project: Project): ShaperTable {
  const sinkRe = tsSinkCallRegex();

  /**
   * 候选。三段的用意：
   *   key   —— 内部唯一编号。**同名多处各有一条**（同一 `toPath` 被两个类实现时
   *            两条并存），因为「确证」是逐条发生的；
   *   name  —— 确证后**对外发布**的名字；null 表示这条只作为"资格凭证"，不发
   *            布（宿主认不出 / 名字已被先到者占用）；
   *   group —— 成员形态的裸名（方法与属性箭头），用于 C4h-② 的同名合并。
   */
  type Cand = {
    key: string; name: string | null; group: string | null;
    params: Set<string>; paramList: string[]; rets: string[];
    restAt: number; curry: CurrySpec[];
  };
  const cands: Cand[] = [];
  const takenNames = new Set<string>();
  const groups = new Map<string, string[]>();
  // 模块级字面量常量（值一并留着：C4i 的计算属性名 `[KEY]` 要靠它解）
  const constTexts = moduleConstTexts(project);

  /**
   * 把一个**没通过判据**的实现记进它所属的成员组。
   *
   * C4j 修（探针 B4/B6 实测）：C4h-② 的"全组确证"只在**进了组**的候选之间成立，
   * 而三条判据不成立的实现在 consider() 里就 return 了 —— 它压根不在组里，于是
   * 「同名三处，一处无形参、一处体内有 sink、一处是好 helper」会被当成"全组都确证"，
   * 成员调用位被放行 ⇒ 误标。组必须记全：**存在过但没确证**也要算进"不是全组确证"。
   */
  const noteUnaccepted = (key: string, group: string | null) => {
    if (group === null) return;
    const list = groups.get(group) ?? [];
    if (!list.includes(key)) list.push(key);
    groups.set(group, list);
  };

  /** 登记一个候选：三条判据 —— 有形参 / 有返回值 / 体内无 sink */
  const consider = (
    key: string,
    name: string | null,
    group: string | null,
    paramNodes: string[],
    restAt: number,
    curry: CurrySpec[],
    declText: string,
    bodyNode: Node
  ) => {
    const paramList = paramNodes.filter(Boolean);
    const params = new Set(paramList);
    if (params.size === 0) return noteUnaccepted(key, group); // 判据①
    sinkRe.lastIndex = 0;
    if (sinkRe.test(declText)) return noteUnaccepted(key, group); // ②
    // 用 AST 取 return 表达式，而不是正则 —— 模板字面量里的 `${}` 会
    // 让「遇到花括号就停」的朴素正则在 `path.join(a,b) + \`.${c}\`` 上截断。
    const rets = returnExprsOf(bodyNode);
    // 柯里化 / 工厂形态：return 出来的是函数或装着函数的对象 ⇒ 判据①看的是最内层
    if (rets.length === 0 && curry.length === 0) return noteUnaccepted(key, group); // ③
    let pub = name;
    if (pub !== null) {
      if (takenNames.has(pub)) pub = null; // 同名重复登记：先到先得，后者降到资格凭证
      else takenNames.add(pub);
    }
    cands.push({ key, name: pub, group, params, paramList, rets, restAt, curry });
    if (group !== null) {
      const list = groups.get(group) ?? [];
      list.push(key);
      groups.set(group, list);
    }
  };

  for (const sf of project.getSourceFiles()) {
    // (a) 函数声明 —— 顶层 + namespace 内
    //     C4i：旧代码用 sf.getFunctions()，实测取不到 `namespace P { export
    //     function toPath(){} }` 里的函数，整片漏（探针 F1）。改遍历声明节点，
    //     但**只收顶层 / namespace 链上的**：函数体内嵌套声明的作用域与调用点
    //     不同，按同一裸名发布会张冠李戴。
    for (const fn of sf.getDescendantsOfKind(ts.SyntaxKind.FunctionDeclaration)) {
      const parent = fn.getParent();
      // 顶层 / namespace 体内两种；函数体内嵌套的声明作用域与调用点不同，不收
      if (!Node.isSourceFile(parent) && !Node.isModuleBlock(parent)) continue;
      const name = fn.getName();
      if (!name) continue;
      const body = fn.getBody();
      if (!body) continue; // 重载签名 / declare 只有签名
      const ps = fn.getParameters();
      const paramNodes = ps.flatMap(paramNamesOf);
      const restAt = restIndexOf(ps);
      const curry = currySpecsOf(paramNodes, body);
      const owner = moduleQualifier(fn);
      // namespace 内却认不出宿主链 ⇒ 不收（宁可漏，不可张冠李戴）
      if (!Node.isSourceFile(parent) && owner === null) continue;
      // namespace 内：`P.toPath(k)` 是主要写法。裸名同时登记是安全的 ——
      // takenNames 先到先得，一个名字只会落到一处定义上（另一处会降级为资格凭证）。
      if (owner !== null) {
        consider(
          `fn:${owner}.${name}`, `${owner}.${name}`, null,
          paramNodes, restAt, curry, fn.getText(), body
        );
      }
      consider(`fn:${name}`, name, null, paramNodes, restAt, curry, fn.getText(), body);
    }
    // (b) 变量承载的箭头 / 函数表达式 —— 现代 TS 里 helper 的主力写法
    //     `export const toPath = (n: string) => n + ".md";`
    //     sf.getFunctions() 收不到这些，2026-09-20 实测整片漏。
    //     C4i 再解一层 IIFE（functionLikeOf）。
    for (const vd of sf.getVariableDeclarations()) {
      const init = vd.getInitializer();
      if (!init) continue;
      const fnLike = functionLikeOf(init);
      if (!fnLike) continue;
      const body = fnLike.getBody();
      if (!body) continue;
      const ps = fnLike.getParameters();
      const paramNodes = ps.flatMap(paramNamesOf);
      consider(
        `var:${vd.getName()}`,
        vd.getName(),
        null,
        paramNodes,
        restIndexOf(ps),
        currySpecsOf(paramNodes, body),
        init.getText(), // IIFE 时含整条调用 ⇒ sink 检查仍覆盖得到
        body
      );
    }
  }

  // ── 成员形态的 helper（对象字面量方法 / 类方法 / 属性箭头 / 属性赋值箭头）──
  //     `const Util = { toPath(n) {…} }`、`class Paths { toPath(n) {…} }`、
  //     `const Util = { toPath: (n) => n + ".md" }`、`Util.toPath = (n) => …`
  //     都不在 getFunctions() 里。C4e 时刻意不做的理由仍在（R11）：按裸名放行会
  //     让别的对象上的同名条目被误认成塑形。所以这里只登记**限定名** Owner.method；
  //     裸名（`.method(` 这种成员调用位）留给下面的 C4h-②，按「同名每一处都被
  //     确证」这条不变量统一放行。
  let memberSeq = 0;
  /** 登记一个成员形态的函数体；owner 认得出时按限定名发布 */
  const considerMember = (
    bare: string,
    owner: string | null,
    paramNodes: string[],
    restAt: number,
    curry: CurrySpec[],
    declText: string,
    body: Node
  ) => {
    memberSeq += 1;
    consider(
      `mb:${memberSeq}`,
      owner !== null ? `${owner}.${bare}` : null,
      bare,
      paramNodes,
      restAt,
      curry,
      declText,
      body
    );
  };
  for (const sf of project.getSourceFiles()) {
    // (c) 对象字面量方法 / 类方法
    for (const md of sf.getDescendantsOfKind(ts.SyntaxKind.MethodDeclaration)) {
      const bare = propertyNameOf(md, constTexts);
      if (!bare || !/^[A-Za-z_$][\w$]*$/.test(bare)) continue; // 算不出的属性名 ⇒ 不收
      const body = md.getBody();
      if (!body) continue; // 重载签名 / declare
      const ps = md.getParameters();
      const pns = ps.flatMap(paramNamesOf);
      considerMember(
        bare, ownerQualifier(md, constTexts), pns,
        restIndexOf(ps), currySpecsOf(pns, body), md.getText(), body
      );
    }
    // (d) 属性承载的箭头 / 函数表达式 —— 现代工程里 Objects-as-namespace 的常态。
    //     ownerQualifier 从父链走（对象字面量 → 属性赋值 → 变量声明），嵌套也认。
    //     C4j：初值外面可能还包着 as / satisfies（`{ toPath: ((n) => …) as any }`）。
    for (const pa of sf.getDescendantsOfKind(ts.SyntaxKind.PropertyAssignment)) {
      const rawInit = pa.getInitializer();
      if (!rawInit) continue;
      const init = unwrapFns(rawInit);
      if (!init) continue;
      if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue;
      const fn = init as ArrowFunction;
      const body = fn.getBody();
      if (!body) continue;
      const bare = propertyNameOf(pa, constTexts);
      if (!bare || !/^[A-Za-z_$][\w$]*$/.test(bare)) continue;
      const ps = fn.getParameters();
      const pns = ps.flatMap(paramNamesOf);
      considerMember(
        bare, ownerQualifier(pa, constTexts), pns,
        restIndexOf(ps), currySpecsOf(pns, body), rawInit.getText(), body
      );
    }
    // (e) 后挂上去的属性箭头 `Util.toPath = (n) => …`（monkey patch / 渐进导出）
    for (const be of sf.getDescendantsOfKind(ts.SyntaxKind.BinaryExpression)) {
      if (be.getOperatorToken().getKind() !== ts.SyntaxKind.EqualsToken) continue;
      const left = be.getLeft();
      const right = unwrapFns(be.getRight());
      if (!Node.isPropertyAccessExpression(left)) continue;
      if (!right || (!Node.isArrowFunction(right) && !Node.isFunctionExpression(right))) continue;
      const body = (right as ArrowFunction).getBody();
      if (!body) continue;
      const qname = left.getText();
      // 只收 `Name.member` 这种纯静态链（`this.x` / `a[b].x` 一律不认）
      if (!/^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$/.test(qname)) continue;
      const bare = qname.split(".").pop() as string;
      const ps = (right as ArrowFunction).getParameters();
      const pns = ps.flatMap(paramNamesOf);
      considerMember(
        bare, qname.slice(0, -(bare.length + 1)), pns,
        restIndexOf(ps), currySpecsOf(pns, body), right.getText(), body
      );
    }
    // (f) C4j：getter 返回出来的箭头 —— `get mk() { return (n) => n + ".md"; }`。
    //     它既不是 MethodDeclaration（没有形参）也不是 PropertyAssignment（值是 getter），
    //     上一轮三种载体都收不到它，整族漏（探针 B1/B2）。真正塑形的是**返回出来的箭头**，
    //     所以判据看的是内层：无形参不收（B4）、体内有 sink 不收（B6）。
    //     注意这里**不**走 currySpecOf —— getter 的读取本身不消耗实参，调用点是
    //     `o.mk(k)` 一次调用，不是 `mk()(k)` 两跳。
    for (const ga of sf.getDescendantsOfKind(ts.SyntaxKind.GetAccessor)) {
      const body = ga.getBody();
      if (!body) continue;
      const inner = returnedFunctionOf(body);
      if (!inner) continue; // getter 直接返回拼接（无形参）⇒ 判据①本就不成立
      const innerBody = inner.getBody();
      if (!innerBody) continue;
      const bare = propertyNameOf(ga, constTexts);
      if (!bare || !/^[A-Za-z_$][\w$]*$/.test(bare)) continue;
      const ps = inner.getParameters();
      const pns = ps.flatMap(paramNamesOf);
      considerMember(
        bare, ownerQualifier(ga, constTexts), pns,
        restIndexOf(ps), currySpecsOf(pns, innerBody), ga.getText(), innerBody
      );
    }
    // (g) C4j：`export default (n) => …` —— 匿名默认导出。它既不是函数声明（没有名字）
    //     也不是变量声明，上一轮整族漏（探针 F9）。名字只能用**导入它的文件**里起的
    //     本地名；多个文件用不同名字导入 ⇒ 每个名字各登记一条（takenNames 仍然先到先得）。
    for (const ea of sf.getDescendantsOfKind(ts.SyntaxKind.ExportAssignment)) {
      if (ea.isExportEquals()) continue;
      const fn = unwrapFns(ea.getExpression());
      if (!fn || (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn))) continue;
      const fnBody = (fn as ArrowFunction).getBody();
      if (!fnBody) continue;
      const localNames = defaultImportLocalNames(project, sf);
      if (localNames.size === 0) continue; // 没人默认导入 ⇒ 名字无从谈起
      const ps = (fn as ArrowFunction).getParameters();
      const pns = ps.flatMap(paramNamesOf);
      const curry = currySpecsOf(pns, fnBody);
      for (const ln of localNames) {
        consider(
          `def:${sf.getFilePath()}:${ln}`, ln, null,
          pns, restIndexOf(ps), curry, ea.getText(), fnBody
        );
      }
    }
  }

  // 形参之外允许出现的自由标识符 = 模块级字面量常量 ∪ 确证的 path 模块别名
  const extraIdents = new Set(constTexts.keys());
  for (const a of pathModuleAliases(project)) extraIdents.add(a);
  const names = new Set<string>();
  const info = new Map<string, ShaperInfo>();
  const acceptedKeys = new Set<string>();
  const keyInfo = new Map<string, ShaperInfo>();
  // 给 maskNonDependentArgsOnce 用的成员名候选（**尚未确证**）。这里宽一点是安全
  // 的：那里的替换只会针对 info 里确证过的名字发生，这个集合只决定「按成员位还是
  // 按裸名位去匹配」。
  const prelimMember = new Set<string>(groups.keys());
  const publish = (name: string, si: ShaperInfo): void => {
    if (names.has(name)) return;
    names.add(name);
    info.set(name, si);
  };

  /** C4j：确证通过的链（工厂可能有几条，脏的那条会被剔掉，见下） */
  const pureCurried = new Map<string, CurrySpec[]>();
  for (let round = 0; round < 2; round++) {
    let added = false;
    for (const c of cands) {
      if (acceptedKeys.has(c.key)) continue;
      let si: ShaperInfo;
      if (c.curry.length > 0) {
        // 柯里化 / 工厂形态：判据落在**最内层**的 return 上，形参集合是本链各层并起来。
        // 每个 spec 各自过判据：工厂返回多个方法时，只把**确证过的那些**收进名录，
        // 脏的那条不发 spec ⇒ 调用点不会摊开它 ⇒ 退化为漏报而不是误报（保守侧）。
        const pure = c.curry.filter((spec) =>
          spec.rets.every((e) =>
            isPureShaperExpr(e, new Set([...c.params, ...spec.allParams]), names, extraIdents)
          )
        );
        if (pure.length === 0) continue;
        acceptedKeys.add(c.key);
        pureCurried.set(c.key, pure);
        // 外层名照发：闭包会捕获外层实参（`const g = withExt(k)` 也是污的）。
        // rets 留空 ⇒ 调用点折叠自动退回「全部依赖」（保守侧）。
        si = { params: c.paramList, deps: new Set(c.paramList), rets: [], restAt: c.restAt };
      } else {
        if (!c.rets.every((e) => isPureShaperExpr(e, c.params, names, extraIdents))) continue;
        acceptedKeys.add(c.key);
        si = {
          params: c.paramList,
          deps: returnDeps(c.rets, c.paramList, info, prelimMember),
          rets: c.rets,
          restAt: c.restAt,
        };
      }
      keyInfo.set(c.key, si);
      if (c.name !== null) publish(c.name, si);
      added = true;
    }
    if (!added) break;
  }

  // C4i/C4j：柯里化与工厂名录。只有**发布了名字**的才登记 —— 名字被别处同名定义占用时
  // （pub 降为 null），`withExt(a)(b)` 里的 withExt 可能指的不是这个 helper，
  // 展开它会张冠李戴 ⇒ 宁可不展（保守侧，退化为漏报而非误报）。
  // 一个名字可以对多条链（工厂返回含多个方法的对象）。
  const curried = new Map<string, CurrySpec[]>();
  for (const c of cands) {
    if (c.name === null || !acceptedKeys.has(c.key)) continue;
    const pure = pureCurried.get(c.key);
    if (!pure || pure.length === 0) continue;
    const list = curried.get(c.name) ?? [];
    for (const spec of pure) if (!list.includes(spec)) list.push(spec);
    curried.set(c.name, list);
  }

  // C4f：依赖分析有次序依赖 —— `wrap(n) { return discard(n); }` 若在 discard 之前
  // 被接受，那一刻 info 里还没有 discard ⇒ deps 偏宽（偏宽 = 继续传播 = 保守侧，
  // 不会误报，但收不紧）。名录定稿后按完整的 info 再算两轮，把次序依赖消掉。
  const candByKey = new Map(cands.map((c) => [c.key, c]));
  for (let round = 0; round < 2; round++) {
    let changed = false;
    for (const [key, si] of keyInfo) {
      const c = candByKey.get(key);
      if (!c) continue;
      const d = returnDeps(c.rets, si.params, info, prelimMember);
      if (d.size !== si.deps.size || [...d].some((x) => !si.deps.has(x))) {
        si.deps = d;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // ── C4h-②（2026-09-20）：同名【成员】多处，只要**每一处**都被确证为纯塑形 ──
  // 旧规则（C4g）是「该方法名全项目唯一才登记裸名」。唯一性只是【不可能认错】这个
  // 不变量的一个充分条件，不是必要条件：同名两处都被确证了，`.toPath(` 这个成员
  // 调用位同样不可能落到别的实现上。把"唯一"换成"全部确证"，两个类各有一个同名
  //  helper 时两边都能接上；依赖集按形参位取并集（保守侧）。
  //
  // 顺带修掉一处真实缺陷：旧代码在 consider() 之后【无条件】把裸名塞进
  // memberNames，于是「方法名唯一但三条判据不成立」的方法，其成员调用位照样被
  // 当成塑形 ⇒ 误标。探针实测（2026-09-20）：
  //   `class Reg { lookup(n) { return registry[n]; } }`（registry 是模块级非字面量
  //   对象 ⇒ 判据③不成立）之后写 `r.lookup(k)`，照样MARKED。
  // 现在改成确证之后才登记，这个口子自然封上。
  const memberNames = new Set<string>();
  for (const [bare, keys] of groups) {
    if (!keys.every((k) => acceptedKeys.has(k))) continue;
    memberNames.add(bare);
    publish(bare, mergeShapers(keys.map((k) => keyInfo.get(k)).filter(Boolean) as ShaperInfo[]));
  }
  return { names, memberNames, info, curried };
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
  {
    id: "document_parse",
    expr: String.raw`\b(?:JSON|JSON5)\s*\.\s*parse\b|\b(?:YAML|yaml)\s*\.\s*(?:parse|load)\b|\b(?:parse|load|read)(?:Yaml|YAML|Json|JSON|Toml|TOML|Xml|XML|Csv|CSV)\s*\(`,
    why: "外部文档的解析产物：值的**内容**由被解析的输入决定，而非由代码写死（fr-016 的 OpenAPI/AsyncAPI 描述文件经 parseYaml 进入后再 split 落盘）",
  },
  // ── 一类性质不同的根（务必读懂再改）──
  // 上面两条是**传输面**：值跨进程边界进来，来源性质无歧义。这一条不是。
  // `Object.keys/values/entries` 是语言运算，声明的是一件更弱的事：
  // 「这些名字/值不是字面量，而是运行时数据结构的产物」。
  // 之所以仍然列为根，理由与取舍：
  //   - 根的职责是【如实描述值的来源】，不是做是否有害的价值判断。
  //     键名能否落到 fs sink、以及有没有被校验，那是前缀修剪与守卫证据的事
  //     （G1/G2）。压掉来源的代价是不可见的漏报，而留下来的误报是可见的。
  //   - 它是 fr-016 唯一本地可观测的入口：文档本体已由**上游**解析好作为形参
  //     传入（`channels: Record<string, any>`），函数体内没有任何解析调用，
  //     看得见的只有这次枚举。
  // 代价：键名来自内部固定字典（如 `for (const l of Object.keys(locales))`）
  // 也会被标记。若工具体现为噪声过大，应优先收窄**这里**，不要在守卫侧放宽。
  {
    id: "runtime_key_enum",
    expr: String.raw`\bObject\s*\.\s*(?:keys|values|entries)\s*\(`,
    why: "运行时枚举产物：键名/键值由数据结构内容决定，不是字面量（fr-016 的 Object.keys(channels) → channelName）",
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

/**
 * C4（2026-09-19）：污点经「路径塑形表达式」包装后仍然传播。
 *
 * 缺口实证（taintpath_A，2026-09-19 measured）：
 *   `const target = path.join(ROOT, req.params.name); fs.readFileSync(target)`
 * 不标记 —— 因为传播只认 `x = <污点>` 直赋，`path.join(...)` 把流掐断了。
 * 真实工程里 `join/resolve/normalize/basename` 是路径构造的**默认写法**，
 * 这条断链等于把最常见的形态整片漏掉。
 *
 * 政策：**白名单传播**，不是「RHS 含污点就传播」。
 *   - 只经【路径塑形】的调用传播（path.* 家族 + 保值的字符串方法）；
 *   - 字符串拼接与模板字面量同样只塑形、不改来源，故一并传播；
 *   - 认不出的调用**不传播** —— 于是 `const safe = sanitizeName(p)` 天然
 *     不污染。这是白名单相对黑名单的决定性优势：未知函数默认站在精度一侧。
 *   代价：项目自有 helper（如 `buildPath(p)`）仍不传播，记为 C4b 缺口。
 *
 * 已知限制：只扫单行赋值（`const x = …;` 一行写完）。跨行书写的调用
 * 链不传播——保持简单，等 C4b 一并处理。
 */
const TS_PATH_SHAPER_RE =
  /(?:path\s*\.\s*(?:posix|win32)\s*\.\s*|path\s*\.\s*)?\b(?:join|resolve|normalize|basename|dirname|extname|relative|format|toNamespacedPath)\s*\(|\.\s*(?:trim|trimStart|trimEnd|replace|replaceAll|toLowerCase|toUpperCase|toString|slice|substring|substr|padStart|padEnd|concat|normalize)\s*\(/;

/** 拼接形态：`+` 或反引号（模板字面量）—— 同样只是塑形 */
const TS_CONCAT_RE = /\+|`/;

/** 函数体内被不可信根污染的局部名（含解构、单跳赋值与 C4 塑形传播，深度 ≤3） */
function collectTaintedNames(text: string, shapers?: ShaperTable): Set<string> {
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
  // 枚举绑定：`for (const k of Object.keys(doc))` / `for (const [k, v] of Object.entries(doc))`
  // fr-016 的污点就是这样进来的 —— 文档本体已由上游解析好作为形参传入，
  // 函数体内没有赋值语句，只有这次枚举。少了这条，iterate-* 系列函数的
  // 局部变量一个都收不到（此前 MISS 的一半原因在此）。
  const bindFromEnum = (pattern: string): boolean => {
    const enumBind = new RegExp(
      `for\\s*\\(\\s*(?:const|let|var)\\s+([\\w$\\[\\],\\s]+?)\\s+(?:of|in)\\s+(?:await\\s+)?(?:${pattern})`,
      "g"
    );
    let hit = false;
    let em: RegExpExecArray | null;
    while ((em = enumBind.exec(text)) !== null) {
      const binding = em[1].replace(/[[\]]/g, " ");
      for (const part of binding.split(",")) {
        const name = part.trim().split(":")[0].trim();
        if (/^[\w$]+$/.test(name) && !tainted.has(name)) { tainted.add(name); hit = true; }
      }
    }
    return hit;
  };
  bindFromEnum(root);

  // ── C4d（2026-09-20）：高阶枚举方法的回调形参 ──
  // `Object.keys(doc).forEach(k => …)` / `ks.map(k => …)` 与 for-of 语义等价
  // （形参 = 被枚举到的元素），但此前只绑 for-of/for-in，这类整片漏。
  // 实测（2026-09-20 探针）：Object.keys/entries 后接 forEach/map 的 4 种
  // 写法全部 MISS，而 for-in 其实一直是通的 —— 缺口在回调，不在 for-in。
  //
  // 方法表的取舍（务必读懂再扩）：只收【枚举全部元素、且形参 = 元素本身】的
  // forEach/map/flatMap/filter 四个。不收：
  //   - find/some/every —— 谓词，形参虽是元素但语义是「判定」，且常配合
  //     白名单做守卫，盲目绑进去反而给守卫侧喂误报；
  //   - reduce           —— 第一个形参是累加器不是元素，语义错位。
  // 认不出就不传播，代价是漏报，不是误报。
  //
  // ── C4d-b（2026-09-20，同日第二次修正）──
  // 初版正则以 `[,)]` 收尾，带来两件事：
  //   ① `forEach(handleOne)` —— 回调是【函数引用】而非内联函数，`handleOne` 被
  //      当成形参绑进污点集合。探针 `Object.keys(doc).forEach(handle); … = handle`
  //      实测误标：这是把回调名当元素，语义错误；
  //   ② 只认 `(k) =>` 带括号的箭头，`k =>` / `function (k) {}` 两种常见写法漏。
  // 改法：分两条 —— 箭头分支形参后必须见 `=>`（括号可有可无），ES5 分支必须见
  // `function` 关键字。两者都要求【回调体是内联的】，函数引用形态自然被排除。
  const CALLBACK_ENUM_METHODS = "forEach|map|flatMap|filter";
  const bindFromCallback = (receiver: string): boolean => {
    const callbackRe = (paramsTail: string): RegExp =>
      new RegExp(
        `${receiver}\\s*\\.\\s*(?:${CALLBACK_ENUM_METHODS})\\s*\\(\\s*(?:async\\s+)?${paramsTail}`,
        "g"
      );
    // 形参字符集要容得下 TS 的**类型标注**（`(s: any) =>` 是 TS 工程里的常态，
    // 漏了 `:` 会让整环不匹配 —— 2026-09-20 实测踩到），因此放行 `:.|<>`
    // （联合类型与泛型形参）；`=>` 与 `{` 仍不在集合内，函数体不会被吃进来。
    const params = String.raw`\(?\s*([\w$\[\],.:\s<>|]+?)\s*\)?`;
    // 箭头回调：`(k) =>` / `k =>` / `async (k) =>` / `([k, v]) =>`
    const arrow = callbackRe(`${params}\\s*=>`);
    // ES5 回调：`function (k) { … }` —— 不是箭头，但形参同样是元素
    const fnCb = callbackRe(String.raw`function\s*\(?\s*([\w$\[\],.:\s<>|]+?)\s*\)`);
    let hit = false;
    for (const re of [arrow, fnCb]) {
      let cm: RegExpExecArray | null;
      while ((cm = re.exec(text)) !== null) {
        const raw = cm[1].trim();
        // `[k, v]` 解构：两个都是元素，都绑；`k, i` 只取第一个（第二个是索引）
        const parts = raw.startsWith("[")
          ? raw.replace(/[[\]]/g, " ").split(",")
          : [raw.split(",")[0]];
        for (const part of parts) {
          const name = part.trim().split(":")[0].trim();
          if (/^[\w$]+$/.test(name) && !tainted.has(name)) { tainted.add(name); hit = true; }
        }
      }
    }
    return hit;
  };
  // 根形态：`Object.keys(doc).forEach(...)` —— root 正则只吃到开括号，
  // 这里补 `[^()]*\)` 吃掉实参列表与闭括号（`Object.keys` 的实参无嵌套）。
  bindFromCallback(`(?:${root})[^()]*\\)`);

  // ── 有界不动点（≤3 轮）：塑形传播 / 聚合迭代 / 单跳赋值 ──
  // C4c：三轮里的第二轮才是关键 —— `const ks = Object.keys(o); for (const k of ks)`
  // 的被迭代对象是**已被污染的变量**，不再是根表达式。此前 enumBind 只按 root
  // 匹配，这种「先收集再迭代」的写法一根都收不到（fr-016 的 gather* 系列如此）。
  for (let depth = 0; depth < 3; depth++) {
    let grew = taintedViaShaper(text, tainted, shapers);
    if (tainted.size > 0) {
      const names = [...tainted].map(escapeRe).join("|");
      if (bindFromEnum(`\\b(?:${names})\\b`)) grew = true;
      // C4d 变量形态：`const ks = Object.keys(doc); ks.forEach(k => …)`
      // C4d-b：接收者允许中间隔着成员 —— `doc.sections.forEach((s) => …)`。
      // doc/ks 已污时，它的成员同样是污点数据的组成部分，枚举出来的元素也是。
      // 末尾仍必须是四个枚举方法之一，`doc.length` 之类不会触发。
      if (bindFromCallback(`(?:^|[^\\w$.])(?:${names})(?:\\s*\\.\\s*[\\w$]+)*`)) grew = true;
      const hop = new RegExp(`(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*\\b(?:${names})\\b`, "g");
      let hm: RegExpExecArray | null;
      while ((hm = hop.exec(text)) !== null) {
        if (!tainted.has(hm[1])) { tainted.add(hm[1]); grew = true; }
      }
    }
    if (!grew) break;
  }
  return tainted;
}

/**
 * C4：把「经路径塑形表达式包装」的赋值名补进污点集合（有界迭代 ≤3 轮）。
 *
 * 按行扫描 `[(const|let|var)] NAME = RHS`：RHS 含污点证据 且
 * （含塑形调用 或 含拼接/模板）⇒ NAME 污染。迭代是为了让
 * `normalized = path.normalize(p)` → `savePath = path.join(normalized, f)`
 * 这类链式构造能接上（fr-012 下载侧守卫块就是这个形状）。
 */
function taintedViaShaper(text: string, tainted: Set<string>, shapers?: ShaperTable): boolean {
  // C4b：项目自有「纯塑形」helper 的调用也算子（如 getFileNamePath(dir, name, ext)）。
  // 见 pureShaperFunctionNames —— 只认三条判据全部成立的函数，认不出就不传播。
  const localShaperRe =
    shapers && shapers.names.size > 0
      ? new RegExp(`(?:^|[^\\w$.])(?:${[...shapers.names].map(escapeRe).join("|")})\\s*\\(`)
      : null;
  // C4g：成员调用位（`.toPath(`）—— 宿主是变量、限定名匹配不到时用
  const memberShaperRe =
    shapers && shapers.memberNames.size > 0
      ? new RegExp(`\\.(?:${[...shapers.memberNames].map(escapeRe).join("|")})\\s*\\(`)
      : null;
  // C4f：helper 调用里【返回值不依赖的实参】不构成污点证据。
  const shaperInfo = shapers?.info;
  const memberNames = shapers?.memberNames;
  let grewAny = false;
  for (let depth = 0; depth < 3; depth++) {
    // 注意：这里**不能**以 `tainted.size === 0` 提前退出 —— 种子是根模式
    // （taintPattern 恒定并入 UNTRUSTED_ROOT_SRC）。本轮这 4 条 known-gap
    // 的共同形态恰恰是「全函数没有任何直赋污点，根只出现在塑形调用里」，
    // 加这道闸门等于整条 C4 不生效（2026-09-19 实测踩到）。
    const taintRe = taintPattern(tainted);
    if (!taintRe) return grewAny;
    let added = false;
    for (const line of text.split("\n")) {
      const m = /^\s*(?:const|let|var)?\s*([\w$]+)\s*=\s*(?:await\s+)?(.+)$/.exec(line);
      if (!m) continue;
      const name = m[1];
      const rhs = m[2];
      if (tainted.has(name)) continue;
      // C4i：柯里化调用先在证据里摊开 —— `withExt(".md")(k)` ⇒ `k + ".md"`，
      // 摊开后的串自己就是拼接，shaped 也顺理成章成立。
      const expanded = shapers ? expandCurried(rhs, shapers.curried) : rhs;
      const shaped =
        TS_PATH_SHAPER_RE.test(expanded) ||
        TS_CONCAT_RE.test(expanded) ||
        (localShaperRe !== null && localShaperRe.test(rhs)) ||
        (memberShaperRe !== null && memberShaperRe.test(rhs));
      // 证据看的是【抹掉不被依赖的实参之后】的 rhs：`discard(k)` 里 k 不流出，
      // 那条支路就不该算证据。`shaped` 仍看原式 —— helper 是不是塑形，与它的
      // 返回值依不依赖实参是两件事。
      const evidence =
        shaperInfo && memberNames
          ? maskNonDependentArgs(expanded, shaperInfo, memberNames)
          : expanded;
      if (taintRe.test(evidence) && shaped) {
        tainted.add(name);
        added = true;
      }
    }
    if (!added) return grewAny;
    grewAny = true;
  }
  return grewAny;
}

function taintPattern(tainted: Set<string>): RegExp | null {
  const parts: string[] = [UNTRUSTED_ROOT_SRC];
  if (tainted.size > 0) {
    parts.push(`\\b(?:${[...tainted].join("|")})\\b`);
  }
  return new RegExp(parts.join("|"));
}

/**
 * 本函数体内：文件 sink 的实参窗口含 request 污点 → true。
 *
 * `sanitizedRe` 非空时（G2）：实参里被净化过的表达式不再算污点 ——
 * 逐实参判定，只要还有一个实参含【未被净化】的污点就照旧标记。
 */
function hasTaintedSinkCall(
  text: string,
  tainted: Set<string>,
  sanitizedRe?: RegExp | null
): boolean {
  const taint = taintPattern(tainted);
  if (!taint) return false;
  const sinkRe = tsSinkCallRegex();
  let m: RegExpExecArray | null;
  while ((m = sinkRe.exec(text)) !== null) {
    const win = m[2] || "";
    if (!taint.test(win)) continue;
    if (sanitizedRe) {
      const args = splitArgWindow(win);
      if (args.length > 0) {
        if (!args.some((a) => taint.test(a) && !sanitizedRe.test(a))) continue;
      } else if (sanitizedRe.test(win)) {
        continue;
      }
    }
    return true;
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

  const bodies: Array<{
    keyName: string;
    fullName: string;
    relPath: string;
    params: string[];
    text: string;
  }> = [];

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
        const body = { keyName: m.getName(), fullName: `${cn}.${m.getName()}`, relPath, params, text: m.getText() };
        bodies.push(body);
        register(body.keyName, body.fullName, body.text, relPath, params);
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
      const body = { keyName: fnName, fullName: fnName, relPath, params, text: fn.getText() };
      bodies.push(body);
      register(body.keyName, body.fullName, body.text, relPath, params);
    }
  }

  // ── sink 形参继承（2026-09-19，fr-016）──
  // 真实工程落盘几乎必过一层自有封装，只做「形参 → 本函数体内 fs sink」的
  // 一跳登记，等于把整层 wrapper 排除在外：
  //   writeToFileByExtension(data, filePath) → writeJson/writeYaml(d, filePath) → fs.writeFileSync(filePath)
  // 于是即使上游 taint 已识别，`writeToFileByExtension(data, taintedPath)`
  // 也查不到任何记录 —— fr-016 的流量断了 sink 侧这一环，与来源侧的根缺口
  // 是**两个独立缺陷**，必须两个都补才能让真实语料动起来。
  //
  // 规矩与既有 register 完全一致、只是再推一层：自己的形参被传进已登记函数的
  // sink 位置 ⇒ 继承该 sink 位置。有界迭代（≤3 轮）保证收敛。
  //
  // 注意这不是 C4b。C4b 是**值侧**（ helper 会不会改变污点性质）；
  // 这里是** sink 侧**（ wrapper 会不会真的写到文件）。两侧对称，缺一不可。
  // 注意用 new RegExp(String) 而非正则字面量：本文件同类表达式（directCallRe 等）
  // 都按这套写法，写成字面量时 `\\w` 会被当成「反斜杠 + w」，一个调用都匹配不到。
  const wrapperCallRe = new RegExp(
    `(?:^|[^\\w$.])([\\w$]+)\\s*\\(([\\s\\S]{0,250}?)\\)`,
    "g"
  );
  for (let round = 0; round < 3; round++) {
    let grew = false;
    for (const b of bodies) {
      wrapperCallRe.lastIndex = 0;
      let cm: RegExpExecArray | null;
      while ((cm = wrapperCallRe.exec(b.text)) !== null) {
        const callee = map.get(cm[1]);
        if (!callee || callee.idxs.size === 0) continue;
        const args = splitArgWindow(cm[2] || "");
        if (args.length === 0) continue;
        b.params.forEach((pname, idx) => {
          if (!pname) return;
          const pre = new RegExp(`\\b${escapeRe(pname)}\\b`);
          // 形参出现在被调用方的【sink 形参位】上，才算继承了 sink
          const inherited = [...callee.idxs].some(
            (i) => i < args.length && pre.test(args[i])
          );
          if (!inherited) return;
          if (!map.has(b.keyName)) {
            map.set(b.keyName, { idxs: new Set(), entries: [] });
          }
          const rec = map.get(b.keyName)!;
          if (rec.idxs.has(idx)) return;
          rec.idxs.add(idx);
          grew = true;
          if (!rec.entries.some((e) => e.name === b.fullName)) {
            rec.entries.push({ name: b.fullName, file: b.relPath });
          }
        });
      }
    }
    if (!grew) break;
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
  guardFns?: Set<string>,
  directGuardFns?: Set<string>,
  shapers?: ShaperTable
): string[] {
  const markers: string[] = [];

  // ── 路径穿越 ──
  // G1（2026-09-19）：有流还不够，必须【没有校验证据】才标记——
  // 与 SSRF 侧「无 SSRF_GUARD_EVIDENCE 才标记」对齐。
  // 未传 guardFns（旧调用点/单测）时按「不做校验识别」的旧语义处理。
  if (hasRequestRootedExpr(text)) {
    const tainted = collectTaintedNames(text, shapers);
    const selfGuarded = guardFns ? hasPathGuardEvidence(text) !== null : false;
    // G2：调用点抑制 —— 被传进「自身含校验证据的函数」的表达式视为已净化。
    // 与 selfGuarded（函数级、按词形）互补：这条按【被调用方的实际证据】定案，
    // 因此认得出 assertTemplateName 这类不含路径语义后缀的自定义校验函数。
    const sanitizedRe = collectSanitizedExprs(text, directGuardFns);
    // C5（2026-09-19）：不可信根可以直接写在 sink 实参里，不需要中间变量。
    // 此前外层要求 collectTaintedNames 非空，于是
    //   `fs.readFileSync("/data/" + req.params.name)` —— 真实工程里最常见的形态
    // 不标记；只有写成 `const n = req.params.name; readFileSync("/data/" + n)` 才标。
    // SSRF 侧从来不是这样（它把 UNTRUSTED_ROOT_SRC 并进 taint 模式去匹配实参窗口），
    // 这是同一条数据流上的又一处口径不一致。
    if (!selfGuarded) {
      if (hasTaintedSinkCall(text, tainted, sanitizedRe)) {
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
              const hit = args.some(
                (arg, i) => rec.idxs.has(i) && taint.test(arg) && !(sanitizedRe && sanitizedRe.test(arg))
              );
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
    const reqTainted = collectTaintedNames(text, shapers);
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
  // direct = tier-0（自身含校验证据）；all = 再向调用方传播一跳后的集合。
  // G2 只用 direct —— 传播得到的名字是「被推断为守卫」，拿它做抑制会把
  // 推断误差直接放大成误报消除。
  const { all: guardFns, direct: directGuardFns } = pathGuardFunctionNames(project);
  // C4b：项目自有「纯塑形」helper —— 让污点能穿过 getFileNamePath(...) 这类
  // 自建封装。与 guardFns 方向相反：那边是压掉流，这边是接通流，
  // 所以它的判据更严（三条全中才认），认不出就留着漏报。
  const shapers = pureShaperFunctionNames(project);
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
      fCalls.push(...computeMarkerCalls(fText, fParams.map((p: any) => p.getName()), sinkParams, onMethodHit, guardFns, directGuardFns, shapers));
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
        initCalls.push(...computeMarkerCalls(initText, initParams.map((p: any) => p.getName()), sinkParams, onMethodHit, guardFns, directGuardFns, shapers));
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
            argCalls.push(...computeMarkerCalls(argText, argParams.map((p: any) => p.getName()), sinkParams, onMethodHit, guardFns, directGuardFns, shapers));
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
        // 2026-09-21：补上真实调用提取（此前只有 computeMarkerCalls，见 extractDirectCalls 注释）。
        // 顺序与函数声明 / 箭头两个分支保持一致：先真实调用，再追加语义标记。
        const mCalls = extractDirectCalls(m, mText);
        mCalls.push(...computeMarkerCalls(mText, mParams.map((p: any) => p.getName()), sinkParams, onMethodHit, guardFns, directGuardFns, shapers));
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
