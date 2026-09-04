/**
 * extract-ir-java.ts — Java 语言 IR 提取（纯 TS 词法，零工具链依赖）
 *
 * 与 C/Go 提取器同模式：逐 .java 文件扫描方法声明 → FunctionInfo 列表。
 * Java 语言支持（3.7.17 里程碑 1）：注册表 LANGUAGE_EXTRACTORS 一项 +
 * evaluateTrust/engine 语言分派；Spring Security 路由覆盖模型见
 * src/frameworks/spring-detector.ts。
 *
 * 注意：提取为词法近似（方法签名正则）——注解驱动的协议金标建立后
 * 再评估是否需 AST（JavaParser 等不引入，保持零依赖）。
 */
import * as fs from "fs";
import * as path from "path";
import type { FunctionInfo, ParamInfo } from "./extract-ir";

const JAVA_EXTENSIONS = new Set([".java"]);

const SKIP_DIRS = new Set([
  "build", "target", "out", "bin", "node_modules", ".git", ".gradle",
  "generated", "test", "tests", "__pycache__",
]);

const JAVA_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "synchronized", "return",
  "new", "case", "do", "try", "else", "instanceof",
]);

const MODIFIERS = "(?:public|protected|private|static|final|synchronized|abstract|default|native|strictfp|transient|volatile|\\s)+";

/** 单文件提取 */
export function extractJavaFile(filePath: string): FunctionInfo[] {
  const out: FunctionInfo[] = [];
  let code: string;
  try {
    code = fs.readFileSync(filePath, "utf-8");
  } catch {
    return out;
  }
  // 方法声明：修饰符 + 返回类型 名字(参数) [throws ...] {
  const re =
    /(?:\b(?:public|protected|private)\s+)?(?:(?:static|final|synchronized|abstract|default)\s+)*(?:[\w$<>\[\],.\s]+?)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:throws\s+[^{]+?)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    if (JAVA_KEYWORDS.has(name)) continue;
    // 前置字符过滤：方法名不应紧跟 '.'（调用）或 '='（赋值）等
    const pre = code.slice(Math.max(0, m.index - 1), m.index);
    if (/[.=@(]/.test(pre)) continue;

    // 可见性（近似）：行内是否有 public/protected（或文件在接口里默认 public）
    const head = code.slice(m.index, m.index + 40);
    const visM = head.match(/\b(public|protected|private)\b/);
    const exported =
      visM ? visM[1] !== "private" : /^interface\s/.test(code.slice(0, m.index).split("\n").pop() || "") ? true : undefined;

    const params: ParamInfo[] = [];
    const rawParams = m[2].trim();
    if (rawParams.length > 0) {
      for (const raw of rawParams.split(",")) {
        const t = raw.trim();
        if (!t) continue;
        // 最后一个词为参数名，其余为类型（含泛型/数组）
        const parts = t.split(/\s+/);
        const pname = parts.pop() || "";
        const ptype = parts.join(" ") || "?";
        if (/^[A-Za-z_$][\w$]*$/.test(pname) && pname !== "final") {
          params.push({ name: pname, type: ptype });
        }
      }
    }
    // 返回类型：方法名前的一段（简化取最近一个类型令牌）
    const returnType = "unknown";

    out.push({
      name,
      params,
      returnType,
      file: filePath,
      exported,
    });
  }
  return out;
}

function collectJavaFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (JAVA_EXTENSIONS.has(path.extname(e.name))) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

/** 注册表入口 */
export function extractIRJava(projectRoot: string): FunctionInfo[] {
  const files = collectJavaFiles(projectRoot);
  const all: FunctionInfo[] = [];
  for (const file of files) {
    for (const fn of extractJavaFile(file)) {
      fn.file = path.relative(projectRoot, fn.file);
      all.push(fn);
    }
  }
  return all;
}
