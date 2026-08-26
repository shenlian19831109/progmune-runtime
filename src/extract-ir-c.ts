/**
 * C IR Extractor — pure-TS function extraction for the merged multi-language
 * registry (extract-project-ir.ts LANGUAGE_EXTRACTORS). No child_process
 * bridge, no native deps.
 *
 * Route: the registry "c" entry calls extractIRC; the result merges into the
 * same FunctionInfo list as TypeScript/Python and flows into call-sequence
 * (P4.6), SSG validation and the agent loop with no further rewiring.
 *
 * Extraction is a best-effort lexical parse of C89-style definitions:
 * signatures (multi-line, static/inline/__attribute__, pointer/array params),
 * direct calls (member calls yield the token before `(`), goto_<label>
 * synthesis, @progmune/@protocol annotations and doc tags from comment blocks.
 *
 * Known limits (see docs/c-language-status.md):
 * - Function-pointer dispatch is statically invisible (cf->close_one()
 *   yields close_one — the call NAME — but the callee is not resolvable).
 * - Macros and K&R definitions are not parsed; C++ constructs out of scope.
 * - No dataflow / pointer / CFG analysis (L3/L4 conclusions unchanged).
 */

import * as fs from "fs";
import * as path from "path";
import type { FunctionInfo, ParamInfo } from "./extract-ir";

// ── Constants ──

const C_EXTENSIONS = new Set([".c", ".h"]);

/** Walk skip set: engine languageToExtensions parity + "benchmarks" (self-host guard). */
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".progmune_corpus",
  "__pycache__", "venv", ".venv", "benchmarks",
]);

/** Copied from sequence-extractor.ts:107-111 (kept local — decoupled benchmark path must not change). */
const C_KEYWORDS = new Set([
  "if", "for", "while", "switch", "return", "sizeof", "typeof",
  "goto", "break", "continue", "case", "default", "do", "else",
  "struct", "union", "enum", "typedef", "extern", "volatile", "const",
]);

/** Casts like `(void) fclose(f)` would otherwise register the type name as a call. */
const C_TYPE_NAMES = new Set([
  "void", "int", "char", "float", "double", "long", "short",
  "signed", "unsigned", "bool", "_Bool",
  "size_t", "ssize_t", "int8_t", "uint8_t", "int16_t", "uint16_t",
  "int32_t", "uint32_t", "int64_t", "uint64_t", "FILE", "time_t",
]);

// ── Annotation types & parsing ──

/** Comment-block annotation above a C definition (mirrors tools/extract_ir.py decorator + docstring meta). */
export interface CAnnotation {
  protocol?: {
    pre_states: string[];
    post_states: string[];
    invalidate?: string[];
    namespace?: string;
  };
  purpose?: string;
  description?: string;
  tags?: string[];
  requires?: string[];
  produces?: string[];
  useWhen?: string[];
  inputs?: string[];
  outputs?: string[];
}

/**
 * Balanced-paren scan starting at the position of `(`; returns the text
 * inside the matching parens, or null if unbalanced. String/char-literal
 * aware so `)` inside "…"/'…' does not terminate early.
 */
function findBalancedParens(text: string, openIdx: number): string | null {
  let depth = 0;
  let inStr = false;
  let inCh = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (inCh) { if (c === "\\") i++; else if (c === "'") inCh = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "'") inCh = true;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** Single-line doc tag capture (`@tag value` to end of line — Python `.` semantics). */
function docTag(text: string, tag: string): string | undefined {
  const m = new RegExp(`@${tag}\\s+(.+)$`, "m").exec(text);
  return m ? m[1].trim() : undefined;
}

/** Split semantics mirroring tools/extract_ir.py + extract-ir.ts doc tags. */
function splitComma(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function splitWords(s: string): string[] {
  return s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
}
function splitUseWhen(s: string): string[] {
  return s.split(/[;；]/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Parse a comment block for @progmune/@protocol annotations and doc tags.
 * Returns null when the comment carries no annotation fields (plain file
 * headers must not attach to the first function).
 */
function parseCAnnotation(text: string): CAnnotation | null {
  // ── Decorator: @progmune(...) / @protocol(...) — balanced kwargs text ──
  let protocol: CAnnotation["protocol"];
  const dec = /@?(?:progmune|protocol)\s*\(/.exec(text);
  if (dec) {
    const openIdx = dec.index + dec[0].length - 1;
    const inner = findBalancedParens(text, openIdx);
    if (inner !== null) {
      // kwargs regex mirrors tools/extract_ir.py:906-929
      const kwargRe = /(\w+)\s*=\s*(?:(\[[^\]]*\])|"([^"]*)"|'([^']*)'|(\w+))/g;
      const kwargs: Record<string, string[]> = {};
      let m: RegExpExecArray | null;
      while ((m = kwargRe.exec(inner)) !== null) {
        let value: string[];
        if (m[2] !== undefined) {
          const quoted = m[2].match(/["']([^"']*)["']/g);
          if (quoted && quoted.length) value = quoted.map((q) => q.slice(1, -1));
          else value = m[2].replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
        } else if (m[3] !== undefined) value = [m[3]];
        else if (m[4] !== undefined) value = [m[4]];
        else value = [m[5]];
        kwargs[m[1]] = value;
      }
      if (Object.keys(kwargs).length > 0) {
        protocol = {
          pre_states: kwargs["pre"] ?? kwargs["pre_states"] ?? [],
          post_states: kwargs["post"] ?? kwargs["post_states"] ?? [],
        };
        if (kwargs["invalidate"] ?? kwargs["inv"]) protocol.invalidate = kwargs["invalidate"] ?? kwargs["inv"];
        if (kwargs["namespace"]?.[0]) protocol.namespace = kwargs["namespace"][0];
      }
    }
  }

  // ── Doc tags (single-line captures, Python mirror) ──
  const purpose = docTag(text, "purpose");
  const description = docTag(text, "description");
  const tagsRaw = docTag(text, "tags");
  const requiresRaw = docTag(text, "requires");
  const producesRaw = docTag(text, "produces");
  const useWhenRaw = docTag(text, "useWhen");
  const inputsRaw = docTag(text, "inputs");
  const outputsRaw = docTag(text, "outputs");

  const tags = tagsRaw ? splitComma(tagsRaw) : undefined;
  const requires = requiresRaw ? splitWords(requiresRaw) : undefined;
  const produces = producesRaw ? splitWords(producesRaw) : undefined;
  const useWhen = useWhenRaw ? splitUseWhen(useWhenRaw) : undefined;
  const inputs = inputsRaw ? splitComma(inputsRaw) : undefined;
  const outputs = outputsRaw ? splitComma(outputsRaw) : undefined;

  if (
    !protocol && !purpose && !description && !tags && !requires &&
    !produces && !useWhen && !inputs && !outputs
  ) return null;

  return { protocol, purpose, description, tags, requires, produces, useWhen, inputs, outputs };
}

// ── Comment/string masking ──

interface MaskState { inBlock: boolean; inString: boolean; inChar: boolean; }

/**
 * Replace comment and string/char-literal content with spaces (1:1 column
 * preservation) so brace counting and call regexes cannot be corrupted by
 * braces or `name(` sequences inside comments or strings. State persists
 * across lines.
 */
function maskLine(line: string, state: MaskState): string {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (state.inBlock) {
      if (c === "*" && line[i + 1] === "/") { state.inBlock = false; out.push(" ", " "); i += 2; }
      else { out.push(" "); i++; }
      continue;
    }
    if (state.inString) {
      if (c === "\\") { out.push(" ", " "); i += 2; }
      else if (c === '"') { state.inString = false; out.push(" "); i++; }
      else { out.push(" "); i++; }
      continue;
    }
    if (state.inChar) {
      if (c === "\\") { out.push(" ", " "); i += 2; }
      else if (c === "'") { state.inChar = false; out.push(" "); i++; }
      else { out.push(" "); i++; }
      continue;
    }
    if (c === "/" && line[i + 1] === "*") { state.inBlock = true; out.push(" ", " "); i += 2; continue; }
    if (c === "/" && line[i + 1] === "/") {
      while (i < line.length) { out.push(" "); i++; }
      break;
    }
    if (c === '"') { state.inString = true; out.push(" "); i++; continue; }
    if (c === "'") { state.inChar = true; out.push(" "); i++; continue; }
    out.push(c);
    i++;
  }
  return out.join("");
}

// ── Params ──

/** Depth-aware top-level comma split (nested ()/[]/{} + string/char literals). */
function splitTopLevelParams(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inStr = false;
  let inCh = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (inCh) { if (c === "\\") i++; else if (c === "'") inCh = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "'") inCh = true;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/**
 * Parse one param segment → {name, type}.
 * Precedence: bare "void" → null; "..." variadic; function pointer
 * `(*name)`; otherwise the last identifier is the name (handles
 * `const char* user`, `char buf[256]`, `unsigned long long n`).
 */
function parseParamSegment(seg: string): ParamInfo | null {
  if (seg === "void") return null;
  if (seg === "...") return { name: "...", type: "..." };
  const fp = seg.match(/\(\s*\*\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/);
  if (fp) return { name: fp[1], type: seg.replace(/\s+/g, " ").trim() };
  const m = seg.match(/^(.+?)\s+([a-zA-Z_][a-zA-Z0-9_]*)((?:\[[^\]]*\])*\s*)$/);
  if (m) return { name: m[2], type: m[1].replace(/\s+/g, " ").trim() };
  return { name: seg.trim(), type: "" };
}

// ── Signature & body parsing ──

/**
 * Strip GNU `__attribute__((...))` / MSVC `__declspec(...)` groups
 * (balanced-paren aware) so the signature regex only deals with tokens.
 * Returns the stripped text plus a char-position map back into the
 * original string, so the `{` position can be re-located afterwards.
 */
function stripAttributes(s: string): { text: string; origIndex: number[] } {
  const re = /\b(?:__attribute__|__declspec)\s*\(/g;
  let text = "";
  const origIndex: number[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const inner = findBalancedParens(s, openIdx);
    if (inner === null) break;
    const end = openIdx + inner.length + 2;
    for (let k = last; k < m.index; k++) { text += s[k]; origIndex.push(k); }
    last = end;
    re.lastIndex = end;
  }
  for (let k = last; k < s.length; k++) { text += s[k]; origIndex.push(k); }
  return { text, origIndex };
}

/**
 * Function-candidate regex: `name(...) {` anchored at line start or after
 * whitespace. NO return-type token loop — the v2 pattern's nested
 * quantifiers backtracked exponentially on `name = some_long_ident(...)`
 * style lines (44-char buffer → ~11s; token-split space is 2^k). Instead
 * we iterate ALL candidates in the buffer (`g` flag), skip keyword /
 * type-name candidates, and derive the return type from the buffer text
 * BEFORE the chosen candidate. `[^;]*?` keeps the params scan bounded.
 * Groups: 1 = name, 2 = params.
 */
const FUNC_CAND_RE = /(?:^|\s)([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^;]*?)\)\s*\{/g;

/** struct/union/enum definition bodies must be skipped, not parsed as functions. */
const STRUCT_DECL_RE = /^(?:typedef\s+)?(?:struct|union|enum)\b/;

/** Call-name + goto extraction filters. */
const CALL_RE = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
const GOTO_RE = /\bgoto\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

function isFilteredCall(name: string): boolean {
  return C_KEYWORDS.has(name) || C_TYPE_NAMES.has(name) || name.startsWith("__");
}

// ── Conditional compilation ──

/**
 * Strip `#if 0` … `#endif` dead regions (dead lines replaced with "" so
 * line indices stay 1:1 for the annotation/mask/parse passes). Real-world
 * C (openssl etc.) has dead blocks with unbalanced braces that would
 * corrupt body brace counting and produce phantom top-level functions.
 *
 * Only a BARE `#if 0` (single token, optional trailing comment) enters a
 * dead region — `#if 0 || X` is not evaluated and treated as active.
 * Nested `#if` inside a dead region stays dead (`#else`/`#elif` included);
 * unmatched `#endif` is ignored.
 */
function stripDeadConditionalBlocks(rawLines: string[]): string[] {
  const out = rawLines.slice();
  // 每层条件状态：false = 死区；true = 活区（未求值条件按活区处理）
  const stack: boolean[] = [];
  const inDeadRegion = () => stack.includes(false);
  const DEAD_IF_RE = /^#\s*if\s+0\s*(?:\/\/[^\n]*|\/\*.*?\*\/)?$/;
  const IF_RE = /^#\s*if(n?def)?\b/;
  const ELIF_ELSE_RE = /^#\s*(?:elif|else)\b/;
  const ENDIF_RE = /^#\s*endif\b/;

  for (let i = 0; i < out.length; i++) {
    const t = out[i].trim();
    if (DEAD_IF_RE.test(t)) stack.push(false);
    else if (IF_RE.test(t)) stack.push(true);
    else if (ELIF_ELSE_RE.test(t)) { /* 保持当前层状态：死区内仍死，活区内不翻转 */ }
    else if (ENDIF_RE.test(t)) { if (stack.length > 0) stack.pop(); }
    if (inDeadRegion()) out[i] = "";
  }
  return out;
}

// ── Top-level parse ──

/**
 * Parse one C source file into FunctionInfo entries.
 *
 * Two passes over the raw lines (ordering is load-bearing):
 * 1. Annotation pass on RAW lines — collects comment blocks above
 *    definitions (masking would erase them).
 * 2. Parse pass on MASKED lines — signature scan + brace counting + calls.
 *
 * @param content - C source text
 * @param filePath - Absolute path of the source file
 * @param projectRoot - Absolute project root (for relative `file` field)
 */
export function parseCSource(content: string, filePath: string, projectRoot: string): FunctionInfo[] {
  // 条件编译死代码剥离（#if 0 块内花括号不平衡是真实仓库的普遍陷阱）
  const rawLines = stripDeadConditionalBlocks(content.split("\n"));

  // ── Pass 1: annotation pass (raw lines) — Map<line index, CAnnotation> ──
  const annotations = new Map<number, CAnnotation>();
  {
    let pending: string[] | null = null;
    let inBlock = false;
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end === -1) {
          pending?.push(line.trim().replace(/^\*+\s?/, "").trim());
          continue;
        }
        pending?.push(line.slice(0, end).trim().replace(/^\*+\s?/, "").trim());
        inBlock = false;
        line = line.slice(end + 2);
      }
      const rest = line.trim();
      if (rest === "") continue; // blank line keeps the pending comment attached
      if (rest.startsWith("//")) {
        if (!pending) pending = [];
        pending.push(rest.slice(2).trim());
        continue;
      }
      if (rest.startsWith("/*")) {
        if (!pending) pending = [];
        const end = rest.indexOf("*/", 2);
        if (end === -1) {
          pending.push(rest.slice(2).trim());
          inBlock = true;
        } else {
          pending.push(rest.slice(2, end).trim());
        }
        continue;
      }
      // code line: terminate pending comment (plain headers are discarded by parseCAnnotation → null)
      if (pending && pending.length) {
        const ann = parseCAnnotation(pending.join("\n"));
        if (ann) annotations.set(i, ann);
        pending = null;
      }
    }
  }

  // ── Pass 2: masking ──
  const maskedLines: string[] = [];
  {
    const state: MaskState = { inBlock: false, inString: false, inChar: false };
    for (const line of rawLines) maskedLines.push(maskLine(line, state));
  }

  // ── Pass 3: signature scan + body scan ──
  const fns: FunctionInfo[] = [];
  const relFile = path.relative(projectRoot, filePath) || path.basename(filePath);
  let i = 0;
  while (i < rawLines.length) {
    while (i < rawLines.length && maskedLines[i].trim() === "") i++;
    if (i >= rawLines.length) break;

    const bufStart = i;
    const bufLineIdx: number[] = [];
    const bufLineStarts: number[] = [];
    let buf = "";
    while (i < rawLines.length) {
      const line = maskedLines[i].trim();
      const sep = buf ? 1 : 0;
      bufLineStarts.push(buf.length + sep);
      bufLineIdx.push(i);
      buf += (sep ? " " : "") + line;
      if (line.includes("{") || line.includes(";")) break;
      i++;
    }
    if (i >= rawLines.length) break;

    // 预处理行只跳过自身，不回退到缓冲区末尾——否则 `#endif\nvoid f() {...}`
    // 这类相邻行会被整个缓冲区吞掉，函数定义随之丢失
    if (buf.trimStart().startsWith("#")) { i = bufStart + 1; continue; }

    // ── function definition? ──
    const { text: cleanBuf, origIndex } = stripAttributes(buf);
    let sig: RegExpExecArray | null = null;
    {
      // 遍历缓冲区内所有 `name(...) {` 候选，跳过关键字/类型名候选
      // （`int authenticate(...)` 的 int 是类型前缀，authenticate 才是函数名）
      FUNC_CAND_RE.lastIndex = 0;
      let cand: RegExpExecArray | null;
      while ((cand = FUNC_CAND_RE.exec(cleanBuf)) !== null) {
        if (!isFilteredCall(cand[1])) { sig = cand; break; }
      }
    }
    if (sig) {
      const name = sig[1];
      const braceInClean = sig.index + sig[0].length - 1;
      const braceIdx = origIndex[braceInClean] ?? (braceInClean + (buf.length - cleanBuf.length));

      // locate the buffered line containing the brace
      let lineK = bufLineIdx.length - 1;
      while (lineK > 0 && bufLineStarts[lineK] > braceIdx) lineK--;
      const braceInLine = braceIdx - bufLineStarts[lineK];
      const rawIdxK = bufLineIdx[lineK];
      const maskedK = maskedLines[rawIdxK];
      const trimStart = maskedK.indexOf(maskedK.trim());

      // body text on line K starts right after the opening brace
      const bodyStart = trimStart + braceInLine + 1;

      // ── body scan: comment/string-aware brace counting + calls ──
      const calls: string[] = [];
      // 不去重：状态机验证中重复调用有语义（double close / 重复 logout 正是
      // 要抓的违规形态）；与 TS/Python 提取器（ts-morph/ast 均保留重复）一致
      const pushCall = (c: string) => {
        if (isFilteredCall(c) || c === name) return;
        calls.push(c);
      };
      let depth = 1;
      let j = rawIdxK;
      let text = maskedK.slice(bodyStart);
      let finished = false;
      while (j < rawLines.length && !finished) {
        if (!text.trimStart().startsWith("#")) {
          // find how much of this line belongs to the body (until depth hits 0)
          let stop = text.length;
          for (let k = 0; k < text.length; k++) {
            const c = text[k];
            if (c === "{") depth++;
            else if (c === "}") {
              depth--;
              if (depth === 0) { stop = k; finished = true; break; }
            }
          }
          const prefix = text.slice(0, stop);
          let m: RegExpExecArray | null;
          CALL_RE.lastIndex = 0;
          while ((m = CALL_RE.exec(prefix)) !== null) pushCall(m[1]);
          GOTO_RE.lastIndex = 0;
          while ((m = GOTO_RE.exec(prefix)) !== null) pushCall(`goto_${m[1]}`);
        }
        j++;
        if (!finished && j < rawLines.length) text = maskedLines[j];
      }
      i = j;

      // ── assemble FunctionInfo ──
      const ann = annotations.get(bufStart);
      // 返回类型 = 候选名之前的缓冲区文本（static/inline/属性前缀一并含在内）
      const retPrefix = cleanBuf.slice(0, sig.index);
      const isStatic = /^static\b/.test(retPrefix.trim());
      const returnType = retPrefix
        .replace(/^static\s+/, "")
        .replace(/^inline\s+/, "")
        .replace(/^OSSL_DEPRECATEDIN\S*\s*/, "")
        .replace(/\s+/g, " ")
        .trim() || "any";
      const params = splitTopLevelParams(sig[2])
        .map((seg) => parseParamSegment(seg))
        .filter((p): p is ParamInfo => p !== null);

      fns.push({
        name,
        params,
        returnType,
        file: relFile,
        calls,
        exported: !isStatic,
        external: false, // isProjectFn contract (call-sequence.ts)
        description: ann?.description ?? ann?.purpose ?? "",
        purpose: ann?.purpose ?? "",
        tags: ann?.tags?.length ? ann.tags : ["c"],
        inputs: ann?.inputs ?? [],
        outputs: ann?.outputs ?? [],
        requires: ann?.requires ?? [],
        produces: ann?.produces ?? [],
        useWhen: ann?.useWhen ?? [],
        protocol: ann?.protocol,
      });
      continue;
    }

    // ── struct/union/enum definition body — consume to the terminating `;` ──
    if (STRUCT_DECL_RE.test(buf.trim()) && buf.includes("{")) {
      i++;
      while (i < rawLines.length && !buf.trimEnd().endsWith(";")) {
        buf += " " + maskedLines[i].trim();
        i++;
      }
      continue;
    }

    // plain declaration / prototype / anything else — skip one line
    i++;
  }

  return fns;
}

// ── Project-level API ──

/** Bounded recursive walk collecting absolute paths of .c/.h files. */
function collectCFiles(projectRoot: string): string[] {
  const out: string[] = [];
  const stack = [projectRoot];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const dir = stack.pop()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(full);
      } else if (C_EXTENSIONS.has(path.extname(e.name))) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Extract C function IR from a project tree (.c/.h files, vendored dirs
 * skipped). Per-file failures are logged and skipped (best-effort parity
 * with the registry's per-language isolation).
 *
 * @param projectRoot - Absolute path to project root
 * @returns FunctionInfo[] merged across all C files
 */
export function extractIRC(projectRoot: string): FunctionInfo[] {
  const out: FunctionInfo[] = [];
  for (const f of collectCFiles(projectRoot)) {
    try {
      out.push(...parseCSource(fs.readFileSync(f, "utf-8"), f, projectRoot));
    } catch (err: any) {
      console.error(`[extractIRC] ${f} 解析失败: ${err?.message || err}`);
    }
  }
  return out;
}
