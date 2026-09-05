/**
 * extract-ir-java.ts — Java 语言 IR 提取（纯 TS 词法，零工具链依赖）
 *
 * 与 C/Go 提取器同模式：逐 .java 文件扫描方法声明 → FunctionInfo 列表，
 * 附带：方法体调用边（calls）与方法前注释协议注解（protocol，
 * // @protocol namespace=… pre_states=[…] post_states=[…]，TS JSDoc
 * 同口径）——供 SSG/序列验证（Java 协议行金标 v1，2026-09-02）。
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

/** 从方法前注释（// @protocol … / // @progmune(…)）解析协议注解，
 *  与 TS JSDoc @protocol 同口径：namespace/pre_states/post_states/invalidate */
function parseJavaProtocol(commentText: string): FunctionInfo["protocol"] | undefined {
  const nsMatch = commentText.match(/namespace\s*=\s*["']?(\w+)/);
  const preMatch = commentText.match(/pre(?:_states)?\s*=\s*\[([^\]]*)\]/);
  const postMatch = commentText.match(/post(?:_states)?\s*=\s*\[([^\]]*)\]/);
  if (!preMatch || !postMatch) return undefined;
  const split = (g: string): string[] =>
    g.split(",").map((x) => x.trim().replace(/["']/g, "")).filter(Boolean);
  const invMatch = commentText.match(/invalidate\s*=\s*\[([^\]]*)\]/);
  return {
    pre_states: split(preMatch[1]),
    post_states: split(postMatch[1]),
    invalidate: invMatch ? split(invMatch[1]) : undefined,
    namespace: nsMatch ? nsMatch[1] : undefined,
  };
}

/** 方法头部向上收集注释（只允许空行/注释/@注解行；遇代码即停，防串方法） */
function collectPrecedingComment(code: string, matchIndex: number): string {
  const headerLine = code.slice(0, matchIndex).split("\n").length; // 1-based
  const srcLines = code.split("\n");
  const pieces: string[] = [];
  let li = headerLine - 2;
  while (li >= 0) {
    const t = srcLines[li].trim();
    if (t === "") { li--; continue; }
    if (/^\/\//.test(t) || /^\/\*/.test(t) || /^\*/.test(t)) { pieces.unshift(srcLines[li]); li--; continue; }
    if (/^@[A-Za-z]/.test(t)) { li--; continue; } // @Override 等注解行
    break;
  }
  return pieces.join("\n");
}

/** 单文件提取 */
export function extractJavaFile(filePath: string): FunctionInfo[] {
  const out: FunctionInfo[] = [];
  let code: string;
  try {
    code = fs.readFileSync(filePath, "utf-8");
  } catch {
    return out;
  }
  // 方法声明：两分支——构造器（可见性 + Name(，无返回类型）与普通方法
  // （修饰符 + 返回类型 Name(，返回类型含 '?' 通配符如 ResponseEntity<?>）。
  // 匹配止于 '('；参数区用字符串感知平衡括号扫描（@PathVariable("slug")
  // 等注解实参的内层括号不再截断参数列表）；throws 子句与 '{' 手扫确认。
  const re =
    /(?:\b(public|protected|private)\s+([A-Za-z_$][\w$]*)\s*\(|(?:\b(?:public|protected|private)\s+)?(?:(?:static|final|synchronized|abstract|default)\s+)*(?:[\w$<>\[\],.?\s]+?)\s+([A-Za-z_$][\w$]*)\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const isCtor = m[1] !== undefined;
    const name = isCtor ? m[2] : m[3];
    if (JAVA_KEYWORDS.has(name)) continue;
    const parenPos = m.index + m[0].length - 1; // 匹配止于 '('
    // 重叠守卫：匹配起点若早于参数 '(' 所在行（如从上一行注释/注解开吃
    // 吞掉真头）→ 从 '(' 行首重扫，避免方法被错配候选吞掉
    const parenLineStart = code.lastIndexOf("\n", parenPos - 1) + 1;
    if (m.index < parenLineStart) {
      re.lastIndex = parenLineStart;
      continue;
    }
    // 起点规则：'.' 前导 = 方法调用（如 adminService.act( 的 act）。
    // 注：'@'/'='/'"' 不在 type-part 字符类内，注解文本本身不可能成为
    // 匹配起点，无需旧版 @ 行守卫（@Autowired public UserService( 的
    // 匹配起于 public，行首是 @——旧守卫会误杀同行注解构造器）
    const pre = code.slice(Math.max(0, m.index - 1), m.index);
    if (pre === ".") continue;

    // 参数区：字符串感知平衡括号扫描
    let pDepth = 1;
    let k = parenPos + 1;
    let quote: string | null = null;
    while (k < code.length && pDepth > 0) {
      const ch = code[k];
      if (quote) {
        if (ch === quote && code[k - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "(") {
        pDepth++;
      } else if (ch === ")") {
        pDepth--;
      }
      k++;
    }
    if (pDepth !== 0) continue; // 括号不闭合
    const rawParams = code.slice(parenPos + 1, k - 1);

    // throws 子句 + '{' 手扫确认（候选非方法声明时在此丢弃）
    let t = k;
    while (t < code.length && /\s/.test(code[t])) t++;
    let bodyStart: number;
    if (code.slice(t, t + 6) === "throws" && !/[\w$]/.test(code[t + 6] || "")) {
      const brace = code.indexOf("{", t);
      if (brace === -1) continue;
      if (/;/.test(code.slice(t, brace))) continue; // throws 到 { 之间有 ; = 调用行
      bodyStart = brace + 1;
    } else {
      if (code[t] !== "{") continue;
      bodyStart = t + 1;
    }

    const head = code.slice(m.index, m.index + 40);
    const visM = head.match(/\b(public|protected|private)\b/);
    const exported =
      visM ? visM[1] !== "private" : /^interface\s/.test(code.slice(0, m.index).split("\n").pop() || "") ? true : undefined;

    const params: ParamInfo[] = [];
    if (rawParams.trim().length > 0) {
      for (const raw of rawParams.split(",")) {
        const t2 = raw.trim();
        if (!t2) continue;
        const parts = t2.split(/\s+/);
        const pname = parts.pop() || "";
        const ptype = parts.join(" ") || "?";
        if (/^[A-Za-z_$][\w$]*$/.test(pname) && pname !== "final") {
          params.push({ name: pname, type: ptype });
        }
      }
    }
    const returnType = "unknown";

    // protocol：方法前注释里的 @protocol/@progmune
    // 行号基准 = 参数 '(' 所在行（正则匹配起点可能早于方法行——用
    // '(' 位置定真实 header 行，避免注释归属串位）
    let protocol: FunctionInfo["protocol"];
    {
      const joined = collectPrecedingComment(code, parenPos);
      const lastAt = Math.max(joined.lastIndexOf("@protocol"), joined.lastIndexOf("@progmune"));
      if (lastAt !== -1) {
        protocol = parseJavaProtocol(joined.slice(lastAt, Math.min(joined.length, lastAt + 300)));
      }
    }

    // calls：方法体（'{' 起平衡到 '}'）内的方法调用
    const calls: string[] = [];
    let depth = 1;
    let bodyEnd = bodyStart;
    while (bodyEnd < code.length && depth > 0) {
      const ch = code[bodyEnd];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      bodyEnd++;
    }
    const body = code.slice(bodyStart, Math.min(bodyEnd, bodyStart + 8000));
    // 零宽后视：前导 '(' 等不被上一匹配吞掉（if (verifyToken(…) 中能收到 verifyToken）；
    // <…> 可选类型实参：new HashMap<String, Object>() 的 HashMap 可见
    const callRe = /(?<=^|[^\w$])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:<[^<>;]*(?:<[^<>;]*>[^<>;]*)*>)?\s*\(/g;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(body)) !== null) {
      const seg = cm[1].split(".").pop() || "";
      if (JAVA_KEYWORDS.has(seg)) continue;
      if (/^(if|for|while|switch|catch|new|return|case|do|super|this)$/.test(seg)) continue;
      if (calls.length < 400 && !calls.includes(seg)) calls.push(seg);
    }

    out.push({
      name,
      params,
      returnType,
      file: filePath,
      exported,
      calls,
      protocol,
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
