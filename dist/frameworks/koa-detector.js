"use strict";
/**
 * Koa Framework Adapter — Protocol Detection for Koa
 *
 * 第 9 个框架适配（TS/JS 第 5 个专用检测器，代码串级镜像 express-detector）：
 *
 *   app.use(authMiddleware)                    全局认证中间件
 *   router.post('/x', authMW, handler)         路由级认证中间件链
 *
 * 规则：
 *   KOA_ROUTE_NO_AUTH        mutation 路由注册（post/put/patch/delete/del）
 *                            中间件链里没有认证名中间件，且文件内无认证
 *                            全局 app.use——路由级 missing-auth
 *
 * 口径（如实）：
 *   - get 读操作不检查；认证入口路径词汇豁免（login/regist/auth/token）
 *   - 认证中间件按名字词表识别（auth/login/permission/token/session/
 *     jwt/verify/guard）；自定义认证名不含词表漏判（保守方向=漏报）
 *   - 文件级窗口（与 Express 检测器同款）：跨文件注册的全局中间件不可见
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeKoaApp = analyzeKoaApp;
exports.analyzeKoaFile = analyzeKoaFile;
const fs = __importStar(require("fs"));
const route_window_1 = require("./route-window");
const MUTATION_METHODS = new Set(["post", "put", "patch", "delete", "del"]);
const AUTH_ENTRY_WORDS = [
    "login", "signin", "sign_in", "regist", "signup", "sign_up",
    "token", "auth", "health",
];
const AUTH_FN_WORDS = [
    "auth", "login", "permission", "token", "credential", "session",
    "jwt", "verify", "guard", "protect", "passport",
];
function isAuthEntryPath(pathName) {
    const lower = pathName.toLowerCase();
    return AUTH_ENTRY_WORDS.some((w) => lower.includes(w));
}
function isAuthFnName(name) {
    const lower = name.toLowerCase();
    return AUTH_FN_WORDS.some((w) => lower.includes(w));
}
// ── Analysis（代码串级） ──
function analyzeKoaApp(code) {
    const issues = [];
    const routes = [];
    const authGlobalMiddleware = [];
    const hasKoa = /\bKoa\b|\bkoa\b/.test(code);
    if (!hasKoa) {
        return { hasKoa: false, routes, authGlobalMiddleware, issues };
    }
    // 全局认证中间件：app.use(authFn)
    const useRe = /\.use\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
    let m;
    while ((m = useRe.exec(code)) !== null) {
        if (isAuthFnName(m[1]))
            authGlobalMiddleware.push(m[1]);
    }
    // 路由注册：router.post('/x', mw1, mw2, handler) / .del()
    // 接收者限定 router/*Router/app——config.get('secret') 之类不再被当路由
    const routeRe = /\b(?:router|[A-Za-z_$][\w$]*[Rr]outer|app)\s*\.(get|post|put|patch|delete|del)\s*\(\s*['"]([^'"]+)['"]/g;
    while ((m = routeRe.exec(code)) !== null) {
        const method = m[1].toLowerCase() === "del" ? "delete" : m[1].toLowerCase();
        const pathName = m[2];
        // 认证名收集窗口 = 本次路由调用（自路径串后至本调用闭合括号），
        // 不跨路由边界——修复 300 字符前向窗口跨路由串扰（bleed）缺陷：
        // 后面路由的 auth 名不再把前面的公开路由洗成 protected
        const window = (0, route_window_1.routeCallWindow)(code, m.index + m[0].length);
        // koa-router 语义：(path, ...middleware, handler)——末参 handler 由
        // middlewareNamesFromWindow 排除，handler 名（如 ctrl.login）不再误判
        const mwNames = (0, route_window_1.middlewareNamesFromWindow)(window);
        const hasAuthMw = mwNames.some((name) => isAuthFnName(name));
        routes.push({
            method,
            path: pathName,
            protected: hasAuthMw,
            line: code.slice(0, m.index).split("\n").length,
        });
    }
    // register 集合豁免（语义层）：同文件存在 <path>/login|register|signup…
    // 姊妹路由 ⇒ <path> 是账户集合，其无认证 POST = 公开注册（realworld
    // 惯用 POST /users 而非 /register——路径豁免词表认不出，Koa 语料
    // 1/1 register FP 的根因）。有 login 佐证才豁免：管理员建用户类
    // 端点（无姊妹 login）仍会报
    const registerRoots = (0, route_window_1.collectRegisterRoots)(routes.map((r) => r.path));
    for (const r of routes) {
        if (MUTATION_METHODS.has(r.method) && !r.protected
            && authGlobalMiddleware.length === 0
            && !isAuthEntryPath(r.path)
            && !(r.method === "post" && (0, route_window_1.isRegisterRoot)(r.path, registerRoots))) {
            issues.push({
                severity: "medium",
                rule: "KOA_ROUTE_NO_AUTH",
                message: `Route ${r.method.toUpperCase()} ${r.path} has no auth middleware ` +
                    `and the app registers no auth middleware — any caller can reach it.`,
                route: `${r.method.toUpperCase()} ${r.path}`,
                line: r.line,
            });
        }
    }
    return { hasKoa: true, routes, authGlobalMiddleware, issues };
}
function analyzeKoaFile(filePath) {
    if (!fs.existsSync(filePath))
        return null;
    const code = fs.readFileSync(filePath, "utf-8");
    if (!/from\s+['"]koa|require\(['"]koa/.test(code))
        return null;
    return analyzeKoaApp(code);
}
