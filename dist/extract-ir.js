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
const ts_morph_1 = require("ts-morph");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
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
            // 解析格式: pre_states=["A","B"] post_states=["C"] invalidate=["A"]
            try {
                const preMatch = text.match(/pre_states\s*=\s*\[([^\]]*)\]/);
                const postMatch = text.match(/post_states\s*=\s*\[([^\]]*)\]/);
                const invMatch = text.match(/invalidate\s*=\s*\[([^\]]*)\]/);
                if (!preMatch || !postMatch)
                    return undefined;
                const pre_states = preMatch[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean);
                const post_states = postMatch[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean);
                const invalidate = invMatch
                    ? invMatch[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean)
                    : undefined;
                return { pre_states, post_states, invalidate };
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
    return [...new Set(calls)];
}
function extractIR(projectRoot) {
    const absRoot = path.resolve(projectRoot);
    const project = new ts_morph_1.Project({
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
                protocol: parseProtocolFromJSDoc(f),
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
                    calls: extractDirectCalls(init),
                    protocol: parseProtocolFromJSDoc(vd),
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
                            calls: extractDirectCalls(arg),
                            protocol: parseProtocolFromJSDoc(vd),
                        });
                        break; // 只取第一个箭头函数参数
                    }
                }
            }
        }
    }
    return funcs;
}
// 若直接运行
if (require.main === module) {
    const root = process.argv[2];
    if (!root) {
        console.error("用法: ts-node extract-ir.ts <项目根>");
        process.exit(1);
    }
    const fns = extractIR(root);
    fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
    console.log(`✅ IR 提取完成: ${fns.length} 个函数 -> ir.json`);
}
