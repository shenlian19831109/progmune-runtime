import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Python stdlib and built-in names to exclude from call sequences
const PYTHON_EXCLUDED = new Set([
  'if', 'for', 'while', 'return', 'print', 'assert', 'raise', 'lambda',
  'len', 'str', 'int', 'float', 'bool', 'list', 'dict', 'tuple', 'set',
  'range', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed',
  'min', 'max', 'sum', 'abs', 'round', 'type', 'isinstance', 'issubclass',
  'hasattr', 'getattr', 'setattr', 'delattr',
  'open', 'close', 'read', 'write', 'super',
  'hexdigest', 'encode', 'decode', 'upper', 'lower', 'strip', 'split',
  'append', 'extend', 'pop', 'remove', 'insert', 'index', 'count', 'sort', 'reverse',
  'keys', 'values', 'items', 'get', 'update', 'popitem',
  'format', 'join', 'replace', 'find', 'startswith', 'endswith',
  'def', 'class', 'pass', 'del', 'self', 'cls',
  'None', 'True', 'False', 'Ellipsis', 'NotImplemented',
]);

export interface CallSequence {
  functionName: string;
  filePath: string;
  lineNumber: number;
  calls: string[];
  bodyLength: number;
}

export interface ExtractorOptions {
  include?: RegExp;
  exclude?: RegExp;
  maxBodyLines?: number;
  useCflow?: boolean;
}

export function extractSequences(
  repoPath: string,
  options: ExtractorOptions = {}
): CallSequence[] {
  const { include = /\.(c|h|ts|js|py)$/, exclude = /(test|vendor|node_modules|build|dist|\.git|__pycache__)/, maxBodyLines = 200 } = options;

  if (options.useCflow && isCProject(repoPath)) {
    return extractWithCflow(repoPath);
  }

  const sequences: CallSequence[] = [];
  const files = findFiles(repoPath, include, exclude);

  for (const file of files) {
    const ext = path.extname(file);
    if (['.c', '.h'].includes(ext)) {
      sequences.push(...extractFromCFile(file, maxBodyLines));
    } else if (['.ts', '.js'].includes(ext)) {
      sequences.push(...extractFromTSFile(file, maxBodyLines));
    } else if (['.py'].includes(ext)) {
      sequences.push(...extractFromPythonFile(file, maxBodyLines));
    }
  }

  return sequences;
}

function extractWithCflow(repoPath: string): CallSequence[] {
  const sequences: CallSequence[] = [];
  try {
    const output = execSync(`cflow --format=posix ${repoPath}/*.c 2>/dev/null || true`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    const lines = output.split('\n');
    let currentFunc = '';
    let calls: string[] = [];
    for (const line of lines) {
      if (line.startsWith(' ')) {
        const match = line.match(/\s+(\w+)/);
        if (match) calls.push(match[1]);
      } else if (line.trim()) {
        if (currentFunc && calls.length > 0) {
          sequences.push({
            functionName: currentFunc,
            filePath: 'unknown',
            lineNumber: 0,
            calls: calls,
            bodyLength: 0,
          });
        }
        const match = line.match(/^(\w+)/);
        currentFunc = match ? match[1] : '';
        calls = [];
      }
    }
  } catch {
    console.warn('cflow not available, falling back to regex parser');
  }
  return sequences;
}

function extractFromCFile(filePath: string, maxBodyLines: number): CallSequence[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const sequences: CallSequence[] = [];

  // v2: Multi-line function signature matching.
  // Handles: Type *func(...) {, static Type\nfunc(...) {, MACRO\nType func(...) {
  // Strategy: scan for identifier(...) { pattern, then backtrack for return type.

  const C_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'return', 'sizeof', 'typeof',
    'goto', 'break', 'continue', 'case', 'default', 'do', 'else',
    'struct', 'union', 'enum', 'typedef', 'extern', 'volatile', 'const',
  ]);

  let i = 0;
  while (i < lines.length) {
    // Build a multi-line buffer: join consecutive lines until we see '{' or ';'
    let buf = '';
    let bufStart = i;
    while (i < lines.length) {
      const line = lines[i].trim();
      buf += (buf ? ' ' : '') + line;
      if (line.includes('{') || line.includes(';')) break;
      i++;
    }

    if (i >= lines.length) break;

    // Skip preprocessor directives, comments, and declarations (lines ending with ;)
    if (buf.trim().startsWith('#') || buf.trim().startsWith('//') || buf.trim().startsWith('/*')) {
      i++;
      continue;
    }

    // v2 regex: handles pointer types, struct types, multi-word return types
    // Matches: [static] [inline] [attributes] ReturnType [*] funcName(params) {
    const funcMatch = buf.match(
      /(?:^|\s)(?:static\s+)?(?:inline\s+)?(?:__attribute__\s*\([^)]*\)\s*)?(?:OSSL_DEPRECATEDIN\S*\s*)?(?:[a-zA-Z_][a-zA-Z0-9_]*\s+(?:\*\s*)?)*?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^;]*?)\)\s*\{/
    );

    if (funcMatch && !C_KEYWORDS.has(funcMatch[1]) && !funcMatch[1].startsWith('__')) {
      const funcName = funcMatch[1];
      const startLine = bufStart;
      let braceCount = 0;
      const calls: string[] = [];

      // Find the opening brace position
      const braceIdx = buf.indexOf('{', funcMatch.index! + funcMatch[0].length - 1);
      if (braceIdx >= 0) braceCount = 1;

      // Advance i past the current line if it's been consumed in buf
      i++;

      let bodyLines = 0;
      while (i < lines.length && braceCount > 0) {
        const currentLine = lines[i];
        for (const char of currentLine) {
          if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
        }

        if (braceCount > 0) {
          bodyLines++;
          if (bodyLines <= maxBodyLines) {
            const callMatches = currentLine.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g);
            for (const cm of callMatches) {
              const called = cm[1];
              if (!C_KEYWORDS.has(called) && !called.startsWith('__')) {
                calls.push(called);
              }
            }
            // Capture goto targets as synthetic calls (goto cleanup → "goto_cleanup")
            const gotoMatches = currentLine.matchAll(/\bgoto\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g);
            for (const gm of gotoMatches) {
              calls.push(`goto_${gm[1]}`);
            }
          }
        }
        i++;
      }

      if (bodyLines <= maxBodyLines && calls.length > 0) {
        sequences.push({
          functionName: funcName,
          filePath,
          lineNumber: startLine + 1,
          calls,
          bodyLength: bodyLines,
        });
      }
    } else {
      i++;
    }
  }

  return sequences;
}

function extractFromTSFile(filePath: string, maxBodyLines: number): CallSequence[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const sequences: CallSequence[] = [];

  const funcRegex = /(?:function\s+|(?:const|let|var)\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:=)?\s*(?:\([^)]*\)\s*=>|\([^)]*\)\s*\{)/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(funcRegex);
    if (match) {
      const funcName = match[1];
      const startLine = i;
      let braceCount = line.includes('{') ? 1 : 0;
      let bodyLines = 0;
      const calls: string[] = [];

      i++;
      while (i < lines.length && braceCount > 0) {
        const currentLine = lines[i];
        for (const char of currentLine) {
          if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
        }

        if (braceCount > 0) {
          bodyLines++;
          const callMatches = currentLine.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g);
          for (const cm of callMatches) {
            const called = cm[1];
            if (!['if', 'for', 'while', 'switch', 'return', 'console', 'require', 'import'].includes(called)) {
              calls.push(called);
            }
          }
        }
        i++;
      }

      if (bodyLines <= maxBodyLines && calls.length > 0) {
        sequences.push({
          functionName: funcName,
          filePath,
          lineNumber: startLine + 1,
          calls,
          bodyLength: bodyLines,
        });
      }
    } else {
      i++;
    }
  }

  return sequences;
}

function extractFromPythonFile(filePath: string, maxBodyLines: number): CallSequence[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const sequences: CallSequence[] = [];

  const funcRegex = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(funcRegex);
    if (match) {
      const funcName = match[1];
      const startLine = i;
      let bodyLines = 0;
      let indentLevel = 0;
      const calls: string[] = [];

      i++;
      // Extract decorators above the function definition
      for (let j = startLine - 1; j >= 0; j--) {
        const decLine = lines[j].trim();
        if (decLine.startsWith('@')) {
          const decMatch = decLine.match(/^@(\w+(?:\.\w+)*)/);
          if (decMatch) calls.push(`@${decMatch[1]}`);
        } else if (decLine !== '') {
          break; // stop at first non-decorator, non-blank line
        }
      }
      // 找到函数体的缩进级别
      const indentMatch = lines[i].match(/^(\s*)/);
      if (indentMatch) {
        indentLevel = indentMatch[1].length;
      }

      while (i < lines.length) {
        const currentLine = lines[i];
        const currentIndent = currentLine.match(/^(\s*)/);
        const indent = currentIndent ? currentIndent[1].length : 0;

        if (indent <= indentLevel && currentLine.trim() !== '') {
          break;
        }

        bodyLines++;
        const callMatches = currentLine.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g);
        for (const cm of callMatches) {
          const called = cm[1];
          if (!PYTHON_EXCLUDED.has(called)) {
            calls.push(called);
          }
        }
        i++;
      }

      if (bodyLines <= maxBodyLines && calls.length > 0) {
        sequences.push({
          functionName: funcName,
          filePath,
          lineNumber: startLine + 1,
          calls,
          bodyLength: bodyLines,
        });
      }
    } else {
      i++;
    }
  }

  return sequences;
}

function findFiles(dir: string, include: RegExp, exclude: RegExp): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!exclude.test(item.name)) {
        results.push(...findFiles(fullPath, include, exclude));
      }
    } else if (include.test(item.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

function isCProject(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir);
  return files.some(f => f.endsWith('.c'));
}
