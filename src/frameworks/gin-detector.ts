/**
 * Gin Framework Adapter — Protocol Detection for Gin (Go)
 *
 * 第 11 个框架适配（Go 第 1 个，代码串级——Go 路由注册与 Koa/Express 同构）：
 *
 *   r.POST("/x", authMW, handler)        路由级认证中间件链
 *   r.Use(authMW) / r.Group("/api", mw)  组级认证中间件
 *
 * 规则：
 *   GIN_ROUTE_NO_AUTH        mutation 路由（post/put/patch/delete）中间件
 *                            链无认证名中间件，且文件内无认证 Use/Group
 *                            中间件——路由级 missing-auth
 *
 * 口径（如实）：
 *   - get 读操作不检查；认证入口路径词汇豁免（login/regist/auth/token）
 *   - 认证中间件按名字词表识别（auth/jwt/login/permission/token/session/
 *     verify/guard/passport）
 *   - 文件级窗口（与 Express/Koa 检测器同款）
 */

import * as fs from "fs";
import { routeCallWindow, middlewareNamesFromWindow } from "./route-window";

// ── Types ──

export interface GinRoute {
  method: string;
  path: string;
  protected: boolean;
  line: number;
}

export interface GinAppAnalysis {
  hasGin: boolean;
  routes: GinRoute[];
  authGroupMiddleware: string[];
  issues: GinSecurityIssue[];
}

export interface GinSecurityIssue {
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
  // 注意：不含 "middleware" 词——loggerMiddleware 等工具中间件不该撞认证
  // （authMiddleware 类靠 "auth" 命中）
  return AUTH_FN_WORDS.some((w) => lower.includes(w));
}

// ── Analysis（代码串级） ──

export function analyzeGinApp(code: string): GinAppAnalysis {
  const issues: GinSecurityIssue[] = [];
  const routes: GinRoute[] = [];
  const authGroupMiddleware: string[] = [];

  const hasGin = /gin\.(Default|New)\(|"github.com\/gin-gonic\/gin"/.test(code);
  if (!hasGin) {
    return { hasGin: false, routes, authGroupMiddleware, issues };
  }

  // 组级认证中间件：r.Use(authMW) / r.Group("/api", authMW) / g.Use(authMW)
  // 捕获支持点限定成员（users.AuthMiddleware）——修复旧版只捕限定符
  // "users" 的缺陷（V7）。整名送词表判定（AuthMiddleware 含 auth ✓）
  const useRe = /\.Use\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(code)) !== null) {
    if (isAuthFnName(m[1])) authGroupMiddleware.push(m[1]);
  }
  const groupRe = /\.Group\s*\(\s*"[^"]*"\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  while ((m = groupRe.exec(code)) !== null) {
    if (isAuthFnName(m[1])) authGroupMiddleware.push(m[1]);
  }

  // 路由注册：r.POST("/x", mw1, mw2, handler)——Go 方法名大写（POST 惯例）
  // 空路径 "..." 允许（realworld 惯用 POST("", ...) 双注册）
  const routeRe = /\.(get|post|put|patch|delete)\s*\(\s*"([^"]*)"(\s*,\s*|\s*\))/gi;
  while ((m = routeRe.exec(code)) !== null) {
    const method = m[1].toLowerCase();
    const pathName = m[2];
    // 认证窗口 = 本次调用边界内（括号感知），不跨路由（V7 缺陷修复）
    const window = routeCallWindow(code, m.index + m[0].length);
    const mwNames = middlewareNamesFromWindow(window);
    const hasAuthMw = mwNames.some((name) => isAuthFnName(name));

    routes.push({
      method,
      path: pathName,
      protected: hasAuthMw,
      line: code.slice(0, m.index).split("\n").length,
    });

    if (MUTATION_METHODS.has(method) && !hasAuthMw
        && authGroupMiddleware.length === 0 && !isAuthEntryPath(pathName)) {
      issues.push({
        severity: "medium",
        rule: "GIN_ROUTE_NO_AUTH",
        message:
          `Route ${method.toUpperCase()} ${pathName} has no auth middleware ` +
          `and no auth Use/Group middleware — any caller can reach it.`,
        route: `${method.toUpperCase()} ${pathName}`,
        line: code.slice(0, m.index).split("\n").length,
      });
    }
  }

  return { hasGin: true, routes, authGroupMiddleware, issues };
}

export function analyzeGinFile(filePath: string): GinAppAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, "utf-8");
  if (!/gin-gonic|gin\.(Default|New)\(/.test(code)) return null;
  return analyzeGinApp(code);
}
