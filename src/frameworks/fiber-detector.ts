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

// ═══════ 项目级：组认证跨文件传播（gin 同款模型，Fiber 移植） ═══════

/**
 * Fiber 与 Gin 同为 Go 组式路由：bootstrap（fiber.New 文件）以组级
 * `api.Use(middleware.Protected())` 施加认证，mutation 经
 * `pkg.RegisterFn(组.Group(...))` 注册在独立文件——保护来自调用点相位。
 * 模型同 gin：语句序状态机 + 注册调用相位；无法建立证据的路由保持文件级。
 */
export interface FiberProjectAnalysis {
  filesScanned: number;
  protectedFunctions: string[];
  issues: FiberSecurityIssue[];
}

/** 顶层函数头（行号 1-based） */
export function fiberFuncStarts(text: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  const re = /^func\s+([A-Za-z_]\w*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1], line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** routeLine 所在顶层函数名 */
export function fiberEnclosingFunc(text: string, routeLine: number): string | null {
  let name: string | null = null;
  for (const f of fiberFuncStarts(text)) {
    if (f.line <= routeLine) name = f.name;
    else break;
  }
  return name;
}

/** bootstrap 相位推导：认证 Use 之后调用的 Register fn（组编号 1,2|3,4|5,6|7,8） */
export function fiberProtectedRegisterFns(bootstrapText: string): Map<string, boolean> {
  const state = new Map<string, boolean>();
  const protectedFns = new Map<string, boolean>();
  const re =
    /(\w+)\s*(?::=|=)\s*fiber\.New\s*\(|(\w+)\.Use\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)|(\w+)\s*(?::=|=)\s*(?:[\w.]*\.)?([A-Za-z_]\w*)\.Group\s*\(|(?:[\w.]*\.)?([A-Z][A-Za-z0-9_]*)\s*\(\s*(?:[\w.]*\.)?([A-Za-z_]\w*)\.Group\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bootstrapText)) !== null) {
    if (m[1] !== undefined) {
      state.set(m[1], false);
    } else if (m[2] !== undefined) {
      if (isAuthFnName(m[3])) state.set(m[2], true);
    } else if (m[4] !== undefined) {
      state.set(m[4], !!state.get(m[5]));
    } else if (m[6] !== undefined) {
      if (state.get(m[7])) protectedFns.set(m[6], true);
    }
  }
  return protectedFns;
}

/** 项目级分析：跨文件组认证传播（同 gin analyzeGinProject） */
export function analyzeFiberProject(projectRoot: string): FiberProjectAnalysis {
  const files: Array<{ file: string; text: string; a: FiberAppAnalysis | null }> = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (["vendor", "node_modules", ".git"].includes(e.name)) continue;
        walk(`${d}/${e.name}`);
      } else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) {
        const fp = `${d}/${e.name}`;
        try {
          files.push({ file: fp, text: fs.readFileSync(fp, "utf-8"), a: analyzeFiberFile(fp) });
        } catch { /* skip */ }
      }
    }
  };
  if (fs.existsSync(projectRoot)) walk(projectRoot.replace(/\/$/, ""));

  // 多层 Register 链传播（journalist 式 main→api.Register(Group+Use)→…）
  const protectedFns = fiberProjectProtectedFns(files);

  const issues: FiberSecurityIssue[] = [];
  for (const { file, text, a } of files) {
    if (!a || a.issues.length === 0) continue;
    const pkgM = text.match(/^package\s+(\w+)/m);
    const filePkg = pkgM ? pkgM[1] : "";
    for (const issue of a.issues) {
      const fn = issue.line ? fiberEnclosingFunc(text, issue.line) : null;
      if (fn && protectedFns.get(`${filePkg}:${fn}`)) continue;
      issues.push({ ...issue });
    }
  }
  return {
    filesScanned: files.length,
    protectedFunctions: [...protectedFns.keys()].filter((k) => protectedFns.get(k)),
    issues,
  };
}

// ═══════ 多层 Register 链传播（真实 Fiber 语料 journalist 验证） ═══════

/** 项目内全部顶层函数（含 fiber 路由参数名） */
interface GoFuncInfo {
  file: string;
  pkg: string;
  name: string;
  routerParams: string[]; // 参数名：类型含 fiber + Router/App/Group
  body: string;
}

/** 解析一个 Go 文件的顶层函数 */
export function goFuncsOf(text: string, file: string): GoFuncInfo[] {
  const out: GoFuncInfo[] = [];
  const pkgM = text.match(/^package\s+(\w+)/m);
  const pkg = pkgM ? pkgM[1] : "";
  const headerRe = /^func\s+([A-Za-z_]\w*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    const hStart = m.index;
    // 平衡取参数
    let depth = 1;
    let end = m.index + m[0].length;
    while (end < text.length && depth > 0) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")") depth--;
      end++;
    }
    const paramsText = text.slice(m.index + m[0].length, end - 1);
    // 找下一个 func 头作为 body 终点
    const nxt = out.length ? text.indexOf("func ", end) : text.indexOf("\nfunc ", end);
    const bodyEnd = (() => {
      const nextHeader = text.slice(end).search(/^func\s/m);
      return nextHeader === -1 ? text.length : end + nextHeader;
    })();
    const body = text.slice(end, bodyEnd);
    const routerParams: string[] = [];
    // 参数切分（顶层逗号）
    let d = 0; let cur = ""; const parts: string[] = [];
    for (const ch of paramsText) {
      if (ch === "(") d++; else if (ch === ")") d--;
      if (ch === "," && d === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    for (const p of parts) {
      // name *pkg.fiber.Router | name fiber.App …
      const pm = p.match(/^([A-Za-z_]\w*)\s+[\w./*]*(\bfiber\b[\w./]*(?:Router|App|Group))/);
      if (pm && /Router|App|Group/.test(pm[2])) routerParams.push(pm[1]);
    }
    out.push({ file, pkg, name: m[1], routerParams, body: text.slice(end, bodyEnd) });
    headerRe.lastIndex = bodyEnd; // 跳过函数体
  }
  return out;
}

/**
 * 项目级保护函数集（多层 Register 链，包限定键）：
 * 队列自全部函数「参数未认证」种子起，凡函数体在「组已 Use 认证」后以
 * 认证组调用项目内 Register 函数 → 该函数入队（参数认证）——支持
 * journalist 式 main→api.Register(Group+Use)→v1.Register→模块 多层链。
 * 键 = pkg:name，避免跨包同名函数（feeds.Register/tokens.Register…）串扰。
 */
export function fiberProjectProtectedFns(
  files: Array<{ file: string; text: string }>,
): Map<string, boolean> {
  const funcs: GoFuncInfo[] = [];
  for (const f of files) funcs.push(...goFuncsOf(f.text, f.file));
  const keyOf = (pkg: string, name: string): string => `${pkg}:${name}`;
  const byKey = new Map<string, GoFuncInfo[]>();
  for (const fn of funcs) {
    byKey.set(keyOf(fn.pkg, fn.name), [...(byKey.get(keyOf(fn.pkg, fn.name)) || []), fn]);
  }
  const protectedFns = new Map<string, boolean>();
  const done = new Set<string>();
  const queue: Array<{ pkg: string; name: string; authed: boolean }> = [];
  for (const fn of funcs) queue.push({ pkg: fn.pkg, name: fn.name, authed: false });
  while (queue.length) {
    const { pkg, name, authed } = queue.shift()!;
    const dk = `${pkg}|${name}|${authed}`;
    if (done.has(dk)) continue;
    done.add(dk);
    if (authed) protectedFns.set(keyOf(pkg, name), true);
    const candidates = byKey.get(keyOf(pkg, name)) || [];
    for (const fn of candidates) {
      const authedParams = new Set<string>();
      if (authed) fn.routerParams.forEach((pp) => authedParams.add(pp));
      const callees = fiberBodyProtectedCalls(fn.body, authedParams, funcs);
      for (const c of callees) queue.push({ pkg: c.pkg, name: c.name, authed: true });
    }
  }
  return protectedFns;
}

/**
 * 函数体内事件模拟 v2：返回在其认证相位被调用的项目函数（包限定）。
 * 调用限定符 feeds.Register → pkg 匹配 feeds；同包调用按当前函数包。
 */
function fiberBodyProtectedCalls(
  body: string,
  authedParams: Set<string>,
  allFuncs: GoFuncInfo[],
): Array<{ pkg: string; name: string }> {
  const calls: Array<{ pkg: string; name: string }> = [];
  const b = body.replace(/\(\s*\*\s*(\w+)\s*\)/g, "$1");
  const curPkg = allFuncs.find((f) => f.body === body)?.pkg || "";
  const state = new Map<string, boolean>();
  for (const p of authedParams) state.set(p, true);
  const re =
    /(\w+)\s*(?::=|=)\s*(?:[\w.]*\.)?([A-Za-z_]\w*)\.Group\s*\(|(\w+)\.Use\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)|(?:([A-Za-z_]\w*)\.)?([A-Z][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(b)) !== null) {
    if (m[1] !== undefined) {
      state.set(m[1], !!state.get(m[2]));
    } else if (m[3] !== undefined) {
      if (isAuthFnName(m[4])) state.set(m[3], true);
    } else if (m[5] !== undefined || m[6] !== undefined) {
      const qual = m[5];
      const fname = m[6];
      // 项目内函数匹配：限定符 → pkg==qual；无限定符 → 同包
      const matches = allFuncs.filter((f) => f.name === fname && (qual ? f.pkg === qual : f.pkg === curPkg));
      if (matches.length === 0) continue;
      const openIdx = b.indexOf("(", m.index + m[0].length - 1);
      if (openIdx < 0) continue;
      let depth = 1; let i = openIdx + 1;
      while (i < b.length && depth > 0) {
        if (b[i] === "(") depth++;
        else if (b[i] === ")") depth--;
        i++;
      }
      const args = b.slice(openIdx + 1, i - 1).split(",").map((x) => x.trim().replace(/^[&*]+/, ""));
      // 实参认证判定：直接组变量 或 内联组派生 X.Group(...)（X 已认证）
      const argAuthed = (a: string): boolean => {
        if (state.get(a)) return true;
        const g = a.match(/^([A-Za-z_]\w*)\.Group\s*\(/);
        return !!g && !!state.get(g[1]);
      };
      if (args.some(argAuthed)) {
        for (const mm of matches) calls.push({ pkg: mm.pkg, name: mm.name });
      }
    }
  }
  return calls;
}
