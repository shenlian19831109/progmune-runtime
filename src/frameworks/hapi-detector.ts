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
import { collectRegisterRoots, isRegisterRoot } from "./route-window";

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

/** 声明式 hapi 路由模块（V6 遗留缺口）：真实 hapi 应用（glue/pal/插件）
 * 以数组声明路由——module.exports = (server) => [ { method, path,
 *   config: { auth: 'jwt', ... }, handler }, ... ]，由框架注册；
 * 文件本身无 require('hapi')、无 server.route 调用 */
function isDeclarativeHapiModule(code: string): boolean {
  const hasRouteObject =
    /method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE|get|post|put|patch|delete)['"]/.test(code) &&
    /path\s*:\s*['"]/.test(code) &&
    /\b(?:config|options)\s*:/.test(code);
  if (!hasRouteObject) return false;
  return (
    /module\.exports\s*=\s*\(?\s*server\b/.test(code) ||
    /module\.exports\s*=\s*function\s*\(\s*server\b/.test(code) ||
    /return\s*\[/.test(code)
  );
}

/** 自 routeObjStart('{') 取平衡块文本（含嵌套 config 对象；字符串感知） */
function hapiBalancedBlock(code: string, openIdx: number): string {
  let depth = 1;
  let end = openIdx + 1;
  let quote: string | null = null;
  while (end < code.length && depth > 0) {
    const ch = code[end];
    if (quote) {
      if (ch === quote && code[end - 1] !== "\\") quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    }
    end++;
  }
  return code.slice(openIdx + 1, Math.max(openIdx + 1, end - 1));
}

function hapiAuthOption(block: string): string | null {
  const authM = block.match(
    /\bauth\s*:\s*(?:['"]([^'"]+)['"]|\{\s*strategy\s*:\s*['"]([^'"]+)['"]|\s*(false|true))/
  );
  if (!authM) return null;
  return authM[3] === "false" ? "false" : authM[1] || authM[2] || authM[3] || null;
}

export function analyzeHapiApp(code: string): HapiAppAnalysis {
  const issues: HapiSecurityIssue[] = [];
  const routes: HapiRoute[] = [];
  const strategies: string[] = [];

  // @hapi-scoped（v17+）、v16 require('hapi'），或声明式数组模块（V6 修复）
  const hasHapi =
    /@hapi\/hapi|\bHapi\.server\b|\bhapi\.server\b|require\(\s*['"]hapi['"]\s*\)|from\s+['"]hapi['"]/.test(
      code
    ) || isDeclarativeHapiModule(code);
  if (!hasHapi) {
    return { hasHapi: false, routes, strategies, issues };
  }

  // 认证策略声明：server.auth.strategy('name', ...)
  const strategyRe = /\.auth\.strategy\s*\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = strategyRe.exec(code)) !== null) {
    strategies.push(m[1]);
  }

  const declarative = isDeclarativeHapiModule(code);
  const lineAt = (idx: number): number => code.slice(0, idx).split("\n").length;

  if (!declarative) {
    // 直连形态：server.route({ ... }) —— 500 字符窗口
    const routeRe = /\.route\s*\(\s*\{/g;
    while ((m = routeRe.exec(code)) !== null) {
      const window = code.slice(m.index, m.index + 500);
      const methodM = window.match(/method\s*:\s*['"]([^'"]+)['"]/);
      const pathM = window.match(/path\s*:\s*['"]([^'"]+)['"]/);
      if (!methodM || !pathM) continue;
      routes.push({
        method: methodM[1].toLowerCase(),
        path: pathM[1],
        authOption: hapiAuthOption(window),
        line: lineAt(m.index),
      });
    }
  } else {
    // 声明式数组：每个 { method, path, config:{auth} } 路由对象
    const verbRe = /method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE|get|post|put|patch|delete)['"]/g;
    while ((m = verbRe.exec(code)) !== null) {
      const verb = m[1].toLowerCase();
      const verbLine = lineAt(m.index);
      const objStart = code.lastIndexOf("{", m.index);
      if (objStart < 0) continue;
      const block = hapiBalancedBlock(code, objStart);
      const pathM = block.match(/path\s*:\s*['"]([^'"]+)['"]/);
      if (!pathM) continue;
      // 重复对象去重
      if (routes.some((r) => r.line === verbLine && r.method === verb)) continue;
      routes.push({
        method: verb,
        path: pathM[1],
        authOption: hapiAuthOption(block),
        line: verbLine,
      });
    }
  }

  // register 集合豁免（语义层，同其他框架）：users/login 姊妹 → POST users 公开
  const registerRoots = collectRegisterRoots(routes.map((r) => r.path));
  for (const r of routes) {
    if (!MUTATION_METHODS.has(r.method)) continue;
    if (isAuthEntryPath(r.path)) continue;
    if (r.method === "post" && isRegisterRoot(r.path, registerRoots)) continue;
    if (r.authOption === null || r.authOption === "false") {
      issues.push({
        severity: "medium",
        rule: "HAPI_ROUTE_NO_AUTH",
        message:
          r.authOption === "false"
            ? `Mutation route ${r.method.toUpperCase()} ${r.path} is explicitly ` +
              `public (auth: false) — any caller can reach it.`
            : `Mutation route ${r.method.toUpperCase()} ${r.path} has no auth ` +
              `option in its route config — any caller can reach it.`,
        route: `${r.method.toUpperCase()} ${r.path}`,
        line: r.line,
      });
    }
  }

  return { hasHapi: true, routes, strategies, issues };
}

export function analyzeHapiFile(filePath: string): HapiAppAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, "utf-8");
  // gate：@hapi-scoped / v16 require('hapi') / 声明式数组模块
  const marker =
    /@hapi\/hapi|@hapi\/hawk|\bHapi\.server\b|require\(\s*['"]hapi['"]\s*\)|from\s+['"]hapi['"]/.test(
      code
    ) || isDeclarativeHapiModule(code);
  if (!marker) return null;
  return analyzeHapiApp(code);
}
