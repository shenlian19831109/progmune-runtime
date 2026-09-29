"use strict";
/**
 * NestJS Framework Adapter Spike — Decorator-based Protocol Detection
 *
 * Parses NestJS decorators (@Controller, @Get/@Post/@Put/@Delete,
 * @UseGuards, @UsePipes, @UseInterceptors) using ts-morph to determine
 * the protocol compliance of each route.
 *
 * Unlike Express middleware (which requires inference from function names),
 * NestJS decorators explicitly declare intent:
 *   @UseGuards(AuthGuard)      → authorization step
 *   @UsePipes(ValidationPipe)  → input validation step
 *   @UseInterceptors(...)      → pre/post processing
 *
 * This detector extracts routes, determines their auth/validation status,
 * and identifies security gaps (mutation routes without guards, etc.).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeNestJSProject = analyzeNestJSProject;
exports.analyzeNestJSFile = analyzeNestJSFile;
exports.formatNestJSReport = formatNestJSReport;
const ts_morph_1 = require("ts-morph");
const route_window_1 = require("./route-window");
const extract_ir_1 = require("../extract-ir");
// ── Core Analysis ──
function analyzeNestJSProject(projectRoot) {
    let project;
    try {
        project = new ts_morph_1.Project({
            tsConfigFilePath: `${projectRoot}/tsconfig.json`,
            skipAddingFilesFromTsConfig: false,
        });
    }
    catch {
        // No tsconfig — try direct file loading
        project = new ts_morph_1.Project();
        try {
            project.addSourceFilesAtPaths(`${projectRoot}/**/*.ts`);
        }
        catch {
            return { controllers: [], routes: [], issues: [], globalAuthGuards: [] };
        }
    }
    const analysis = {
        controllers: [],
        routes: [],
        issues: [],
        globalAuthGuards: [],
    };
    // ── 第一遍：全局守卫（@Module providers 里的 APP_GUARD）──
    for (const file of project.getSourceFiles()) {
        if (file.getFilePath().includes("node_modules"))
            continue;
        if (/\.(test|spec)\.ts$/.test(file.getFilePath()))
            continue;
        for (const cls of file.getClasses()) {
            const moduleDec = cls.getDecorator("Module");
            if (!moduleDec)
                continue;
            const guardNames = extractAppGuardNames(moduleDec, cls);
            for (const name of guardNames) {
                if (isAuthGuardName(name) && !analysis.globalAuthGuards.includes(name)) {
                    analysis.globalAuthGuards.push(name);
                }
            }
        }
    }
    const hasGlobalAuthGuard = analysis.globalAuthGuards.length > 0;
    // ── 全局校验管道（2026-09-29：docmost 123 条 NO_VALIDATION 失明误报的根因）──
    // NestJS 标准做法是 bootstrap 里 app.useGlobalPipes(new ValidationPipe(...))，
    // 路由本身不带 @UsePipes 装饰器 ⇒ 此前全部报 NO_VALIDATION。
    // 检测方式：任意非 node_modules 源文件出现 .useGlobalPipes( 调用（参数不限——
    // hedgedoc 形态是 useGlobalPipes(setupValidationPipe(logger))，管道经辅助函数
    // 创建，字面 ValidationPipe 不在调用处）。
    // 保守判定：全局管道只豁免「入参是已校验 DTO」的路由（见下），裸类型入参仍报。
    let hasGlobalValidationPipe = false;
    for (const file of project.getSourceFiles()) {
        if (file.getFilePath().includes("node_modules"))
            continue;
        if (/\.(test|spec)\.ts$/.test(file.getFilePath()))
            continue;
        if (/\.useGlobalPipes\s*\(/.test(file.getText())) {
            hasGlobalValidationPipe = true;
            break;
        }
    }
    // ── 已校验 DTO 类名集合（E3 通道同款实现，import 落地代码而非重写）──
    const validatedDtos = hasGlobalValidationPipe
        ? (0, extract_ir_1.validatedDtoClassNames)(project)
        : new Set();
    // ── 继承闭包（2026-09-29 docmost 实测：RemoveFavoriteDto extends AddFavoriteDto）──
    // E3 集合只收「类自身带校验装饰器」的类，继承来的装饰器看不到。
    // 只扩 detector 侧集合，不动 E3 函数（后者影响 safeguard 盲测基线）。
    for (const file of project.getSourceFiles()) {
        if (file.getFilePath().includes("node_modules"))
            continue;
        for (const cls of file.getClasses()) {
            let base = cls.getBaseClass();
            while (base) {
                const baseName = base.getName();
                if (baseName && validatedDtos.has(baseName)) {
                    const clsName = cls.getName();
                    if (clsName)
                        validatedDtos.add(clsName);
                    break;
                }
                base = base.getBaseClass();
            }
        }
    }
    // ── Zod 形态扩展（2026-09-29 hedgedoc 实测）──
    // class LoginDto extends createZodDto(LoginSchema) {} —— nestjs-zod 的校验
    // 体系不产 class-validator 装饰器，E3 通道看不见。extends 表达式文本
    // 含 createZodDto( 即视为已校验 DTO。同样只扩 detector 侧集合。
    for (const file of project.getSourceFiles()) {
        if (file.getFilePath().includes("node_modules"))
            continue;
        for (const cls of file.getClasses()) {
            const ext = cls.getExtends();
            if (!ext)
                continue;
            if (/createZodDto\s*\(/.test(ext.getText())) {
                const clsName = cls.getName();
                if (clsName)
                    validatedDtos.add(clsName);
            }
        }
    }
    // ── 第二遍：模块级中间件保护（Nest 5 时代惯用法）──
    // class XxxModule implements NestModule { configure(consumer) {
    //   consumer.apply(AuthMiddleware).forRoutes({path, method}, ...) } }
    // 覆盖关系：controller → [{path, methods}]（REALWORLD_STRUCTURAL_V1：
    // guard 单一模型漏掉 configure/forRoutes 中间件保护 → 23 issues 全 FP）
    const ctrlMiddleware = new Map();
    for (const file of project.getSourceFiles()) {
        if (file.getFilePath().includes("node_modules"))
            continue;
        for (const cls of file.getClasses()) {
            const moduleDec = cls.getDecorator("Module");
            if (!moduleDec)
                continue;
            const configure = cls.getMethods().find((mm) => mm.getName() === "configure");
            if (!configure)
                continue;
            const coverage = extractMiddlewareForRoutes(configure.getText());
            if (coverage.length === 0)
                continue;
            // 该模块声明管哪些 controller
            const ctrlNames = extractModuleControllerNames(moduleDec);
            for (const c of ctrlNames) {
                const merged = ctrlMiddleware.get(c) || [];
                merged.push(...coverage);
                ctrlMiddleware.set(c, merged);
            }
        }
    }
    // ── register 集合豁免预扫（语义层）──
    // 项目级收集账户入口路由（*\/login|register|signup…）→ 集合根
    // （/users/login → /users）；该集合的 POST = 公开注册（realworld 惯用
    // POST /users——register FP 跨框架根因）。POST-only：同集合的 PUT 等
    // 不豁免；无 login 姊妹佐证的写集合（管理员建用户）仍查
    const allRoutePaths = [];
    for (const file of project.getSourceFiles()) {
        if (file.getFilePath().includes("node_modules"))
            continue;
        if (/\.(test|spec)\.ts$/.test(file.getFilePath()))
            continue;
        for (const cls of file.getClasses()) {
            const ctrlDec = cls.getDecorator("Controller");
            if (!ctrlDec)
                continue;
            const basePath = getStringArg(ctrlDec, 0) || "";
            for (const method of cls.getMethods()) {
                const http = getHttpMethod(method);
                if (!http)
                    continue;
                const routePath = getStringArg(method.getDecorators().find((d) => isHttpDecorator(d)), 0) || "";
                allRoutePaths.push(basePath + (routePath.startsWith("/") ? routePath : `/${routePath}`));
            }
        }
    }
    const registerRoots = (0, route_window_1.collectRegisterRoots)(allRoutePaths);
    for (const file of project.getSourceFiles()) {
        // Skip node_modules and test files
        if (file.getFilePath().includes("node_modules"))
            continue;
        if (/\.(test|spec)\.ts$/.test(file.getFilePath()))
            continue;
        for (const cls of file.getClasses()) {
            const ctrlDec = cls.getDecorator("Controller");
            if (!ctrlDec)
                continue;
            const controllerName = cls.getName() || "UnknownController";
            analysis.controllers.push(controllerName);
            const basePath = getStringArg(ctrlDec, 0) || "";
            const classGuards = extractGuardNames(cls.getDecorator("UseGuards"));
            const classPipes = extractGuardNames(cls.getDecorator("UsePipes"));
            const classPublic = cls.getDecorator("Public") !== undefined
                || cls.getDecorator("SkipAuth") !== undefined
                || cls.getDecorator("AllowAnon") !== undefined;
            for (const method of cls.getMethods()) {
                const httpMethod = getHttpMethod(method);
                if (!httpMethod)
                    continue;
                const routePath = getStringArg(method.getDecorators().find(d => isHttpDecorator(d)), 0) || "";
                const fullPath = basePath + (routePath.startsWith("/") ? routePath : `/${routePath}`);
                // Guards/Pipes: method-level overrides class-level
                const methodGuards = extractGuardNames(method.getDecorator("UseGuards"));
                const methodPipes = extractGuardNames(method.getDecorator("UsePipes"));
                const guards = methodGuards.length > 0 ? methodGuards : classGuards;
                const pipes = methodPipes.length > 0 ? methodPipes : classPipes;
                const isPublicDecorated = classPublic
                    || method.getDecorator("Public") !== undefined
                    || method.getDecorator("SkipAuth") !== undefined
                    || method.getDecorator("AllowAnon") !== undefined;
                // 认证守卫 = 认证名分类后的守卫（ThrottlerGuard 等限流守卫不算认证）
                const authGuards = guards.filter(isAuthGuardName);
                // 入参是否指向已校验 DTO：@Body()/@Query()/@Param() 参数的
                // 类型名 ∈ class-validator 装饰类集合（E3 通道语义）。
                // ts-morph 的类型文本会带 import 前缀：import(".../page.dto").PageInfoDto
                // 或泛型 Selectable<import("...").Users> —— 取全部标识符，
                // 任一命中已校验 DTO 集合即豁免（联合类型/裸类型/数组皆可对上；
                // db 类型 Users 等不在集合，不会误豁免）。
                const hasValidatedDto = method.getParameters().some((param) => {
                    const decNames = param.getDecorators().map((d) => d.getName());
                    if (!decNames.some((n) => ["Body", "Query", "Param"].includes(n)))
                        return false;
                    const typeText = param.getType().getText();
                    const ids = typeText.match(/[A-Za-z_$][\w$]*/g) || [];
                    return ids.some((id) => validatedDtos.has(id));
                });
                // 无结构化输入：入参没有 @Body/@Query/@Param——只有 AuthUser/Req/Res/
                // UploadedFile 等上下文注入或文件对象（2026-09-29 docmost 实测：
                // auth/collab-token、auth/logout 等无 body 路由被误报 NO_VALIDATION）。
                // 没有可校验的 DTO 输入，规则判定面不覆盖，不报。
                const hasStructuredInput = method.getParameters().some((param) => param.getDecorators().some((d) => ["Body", "Query", "Param"].includes(d.getName())));
                const route = {
                    method: httpMethod,
                    path: fullPath,
                    controller: controllerName,
                    handler: method.getName() || "unknown",
                    hasAuthGuard: authGuards.length > 0,
                    hasValidationPipe: pipes.length > 0,
                    hasValidatedDto,
                    guards,
                    pipes,
                    isPublicDecorated,
                };
                analysis.routes.push(route);
                // 路由级保护判定：类/方法认证守卫，或全局 APP_GUARD（除非 @Public 豁免），
                // 或模块级中间件 forRoutes 覆盖（Nest 5 惯用法）
                const protectedByGlobal = hasGlobalAuthGuard && !isPublicDecorated;
                const protectedByMiddleware = middlewareCovers(ctrlMiddleware, controllerName, httpMethod, fullPath);
                // ── Security Checks ──
                // POST/PUT/DELETE without auth guard
                // Skip intentionally public routes (login, register, health, etc.)
                if (["POST", "PUT", "DELETE", "PATCH"].includes(httpMethod) && !isPublicRoute(fullPath)) {
                    const isRegisterPost = httpMethod === "POST" && (0, route_window_1.isRegisterRoot)(fullPath, registerRoots);
                    if (!route.hasAuthGuard && !protectedByGlobal && !protectedByMiddleware && !isRegisterPost) {
                        analysis.issues.push({
                            type: "NESTJS_NO_AUTH",
                            severity: "critical",
                            route: `${httpMethod} ${fullPath}`,
                            controller: controllerName,
                            message: `Mutation route ${httpMethod} ${fullPath} has no auth guard and ` +
                                (hasGlobalAuthGuard
                                    ? `is explicitly marked public — it bypasses the global ${analysis.globalAuthGuards.join("/")}.`
                                    : `no global APP_GUARD protects the app. Anyone can call it.`),
                            fix: `Add @UseGuards(AuthGuard) to the method or controller class, or remove the @Public marker.`,
                        });
                    }
                    // 豁免：@UsePipes 装饰器，或「全局 ValidationPipe + 入参是已校验 DTO」
                    // （docmost 实测 123 条失明误报的修复——路由 DTO 在别的文件带
                    // class-validator 装饰器，只看 @UsePipes 永远看不到），
                    // 或路由无结构化输入（没有可校验的东西）
                    const validatedByGlobalPipe = hasGlobalValidationPipe && route.hasValidatedDto;
                    if (!route.hasValidationPipe && !validatedByGlobalPipe && hasStructuredInput) {
                        analysis.issues.push({
                            type: "NESTJS_NO_VALIDATION",
                            severity: "medium",
                            route: `${httpMethod} ${fullPath}`,
                            controller: controllerName,
                            message: `Mutation route ${httpMethod} ${fullPath} has no @UsePipes for input validation.`,
                            fix: `Add @UsePipes(ValidationPipe) or a DTO class to validate input.`,
                        });
                    }
                }
                // Sensitive GET routes without auth
                if (httpMethod === "GET") {
                    const sensitiveTerms = ["admin", "private", "secret", "manage"];
                    if (sensitiveTerms.some(t => fullPath.toLowerCase().includes(t))
                        && !route.hasAuthGuard && !protectedByGlobal && !protectedByMiddleware) {
                        analysis.issues.push({
                            type: "NESTJS_SENSITIVE_PUBLIC",
                            severity: "high",
                            route: `${httpMethod} ${fullPath}`,
                            controller: controllerName,
                            message: `Sensitive GET route ${fullPath} is publicly accessible without auth protection.`,
                            fix: `Add @UseGuards(AuthGuard) to protect this route.`,
                        });
                    }
                }
            }
        }
    }
    return analysis;
}
// ── Helpers ──
/**
 * 守卫名认证分类：auth/jwt/session/permission/role/access 等为认证守卫；
 * throttler/rate/logger 等非认证守卫不算（限流≠认证——实测误报源）。
 */
function isAuthGuardName(name) {
    const lower = name.toLowerCase();
    if (/throttler|rate.?limit|logger|logging|cache/.test(lower))
        return false;
    return /auth|jwt|session|permission|role|access|apikey|api_key|token|login|passport/.test(lower);
}
/**
 * 从 @Module 装饰器的 providers 提取 APP_GUARD 类名：
 *   providers: [{ provide: APP_GUARD, useClass: AuthGuard }]
 * 支持装饰器参数对象字面量与类属性 providers 两种形态。
 */
function extractAppGuardNames(moduleDec, cls) {
    const names = [];
    const scanProviders = (arg) => {
        if (!arg)
            return;
        // @Module({ providers: [...] })
        const obj = arg.asKind(ts_morph_1.SyntaxKind.ObjectLiteralExpression);
        if (obj) {
            const providersProp = obj.getProperty("providers");
            if (providersProp) {
                const initializer = providersProp.getInitializer?.();
                if (initializer && initializer.asKind(ts_morph_1.SyntaxKind.ArrayLiteralExpression)) {
                    for (const el of initializer.getElements()) {
                        const elObj = el.asKind(ts_morph_1.SyntaxKind.ObjectLiteralExpression);
                        if (!elObj)
                            continue;
                        const provideProp = elObj.getProperty("provide");
                        const useClassProp = elObj.getProperty("useClass");
                        const provideName = provideProp?.getInitializer?.()?.getText?.();
                        const useClassName = useClassProp?.getInitializer?.()?.getText?.();
                        if (provideName === "APP_GUARD" && useClassName) {
                            names.push(useClassName);
                        }
                    }
                }
            }
        }
    };
    // 装饰器参数形态
    const decArg = moduleDec.getArguments()[0];
    scanProviders(decArg);
    // 类属性形态：providers = [...]
    for (const prop of cls.getProperties()) {
        if (prop.getName() === "providers") {
            scanProviders(prop.getInitializer());
        }
    }
    return names;
}
// ── 模块级中间件覆盖（Nest 5 configure/forRoutes 惯用法）──
/** 从 configure(consumer) 方法文本提取 forRoutes 覆盖：{path, methods[]} */
function extractMiddlewareForRoutes(configureText) {
    const out = [];
    // consumer.apply(X).forRoutes({...}, {...}) / .forRoutes('path', ...)
    const frIndexes = [];
    let idx = 0;
    while ((idx = configureText.indexOf(".forRoutes(", idx)) !== -1) {
        frIndexes.push(idx + ".forRoutes(".length);
        idx += ".forRoutes(".length;
    }
    for (const start of frIndexes) {
        // 括号平衡取 forRoutes 参数块
        let depth = 1;
        let end = start;
        while (end < configureText.length && depth > 0) {
            if (configureText[end] === "(")
                depth++;
            else if (configureText[end] === ")")
                depth--;
            end++;
        }
        const argsText = configureText.slice(start, end - 1);
        // 逐顶层参数（逗号切分，深度感知）
        const args = [];
        let cur = "";
        let d = 0;
        for (const ch of argsText) {
            if (ch === "(" || ch === "[" || ch === "{")
                d++;
            else if (ch === ")" || ch === "]" || ch === "}")
                d--;
            if (ch === "," && d === 0) {
                args.push(cur);
                cur = "";
            }
            else
                cur += ch;
        }
        if (cur.trim())
            args.push(cur);
        for (const arg of args) {
            const trimmed = arg.trim();
            const pathM = trimmed.match(/path\s*:\s*['"]([^'"]+)['"]/);
            const methodM = trimmed.match(/method\s*:\s*RequestMethod\.(\w+)/);
            const plain = trimmed.match(/^['"]([^'"]+)['"]$/);
            const path = pathM ? pathM[1] : plain ? plain[1] : null;
            if (!path)
                continue;
            const method = methodM ? methodM[1] : "*";
            out.push({ path, methods: [method] });
        }
    }
    return out;
}
/** @Module({ controllers: [A, B] }) 里的控制器类名 */
function extractModuleControllerNames(moduleDec) {
    const out = [];
    const text = moduleDec.getText();
    const m = text.match(/controllers\s*:\s*\[([^\]]*)\]/);
    if (!m)
        return out;
    for (const name of m[1].split(",")) {
        const n = name.trim().replace(/\s+as\s+\w+$/, "").split(".").pop();
        if (n && /^[A-Za-z_$]/.test(n))
            out.push(n);
    }
    return out;
}
/** route（method, fullPath）是否被 controller 的模块中间件覆盖 */
function middlewareCovers(ctrlMiddleware, controllerName, httpMethod, fullPath) {
    const entries = ctrlMiddleware.get(controllerName);
    if (!entries || entries.length === 0)
        return false;
    const norm = (p) => p.replace(/^\/+|\/+$/g, "");
    const routePath = norm(fullPath);
    return entries.some((e) => {
        const em = e.methods[0] || "*";
        // RequestMethod.ALL 与通配 * 匹配任意方法
        if (em !== "*" && em !== "ALL" && em !== httpMethod)
            return false;
        return norm(e.path) === routePath;
    });
}
/** Check if a route is intentionally public (login, register, health, etc.). */
function isPublicRoute(path) {
    // Normalize: ensure leading slash for consistent matching
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const publicPatterns = [
        /\/auth\/login$/i, /\/login$/i,
        /\/auth\/register$/i, /\/register$/i, /\/signup$/i,
        /\/auth\/signup$/i, /\/auth\/signin$/i, /\/signin$/i,
        /\/auth\/refresh$/i, /\/auth\/forgot/i, /\/auth\/reset/i,
        // auth 流程自身端点（2026-09-29 docmost 实测：auth/setup、
        // auth/password-reset、auth/verify-token 被误报 NO_AUTH——
        // 用户尚未登录，这些端点天生无认证；原 /auth/reset 匹配不了 password-reset）
        /\/auth\/password-reset$/i, /\/auth\/reset-password$/i,
        /\/auth\/verify-token$/i, /\/auth\/verify$/i,
        /\/auth\/setup$/i, /\/auth\/init$/i,
        /\/health$/i, /\/healthcheck$/i, /\/ping$/i, /\/status$/i,
        /\/public\//i, /\/static\//i,
    ];
    return publicPatterns.some(p => p.test(normalized));
}
// ── Low-level Helpers ──
function getHttpMethod(method) {
    for (const dec of method.getDecorators()) {
        const name = dec.getName();
        if (["Get", "Post", "Put", "Delete", "Patch", "Options", "Head", "All"].includes(name)) {
            return name.toUpperCase();
        }
    }
    return null;
}
function isHttpDecorator(dec) {
    return ["Get", "Post", "Put", "Delete", "Patch", "Options", "Head", "All"].includes(dec.getName());
}
function getStringArg(decorator, index) {
    if (!decorator)
        return undefined;
    const args = decorator.getArguments();
    if (args.length <= index)
        return undefined;
    const text = args[index].getText();
    return text.replace(/^['"]|['"]$/g, "");
}
function extractGuardNames(decorator) {
    if (!decorator)
        return [];
    const args = decorator.getArguments();
    const result = [];
    for (const arg of args) {
        const text = arg.getText();
        // Handle: @UseGuards(AuthGuard) or @UseGuards(AuthGuard, AdminGuard)
        const matches = text.match(/\b([A-Z][a-zA-Z0-9]*(?:Guard|Pipe|Interceptor))\b/g);
        if (matches)
            result.push(...matches);
    }
    return result;
}
// ── File-level and Project-level Convenience ──
/**
 * Analyze a single TypeScript file for NestJS controllers.
 */
function analyzeNestJSFile(filePath) {
    const fs = require("fs");
    if (!fs.existsSync(filePath))
        return null;
    const code = fs.readFileSync(filePath, "utf-8");
    // Quick check: does this file look like NestJS?
    if (!/@Controller\b/.test(code) && !/@nestjs\/common/.test(code))
        return null;
    const project = new ts_morph_1.Project();
    try {
        project.addSourceFileAtPath(filePath);
    }
    catch {
        return null;
    }
    // Parse using the same logic as analyzeNestJSProject
    const analysis = {
        controllers: [],
        routes: [],
        issues: [],
        globalAuthGuards: [], // 单文件分析无全局守卫上下文（项目级请用 analyzeNestJSProject）
    };
    for (const file of project.getSourceFiles()) {
        for (const cls of file.getClasses()) {
            const ctrlDec = cls.getDecorator("Controller");
            if (!ctrlDec)
                continue;
            // ... (same parsing logic)
            const controllerName = cls.getName() || "UnknownController";
            analysis.controllers.push(controllerName);
            const basePath = getStringArg(ctrlDec, 0) || "";
            const classGuards = extractGuardNames(cls.getDecorator("UseGuards"));
            const classPipes = extractGuardNames(cls.getDecorator("UsePipes"));
            for (const method of cls.getMethods()) {
                const httpMethod = getHttpMethod(method);
                if (!httpMethod)
                    continue;
                const routePath = getStringArg(method.getDecorators().find(d => isHttpDecorator(d)), 0) || "";
                const fullPath = basePath + (routePath.startsWith("/") ? routePath : `/${routePath}`);
                const methodGuards = extractGuardNames(method.getDecorator("UseGuards"));
                const methodPipes = extractGuardNames(method.getDecorator("UsePipes"));
                const guards = methodGuards.length > 0 ? methodGuards : classGuards;
                const pipes = methodPipes.length > 0 ? methodPipes : classPipes;
                const route = {
                    method: httpMethod,
                    path: fullPath,
                    controller: controllerName,
                    handler: method.getName() || "unknown",
                    hasAuthGuard: guards.filter(isAuthGuardName).length > 0,
                    hasValidationPipe: pipes.length > 0,
                    hasValidatedDto: false, // 单文件分析无跨文件 DTO 上下文（项目级用 analyzeNestJSProject）
                    guards,
                    pipes,
                    isPublicDecorated: false, // 单文件分析不解析 @Public（项目级用 analyzeNestJSProject）
                };
                analysis.routes.push(route);
                // Security checks
                if (["POST", "PUT", "DELETE", "PATCH"].includes(httpMethod) && !isPublicRoute(fullPath)) {
                    if (!route.hasAuthGuard) {
                        analysis.issues.push({
                            type: "NESTJS_NO_AUTH",
                            severity: "critical",
                            route: `${httpMethod} ${fullPath}`,
                            controller: controllerName,
                            message: `Mutation route ${httpMethod} ${fullPath} has no @UseGuards. Anyone can call it.`,
                            fix: `Add @UseGuards(AuthGuard) to the method or controller class.`,
                        });
                    }
                    if (!route.hasValidationPipe) {
                        analysis.issues.push({
                            type: "NESTJS_NO_VALIDATION",
                            severity: "medium",
                            route: `${httpMethod} ${fullPath}`,
                            controller: controllerName,
                            message: `Mutation route ${httpMethod} ${fullPath} has no @UsePipes for input validation.`,
                            fix: `Add @UsePipes(ValidationPipe) or a DTO class to validate input.`,
                        });
                    }
                }
                if (httpMethod === "GET") {
                    const sensitiveTerms = ["admin", "private", "secret", "manage"];
                    if (sensitiveTerms.some(t => fullPath.toLowerCase().includes(t)) && !route.hasAuthGuard) {
                        analysis.issues.push({
                            type: "NESTJS_SENSITIVE_PUBLIC",
                            severity: "high",
                            route: `${httpMethod} ${fullPath}`,
                            controller: controllerName,
                            message: `Sensitive GET route ${fullPath} is publicly accessible without @UseGuards.`,
                            fix: `Add @UseGuards(AuthGuard) to protect this route.`,
                        });
                    }
                }
            }
        }
    }
    return analysis;
}
/**
 * Format a summary report for CLI output.
 */
function formatNestJSReport(analysis) {
    if (analysis.controllers.length === 0) {
        return "Not a NestJS project (no @Controller classes found).";
    }
    const lines = [
        `Controllers: ${analysis.controllers.length}`,
        `Routes: ${analysis.routes.length}`,
        `Issues: ${analysis.issues.length}`,
        "",
    ];
    if (analysis.issues.length === 0) {
        lines.push("✅ No NestJS security issues detected.");
        return lines.join("\n");
    }
    for (const issue of analysis.issues) {
        const emoji = issue.severity === "critical" ? "🔴" : issue.severity === "high" ? "🟠" : "🟡";
        lines.push(`${emoji} [${issue.type}] ${issue.route}`);
        lines.push(`   ${issue.message}`);
        lines.push(`   Fix: ${issue.fix}`);
        lines.push("");
    }
    return lines.join("\n");
}
