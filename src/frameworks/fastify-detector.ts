/**
 * Fastify Framework Adapter — Protocol Detection for Fastify
 *
 * 第 6 个框架适配（TS/JS 第 3 个专用检测器，镜像 express-detector 的
 * 代码串分析风格）：
 *
 *   fastify.get('/x', { preHandler: [auth] }, handler)  路由级认证选项
 *   fastify.addHook('preHandler', authFn)               全局认证钩子
 *
 * 规则：
 *   FASTIFY_ROUTE_NO_AUTH        mutation 路由注册（post/put/patch/delete）
 *                                无 preHandler/preValidation 认证选项，
 *                                且文件中无认证 addHook——路由级 missing-auth
 *
 * 口径（如实）：
 *   - get 是读操作不检查（公开读是常见设计）
 *   - 认证钩子函数按名字词表识别（auth/login/permission/token/session…）；
 *     自定义认证函数若名字不含词表会漏判（保守方向是漏报不是误报）
 *   - 认证入口路径按词汇豁免（login/regist/auth/token/health）
 *   - 代码串级分析（与 Express 检测器同款）：装饰器/配置展开不可见
 */

import * as fs from "fs";
import { collectRegisterRoots, isRegisterRoot } from "./route-window";

// ── Types ──

export interface FastifyRoute {
  method: string;
  path: string;
  /** 路由级认证保护（preHandler/preValidation 选项内出现 auth-like 名） */
  protected: boolean;
  line: number;
}

export interface FastifyAppAnalysis {
  hasFastify: boolean;
  routes: FastifyRoute[];
  authHooks: string[];
  issues: FastifySecurityIssue[];
}

export interface FastifySecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  line?: number;
}

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

const AUTH_ENTRY_WORDS = [
  "login", "signin", "sign_in", "regist", "signup", "sign_up",
  "token", "auth", "health", "status",
];

const AUTH_FN_WORDS = [
  "auth", "login", "permission", "token", "credential", "session",
  "jwt", "verify", "guard", "protect",
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

/** 自 openIdx（'{' 或 '('）取平衡块内文本（字符串感知） */
function balancedBlock(code: string, openIdx: number): string {
  const open = code[openIdx];
  const close = open === "{" ? "}" : ")";
  let depth = 1;
  let end = openIdx + 1;
  let quote: string | null = null;
  while (end < code.length && depth > 0) {
    const ch = code[end];
    if (quote) {
      if (ch === quote && code[end - 1] !== "\\") quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
    }
    end++;
  }
  return code.slice(openIdx + 1, Math.max(openIdx + 1, end - 1));
}

/** 认证选项名：位置形态（options 对象）与 object-form 路由均可出现 */
const AUTH_OPTION_NAMES = ["onRequest", "preHandler", "preValidation"];

/** 选项数组里是否有 auth-like 名（支持点限定 server.authenticate） */
function optionListHasAuth(listText: string): boolean {
  return listText.split(",").some((name) => isAuthFnName(name.trim()));
}

function hasAuthOptionInBlock(block: string): boolean {
  for (const opt of AUTH_OPTION_NAMES) {
    const re = new RegExp(`\\b${opt}\\s*:\\s*\\[([^\\]]*)\\]`, "g");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(block)) !== null) {
      if (optionListHasAuth(mm[1])) return true;
    }
  }
  return false;
}

export function analyzeFastifyApp(code: string): FastifyAppAnalysis {
  const issues: FastifySecurityIssue[] = [];
  const routes: FastifyRoute[] = [];
  const authHooks: string[] = [];

  const hasFastify = /\bFastify\b|\bfastify\b/.test(code);
  if (!hasFastify) {
    return { hasFastify: false, routes, authHooks, issues };
  }

  // 全局认证钩子：addHook('preHandler'|'preValidation'|'onRequest', authFn)
  const hookRe = /\.addHook\s*\(\s*['"](preHandler|preValidation|onRequest)['"]\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  let m: RegExpExecArray | null;
  while ((m = hookRe.exec(code)) !== null) {
    if (isAuthFnName(m[2])) authHooks.push(m[2]);
  }

  const pushRoute = (
    method: string, pathName: string, protected_: boolean, at: number,
  ): void => {
    routes.push({
      method,
      path: pathName,
      protected: protected_,
      line: code.slice(0, at).split("\n").length,
    });
  };

  // ── object-form 路由：server.route({ method, path, onRequest:[auth], ... })
  //    （fastify-realworld 20/20 用此形态——V2 recall 失明根因）
  const objRe = /\.route\s*\(\s*\{/g;
  while ((m = objRe.exec(code)) !== null) {
    const block = balancedBlock(code, m.index + m[0].length - 1); // 自 '{'
    const methodM = block.match(/method\s*:\s*['"]([^'"]+)['"]/);
    if (!methodM) continue;
    const method = methodM[1].toLowerCase();
    // path 可能是拼接 options.prefix + 'users/login'——取首个引号字面量
    const pathM = block.match(/path\s*:\s*[^,'"\n]*['"]([^'"]+)['"]/);
    const pathName = pathM ? pathM[1] : "";
    const protected_ = hasAuthOptionInBlock(block);
    pushRoute(method, pathName, protected_, m.index);
  }

  // ── 位置形态：fastify.post('/x', { preHandler: [auth] }, handler) ──
  const posRe = /\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = posRe.exec(code)) !== null) {
    const method = m[1].toLowerCase();
    const pathName = m[2];
    const window = code.slice(m.index, m.index + 400);
    const protected_ = hasAuthOptionInBlock(window);
    pushRoute(method, pathName, protected_, m.index);
  }

  // register 集合豁免（语义层，同 Koa/Gin）：有 <path>/login 姊妹佐证的
  // 账户集合，其无认证 POST = 公开注册
  const registerRoots = collectRegisterRoots(routes.map((r) => r.path));
  for (const r of routes) {
    if (MUTATION_METHODS.has(r.method) && !r.protected
        && authHooks.length === 0
        && !isAuthEntryPath(r.path)
        && !(r.method === "post" && isRegisterRoot(r.path, registerRoots))) {
      issues.push({
        severity: "medium",
        rule: "FASTIFY_ROUTE_NO_AUTH",
        message:
          `Route ${r.method.toUpperCase()} ${r.path} is registered without ` +
          `onRequest/preHandler/preValidation auth and the app has no auth hook — ` +
          `any caller can reach it.`,
        route: `${r.method.toUpperCase()} ${r.path}`,
        line: r.line,
      });
    }
  }

  return { hasFastify: true, routes, authHooks, issues };
}

export function analyzeFastifyFile(filePath: string): FastifyAppAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, "utf-8");
  // 门：直接 import fastify（应用入口）或 fastify-plugin（真实插件模块——
  // fastify-realworld 的路由模块是 fp(plugin) 包裹、接收 server 实例；
  // 旧门只认 require('fastify') → 0/38 文件进门）
  if (
    !/from\s+['"]fastify['"]|require\(['"]fastify['"]\)|fastify-plugin/.test(code)
  ) {
    return null;
  }
  return analyzeFastifyApp(code);
}
