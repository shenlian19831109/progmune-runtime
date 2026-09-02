/**
 * Hapi Framework Adapter — Protocol Detection for Hapi
 *
 * 第 10 个框架适配（TS/JS 第 6 个专用检测器，代码串级）：
 *
 *   server.auth.strategy('jwt', 'jwt', {...})            认证策略声明
 *   server.route({ method: 'POST', path: '/x',
 *                  options: { auth: 'jwt' } })           路由级认证
 *
 * 规则：
 *   HAPI_ROUTE_NO_AUTH        mutation 路由（method 含 POST/PUT/PATCH/
 *                             DELETE）的 options 无 auth 字段，或显式
 *                             auth: false——路由级 missing-auth / 显式公开
 *
 * 口径（如实）：
 *   - get 读操作不检查；认证入口路径词汇豁免（login/regist/auth/token）
 *   - 策略名本身不作为认证证明——必须出现在路由 options.auth
 *     （auth: 'jwt' / auth: { strategy: 'jwt' } 均识别）
 *   - auth: 'try'（可选认证）视为受保护（非公开）
 */

import * as fs from "fs";

// ── Types ──

export interface HapiRoute {
  method: string;
  path: string;
  authOption: string | null; // null = 无 auth 字段
  line: number;
}

export interface HapiAppAnalysis {
  hasHapi: boolean;
  routes: HapiRoute[];
  strategies: string[];
  issues: HapiSecurityIssue[];
}

export interface HapiSecurityIssue {
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

function isAuthEntryPath(pathName: string): boolean {
  const lower = pathName.toLowerCase();
  return AUTH_ENTRY_WORDS.some((w) => lower.includes(w));
}

// ── Analysis（代码串级） ──

export function analyzeHapiApp(code: string): HapiAppAnalysis {
  const issues: HapiSecurityIssue[] = [];
  const routes: HapiRoute[] = [];
  const strategies: string[] = [];

  // @hapi-scoped（v17+）或 v16 时代 require('hapi')（V6 gate 时代失配修复）
  const hasHapi =
    /@hapi\/hapi|\bHapi\.server\b|\bhapi\.server\b|require\(\s*['"]hapi['"]\s*\)|from\s+['"]hapi['"]/.test(
      code
    );
  if (!hasHapi) {
    return { hasHapi: false, routes, strategies, issues };
  }

  // 认证策略声明：server.auth.strategy('name', ...)
  const strategyRe = /\.auth\.strategy\s*\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = strategyRe.exec(code)) !== null) {
    strategies.push(m[1]);
  }

  // 路由块：server.route({ ... }) —— 从 route( 向后截 500 字符窗口
  const routeRe = /\.route\s*\(\s*\{/g;
  while ((m = routeRe.exec(code)) !== null) {
    const window = code.slice(m.index, m.index + 500);
    const methodM = window.match(/method\s*:\s*['"]([^'"]+)['"]/);
    const pathM = window.match(/path\s*:\s*['"]([^'"]+)['"]/);
    const authM = window.match(/auth\s*:\s*(?:['"]([^'"]+)['"]|\{\s*strategy\s*:\s*['"]([^'"]+)['"]|\s*(false|true))/);
    if (!methodM || !pathM) continue;

    const method = methodM[1].toLowerCase();
    const pathName = pathM[1];
    // auth: false → 显式公开；无 auth 字段 → authM null
    const authOption = authM
      ? (authM[3] === "false" ? "false" : authM[1] || authM[2] || authM[3] || null)
      : null;

    routes.push({
      method,
      path: pathName,
      authOption,
      line: code.slice(0, m.index).split("\n").length,
    });

    if (!MUTATION_METHODS.has(method)) continue;
    if (isAuthEntryPath(pathName)) continue;
    // 无 auth 字段（authOption null 且非显式 false 已涵盖）或显式 false → 报
    if (authOption === null || authOption === "false") {
      issues.push({
        severity: "medium",
        rule: "HAPI_ROUTE_NO_AUTH",
        message:
          authOption === "false"
            ? `Mutation route ${method.toUpperCase()} ${pathName} is explicitly ` +
              `public (auth: false) — any caller can reach it.`
            : `Mutation route ${method.toUpperCase()} ${pathName} has no auth ` +
              `option in its route config — any caller can reach it.`,
        route: `${method.toUpperCase()} ${pathName}`,
        line: code.slice(0, m.index).split("\n").length,
      });
    }
  }

  return { hasHapi: true, routes, strategies, issues };
}

export function analyzeHapiFile(filePath: string): HapiAppAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, "utf-8");
  // gate 兼容 v16（require('hapi')）与 @hapi-scoped v17+
  if (
    !/@hapi\/hapi|@hapi\/hawk|\bHapi\.server\b|require\(\s*['"]hapi['"]\s*\)|from\s+['"]hapi['"]/.test(
      code
    )
  ) {
    return null;
  }
  return analyzeHapiApp(code);
}
