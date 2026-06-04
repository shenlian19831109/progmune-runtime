import { Project, Node } from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";
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
                if (!preMatch || !postMatch)
                    return undefined;
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
    if (Node.isUnionTypeNode(typeNode)) {
        return typeNode.getTypeNodes().map((t) => getTypeDetail(t)).join(" | ");
    }
    // 处理泛型
    if (Node.isTypeReference(typeNode)) {
        const typeName = typeNode.getTypeName().getText();
        const typeArgs = typeNode.getTypeArguments();
        if (typeArgs.length > 0) {
            const args = typeArgs.map((ta) => getTypeDetail(ta)).join(", ");
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
function extractDirectCalls(func) {
    const body = func.getBody();
    if (!body)
        return [];
    const calls = [];
    body.forEachDescendant((node, traversal) => {
        if (Node.isCallExpression(node)) {
            const expr = node.getExpression();
            if (Node.isIdentifier(expr))
                calls.push(expr.getText());
            else if (Node.isPropertyAccessExpression(expr))
                calls.push(expr.getName());
        }
        if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node))
            traversal.skip();
    });
    return [...new Set(calls)];
}
/**
 * 从 TypeScript 项目提取 IR（函数签名、参数、返回值、协议注解）。
 * @protocol namespace=dev_pipeline pre_states=[] post_states=["IR_EXTRACTED"] invalidate=["IR_STALE"]
 */
/** @requires PROJECT_PATH @produces IR_FUNCTIONS */
/** @requires PROJECT_PATH @produces IR_FUNCTIONS */
export function extractIR(projectRoot) {
    return extractIRWithTypes(projectRoot).functions;
}
/** Extract both functions and type→file mapping. */
/** @requires PROJECT_PATH @produces IR_WITH_TYPES */
/** @requires PROJECT_PATH @produces IR_WITH_TYPES */
export function extractIRWithTypes(projectRoot) {
    const absRoot = path.resolve(projectRoot);
    const project = new Project({
        tsConfigFilePath: path.join(absRoot, "tsconfig.json"),
        skipAddingFilesFromTsConfig: false,
    });
    if (!fs.existsSync(path.join(absRoot, "tsconfig.json"))) {
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
            if (Node.isArrowFunction(init)) {
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
            if (Node.isCallExpression(init)) {
                for (const arg of init.getArguments()) {
                    if (Node.isArrowFunction(arg)) {
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
            // Extract class methods: ts-morph getFunctions() excludes class members
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
                        exported: vd.isExported(), calls: [],
                        ...parseCapabilityFromJSDoc(m),
                        protocol: parseProtocolFromJSDoc(m),
                    });
                }
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
