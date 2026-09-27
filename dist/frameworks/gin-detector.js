"use strict";
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
exports.analyzeGinApp = analyzeGinApp;
exports.analyzeGinFile = analyzeGinFile;
exports.ginFuncStarts = ginFuncStarts;
exports.ginProtectedRegisterFns = ginProtectedRegisterFns;
exports.ginEnclosingFunc = ginEnclosingFunc;
exports.analyzeGinProject = analyzeGinProject;
const fs = __importStar(require("fs"));
const route_window_1 = require("./route-window");
const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);
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
    // 注意：不含 "middleware" 词——loggerMiddleware 等工具中间件不该撞认证
    // （authMiddleware 类靠 "auth" 命中）
    return AUTH_FN_WORDS.some((w) => lower.includes(w));
}
// ── Analysis（代码串级） ──
function analyzeGinApp(code) {
    const issues = [];
    const routes = [];
    const authGroupMiddleware = [];
    const hasGin = /gin\.(Default|New)\(|"github.com\/gin-gonic\/gin"/.test(code);
    if (!hasGin) {
        return { hasGin: false, routes, authGroupMiddleware, issues };
    }
    // 组级认证中间件：r.Use(authMW) / r.Group("/api", authMW) / g.Use(authMW)
    // 捕获支持点限定成员（users.AuthMiddleware）——修复旧版只捕限定符
    // "users" 的缺陷（V7）。整名送词表判定（AuthMiddleware 含 auth ✓）
    const useRe = /\.Use\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
    let m;
    while ((m = useRe.exec(code)) !== null) {
        if (isAuthFnName(m[1]))
            authGroupMiddleware.push(m[1]);
    }
    const groupRe = /\.Group\s*\(\s*"[^"]*"\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
    while ((m = groupRe.exec(code)) !== null) {
        if (isAuthFnName(m[1]))
            authGroupMiddleware.push(m[1]);
    }
    // 路由注册：r.POST("/x", mw1, mw2, handler)——Go 方法名大写（POST 惯例）
    // 空路径 "..." 允许（realworld 惯用 POST("", ...) 双注册）
    const routeRe = /\.(get|post|put|patch|delete)\s*\(\s*"([^"]*)"(\s*,\s*|\s*\))/gi;
    while ((m = routeRe.exec(code)) !== null) {
        const method = m[1].toLowerCase();
        const pathName = m[2];
        // 认证窗口 = 本次调用边界内（括号感知），不跨路由（V7 缺陷修复）
        const window = (0, route_window_1.routeCallWindow)(code, m.index + m[0].length);
        const mwNames = (0, route_window_1.middlewareNamesFromWindow)(window);
        const hasAuthMw = mwNames.some((name) => isAuthFnName(name));
        routes.push({
            method,
            path: pathName,
            protected: hasAuthMw,
            line: code.slice(0, m.index).split("\n").length,
        });
    }
    // register 集合豁免（语义层，同 Koa）：有 <path>/login 姊妹佐证的
    // 账户集合，其无认证 POST = 公开注册（gin realworld 用 POST "" /
    // "/" + /login 双注册——路径豁免词表认不出）
    const registerRoots = (0, route_window_1.collectRegisterRoots)(routes.map((r) => r.path));
    for (const r of routes) {
        if (MUTATION_METHODS.has(r.method) && !r.protected
            && authGroupMiddleware.length === 0
            && !isAuthEntryPath(r.path)
            && !(r.method === "post" && (0, route_window_1.isRegisterRoot)(r.path, registerRoots))) {
            issues.push({
                severity: "medium",
                rule: "GIN_ROUTE_NO_AUTH",
                message: `Route ${r.method.toUpperCase()} ${r.path} has no auth middleware ` +
                    `and no auth Use/Group middleware — any caller can reach it.`,
                route: `${r.method.toUpperCase()} ${r.path}`,
                line: r.line,
            });
        }
    }
    return { hasGin: true, routes, authGroupMiddleware, issues };
}
function analyzeGinFile(filePath) {
    if (!fs.existsSync(filePath))
        return null;
    const code = fs.readFileSync(filePath, "utf-8");
    if (!/gin-gonic|gin\.(Default|New)\(/.test(code))
        return null;
    return analyzeGinApp(code);
}
/** 顶层函数头（行号 1-based）——排除接收者方法（method receiver） */
function ginFuncStarts(text) {
    const out = [];
    const re = /^func\s+([A-Za-z_]\w*)\s*\(/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push({ name: m[1], line: text.slice(0, m.index).split("\n").length });
    }
    return out;
}
/**
 * 从 bootstrap 文本（含 gin.Default/New 的文件）推导：
 * 哪些 Register 函数在「组已施加认证 Use 之后」被调用（其路由受保护）。
 * 语句顺序敏感：Use 之前注册的（register/login）不算。
 */
function ginProtectedRegisterFns(bootstrapText) {
    const state = new Map(); // 组变量 → 已认证
    const protectedFns = new Map();
    const re = /(\w+)\s*(?::=|=)\s*gin\.(Default|New)\s*\(|(\w+)\.Use\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\s*\(\s*(true|false))?|(\w+)\s*(?::=|=)\s*(?:[\w.]*\.)?([A-Za-z_]\w*)\.Group\s*\(|(?:[\w.]*\.)?([A-Z][A-Za-z0-9_]*)\s*\(\s*(?:[\w.]*\.)?([A-Za-z_]\w*)\.Group\s*\(/g;
    let m;
    // 组编号（按开括号序）：1,2 根组 | 3,4,5 Use | 6,7 子组 | 8,9 注册调用
    while ((m = re.exec(bootstrapText)) !== null) {
        if (m[1] !== undefined) {
            state.set(m[1], false); // 根组：gin.Default/New
        }
        else if (m[3] !== undefined) {
            // 组.Use(认证)；首参字面 false = 可选认证（public 读通行）不视为
            // 保护——否则删掉 required Use 后 mutations 仍被可选 Use 掩盖（FN）
            if (isAuthFnName(m[4]) && m[5] !== "false")
                state.set(m[3], true);
        }
        else if (m[6] !== undefined) {
            state.set(m[6], !!state.get(m[7])); // 子组继承父组状态
        }
        else if (m[8] !== undefined) {
            if (state.get(m[9]))
                protectedFns.set(m[8], true); // 认证相位调用的 Register fn
        }
    }
    return protectedFns;
}
/** routeLine 所在顶层函数名（按 func 头归属） */
function ginEnclosingFunc(text, routeLine) {
    let name = null;
    for (const f of ginFuncStarts(text)) {
        if (f.line <= routeLine)
            name = f.name;
        else
            break;
    }
    return name;
}
/** 项目级分析：跨文件组认证传播 + 文件级判定兜底 */
function analyzeGinProject(projectRoot) {
    const files = [];
    // 简易 walk（.go，跳过 _test/vendor/node_modules）
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) {
                if (["vendor", "node_modules", ".git"].includes(e.name))
                    continue;
                walk(`${d}/${e.name}`);
            }
            else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) {
                const fp = `${d}/${e.name}`;
                try {
                    files.push({ file: fp, text: fs.readFileSync(fp, "utf-8"), a: analyzeGinFile(fp) });
                }
                catch { /* skip unreadable */ }
            }
        }
    };
    if (fs.existsSync(projectRoot))
        walk(projectRoot.replace(/\/$/, ""));
    // bootstrap：含 gin.Default/gin.New 的文件（组认证相位在此推导）
    const bootstrap = files.find((f) => /gin\.(Default|New)\s*\(/.test(f.text));
    const protectedFns = bootstrap
        ? ginProtectedRegisterFns(bootstrap.text)
        : new Map();
    const issues = [];
    for (const { file, text, a } of files) {
        if (!a || a.issues.length === 0)
            continue;
        for (const issue of a.issues) {
            const fn = issue.line ? ginEnclosingFunc(text, issue.line) : null;
            if (fn && protectedFns.get(fn))
                continue; // 认证相位注册 → 受保护
            issues.push({ ...issue, route: issue.route });
        }
    }
    return {
        filesScanned: files.length,
        protectedFunctions: [...protectedFns.keys()].filter((k) => protectedFns.get(k)),
        issues,
    };
}
