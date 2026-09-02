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
