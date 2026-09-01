/**
 * Go IR Extractor — pure-TS function extraction for the merged multi-language
 * registry (extract-project-ir.ts LANGUAGE_EXTRACTORS)。无子进程、无 Go
 * 工具链依赖（npm 安装态可用——与 C 提取器同哲学，区别于 Python 桥）。
 *
 * Route: the registry "go" entry calls extractIRGo; the result merges into
 * the same FunctionInfo list as TypeScript/Python/C and flows into
 * call-sequence (P4.6), SSG validation and the agent loop with no rewiring.
 *
 * Extraction is a best-effort lexical parse of Go definitions:
 *   - func Name(params) returns { ... }       普通函数
 *   - func (r *Repo) Name(params) returns { } 接收者方法（方法名=Name）
 *   - 多行签名（平衡括号）、返回值类型 best-effort 记录
 *   - 直接调用提取（obj.Method() 取 Method——与 C 成员调用同规则）
 *   - 注释注解：// @progmune(namespace=..., pre=[...], post=[...])
 *     + @purpose/@tags/@requires/@produces/@useWhen/@inputs/@outputs 文档标签
 *   - exported = 首字母大写（Go 语言约定）
 *
 * Known limits（如实）:
 *   - 接口方法/函数值分发静态不可见（interface 与 func 变量同 L3 边界）
 *   - 泛型类型参数（func F[T any](...)）best-effort 剥除，不做完整解析
 *   - 无数据流/指针分析——与 C 的 L3/L4 结论同源
 */

import * as fs from "fs";
import * as path from "path";
import type { FunctionInfo } from "./extract-ir";

// ── Constants ──

const GO_EXTENSIONS = new Set([".go"]);

/** Walk skip set（生产表面守卫，与 C/Python 提取器口径一致）。 */
const SKIP_DIRS = new Set([
  "vendor", "testdata", "test", "tests", "examples", "example", "docs",
  "doc", "third_party", "node_modules", ".git", "scripts", "tools",
]);

/** Go 关键字/内置（调用提取时排除）。 */
const GO_KEYWORDS = new Set([
  "break", "case", "chan", "const", "continue", "default", "defer", "else",
  "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
  "map", "package", "range", "return", "select", "struct", "switch", "type",
  "var", "append", "cap", "close", "complex", "copy", "delete", "imag",
  "len", "make", "new", "panic", "print", "println", "real", "recover",
]);

function isTestFilename(name: string): boolean {
  return name.endsWith("_test.go");
}

// ── 注释/字符串掩码（Go 额外有反引号 raw string） ──

interface MaskState { inBlock: boolean; inString: boolean; inRaw: boolean; inRune: boolean; }

function maskLine(line: string, state: MaskState): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (state.inBlock) {
      if (ch === "*" && next === "/") { state.inBlock = false; i++; }
      out += " ";
    } else if (state.inString) {
      if (ch === "\\") { out += "  "; i++; }
      else if (ch === '"') { state.inString = false; out += " "; }
      else out += " ";
    } else if (state.inRaw) {
      if (ch === "`") { state.inRaw = false; out += " "; }
      else out += " ";
    } else if (state.inRune) {
      if (ch === "\\") { out += "  "; i++; }
      else if (ch === "'") { state.inRune = false; out += " "; }
      else out += " ";
    } else {
      if (ch === "/" && next === "*") { state.inBlock = true; i++; out += "  "; }
      else if (ch === "/" && next === "/") { out += "  "; break; }
      else if (ch === '"') { state.inString = true; out += " "; }
      else if (ch === "`") { state.inRaw = true; out += " "; }
      else if (ch === "'") { state.inRune = true; out += " "; }
      else out += ch;
    }
  }
  return out;
}

// ── 注释块注解 ──

interface GoAnnotation {
  namespace?: string;
  pre_states: string[];
  post_states: string[];
  invalidate?: string[];
}

function parseGoAnnotation(text: string): GoAnnotation | null {
  const m = text.match(/@progmune\s*\(\s*([^)]*)\)/);
  if (!m) return null;
  const body = m[1];
  const ann: GoAnnotation = { pre_states: [], post_states: [] };
  const ns = body.match(/namespace\s*=\s*"([^"]+)"/);
  if (ns) ann.namespace = ns[1];
  const states = (key: string): string[] => {
    const mm = body.match(new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`));
    if (!mm) return [];
    const vals = mm[1].match(/"([^"]+)"/g) || [];
    return vals.map((v) => v.slice(1, -1));
  };
  ann.pre_states = states("pre");
  ann.post_states = states("post");
  const inv = states("invalidate");
  if (inv.length > 0) ann.invalidate = inv;
  return ann;
}

function docTag(text: string, tag: string): string | undefined {
  const m = text.match(new RegExp(`@${tag}\\s+([^\\n*]+)`));
  return m ? m[1].trim() : undefined;
}

// ── 调用提取 ──

function extractCallsFromBody(body: string): string[] {
  const calls = new Set<string>();
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (GO_KEYWORDS.has(name)) continue;
    if (GO_KEYWORDS.has(name)) continue;
    calls.add(name);
  }
  return Array.from(calls);
}

// ── 顶层参数切分 ──

function splitTopLevelParams(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

// ── 单文件提取 ──

function extractGoFile(filePath: string): FunctionInfo[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const functions: FunctionInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    // 函数定义行：func Name( 或 func (receiver) Name(
    const plain = lines[i].match(/^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)/);
    const receiver = lines[i].match(/^\s*func\s*\([^)]*\)\s*([A-Za-z_][A-Za-z0-9_]*)/);
    const name = plain ? plain[1] : receiver ? receiver[1] : null;
    if (!name) continue;

    // 多行签名：从 func 起拼接直到找到 { 或 ;
    let sigText = lines[i];
    let j = i;
    while (!sigText.includes("{") && !sigText.includes(";") && j < lines.length - 1) {
      j++;
      sigText += "\n" + lines[j];
    }
    const braceIdx = sigText.indexOf("{");
    if (braceIdx < 0) continue; // 接口方法声明（无函数体）
    const signature = sigText.slice(0, braceIdx);

    // 注释块注解：函数定义行上方的连续注释（// 与 /* */）
    const commentLines: string[] = [];
    for (let k = i - 1; k >= 0; k--) {
      const t = lines[k].trim();
      if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) {
        commentLines.unshift(t);
      } else if (t === "") {
        if (commentLines.length === 0) continue;
        break;
      } else {
        break;
      }
    }
    const commentText = commentLines.join("\n");

    // 注解解析
    let protocol: FunctionInfo["protocol"];
    const ann = parseGoAnnotation(commentText);
    if (ann) {
      protocol = {
        pre_states: ann.pre_states,
        post_states: ann.post_states,
        ...(ann.invalidate ? { invalidate: ann.invalidate } : {}),
        ...(ann.namespace ? { namespace: ann.namespace } : {}),
      };
    }
    const purpose = docTag(commentText, "purpose");
    const tags = docTag(commentText, "tags")?.split(/[,\s]+/).filter(Boolean);
    const requires = docTag(commentText, "requires")?.split(/[,\s]+/).filter(Boolean);
    const produces = docTag(commentText, "produces")?.split(/[,\s]+/).filter(Boolean);
    const useWhen = docTag(commentText, "useWhen")?.split(/[,\s]+/).filter(Boolean);

    // 参数列表：签名中第一个 ( ... )
    const openParen = signature.indexOf("(");
    const closeParen = signature.indexOf(")", openParen);
    let params: string[] = [];
    if (openParen >= 0 && closeParen > openParen) {
      params = splitTopLevelParams(signature.slice(openParen + 1, closeParen));
    }
    // 返回类型：签名尾部（剥除泛型括号）
    const returnType = signature.slice(closeParen + 1).replace(/\[[^\]]*\]/g, "").trim();

    // 函数体：从签名行（j）的 { 起逐行扫描到匹配 }（掩码后括号平衡，
    // 增量计数——每行只数一次，避免累积体重复计数）
    let body = "";
    let depth = 0;
    let started = false;
    let endLine = j;
    const bodyMask: MaskState = { inBlock: false, inString: false, inRaw: false, inRune: false };
    for (let li = j; li < lines.length; li++) {
      const maskedLine = maskLine(lines[li], bodyMask);
      if (!started) {
        const b = maskedLine.indexOf("{");
        if (b < 0) continue; // 多行签名的后续行还没到 {
        started = true;
        for (const ch of maskedLine.slice(b)) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
      } else {
        for (const ch of maskedLine) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
      }
      body += lines[li] + "\n";
      if (depth === 0) { endLine = li; break; }
    }
    if (!started || depth !== 0) continue;

    // 调用提取（掩码态重置后重扫完整函数体）
    const resetMask: MaskState = { inBlock: false, inString: false, inRaw: false, inRune: false };
    const maskedBody = body.split("\n").map((l) => maskLine(l, resetMask)).join("\n");
    const calls = extractCallsFromBody(maskedBody).filter((c) => c !== name);

    functions.push({
      name,
      file: filePath,
      params: params.map((p) => ({ name: p.split(/[\s\[\]]/)[0] || p, type: p })),
      returnType: returnType || "unknown",
      calls,
      exported: /^[A-Z]/.test(name),
      tags: tags && tags.length > 0 ? tags : undefined,
      ...(purpose ? { purpose } : {}),
      ...(requires && requires.length > 0 ? { requires } : {}),
      ...(produces && produces.length > 0 ? { produces } : {}),
      ...(useWhen && useWhen.length > 0 ? { useWhen } : {}),
      ...(protocol ? { protocol } : {}),
    });

    i = endLine; // 跳过已消费的行
  }

  return functions;
}

// ── 项目级入口（注册表调用） ──

function collectGoFiles(root: string): string[] {
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
      } else if (GO_EXTENSIONS.has(path.extname(e.name)) && !isTestFilename(e.name)) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

export function extractIRGo(projectRoot: string): FunctionInfo[] {
  const files = collectGoFiles(projectRoot);
  const all: FunctionInfo[] = [];
  for (const file of files) {
    for (const fn of extractGoFile(file)) {
      fn.file = path.relative(projectRoot, fn.file);
      all.push(fn);
    }
  }
  return all;
}
