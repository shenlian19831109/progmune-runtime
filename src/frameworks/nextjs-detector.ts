/**
 * Next.js Framework Adapter — App Router route handler analysis
 *
 * 第 7 个框架适配（TS/JS 第 4 个专用检测器）。Next.js 的「路由」是文件
 * 而不是代码声明：app 下各段的 route.ts 每个导出 POST/PUT/PATCH/DELETE 的文件
 * 就是一个对外写入口。本模块做文件级结构扫描：
 *
 *   mutation 导出       export function POST/PUT/PATCH/DELETE(...)
 *   路由级认证信号      route.ts 内调用 next-auth（getServerSession/auth()）
 *                       或自定义认证（requireAuth/verifyToken/getToken/
 *                       withAuth/isAuthenticated 等）
 *   全局认证信号        middleware.ts（项目根或 src/）内容命中认证词表
 *
 * 规则：
 *   NEXT_ROUTE_NO_AUTH        mutation 路由文件无路由级认证调用，且项目
 *                             无认证 middleware——路由级 missing-auth
 *
 * 口径（如实）：
 *   - GET 导出不检查（公开读是常见设计）
 *   - 认证信号按词表识别；自定义认证名不含词表会漏判（保守方向是漏报）
 *   - 认证入口路径按词汇豁免（login/regist/auth/token）
 *   - Server Components / page.tsx 的非 API 页面不检查（只盯 route.ts
 *     与 pages/api——对外 API 面）
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ──

export interface NextRouteFile {
  file: string;
  mutations: string[]; // 导出的写方法
  hasAuthCall: boolean;
}

export interface NextAppAnalysis {
  hasNext: boolean;
  routeFiles: NextRouteFile[];
  hasAuthMiddleware: boolean;
  issues: NextSecurityIssue[];
}

export interface NextSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  file?: string;
}

const MUTATION_EXPORTS = ["POST", "PUT", "PATCH", "DELETE"];

const AUTH_ENTRY_WORDS = [
  "login", "signin", "sign_in", "regist", "signup", "sign_up",
  "token", "auth", "health",
];

// 路由级认证信号：会话式（getServerSession/next-auth v5 auth()/clerk
// currentUser）+ webhook 载荷签名校验（Stripe constructEvent 等——
// V5 真实语料证明 webhook 端点的标准保护是签名校验而非会话）
const AUTH_CALL_RE = /\b(getServerSession|requireAuth|requireUser|verifyToken|verifyAuth|isAuthenticated|checkAuth|getToken|withAuth|authSession|authenticate|auth|currentUser)\s*\(|\b(constructEvent|verifyWebhook|verifySignature|verifyWebhookSignature|validateWebhook|validateSignature)\s*\(/;

const AUTH_MIDDLEWARE_RE = /\b(getServerSession|requireAuth|verifyToken|getToken|withAuth|next-auth|authorization|authenticate)\b/;

function isAuthEntryFile(relFile: string): boolean {
  const lower = relFile.toLowerCase();
  return AUTH_ENTRY_WORDS.some((w) => lower.includes(w));
}

// ── Analysis ──

/**
 * 扫描 Next.js 项目的 API 路由文件（app 下各段的 route.ts + pages/api 下各段）。
 * @param projectRoot — 项目根目录
 * @param middlewareCode — middleware.ts 内容（调用方预读，可为空）
 */
export function analyzeNextApp(
  projectRoot: string,
  middlewareCode?: string
): NextAppAnalysis {
  const routeFiles: NextRouteFile[] = [];
  const issues: NextSecurityIssue[] = [];
  let legacyApiFiles = 0; // pages/api 旧式 handler（方法不可静态区分，只计数）
  const hasAuthMiddleware = !!middlewareCode && AUTH_MIDDLEWARE_RE.test(middlewareCode);

  const candidates: string[] = [];
  for (const base of ["app", "src/app"]) {
    const dir = path.join(projectRoot, base);
    if (fs.existsSync(dir)) {
      collectRouteFiles(dir, candidates);
    }
  }
  const pagesApi = path.join(projectRoot, "pages", "api");
  if (fs.existsSync(pagesApi)) {
    collectRouteFiles(pagesApi, candidates);
  }

  for (const file of candidates) {
    let code: string;
    try {
      code = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const mutations: string[] = [];
    for (const m of MUTATION_EXPORTS) {
      if (new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(code)) {
        mutations.push(m);
      }
    }
    if (mutations.length === 0) {
      legacyApiFiles++;
      continue;
    }

    const hasAuthCall = AUTH_CALL_RE.test(code);
    const rel = path.relative(projectRoot, file);
    routeFiles.push({ file: rel, mutations, hasAuthCall });

    if (!hasAuthCall && !hasAuthMiddleware && !isAuthEntryFile(rel)) {
      issues.push({
        severity: "medium",
        rule: "NEXT_ROUTE_NO_AUTH",
        message:
          `API route ${rel} exports ${mutations.join("/")} without an auth ` +
          `check in the handler and the project has no auth middleware — ` +
          `any caller can reach it.`,
        route: rel,
        file: rel,
      });
    }
  }

  return {
    hasNext: routeFiles.length > 0 || legacyApiFiles > 0 || !!middlewareCode,
    routeFiles,
    hasAuthMiddleware,
    issues,
  };
}

function collectRouteFiles(dir: string, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectRouteFiles(full, out);
    } else if (e.isFile() && e.name === "route.ts") {
      out.push(full);
    } else if (e.isFile() && /\.(ts|js)$/.test(e.name) && dir.includes("pages" + path.sep + "api")) {
      out.push(full);
    }
  }
}

/** 读取项目的 middleware 代码（根或 src/） */
export function readNextMiddleware(projectRoot: string): string | undefined {
  for (const rel of ["middleware.ts", "middleware.js", "src/middleware.ts", "src/middleware.js"]) {
    const p = path.join(projectRoot, rel);
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, "utf-8");
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
