/**
 * Project IR extraction — merged multi-language entry point.
 *
 * Registry pattern: each supported language contributes a detector +
 * extractor entry. extractProjectIR runs every extractor whose language
 * is detected in the project and merges the results into one FunctionInfo
 * list, so TS + Python coexist in a mixed project.
 *
 * Adding a language later (Go, Java, ...) = register one entry in
 * LANGUAGE_EXTRACTORS. The agent loop (extractIRWithDelta), execute()'s
 * ir.json write and the MCP server all pick it up automatically — no
 * dispatch rewiring anywhere else.
 */

import * as fs from "fs";
import * as path from "path";
import { extractIR } from "./extract-ir";
import type { FunctionInfo } from "./extract-ir";
import { extractIRPython } from "./extract-ir-python";
import { extractIRC } from "./extract-ir-c";
import { extractIRGo } from "./extract-ir-go";
import { extractIRJava } from "./extract-ir-java";

/** 语言提取器注册项：检测 + 提取。新增语言只需追加一条。 */
export interface LanguageExtractor {
  /** 语言名（审计/诊断用） */
  language: string;
  /** 项目是否含该语言源文件（false 时 extract 不会被调用） */
  detect(projectRoot: string): boolean;
  /** 提取该语言函数为 FunctionInfo */
  extract(projectRoot: string): FunctionInfo[];
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".progmune_corpus",
  "__pycache__", "venv", ".venv",
  "benchmarks", // vendored C 基准仓库（与 extract-ir-c.ts collectCFiles 口径一致）
]);

/** 有界递归扫描：项目是否含指定扩展名源文件（首个命中即返回）。 */
function hasSourceFiles(projectRoot: string, exts: Set<string>): boolean {
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
      } else if (exts.has(path.extname(e.name))) {
        return true;
      }
    }
  }
  return false;
}

/** 已注册语言提取器（新增语言在此追加一条）。 */
export const LANGUAGE_EXTRACTORS: LanguageExtractor[] = [
  {
    language: "typescript",
    detect: (p) => hasSourceFiles(p, new Set([".ts", ".tsx"])),
    extract: (p) => extractIR(p),
  },
  {
    language: "python",
    detect: (p) => hasSourceFiles(p, new Set([".py"])),
    extract: (p) => extractIRPython(p),
  },
  {
    language: "c",
    detect: (p) => hasSourceFiles(p, new Set([".c", ".h"])),
    extract: (p) => extractIRC(p),
  },
  {
    language: "go",
    detect: (p) => hasSourceFiles(p, new Set([".go"])),
    extract: (p) => extractIRGo(p),
  },
  {
    language: "java",
    detect: (p) => hasSourceFiles(p, new Set([".java"])),
    extract: (p) => extractIRJava(p),
  },
];

/** 项目检测到的语言列表（审计/标签用）。 */
export function detectLanguages(projectRoot: string): string[] {
  return LANGUAGE_EXTRACTORS.filter((e) => e.detect(projectRoot)).map((e) => e.language);
}

/**
 * Extract the merged project IR across all detected languages.
 *
 * 单语言提取失败不拖垮其余语言（与感知层 best-effort 原则一致）；
 * 仅当所有检测到的语言全部失败时才抛错，保留 execute 的硬失败语义。
 *
 * @param projectRoot - Absolute path to project root
 * @param extractors - Registry override (tests inject fake entries here)
 * @returns Merged FunctionInfo list
 */
export function extractProjectIR(
  projectRoot: string,
  extractors: readonly LanguageExtractor[] = LANGUAGE_EXTRACTORS,
): FunctionInfo[] {
  const merged: FunctionInfo[] = [];
  let anyDetected = false;
  let anySucceeded = false;
  for (const e of extractors) {
    if (!e.detect(projectRoot)) continue;
    anyDetected = true;
    try {
      merged.push(...e.extract(projectRoot));
      anySucceeded = true;
    } catch (err: any) {
      console.error(`[extractProjectIR] ${e.language} 提取失败: ${err?.message || err}`);
    }
  }
  if (anyDetected && !anySucceeded) {
    throw new Error("所有已检测语言的 IR 提取均失败");
  }
  return merged;
}
