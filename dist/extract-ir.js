"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractIR = extractIR;
exports.extractIRWithTypes = extractIRWithTypes;
const ts_morph_1 = require("ts-morph");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const ts = __importStar(require("typescript"));
/** 从 JSDoc 注释中解析 capability 注解 (@purpose, @tags, @requires, @produces) */
function parseCapabilityFromJSDoc(node) {
    const jsdocs = node.getJsDocs?.();
    if (!jsdocs || jsdocs.length === 0)
        return {};
    const result = {};
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
                    result.tags = val.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
                }
                if (tn === "requires") {
                    const val = t.getCommentText?.() || "";
                    if (!result.requires)
                        result.requires = [];
                    result.requires.push(...val.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
                }
                if (tn === "produces") {
                    const val = t.getCommentText?.() || "";
                    if (!result.produces)
                        result.produces = [];
                    result.produces.push(...val.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
                }
                if (tn === "useWhen") {
                    const val = t.getCommentText?.() || "";
                    if (!result.useWhen)
                        result.useWhen = [];
                    result.useWhen.push(...val.split(/[;；]/).map((s) => s.trim()).filter(Boolean));
                }
            }
        }
    }
    return result;
}
/** Auto-derive tags from function's source file name */
function deriveTagsFromFile(filePath) {
    const name = filePath.replace(/\.ts$/, "").replace(/^src\//, "");
    const tags = name.split(/[\/\-]/).filter(t => t.length > 2 && t !== "src");
    return [...new Set(tags)];
}
/** 从 JSDoc 注释中解析 @protocol 注解 */
function parseProtocolFromJSDoc(node) {
    const jsdocs = node.getJsDocs?.();
    if (!jsdocs || jsdocs.length === 0)
        return undefined;
    for (const doc of jsdocs) {
        const tags = doc.getTags?.();
        if (!tags)
            continue;
        for (const tag of tags) {
            const tagName = tag.getTagName?.();
            if (tagName !== 'protocol')
                continue;
            const text = tag.getCommentText?.() || '';
            // 解析格式: namespace=file pre_states=["A","B"] post_states=["C"] invalidate=["A"]
            try {
                const nsMatch = text.match(/namespace\s*=\s*(\w+)/);
                const preMatch = text.match(/pre_states\s*=\s*\[([^\]]*)\]/);
                const postMatch = text.match(/post_states\s*=\s*\[([^\]]*)\]/);
                const invMatch = text.match(/invalidate\s*=\s*\[([^\]]*)\]/);
                // 非规则注解（如文件头文档正文中的 "@protocol" 字样被 ts-morph 解析为 tag）
                // → 跳过继续找下一个 @protocol tag，而不是直接放弃
                if (!preMatch || !postMatch)
                    continue;
                const namespace = nsMatch ? nsMatch[1] : undefined;
                const pre_states = preMatch[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean);
                const post_states = postMatch[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean);
                const invalidate = invMatch
                    ? invMatch[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean)
                    : undefined;
                return { pre_states, post_states, invalidate, namespace };
            }
            catch {
                return undefined;
            }
        }
    }
    return undefined;
}
// 获取类型节点的结构化描述
function getTypeDetail(typeNode) {
    if (!typeNode)
        return "";
    const text = typeNode.getText();
    // 简单处理联合类型
    if (ts_morph_1.Node.isUnionTypeNode(typeNode)) {
        return typeNode.getTypeNodes().map((t) => getTypeDetail(t)).join(" | ");
    }
    // 处理泛型
    if (ts_morph_1.Node.isTypeReference(typeNode)) {
        const typeName = typeNode.getTypeName().getText();
        const typeArgs = typeNode.getTypeArguments();
        if (typeArgs.length > 0) {
            const args = typeArgs.map((ta) => getTypeDetail(ta)).join(", ");
            return `${typeName}<${args}>`;
        }
        return typeName;
    }
    // 处理数组/元组
    if (ts_morph_1.Node.isArrayTypeNode(typeNode)) {
        return getTypeDetail(typeNode.getElementTypeNode()) + "[]";
    }
    // 其他类型直接返回文本
    return text;
}
function getParamType(param) {
    const typeNode = param.getTypeNode?.();
    return typeNode ? typeNode.getText() : "any";
}
function getParamTypeDetail(param) {
    const typeNode = param.getTypeNode?.();
    return typeNode ? getTypeDetail(typeNode) : "";
}
function getReturnType(func) {
    const typeNode = func.getReturnTypeNode?.();
    return typeNode ? typeNode.getText() : "any";
}
function getReturnTypeDetail(func) {
    const typeNode = func.getReturnTypeNode?.();
    return typeNode ? getTypeDetail(typeNode) : "";
}
/** Derive input types from params (auto-capability graph). */
function deriveInputs(params) {
    return params.map(p => {
        const t = (p.type || "any").replace(/\[\]$/, "").replace(/<[^>]*>/g, "");
        return t.split("|")[0].trim();
    }).filter(t => t !== "any" && t !== "void");
}
/** Derive output types from return type (auto-capability graph). */
function deriveOutputs(returnType) {
    const t = returnType.replace(/\[\]$/, "").replace(/<[^>]*>/g, "").split("|")[0].trim();
    return (t === "void" || t === "any") ? [] : [t];
}
/** Read tsconfig.json resolving the extends chain via TypeScript's config parser. */
function readOriginalTsConfig(tsconfigPath) {
    try {
        const raw = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        if (raw.error)
            return null;
        const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(tsconfigPath));
        if (parsed.errors?.length > 0) {
            // Non-fatal — config may still be usable
        }
        const co = parsed.options;
        // Convert numeric ModuleResolutionKind to string
        let modRes;
        if (co.moduleResolution !== undefined && typeof co.moduleResolution === 'number') {
            modRes = ts.ModuleResolutionKind[co.moduleResolution];
        }
        return {
            paths: (co.paths && Object.keys(co.paths).length > 0) ? co.paths : undefined,
            baseUrl: co.baseUrl,
            moduleResolution: modRes?.toLowerCase(),
        };
    }
    catch {
        return null;
    }
}
/**
 * Manual module resolution for bundler/NodeNext projects.
 * Falls back after ts-morph's built-in resolution fails.
 */
function manualResolveModule(moduleSpecifier, sourceFilePath, projectRoot, originalConfig) {
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
                if (!match)
                    continue;
                wildcard = match[1] || '';
                matched = true;
            }
            else {
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
            if (!matched)
                continue;
            for (const target of targets) {
                const resolvedRel = hasWildcard ? target.replace(/\*/g, wildcard) : (target + wildcard);
                const candidateBase = path.resolve(baseUrlPath, resolvedRel);
                // Try candidate as a file first
                try {
                    const st = fs.statSync(candidateBase);
                    if (st.isFile())
                        return candidateBase;
                }
                catch { }
                // Try adding .ts / .tsx / .d.ts extensions
                for (const ext of ['.ts', '.tsx', '.d.ts']) {
                    try {
                        const withExt = candidateBase + ext;
                        const st = fs.statSync(withExt);
                        if (st.isFile())
                            return withExt;
                    }
                    catch { }
                }
                // Try as directory with index file
                try {
                    const idxTs = path.join(candidateBase, 'index.ts');
                    if (fs.statSync(idxTs).isFile())
                        return idxTs;
                }
                catch { }
                try {
                    const idxTsx = path.join(candidateBase, 'index.tsx');
                    if (fs.statSync(idxTsx).isFile())
                        return idxTsx;
                }
                catch { }
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
                if (fs.statSync(candidate).isFile())
                    return candidate;
            }
            catch { }
        }
        // NodeNext style: "./foo.js" → "./foo.ts"
        if (moduleSpecifier.endsWith('.js') || moduleSpecifier.endsWith('.jsx')) {
            const stripped = moduleSpecifier.replace(/\.jsx?$/, '');
            for (const suffix of ['.ts', '.tsx', '.d.ts']) {
                try {
                    const candidate = path.resolve(sourceDir, stripped + suffix);
                    if (fs.statSync(candidate).isFile())
                        return candidate;
                }
                catch { }
            }
        }
        // Try as directory with index file
        try {
            const idxTs = path.resolve(sourceDir, moduleSpecifier, 'index.ts');
            if (fs.existsSync(idxTs))
                return idxTs;
        }
        catch { }
        try {
            const idxTsx = path.resolve(sourceDir, moduleSpecifier, 'index.tsx');
            if (fs.existsSync(idxTsx))
                return idxTsx;
        }
        catch { }
    }
    return null;
}
function extractDirectCalls(func) {
    const body = func.getBody();
    if (!body)
        return [];
    const calls = [];
    body.forEachDescendant((node, traversal) => {
        if (ts_morph_1.Node.isCallExpression(node)) {
            const expr = node.getExpression();
            if (ts_morph_1.Node.isIdentifier(expr))
                calls.push(expr.getText());
            else if (ts_morph_1.Node.isPropertyAccessExpression(expr))
                calls.push(expr.getName());
        }
        if (ts_morph_1.Node.isFunctionDeclaration(node) || ts_morph_1.Node.isArrowFunction(node))
            traversal.skip();
    });
    // Semantic markers (mirroring the Python extractor):
    // - token issuance: set_cookie calls or token/session-named assignments —
    //   the Token Security rule's requireMarker precondition consumes it.
    // - inline ownership comparison: ownerId/authorId compared with ==/!== —
    //   the Ownership Check rules' satisfier consumes it (the call-name
    //   interface cannot see inline comparisons).
    const text = func.getText();
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
const TS_FILE_SINK_NAMES = [
    "readFile", "readFileSync", "writeFile", "writeFileSync",
    "appendFile", "appendFileSync", "unlink", "unlinkSync", "rm", "rmSync",
    "mkdir", "mkdirSync", "open", "openSync", "createReadStream",
    "createWriteStream", "existsSync", "readdir", "readdirSync",
    "copyFile", "rename", "stat", "lstat", "rmdir", "truncate",
];
function tsSinkCallRegex() {
    return new RegExp(`(?:^|[^\\w.$])(?:await\\s+)?(?:[\\w$]+\\.)?(${TS_FILE_SINK_NAMES.join("|")})\\s*\\(([\\s\\S]{0,250}?)\\)`, "g");
}
/** request 根表达式：req.params / request.body / req.query['x'] … */
function hasRequestRootedExpr(text) {
    return /\b(?:req|request)\.(?:params|query|body|headers|cookies)\b[.[]?/.test(text);
}
/** 函数体内被 request 污染的局部名（含解构与单跳赋值，深度 ≤2） */
function collectTaintedNames(text) {
    const tainted = new Set();
    let m;
    const direct = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?(?:req|request)\.(?:params|query|body|headers|cookies)\b[.[]?/g;
    while ((m = direct.exec(text)) !== null)
        tainted.add(m[1]);
    const destr = /(?:const|let|var)\s*\{\s*([^}=]*?)\s*\}\s*=\s*(?:await\s+)?(?:req|request)\.(?:params|query|body|headers|cookies)\b/g;
    while ((m = destr.exec(text)) !== null) {
        for (const part of m[1].split(",")) {
            const name = part.trim().split(":")[0].trim();
            if (/^[\w$]+$/.test(name))
                tainted.add(name);
        }
    }
    const bareAssign = /(?:^|[^\w$.])([\w$]+)\s*=\s*(?:req|request)\.(?:params|query|body|headers|cookies)\b[.[]?/g;
    while ((m = bareAssign.exec(text)) !== null)
        tainted.add(m[1]);
    // 单跳传播（深度 ≤2）
    for (let depth = 0; depth < 2; depth++) {
        if (tainted.size === 0)
            break;
        const names = [...tainted].join("|");
        const hop = new RegExp(`(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*\\b(?:${names})\\b`, "g");
        let added = false;
        while ((m = hop.exec(text)) !== null) {
            if (!tainted.has(m[1])) {
                tainted.add(m[1]);
                added = true;
            }
        }
        if (!added)
            break;
    }
    return tainted;
}
function taintPattern(tainted) {
    const parts = [
        /\b(?:req|request)\.(?:params|query|body|headers|cookies)\b[.[]?/.source,
    ];
    if (tainted.size > 0) {
        parts.push(`\\b(?:${[...tainted].join("|")})\\b`);
    }
    return new RegExp(parts.join("|"));
}
/** 本函数体内：文件 sink 的实参窗口含 request 污点 → true */
function hasTaintedSinkCall(text, tainted) {
    const taint = taintPattern(tainted);
    if (!taint)
        return false;
    const sinkRe = tsSinkCallRegex();
    let m;
    while ((m = sinkRe.exec(text)) !== null) {
        if (taint.test(m[2] || ""))
            return true;
    }
    return false;
}
/** 深度 0 逗号切分实参窗口（截断窗口内近似；首个参数位置常用于路径） */
function splitArgWindow(win) {
    const args = [];
    let depth = 0;
    let cur = "";
    for (const ch of win) {
        if (ch === "(" || ch === "[" || ch === "{")
            depth++;
        else if (ch === ")" || ch === "]" || ch === "}")
            depth--;
        else if (ch === "," && depth === 0) {
            args.push(cur);
            cur = "";
            continue;
        }
        cur += ch;
    }
    if (cur.trim())
        args.push(cur);
    return args;
}
/** 项目方法名 → 方法体内流入文件 sink 的形参下标集合 */
function methodSinkParamMap(project, absRoot) {
    const map = new Map();
    for (const sf of project.getSourceFiles()) {
        const relPath = path.relative(absRoot, sf.getFilePath());
        for (const cls of sf.getClasses()) {
            const cn = cls.getName();
            if (!cn)
                continue;
            for (const m of cls.getMethods()) {
                const params = m.getParameters().map((p) => p.getName());
                if (params.length === 0)
                    continue;
                const text = m.getText();
                const sinkRe = tsSinkCallRegex();
                let sm;
                while ((sm = sinkRe.exec(text)) !== null) {
                    const win = sm[2] || "";
                    params.forEach((pname, idx) => {
                        if (new RegExp(`\\b${pname}\\b`).test(win)) {
                            if (!map.has(m.getName())) {
                                map.set(m.getName(), { idxs: new Set(), entries: [] });
                            }
                            const rec = map.get(m.getName());
                            rec.idxs.add(idx);
                            const fullName = `${cn}.${m.getName()}`;
                            if (!rec.entries.some((e) => e.name === fullName)) {
                                rec.entries.push({ name: fullName, file: relPath });
                            }
                        }
                    });
                }
            }
        }
    }
    return map;
}
/**
 * 注入路径穿越标记：
 *  1) 本函数体内 sink 实参直接污点；
 *  2) 跨函数一跳——调用项目方法且污点实参落在该方法的 sink 形参位置。
 * 标记只进 funcs 中该函数的 calls（方法条目不单独标——违规归因到入口）。
 */
function augmentPathTraversalMarkers(project, funcs, absRoot) {
    const sinkParams = methodSinkParamMap(project, absRoot);
    const methodCallRe = new RegExp(`\\.([\\w$]+)\\s*\\(([\\s\\S]{0,250}?)\\)`, "g");
    const mark = (name, file) => {
        const entry = funcs.find((x) => x.name === name && x.file === file);
        if (!entry)
            return;
        entry.calls = entry.calls || [];
        if (!entry.calls.includes(PATH_TRAVERSAL_MARKER)) {
            entry.calls.push(PATH_TRAVERSAL_MARKER);
        }
    };
    // 对每个函数式节点（函数声明/方法/箭头回调——fastify 路由回调是内联
    // 箭头函数，不在 funcs 中）独立做污点分析。节点文本预过滤：
    // 不含 request 访问也不含 sink 方法调用则跳过。
    const sinkMethodNames = [...sinkParams.keys()];
    const prefilter = new RegExp(`\\b(?:req|request)\\.(?:params|query|body|headers|cookies)\\b|` +
        (sinkMethodNames.length > 0 ? `\\.(?:${sinkMethodNames.join("|")})\\s*\\(` : "a^"));
    for (const sf of project.getSourceFiles()) {
        if (sf.getFilePath().includes("node_modules"))
            continue;
        const relPath = path.relative(absRoot, sf.getFilePath());
        sf.forEachDescendant((node) => {
            if (!ts_morph_1.Node.isFunctionDeclaration(node) &&
                !ts_morph_1.Node.isArrowFunction(node) &&
                !ts_morph_1.Node.isMethodDeclaration(node)) {
                return;
            }
            const text = node.getText();
            if (!prefilter.test(text))
                return;
            const tainted = collectTaintedNames(text);
            if (tainted.size === 0)
                return;
            const taint = taintPattern(tainted);
            if (!taint)
                return;
            // 1) 节点体内 sink 实参直接污点 → 标记该节点归属的 funcs 条目
            if (hasTaintedSinkCall(text, tainted)) {
                const nodeName = ts_morph_1.Node.isArrowFunction(node) ? undefined : node.getName();
                if (ts_morph_1.Node.isFunctionDeclaration(node) && nodeName) {
                    mark(nodeName, relPath);
                }
                else if (ts_morph_1.Node.isMethodDeclaration(node) && nodeName) {
                    const cls = node.getParent();
                    if (ts_morph_1.Node.isClassDeclaration(cls) && cls.getName()) {
                        mark(`${cls.getName()}.${nodeName}`, relPath);
                    }
                }
                return;
            }
            // 2) 跨函数一跳：污点实参传入项目方法体的文件 sink。
            //    标记调用方（若可归属）+ 被调方法条目——路由回调不可归属时，
            //    方法条目是唯一可归因位置（openhop 形态）。
            methodCallRe.lastIndex = 0;
            let m;
            while ((m = methodCallRe.exec(text)) !== null) {
                const callee = m[1];
                const rec = sinkParams.get(callee);
                if (!rec || rec.idxs.size === 0)
                    continue;
                const win = m[2] || "";
                const args = splitArgWindow(win);
                const hit = args.some((arg, i) => rec.idxs.has(i) && taint.test(arg));
                if (!hit)
                    continue;
                const nodeName = ts_morph_1.Node.isArrowFunction(node) ? undefined : node.getName();
                if (ts_morph_1.Node.isFunctionDeclaration(node) && nodeName) {
                    mark(nodeName, relPath);
                }
                else if (ts_morph_1.Node.isMethodDeclaration(node) && nodeName) {
                    const cls = node.getParent();
                    if (ts_morph_1.Node.isClassDeclaration(cls) && cls.getName()) {
                        mark(`${cls.getName()}.${nodeName}`, relPath);
                    }
                }
                for (const me of rec.entries) {
                    mark(me.name, me.file);
                }
                return;
            }
        });
    }
}
/**
 * 从 TypeScript 项目提取 IR（函数签名、参数、返回值、协议注解）。
 * @protocol namespace=dev_pipeline pre_states=[] post_states=["IR_EXTRACTED"] invalidate=["IR_STALE"]
 */
/** @requires PROJECT_PATH @produces IR_FUNCTIONS */
/** @requires PROJECT_PATH @produces IR_FUNCTIONS */
function extractIR(projectRoot) {
    return extractIRWithTypes(projectRoot).functions;
}
/** Extract both functions and type→file mapping. */
/** @requires PROJECT_PATH @produces IR_WITH_TYPES */
/** @requires PROJECT_PATH @produces IR_WITH_TYPES */
function extractIRWithTypes(projectRoot, _visited = new Set()) {
    const absRoot = path.resolve(projectRoot);
    const tsconfigPath = path.join(absRoot, "tsconfig.json");
    // Prevent infinite recursion for circular project references
    if (_visited.has(absRoot)) {
        return { functions: [], typeMap: {} };
    }
    _visited.add(absRoot);
    // ── P0: Monorepo / project references detection ──
    let references = [];
    if (fs.existsSync(tsconfigPath)) {
        try {
            const tsconfigRaw = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
            if (tsconfigRaw.references && Array.isArray(tsconfigRaw.references)) {
                references = tsconfigRaw.references
                    .map((ref) => ref.path ? path.resolve(absRoot, ref.path) : null)
                    .filter((p) => p !== null && fs.existsSync(path.join(p, "tsconfig.json")));
            }
        }
        catch { /* invalid tsconfig JSON */ }
    }
    if (references.length > 0) {
        console.error(`🔧 检测到 monorepo: ${references.length} 个子项目`);
        const allFunctions = [];
        const allTypeMap = {};
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
function _extractSingleProject(absRoot, tsconfigPath) {
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
    const project = new ts_morph_1.Project({
        tsConfigFilePath: tsconfigPath,
        skipAddingFilesFromTsConfig: false,
        skipFileDependencyResolution: true, // compatible with NodeNext/ESM tsconfigs
        compilerOptions: {
            module: 1, // CommonJS — overrides project tsconfig for extraction
            moduleResolution: 2, // Classic Node resolution
        },
    });
    if (!fs.existsSync(tsconfigPath)) {
        project.addSourceFilesAtPaths(path.join(absRoot, "**/*.ts"));
    }
    const funcs = [];
    for (const sf of project.getSourceFiles()) {
        const relPath = path.relative(absRoot, sf.getFilePath());
        for (const f of sf.getFunctions()) {
            const name = f.getName();
            if (!name)
                continue;
            funcs.push({
                name,
                params: f.getParameters().map(p => ({
                    name: p.getName(),
                    type: getParamType(p),
                    typeDetail: getParamTypeDetail(p),
                })),
                returnType: getReturnType(f),
                returnTypeDetail: getReturnTypeDetail(f),
                file: relPath,
                calls: extractDirectCalls(f),
                exported: f.isExported(),
                inputs: deriveInputs(f.getParameters().map(p => ({ name: p.getName(), type: p.getTypeNode()?.getText() || "any" }))),
                outputs: deriveOutputs(f.getReturnTypeNode()?.getText() || "any"),
                protocol: parseProtocolFromJSDoc(f),
                ...parseCapabilityFromJSDoc(f),
            });
        }
        // 提取箭头函数（const fn = () => {}, export const fn = () => {} 等）
        for (const vd of sf.getVariableDeclarations()) {
            const init = vd.getInitializer();
            if (!init)
                continue;
            // 直接箭头函数: const fn = () => {}
            if (ts_morph_1.Node.isArrowFunction(init)) {
                const name = vd.getName();
                funcs.push({
                    name,
                    params: init.getParameters().map(p => ({
                        name: p.getName(),
                        type: getParamType(p),
                        typeDetail: getParamTypeDetail(p),
                    })),
                    returnType: getReturnType(init),
                    returnTypeDetail: getReturnTypeDetail(init),
                    file: relPath,
                    exported: vd.isExported(),
                    calls: extractDirectCalls(init),
                    protocol: parseProtocolFromJSDoc(vd),
                    ...parseCapabilityFromJSDoc(vd),
                });
                continue;
            }
            // 包装的箭头函数: const fn = debounce(() => {})
            if (ts_morph_1.Node.isCallExpression(init)) {
                for (const arg of init.getArguments()) {
                    if (ts_morph_1.Node.isArrowFunction(arg)) {
                        const name = vd.getName();
                        funcs.push({
                            name,
                            params: arg.getParameters().map(p => ({
                                name: p.getName(),
                                type: getParamType(p),
                                typeDetail: getParamTypeDetail(p),
                            })),
                            returnType: getReturnType(arg),
                            returnTypeDetail: getReturnTypeDetail(arg),
                            file: relPath,
                            exported: vd.isExported(),
                            calls: extractDirectCalls(arg),
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
            if (!cn)
                continue;
            for (const m of cls.getMethods()) {
                const mn = m.getName();
                if (!mn)
                    continue;
                funcs.push({
                    name: `${cn}.${mn}`,
                    params: m.getParameters().map((p) => ({ name: p.getName(), type: getParamType(p), typeDetail: getParamTypeDetail(p) })),
                    returnType: m.getReturnTypeNode?.()?.getText?.() || "any",
                    returnTypeDetail: m.getReturnTypeNode?.()?.getText?.() || "any",
                    file: relPath,
                    exported: cls.isExported(),
                    calls: [],
                    ...parseCapabilityFromJSDoc(m),
                    protocol: parseProtocolFromJSDoc(m),
                });
            }
        }
    }
    // ═══════════════════════════════════════════════════════════════
    // Phase 4.5: Path traversal marker（2026-09-11，fr-007 openhop）
    // 镜像 Python 提取器的 request 污点 → 文件 sink 单跳追踪，并补
    // 跨函数一跳：调用点把污点参数传给项目方法，该方法体内该参数
    // 流入文件 sink → 调用方函数注入 __progmune_path_traversal__。
    // 消费方：protocol-domain-validator PATH_TRAVERSAL 检查（引擎）
    // 与 protocol-detector 同名规则（source-level benchmark 路径）。
    // ═══════════════════════════════════════════════════════════════
    augmentPathTraversalMarkers(project, funcs, absRoot);
    // ═══════════════════════════════════════════════════════════════
    // Phase 5: Dynamic external function resolution
    // Replaces hardcoded knownExternals
    //   includes: npm packages (.d.ts via ts.resolveModuleName), Node.js built-ins (@types/node)
    //   fallback: knownExternals registry for unresolved functions
    //   final fallback: any type with empty params with ts-morph + ts.resolveModuleName
    // ═══════════════════════════════════════════════════════════════
    const declaredNames = new Set(funcs.map(f => f.name));
    // Collect imports for dynamic resolution
    const externalFuncs = new Map();
    // Also track namespace imports: import * as X from 'module' → X.method
    const namespaceImports = new Map(); // X → resolved source file
    for (const sf of project.getSourceFiles()) {
        if (sf.getFilePath().includes('node_modules'))
            continue;
        for (const imp of sf.getImportDeclarations()) {
            const mod = imp.getModuleSpecifierValue();
            // Named imports: import { X } from 'mod'
            for (const ni of imp.getNamedImports()) {
                const name = ni.getName();
                if (declaredNames.has(name))
                    continue;
                if (externalFuncs.has(name))
                    continue;
                try {
                    const resolved = imp.getModuleSpecifierSourceFile();
                    if (resolved) {
                        const sig = extractSignatureFromFile(name, resolved);
                        if (sig) {
                            externalFuncs.set(name, sig);
                            continue;
                        }
                    }
                    const tsResult = ts.resolveModuleName(mod, sf.getFilePath(), {}, ts.sys);
                    const resolvedPath = tsResult.resolvedModule?.resolvedFileName;
                    if (resolvedPath && fs.existsSync(resolvedPath)) {
                        const sig = extractSignatureFromDts(name, resolvedPath, project);
                        if (sig) {
                            externalFuncs.set(name, sig);
                            continue;
                        }
                    }
                    // ── P0 fallback: manual resolution for bundler aliases & NodeNext .js→.ts ──
                    const manualPath = manualResolveModule(mod, sf.getFilePath(), absRoot, originalTsConfig);
                    if (manualPath) {
                        try {
                            const manualFile = project.addSourceFileAtPathIfExists(manualPath);
                            if (manualFile) {
                                const sig = extractSignatureFromFile(name, manualFile);
                                if (sig) {
                                    externalFuncs.set(name, sig);
                                    continue;
                                }
                            }
                        }
                        catch { /* manual file may be a directory or invalid */ }
                    }
                }
                catch { /* IR parse fallback */ }
            }
            // Namespace imports: import * as X from 'mod'
            const nsImport = imp.getNamespaceImport();
            if (nsImport) {
                try {
                    const resolved = imp.getModuleSpecifierSourceFile();
                    if (resolved) {
                        namespaceImports.set(nsImport.getText(), resolved);
                    }
                    else {
                        const tsResult = ts.resolveModuleName(mod, sf.getFilePath(), {}, ts.sys);
                        const resolvedPath = tsResult.resolvedModule?.resolvedFileName;
                        if (resolvedPath && fs.existsSync(resolvedPath)) {
                            const dtsFile = project.addSourceFileAtPathIfExists(resolvedPath);
                            if (dtsFile)
                                namespaceImports.set(nsImport.getText(), dtsFile);
                        }
                        else {
                            // ── P0 fallback: manual resolution for namespace imports ──
                            const manualPath = manualResolveModule(mod, sf.getFilePath(), absRoot, originalTsConfig);
                            if (manualPath) {
                                try {
                                    const manualFile = project.addSourceFileAtPathIfExists(manualPath);
                                    if (manualFile)
                                        namespaceImports.set(nsImport.getText(), manualFile);
                                }
                                catch { /* manual file may be a directory */ }
                            }
                            else {
                                // Node.js built-in: try @types/node
                                const nodeTypesPath = path.join(absRoot, "node_modules/@types/node", mod + ".d.ts");
                                if (fs.existsSync(nodeTypesPath)) {
                                    const nodeDts = project.addSourceFileAtPathIfExists(nodeTypesPath);
                                    if (nodeDts)
                                        namespaceImports.set(nsImport.getText(), nodeDts);
                                }
                            }
                        }
                    }
                }
                catch { /* IR parse fallback */ }
            }
        }
    }
    // Resolve namespace calls: fs.readFileSync → look up 'readFileSync' in 'fs' source file
    function tryResolveFromNamespace(callName, prefix) {
        const sourceFile = namespaceImports.get(prefix);
        if (!sourceFile)
            return false;
        const sig = extractSignatureFromFile(callName, sourceFile);
        if (sig) {
            externalFuncs.set(callName, sig);
            return true;
        }
        return false;
    }
    // Collect undeclared calls (functions used but not declared and not resolved above)
    const allCalls = new Set();
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
    const knownExternals = {
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
        if (declaredNames.has(callName))
            continue;
        if (ignoredBuiltins.has(callName))
            continue;
        if (callName.startsWith("is") && callName[2] === callName[2]?.toUpperCase())
            continue;
        // Try namespace resolution for unresolved calls
        if (!externalFuncs.has(callName) && !knownExternals[callName]) {
            // Check if this function is called as X.method (property access)
            // The callName is already the method name from extractDirectCalls
            // Try each known namespace to find the function
            for (const [nsPrefix] of namespaceImports) {
                if (tryResolveFromNamespace(callName, nsPrefix))
                    break;
            }
        }
        // ── P0 fallback: try manual resolution for named-import-style unknown calls ──
        // Some imports may not have been resolved as named imports in ts-morph
        // (e.g., when the import declaration itself wasn't parsed correctly)
        if (!externalFuncs.has(callName) && !knownExternals[callName]) {
            // Scan all source file imports again with manual resolution
            for (const sf of project.getSourceFiles()) {
                if (sf.getFilePath().includes('node_modules'))
                    continue;
                for (const imp of sf.getImportDeclarations()) {
                    const mod = imp.getModuleSpecifierValue();
                    const manualPath = manualResolveModule(mod, sf.getFilePath(), absRoot, originalTsConfig);
                    if (!manualPath)
                        continue;
                    // Check if this module exports the callName
                    let manualFile;
                    try {
                        manualFile = project.addSourceFileAtPathIfExists(manualPath);
                    }
                    catch {
                        continue;
                    }
                    if (!manualFile)
                        continue;
                    const sig = extractSignatureFromFile(callName, manualFile);
                    if (sig) {
                        externalFuncs.set(callName, sig);
                        dynamicCount++;
                        break;
                    }
                }
                if (externalFuncs.has(callName))
                    break;
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
        }
        else if (fallback) {
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
        }
        else {
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
            if (derived.length > 0)
                f.tags = derived;
        }
    }
    // Build type→module map for emitter
    const _typeMap = {};
    for (const _sf of project.getSourceFiles()) {
        if (_sf.getFilePath().includes("node_modules"))
            continue;
        const _rp = path.relative(absRoot, _sf.getFilePath());
        for (const _iface of _sf.getInterfaces()) {
            const _n = _iface.getName();
            if (_n && _iface.isExported())
                _typeMap[_n] = _rp;
        }
        for (const _ta of _sf.getTypeAliases()) {
            const _n = _ta.getName();
            if (_n && _ta.isExported())
                _typeMap[_n] = _rp;
        }
    }
    // ── Post-process: auto-derive missing capability metadata ──
    // Name-based data-flow inference patterns
    const PRODUCER_PREFIXES = [
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
    const CONSUMER_PREFIXES = [
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
                    f._requiresDerived = true;
                    break;
                }
            }
        }
        if (!f.produces || f.produces.length === 0) {
            for (const [re, label] of PRODUCER_PREFIXES) {
                if (re.test(f.name)) {
                    f.produces = [label];
                    f._producesDerived = true;
                    break;
                }
            }
        }
    }
    // Strategy 5: Cross-function data-flow — only inherit from callees
    // with BOTH explicit requires AND produces (true pipeline functions).
    // Single-hop only. Prevents noise: generateAttemptId→CREATED won't propagate.
    const nameToFunc = new Map();
    for (const f of funcs)
        nameToFunc.set(f.name, f);
    for (const f of funcs) {
        if ((f.requires || []).length > 0 && (f.produces || []).length > 0)
            continue; // already annotated
        if (!f.calls || f.calls.length === 0)
            continue;
        let inherited = 0;
        const MAX_INHERIT = 2; // cap edges per function
        for (const calleeName of f.calls) {
            if (inherited >= MAX_INHERIT)
                break;
            const callee = nameToFunc.get(calleeName);
            if (!callee)
                continue;
            // Require BOTH explicit requires AND produces — true pipeline node
            const hasExplicitR = callee.requires && callee.requires.length > 0 && !callee._requiresDerived;
            const hasExplicitP = callee.produces && callee.produces.length > 0 && !callee._producesDerived;
            if (!hasExplicitR || !hasExplicitP)
                continue;
            if (!f.requires || f.requires.length === 0) {
                f.requires = [...new Set(callee.requires)];
                inherited++;
            }
            if (!f.produces || f.produces.length === 0) {
                f.produces = [...new Set(callee.produces)];
            }
        }
    }
    return { functions: funcs, typeMap: _typeMap };
}
// ═══════════════════════════════════════════════════════════════
// Dynamic external signature extraction helpers
// ═══════════════════════════════════════════════════════════════
/** Extract function signature from a resolved ts-morph source file. */
function extractSignatureFromFile(name, sf) {
    for (const exp of sf.getExportedDeclarations().entries()) {
        if (exp[0] !== name)
            continue;
        for (const decl of exp[1]) {
            if (ts_morph_1.Node.isFunctionDeclaration(decl)) {
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
            if (ts_morph_1.Node.isVariableDeclaration(decl)) {
                const init = decl.getInitializer();
                if (init && ts_morph_1.Node.isArrowFunction(init)) {
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
function extractSignatureFromDts(name, dtsPath, project) {
    try {
        const sf = project.addSourceFileAtPathIfExists(dtsPath);
        if (!sf)
            return null;
        return extractSignatureFromFile(name, sf);
    }
    catch {
        return null;
    }
}
// 若直接运行
if (require.main === module) {
    const root = process.argv[2];
    if (!root) {
        console.error("用法: ts-node extract-ir.ts <项目根>");
        process.exit(1);
    }
    const result = extractIRWithTypes(root);
    const data = { typeMap: result.typeMap, functions: result.functions };
    fs.writeFileSync("ir.json", JSON.stringify(data, null, 2));
    console.log(`✅ IR 提取完成: ${result.functions.length} 个函数, ${Object.keys(result.typeMap).length} 个类型 -> ir.json`);
}
