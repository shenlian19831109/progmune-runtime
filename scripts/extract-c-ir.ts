#!/usr/bin/env npx ts-node
/**
 * Extract C function definitions + call sequences from source tree.
 * Outputs ir.json-compatible format for L3 analysis.
 *
 * Usage: npx ts-node scripts/extract-c-ir.ts [repo-dir] > output.json
 */

import * as fs from "fs";
import * as path from "path";

interface CFunc {
  name: string;
  file: string;
  calls: string[];
  lineStart: number;
}

function extractFunctionsFromFile(filePath: string, repoRoot: string): CFunc[] {
  const source = fs.readFileSync(filePath, "utf-8");
  const funcs: CFunc[] = [];

  // Match C function definitions: [static] [const] return_type func_name(params) {
  // Handles: static void foo(...) {, int *bar(...) {, const char *baz(...) {
  const funcRegex = /^(?:static\s+)?(?:const\s+)?(?:inline\s+)?(?:__attribute__\s*\(\([^)]+\)\)\s*)?(\w[\w\s*<>]*?[\s*]+)(\w+)\s*\(([^)]*)\)\s*(\{)/gm;

  let match;
  while ((match = funcRegex.exec(source)) !== null) {
    const name = match[2];
    const bodyStart = match.index + match[0].length;

    // Skip very short names and obvious macros
    if (name.length < 2) continue;

    // Find matching closing brace
    let depth = 1;
    let pos = bodyStart;
    while (pos < source.length && depth > 0) {
      if (source[pos] === '{') depth++;
      else if (source[pos] === '}') depth--;
      pos++;
    }
    const bodyEnd = pos;
    const body = source.substring(bodyStart, Math.min(bodyEnd, bodyStart + 50000));

    // Extract function calls
    const callSet = new Set<string>();
    const callRegex = /([a-zA-Z_]\w*)\s*\(/g;
    let cm;
    while ((cm = callRegex.exec(body)) !== null) {
      const called = cm[1];
      // Filter C keywords and common non-function tokens
      if (/^(if|for|while|switch|return|sizeof|case|default|goto|break|continue|void|int|char|long|short|float|double|bool|size_t|unsigned|signed|struct|enum|union|typedef|extern|static|const|volatile|NULL|true|false)$/.test(called)) continue;
      if (/^(ELOG|ereport|errmsg|Assert|CHECK|DEBUGF|DEBUG|NDEBUG|UNUSED|LIKELY|UNLIKELY|container_of|offsetof|ARRAY_SIZE)$/.test(called)) continue;
      callSet.add(called);
    }

    const relPath = path.relative(repoRoot, filePath);
    funcs.push({
      name,
      file: relPath,
      calls: [...callSet],
      lineStart: match.index,
    });
  }

  return funcs;
}

function extractFromRepo(repoDir: string): CFunc[] {
  const allFuncs: CFunc[] = [];
  const seen = new Set<string>();

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        const base = path.basename(full);
        // Skip test dirs, build dirs, etc.
        if (/^(tests?|docs?|\.git|build|win32|amiga|os400|packages|scripts|plan9|vms)$/.test(base)) continue;
        walk(full);
      } else if (entry.endsWith('.c') || entry.endsWith('.h')) {
        // Skip header files for cleaner function list (only .c has definitions)
        if (entry.endsWith('.h')) continue;
        try {
          const funcs = extractFunctionsFromFile(full, repoDir);
          for (const f of funcs) {
            const key = `${f.file}:${f.name}`;
            if (!seen.has(key)) {
              seen.add(key);
              allFuncs.push(f);
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(repoDir);
  return allFuncs;
}

// ── Main ──
const targetRepo = process.argv[2] || path.join(__dirname, "..", "benchmarks", "curl");
const repoRoot = path.resolve(targetRepo);

console.error(`Extracting functions from: ${repoRoot}`);
const funcs = extractFromRepo(repoRoot);
console.error(`Extracted ${funcs.length} functions from C source`);

// Output JSON
const output = {
  repo: path.basename(repoRoot),
  extractedAt: new Date().toISOString(),
  totalFunctions: funcs.length,
  functions: funcs.map(f => ({
    name: f.name,
    file: f.file,
    calls: f.calls,
  })),
};

console.log(JSON.stringify(output));
