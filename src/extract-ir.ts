import { Project, Node, FunctionDeclaration, VariableStatement, ArrowFunction, Type } from "ts-morph";
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
      });
    }
    // 箭头函数类似处理，略
  }
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
