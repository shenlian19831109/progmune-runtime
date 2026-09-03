/**
 * Fiber Framework Adapter — Protocol Detection for Fiber (Go)
 *
 * 第 12 个框架适配（Go 第 2 个，代码串级——Fiber 路由与 Express 同构）：
 *
 *   app.Post("/x", authMW, handler)     路由级认证中间件链
 *   app.Use(authMW) / group.Use(authMW) 全局/组级认证中间件
 *
 * 规则：
 *   FIBER_ROUTE_NO_AUTH       mutation 路由（post/put/patch/delete）中间件
 *                             链无认证名中间件，且文件内无认证 Use 中间件
 *
 * 口径（如实）：
 *   - get 读操作不检查；认证入口路径词汇豁免（login/regist/auth/token）
 *   - 认证中间件按名字词表识别（auth/jwt/login/permission/token/session/
 *     verify/guard/passport）
 *   - 文件级窗口（与 Express/Koa 检测器同款）
 */

import * as fs from "fs";
import { routeCallWindow, middlewareNamesFromWindow, collectRegisterRoots, isRegisterRoot } from "./route-window";

// ── Types ──

export interface FiberRoute {
  method: string;
  path: string;
  protected: boolean;
  line: number;
}

export interface FiberAppAnalysis {
  hasFiber: boolean;
  routes: FiberRoute[];
  authMiddleware: string[];
  issues: FiberSecurityIssue[];
}

export interface FiberSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  line?: number;
}

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

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

// ── Analysis（代码串级） ──

export function analyzeFiberApp(code: string): FiberAppAnalysis {
  const issues: FiberSecurityIssue[] = [];
  const routes: FiberRoute[] = [];
  const authMiddleware: string[] = [];

  const hasFiber = /fiber\.New\(|"github.com\/gofiber\/fiber/.test(code);
  if (!hasFiber) {
    return { hasFiber: false, routes, authMiddleware, issues };
  }

  // 全局/组级认证中间件：app.Use(authMW) / group.Use(authMW)
  // 捕获支持点限定成员（jwtware.New 前的一般为 middleware.Protected 等）
  const useRe = /\.Use\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(code)) !== null) {
    if (isAuthFnName(m[1])) authMiddleware.push(m[1]);
  }

  // 路由注册：app.Post("/x", mw1, mw2, handler)——Go 方法名大写（Post 惯例）
  // 空路径 "..." 允许
  const routeRe = /\.(get|post|put|patch|delete)\s*\(\s*"([^"]*)"(\s*,\s*|\s*\))/gi;
  while ((m = routeRe.exec(code)) !== null) {
    const method = m[1].toLowerCase();
    const pathName = m[2];
    // 认证窗口 = 本次调用边界内（括号感知），不跨路由（V8 缺陷修复）
    const window = routeCallWindow(code, m.index + m[0].length);
    const mwNames = middlewareNamesFromWindow(window);
    const hasAuthMw = mwNames.some((name) => isAuthFnName(name));

    routes.push({
      method,
      path: pathName,
      protected: hasAuthMw,
      line: code.slice(0, m.index).split("\n").length,
    });
  }

  // register 集合豁免（语义层，同 Koa/Gin）
  const registerRoots = collectRegisterRoots(routes.map((r) => r.path));
  for (const r of routes) {
    if (MUTATION_METHODS.has(r.method) && !r.protected
        && authMiddleware.length === 0
        && !isAuthEntryPath(r.path)
        && !(r.method === "post" && isRegisterRoot(r.path, registerRoots))) {
      issues.push({
        severity: "medium",
        rule: "FIBER_ROUTE_NO_AUTH",
        message:
          `Route ${r.method.toUpperCase()} ${r.path} has no auth middleware ` +
          `and no auth Use middleware — any caller can reach it.`,
        route: `${r.method.toUpperCase()} ${r.path}`,
        line: r.line,
      });
    }
  }

  return { hasFiber: true, routes, authMiddleware, issues };
}

export function analyzeFiberFile(filePath: string): FiberAppAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, "utf-8");
  if (!/gofiber|fiber\.New\(/.test(code)) return null;
  return analyzeFiberApp(code);
}
