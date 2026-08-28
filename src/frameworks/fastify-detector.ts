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

// ── Analysis（代码串级，镜像 express-detector） ──

export function analyzeFastifyApp(code: string): FastifyAppAnalysis {
  const issues: FastifySecurityIssue[] = [];
  const routes: FastifyRoute[] = [];
  const authHooks: string[] = [];

  const hasFastify = /\bFastify\b|\bfastify\b/.test(code);
  if (!hasFastify) {
    return { hasFastify: false, routes, authHooks, issues };
  }

  // 全局认证钩子：addHook('preHandler'|'preValidation'|'onRequest', authFn)
  const hookRe = /\.addHook\s*\(\s*['"](preHandler|preValidation|onRequest)['"]\s*,\s*([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = hookRe.exec(code)) !== null) {
    if (isAuthFnName(m[2])) authHooks.push(m[2]);
  }

  // 路由注册：fastify.post('/x', {...}, handler) —— 捕获到 options 窗口
  const routeRe = /\.(get|post|put|patch|delete|route)\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = routeRe.exec(code)) !== null) {
    const method = m[1].toLowerCase();
    const pathName = m[2];
    // 从路由调用起点向后截取 400 字符窗口，查 preHandler/preValidation 选项
    const windowStart = m.index;
    const window = code.slice(windowStart, windowStart + 400);
    const hasAuthOption = /\b(preHandler|preValidation)\s*:/g.test(window)
      && (() => {
        // 选项值里出现 auth-like 函数名才认（保守）
        const optMatch = window.match(/\b(preHandler|preValidation)\s*:\s*\[([^\]]*)\]/);
        if (!optMatch) return false;
        return optMatch[2].split(",").some((name) => isAuthFnName(name.trim()));
      })();

    routes.push({
      method,
      path: pathName,
      protected: hasAuthOption,
      line: code.slice(0, m.index).split("\n").length,
    });

    if (MUTATION_METHODS.has(method) && !hasAuthOption
        && authHooks.length === 0 && !isAuthEntryPath(pathName)) {
      issues.push({
        severity: "medium",
        rule: "FASTIFY_ROUTE_NO_AUTH",
        message:
          `Route ${method.toUpperCase()} ${pathName} is registered without ` +
          `preHandler/preValidation auth and the app has no auth hook — ` +
          `any caller can reach it.`,
        route: `${method.toUpperCase()} ${pathName}`,
        line: code.slice(0, m.index).split("\n").length,
      });
    }
  }

  return { hasFastify: true, routes, authHooks, issues };
}

export function analyzeFastifyFile(filePath: string): FastifyAppAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, "utf-8");
  if (!/from\s+['"]fastify['"]|require\(['"]fastify['"]\)/.test(code)) return null;
  return analyzeFastifyApp(code);
}
