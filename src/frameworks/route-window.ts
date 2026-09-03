/**
 * route-window.ts — 路由调用窗口共享工具（Koa/Gin/Fiber 代码串检测器共用）
 *
 * 背景：初代实现用「路径串后固定 300 字符窗口」收集认证中间件名 →
 * 跨路由串扰（bleed）：后面路由的 auth 名污染前面公开路由的保护判定
 * （V3 Koa / V7 Gin / V8 Fiber 同款缺陷）。
 *
 * 修复思路：
 *  1. routeCallWindow —— 窗口 = 本次路由调用边界内（括号深度感知到闭合
 *     `)`），不跨路由、容忍内联 handler 的多层括号
 *  2. middlewareNamesFromWindow —— koa-router/gin/fiber 语义一致：
 *     `(path, ...middleware, handler)`，最后一个纯函数引用参数是
 *     handler（如 ctrl.login / UsersLogin），排除——handler 名含 auth
 *     词不再被误判为认证中间件
 */

/**
 * 自路由调用起点（路径串刚结束处）扫描到本次调用的闭合括号。
 * @param code  源码
 * @param from  路径串结束位置（调用括号深度已为 1——方法名的 `(` 已消费）
 * @returns 窗口内容（含闭合 `)`）
 */
export function routeCallWindow(code: string, from: number): string {
  let depth = 1;
  let end = from;
  let quote: string | null = null;
  const MAX = 4000;
  while (end < code.length && end - from < MAX) {
    const ch = code[end];
    if (quote) {
      if (ch === quote && code[end - 1] !== "\\") quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
    end++;
  }
  return code.slice(from, end + 1);
}

/** 纯函数引用：auth / ctrl.login / users.AuthMiddleware */
function isPlainFnRef(s: string): boolean {
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(s.trim());
}

/**
 * 从路由调用参数窗口提取中间件候选名。
 * 顶层逗号切分（深度感知）→ 末参若为纯函数引用则视为 handler 排除 →
 * 其余参数内的标识符即中间件候选。
 */
export function middlewareNamesFromWindow(window: string): string[] {
  const names: string[] = [];
  const body = window.replace(/\)\s*$/, "");
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

  const mwParts = isPlainFnRef(parts[parts.length - 1] ?? "")
    ? parts.slice(0, -1)
    : parts;
  for (const p of mwParts) {
    const found = p.match(/[A-Za-z_$][\w$]*/g) || [];
    names.push(...found);
  }
  return names;
}

// ── register 集合豁免（语义层，Koa/Gin/Fiber/NestJS 共用）──

/** 账户集合根判定词：路径以这些后缀结尾的路由是账户入口（login 等） */
const ACCOUNT_ENTRY_SUFFIXES = [
  "/login", "/signin", "/sign_in", "/register", "/signup", "/sign_up",
];

/** 规范化路径：去首尾斜杠 */
export function normPath(p: string): string {
  return p.replace(/^\/+|\/+$/g, "");
}

/**
 * 收集「账户集合根」：对每条路径，若以账户入口后缀结尾（如 /users/login），
 * 剥掉后缀得集合根（/users）。该集合的无认证 POST = 公开注册（豁免）。
 * 佐证式豁免——无 login/register 姊妹的写集合不豁免（管理员建用户等仍查）。
 */
export function collectRegisterRoots(paths: string[]): Set<string> {
  const roots = new Set<string>();
  for (const p of paths) {
    const lower = p.toLowerCase();
    for (const suffix of ACCOUNT_ENTRY_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        roots.add(normPath(p.slice(0, -suffix.length)));
        break;
      }
    }
  }
  return roots;
}

/** routePath 是否命中账户集合根（规范化比较） */
export function isRegisterRoot(routePath: string, roots: Set<string>): boolean {
  return roots.has(normPath(routePath));
}
