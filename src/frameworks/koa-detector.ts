/**
 * Koa Framework Adapter — Protocol Detection for Koa
 *
 * 第 9 个框架适配（TS/JS 第 5 个专用检测器，代码串级镜像 express-detector）：
 *
 *   app.use(authMiddleware)                    全局认证中间件
 *   router.post('/x', authMW, handler)         路由级认证中间件链
 *
 * 规则：
 *   KOA_ROUTE_NO_AUTH        mutation 路由注册（post/put/patch/delete/del）
 *                            中间件链里没有认证名中间件，且文件内无认证
 *                            全局 app.use——路由级 missing-auth
 *
 * 口径（如实）：
 *   - get 读操作不检查；认证入口路径词汇豁免（login/regist/auth/token）
 *   - 认证中间件按名字词表识别（auth/login/permission/token/session/
 *     jwt/verify/guard）；自定义认证名不含词表漏判（保守方向=漏报）
 *   - 文件级窗口（与 Express 检测器同款）：跨文件注册的全局中间件不可见
 */

import * as fs from "fs";

// ── Types ──

export interface KoaRoute {
  method: string;
  path: string;
  protected: boolean;
  line: number;
}

export interface KoaAppAnalysis {
  hasKoa: boolean;
  routes: KoaRoute[];
  authGlobalMiddleware: string[];
  issues: KoaSecurityIssue[];
}

export interface KoaSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  line?: number;
}

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete", "del"]);

const AUTH_ENTRY_WORDS = [
  "login", "signin", "sign_in", "regist", "signup", "sign_up",
  "token", "auth", "health",
];

const AUTH_FN_WORDS = [
  "auth", "login", "permission", "token", "credential", "session",
  "jwt", "verify", "guard", "protect", "passport",
];

function isAuthEntryPath(pathName: string): boolean {
  const lower = pathName.toLowerCase();
  return AUTH_ENTRY_WORDS.some((w) => lower.includes(w));
}

function isAuthFnName(name: string): boolean {
  const lower = name.toLowerCase();
  return AUTH_FN_WORDS.some((w) => lower.includes(w));
}

/**
 * 从路由调用参数串提取中间件候选名：
 * 1. 按顶层逗号切分参数（深度感知 ()[]{}，容忍内联 handler 里的逗号/括号）
 * 2. 最后一个参数若是纯标识符（函数引用）→ 是 handler，排除
 *    （inline handler 如 async (ctx) => {...} 无法整参排除，其内部
 *     标识符仍会进入候选——保守方向：多认少漏，认证名在 handler 体内
 *     的概率极低）
 */
function collectMiddlewareNames(callWindow: string): string[] {
  const names: string[] = [];
  // 去掉尾部的闭合括号（window 含 scanEnd 处的 ')'）
  const body = callWindow.replace(/\)\s*$/, "");
  // 顶层逗号切分
  const parts: string[] = [];
  let cur = "";
  let d = 0;
  for (const ch of body) {
    if (ch === "(" || ch === "[" || ch === "{") d++;
    else if (ch === ")" || ch === "]" || ch === "}") d--;
    if (ch === "," && d === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) parts.push(cur);

  const isPlainFnRef = (s: string): boolean =>
    /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(s.trim());
  // 排除末参（若为纯函数引用）
  const mwParts = isPlainFnRef(parts[parts.length - 1] ?? "")
    ? parts.slice(0, -1)
    : parts;

  for (const p of mwParts) {
    const found = p.match(/[A-Za-z_$][\w$]*/g) || [];
    names.push(...found);
  }
  return names;
}

// ── Analysis（代码串级） ──

export function analyzeKoaApp(code: string): KoaAppAnalysis {
  const issues: KoaSecurityIssue[] = [];
  const routes: KoaRoute[] = [];
  const authGlobalMiddleware: string[] = [];

  const hasKoa = /\bKoa\b|\bkoa\b/.test(code);
  if (!hasKoa) {
    return { hasKoa: false, routes, authGlobalMiddleware, issues };
  }

  // 全局认证中间件：app.use(authFn)
  const useRe = /\.use\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(code)) !== null) {
    if (isAuthFnName(m[1])) authGlobalMiddleware.push(m[1]);
  }

  // 路由注册：router.post('/x', mw1, mw2, handler) / .del()
  // 接收者限定 router/*Router/app——config.get('secret') 之类不再被当路由
  const routeRe = /\b(?:router|[A-Za-z_$][\w$]*[Rr]outer|app)\s*\.(get|post|put|patch|delete|del)\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = routeRe.exec(code)) !== null) {
    const method = m[1].toLowerCase() === "del" ? "delete" : m[1].toLowerCase();
    const pathName = m[2];
    // 认证名收集窗口 = 本次路由调用（自路径串后至本调用闭合括号），
    // 不跨路由边界——修复 300 字符前向窗口跨路由串扰（bleed）缺陷：
    // 后面路由的 auth 名不再把前面的公开路由洗成 protected
    let scanStart = m.index + m[0].length;
    let depth = 1; // .post( 的括号仍在开
    let scanEnd = scanStart;
    const MAX_SCAN = 4000;
    while (scanEnd < code.length && scanEnd - scanStart < MAX_SCAN) {
      const ch = code[scanEnd];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
      scanEnd++;
    }
    const window = code.slice(scanStart, scanEnd + 1);
    // koa-router 语义：router.post(path, ...middleware, handler)——最后一个
    // 参数是 handler。末参若为纯标识符（函数引用）则排除，避免 handler 名
    // （如 ctrl.login）含 auth 词被误判为认证中间件
    const mwNames = collectMiddlewareNames(window);
    const hasAuthMw = mwNames.some((name) => isAuthFnName(name));

    routes.push({
      method,
      path: pathName,
      protected: hasAuthMw,
      line: code.slice(0, m.index).split("\n").length,
    });

    if (MUTATION_METHODS.has(method) && !hasAuthMw
        && authGlobalMiddleware.length === 0 && !isAuthEntryPath(pathName)) {
      issues.push({
        severity: "medium",
        rule: "KOA_ROUTE_NO_AUTH",
        message:
          `Route ${method.toUpperCase()} ${pathName} has no auth middleware ` +
          `and the app registers no auth middleware — any caller can reach it.`,
        route: `${method.toUpperCase()} ${pathName}`,
        line: code.slice(0, m.index).split("\n").length,
      });
    }
  }

  return { hasKoa: true, routes, authGlobalMiddleware, issues };
}

export function analyzeKoaFile(filePath: string): KoaAppAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, "utf-8");
  if (!/from\s+['"]koa|require\(['"]koa/.test(code)) return null;
  return analyzeKoaApp(code);
}
