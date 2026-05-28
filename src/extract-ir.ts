import { Project, Node, FunctionDeclaration, VariableStatement, ArrowFunction, Type, CallExpression } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

interface ParamInfo {
  name: string;
  type: string;          // 保留字符串形式
  typeDetail?: string;   // 结构化类型表示（如 "string | null", "Promise<User>"）
}

interface FunctionInfo {
  name: string;
  params: ParamInfo[];
  returnType: string;
  returnTypeDetail?: string;
  file: string;
  calls: string[];
  /** 外部导入函数（非本项目声明） */
  external?: boolean;
  /** 外部函数的描述 */
  description?: string;
  protocol?: {
    pre_states: string[];
    post_states: string[];
    invalidate?: string[];
    namespace?: string;
  };
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
        if (!preMatch || !postMatch) return undefined;
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

function extractDirectCalls(func: FunctionDeclaration | ArrowFunction): string[] {
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
  return [...new Set(calls)];
}

export function extractIR(projectRoot: string): FunctionInfo[] {
  const absRoot = path.resolve(projectRoot);
  const project = new Project({
    tsConfigFilePath: path.join(absRoot, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });
  if (!fs.existsSync(path.join(absRoot, "tsconfig.json"))) {
    project.addSourceFilesAtPaths(path.join(absRoot, "**/*.ts"));
  }
  const funcs: FunctionInfo[] = [];
  for (const sf of project.getSourceFiles()) {
    const relPath = path.relative(absRoot, sf.getFilePath());
    for (const f of sf.getFunctions()) {
      const name = f.getName();
      if (!name) continue;
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
      if (!init) continue;
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
          calls: extractDirectCalls(init),
	        protocol: parseProtocolFromJSDoc(vd),
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
              calls: extractDirectCalls(arg),
	            protocol: parseProtocolFromJSDoc(vd),
            });
            break; // 只取第一个箭头函数参数
          }
        }
      }
    }
  }
  // 提取外部依赖函数：收集所有 calls 中引用但未声明的函数
  const declaredNames = new Set(funcs.map(f => f.name));
  const allCalls = new Set<string>();
  for (const f of funcs) {
    for (const c of f.calls) {
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

  // 已知外部函数签名注册表
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
  for (const callName of allCalls) {
    if (declaredNames.has(callName)) continue;
    if (ignoredBuiltins.has(callName)) continue;

    // 跳过 TypeScript 类型/语法节点
    if (callName.startsWith("is") && callName[2] === callName[2]?.toUpperCase()) continue;

    const known = knownExternals[callName];
    funcs.push({
      name: callName,
      params: known ? known.params : [],
      returnType: known ? known.returnType : "any",
      returnTypeDetail: known ? known.returnType : "any",
      file: "(external)",
      calls: [],
      external: true,
      description: known?.description,
    });
    externalCount++;
  }

  console.error(`📦 外部函数: ${externalCount} (from ${allCalls.size} total calls)`);
  return funcs;
}

// 若直接运行
if (require.main === module) {
  const root = process.argv[2];
  if (!root) { console.error("用法: ts-node extract-ir.ts <项目根>"); process.exit(1); }
  const fns = extractIR(root);
  fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
  console.log(`✅ IR 提取完成: ${fns.length} 个函数 -> ir.json`);
}
