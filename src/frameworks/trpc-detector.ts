/**
 * tRPC Framework Adapter — Endpoint Input Validation Detection
 *
 * Detects tRPC router/procedure patterns in TypeScript projects and
 * flags procedures that lack input schema validation:
 *
 *   - TRPC_MUTATION_WITHOUT_INPUT_SCHEMA (high)
 *     Mutation procedure without .input(z.object(...)) that references
 *     `input.` in its body or performs DB writes — unvalidated data
 *     reaches business logic.
 *
 *   - TRPC_PUBLIC_MUTATION (high)
 *     publicProcedure mutation without input schema — unauthenticated
 *     AND unvalidated mutation endpoint.
 *
 *   - TRPC_PROCEDURE_USES_INPUT_WITHOUT_SCHEMA (medium)
 *     Any procedure (query or mutation) whose body reads `input.x`
 *     but has no .input() schema declared.
 *
 * Purely regex-based, no AST — follows the express-detector.ts pattern.
 */

// ── Types ──

export interface TRPCProcedure {
  name: string;
  kind: "query" | "mutation";
  procedureType: "public" | "protected" | "admin";
  hasInputSchema: boolean;
  usesInputInBody: boolean;
  doesDbWrite: boolean;
  line: number;
}

export interface TRPCSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  procedure: string;
  message: string;
  line: number;
  fix: string;
}

export interface TRPCFileAnalysis {
  hasTRPC: boolean;
  routerNames: string[];
  procedures: TRPCProcedure[];
  issues: TRPCSecurityIssue[];
}

// ── Detection Patterns ──

// 注意：detect 用途不带 /g——带 /g 的 test() 会跨文件泄漏 lastIndex，
// 导致逐文件扫描结果随顺序漂移（实测 4/19 vs 7/19）
const PROCEDURE_TYPE_PATTERN = /\b(publicProcedure|protectedProcedure|adminProcedure)\b/;

const DB_WRITE_PATTERN =
  /\b(db\.(insert|update|delete|create|upsert|execute)|prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)|drizzle\.(insert|update|delete)|\.(insert|update|delete|create|upsert)\s*\()/i;

/**
 * Detect whether this file contains tRPC definitions.
 */
export function detectTRPCApp(code: string): boolean {
  return (
    /\b(initTRPC|t\.router)\b/.test(code) ||
    /\brouter\s*\(\s*\{/.test(code) ||
    PROCEDURE_TYPE_PATTERN.test(code)
  );
}

/**
 * Extract tRPC router variable names (export const xxxRouter = router({...})).
 */
export function extractRouterNames(code: string): string[] {
  const names: string[] = [];
  const re = /(?:export\s+)?(?:const|let)\s+(\w*[Rr]outer\w*)\s*=\s*(?:t\.)?router\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Extract procedure definitions from a tRPC router body.
 *
 * Matches patterns like:
 *   add: protectedProcedure.input(z.object({...})).mutation(async ({ctx, input}) => {...}),
 *   list: publicProcedure.query(async ({ctx}) => {...}),
 */
export function extractProcedures(code: string): TRPCProcedure[] {
  const procedures: TRPCProcedure[] = [];
  // 过程起点：name: <procedureType>（不含链）
  const procStartRe =
    /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(publicProcedure|protectedProcedure|adminProcedure)\b/g;

  let m: RegExpExecArray | null;
  while ((m = procStartRe.exec(code)) !== null) {
    const name = m[1];
    const procType = m[2].replace(/Procedure$/, "") as "public" | "protected" | "admin";

    // ── 链扫描（括号感知）──
    // 自 procedure 类型后逐个解析 .method(balancedArgs)，容忍嵌套括号与
    // 多行（.input(z.object({...})) 等标准形态），直至 .query(/.mutation(
    // 或链中断。旧实现用 (?:\.\w+\([^()]*\))* 不跨嵌套括号 → 标准
    // zod input 链整体失明（V4 缺陷）。
    let pos = procStartRe.lastIndex;
    let hasInputSchema = false;
    let kind: "query" | "mutation" | null = null;
    let kindOpenIdx = -1; // .query( 或 .mutation( 的 '(' 下标

    const skipWs = (): void => {
      while (pos < code.length && /\s/.test(code[pos])) pos++;
    };
    const consumeBalanced = (open: string, close: string): void => {
      let depth = 1;
      let quote: string | null = null;
      pos++; // 跳过 open
      while (pos < code.length && depth > 0) {
        const ch = code[pos];
        if (quote) {
          if (ch === quote && code[pos - 1] !== "\\") quote = null;
        } else if (ch === '"' || ch === "'" || ch === "`") {
          quote = ch;
        } else if (ch === open) {
          depth++;
        } else if (ch === close) {
          depth--;
        }
        pos++;
      }
    };

    for (let step = 0; step < 100; step++) {
      skipWs();
      if (code[pos] !== ".") break;
      pos++;
      const methStart = pos;
      while (pos < code.length && /[A-Za-z0-9_$]/.test(code[pos])) pos++;
      const method = code.slice(methStart, pos);
      skipWs();
      if (code[pos] !== "(") break;
      if (method === "query" || method === "mutation") {
        kind = method as "query" | "mutation";
        kindOpenIdx = pos; // '(' 位置
        break;
      }
      if (method === "input") hasInputSchema = true;
      consumeBalanced("(", ")");
    }

    if (kind === null || kindOpenIdx < 0) continue; // 非完整过程定义

    // ── body：自 kind 的 '(' 后到匹配闭合括号（字符串感知）──
    let depth = 1;
    let closeIdx = kindOpenIdx + 1;
    let quote: string | null = null;
    while (closeIdx < code.length && depth > 0) {
      const ch = code[closeIdx];
      if (quote) {
        if (ch === quote && code[closeIdx - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      closeIdx++;
    }
    const body = code.slice(kindOpenIdx + 1, Math.min(closeIdx - 1, kindOpenIdx + 2000));

    const usesInputInBody = /input\s*\./.test(body) || /\binput\b/.test(body);
    const doesDbWrite = DB_WRITE_PATTERN.test(body);

    procedures.push({
      name,
      kind,
      procedureType: procType,
      hasInputSchema,
      usesInputInBody,
      doesDbWrite,
      line: code.slice(0, m.index).split("\n").length,
    });
  }

  return procedures;
}

/**
 * Analyze a source file for tRPC security issues.
 * Main entry point — mirrors analyzeExpressFile().
 */
export function analyzeTRPCFile(filePath: string): TRPCFileAnalysis {
  const fs = require("fs");
  let code: string;
  try {
    code = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { hasTRPC: false, routerNames: [], procedures: [], issues: [] };
  }

  if (!detectTRPCApp(code)) {
    return { hasTRPC: false, routerNames: [], procedures: [], issues: [] };
  }

  const routerNames = extractRouterNames(code);
  const procedures = extractProcedures(code);
  const issues: TRPCSecurityIssue[] = [];

  for (const p of procedures) {
    // Rule 1: Mutation without input schema that writes to DB or uses input
    if (p.kind === "mutation" && !p.hasInputSchema && (p.usesInputInBody || p.doesDbWrite)) {
      issues.push({
        severity: "high",
        rule: "TRPC_MUTATION_WITHOUT_INPUT_SCHEMA",
        procedure: p.name,
        message:
          `tRPC mutation "${p.name}" has no .input() schema but ` +
          `${p.usesInputInBody ? "references `input` in its body" : "performs DB writes"}. ` +
          `Unvalidated payloads reach business logic.`,
        line: p.line,
        fix: `Add .input(z.object({...})) to "${p.name}" with a Zod schema covering every field read from input.`,
      });
    }

    // Rule 2: Public (unauthenticated) mutation WITHOUT input schema that
    // moves data (uses input or writes to DB). Pure stateless public
    // mutations (e.g. logout clearing a cookie) are exempt.
    if (p.kind === "mutation" && p.procedureType === "public" && !p.hasInputSchema &&
        (p.usesInputInBody || p.doesDbWrite)) {
      issues.push({
        severity: "high",
        rule: "TRPC_PUBLIC_MUTATION",
        procedure: p.name,
        message:
          `tRPC mutation "${p.name}" is public (no auth) AND has no .input() validation ` +
          `while ${p.usesInputInBody ? "reading `input`" : "writing to the database"}. ` +
          `Anyone can submit arbitrary payloads.`,
        line: p.line,
        fix: `Use protectedProcedure for "${p.name}", and add .input(z.object({...})) for payload validation.`,
      });
    }

    // Rule 3: Any procedure reading input without a schema
    if (p.usesInputInBody && !p.hasInputSchema && p.kind === "query") {
      issues.push({
        severity: "medium",
        rule: "TRPC_PROCEDURE_USES_INPUT_WITHOUT_SCHEMA",
        procedure: p.name,
        message:
          `tRPC query "${p.name}" reads \`input\` but declares no .input() schema. ` +
          `Input shape is unvalidated and can drift from the contract.`,
        line: p.line,
        fix: `Declare .input(z.object({...})) on "${p.name}" to pin down the input contract.`,
      });
    }
  }

  return { hasTRPC: true, routerNames, procedures, issues };
}
