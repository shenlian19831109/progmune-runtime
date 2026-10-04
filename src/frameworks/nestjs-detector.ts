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

import {
  Project,
  ClassDeclaration,
  MethodDeclaration,
  Decorator,
  SyntaxKind,
  Expression,
} from "ts-morph";
import { collectRegisterRoots, isRegisterRoot } from "./route-window";
import { validatedDtoClassNames } from "../extract-ir";

// ── Types ──

export interface NestJSRoute {
  method: string;
  path: string;
  controller: string;
  handler: string;
  hasAuthGuard: boolean;
  hasValidationPipe: boolean;
  /** 入参类型 ∈ 已校验 DTO 集合（class-validator 装饰器在别的文件——跨文件校验证据） */
  hasValidatedDto: boolean;
  /** 存在 @Body/@Query/@Param 结构化入参（没有则无可校验对象，规则判定面不覆盖） */
  hasStructuredInput: boolean;
  guards: string[];
  pipes: string[];
  /** @Public()/@SkipAuth() 标记（配合全局守卫的公开路由豁免） */
  isPublicDecorated: boolean;
}

export interface NestJSSecurityIssue {
  type: "NESTJS_NO_AUTH" | "NESTJS_NO_VALIDATION" | "NESTJS_SENSITIVE_PUBLIC";
  severity: "critical" | "high" | "medium";
  route: string;
  controller: string;
  message: string;
  fix: string;
}

// ── App-level provider 注册事件（§52，2026-10-03）──
//
// 原则：**校验管道 / 认证守卫是否生效，取决于「有没有注册事件」，
// 而不是被注册物的类名长什么样、写在哪个文件的哪一层的哪个数组里。**
//
// 3.7.55 的刀 1 学到的是两种「写法」：`app.useGlobalPipes(new ValidationPipe())`
// 与 `class XxxDto extends createZodDto(...)`。immich 用第三种 ——
// `{ provide: APP_PIPE, useClass: ZodValidationPipe }` 写在顶层 `const commonMiddleware = [...]`
// 里，再经 `...commonMiddleware` spread 进 `@Module({ providers })` ——
// 于是 153 条 NO_VALIDATION 误报。这是典型的 in-sample 失败：不是随机变差，
// 而是**恰好倒在没见过的第三种注册途径上**。
//
// Nest 官方文档里全局管道只有两条注册途径：bootstrap 的 `useGlobalPipes()`
// 与 DI 的 `APP_PIPE` provider。后者**不必**直接写在 @Module 装饰器里 ⇒
// 必须沿标识符回溯到数组定义，而不是只看装饰器那一层。

export type AppLevelProviderToken =
  | "APP_PIPE" | "APP_GUARD" | "APP_INTERCEPTOR" | "APP_FILTER";

export interface AppLevelProviderRegistration {
  token: AppLevelProviderToken;
  /** useClass / useFactory / useValue 的实现名（取不到为 null） */
  impl: string | null;
  /** 注册事件的发现途径（用于复核「为什么说它生效了」） */
  source: "module-decorator" | "module-property" | "array-literal" | "text-fallback";
  /** spread 引用链，如 `commonMiddleware` ← `apiMiddleware` */
  via: string[];
  file: string;
  line: number;
}

export interface NestJSAnalysis {
  controllers: string[];
  routes: NestJSRoute[];
  issues: NestJSSecurityIssue[];
  /** 全局认证守卫（@Module providers 里的 APP_GUARD，认证名分类后） */
  globalAuthGuards: string[];
  /** 全局校验管道的实现名（useGlobalPipes / APP_PIPE 两种注册途径） */
  globalValidationPipes: string[];
  /** 全部 app-level provider 注册事件（含文件行号，可复核） */
  registrations: AppLevelProviderRegistration[];
}

// ── Core Analysis ──

export function analyzeNestJSProject(projectRoot: string): NestJSAnalysis {
  let project: Project;
  try {
    project = new Project({
      tsConfigFilePath: `${projectRoot}/tsconfig.json`,
      skipAddingFilesFromTsConfig: false,
    });
  } catch {
    // No tsconfig — try direct file loading
    project = new Project();
    try {
      project.addSourceFilesAtPaths(`${projectRoot}/**/*.ts`);
    } catch {
      return {
        controllers: [], routes: [], issues: [], globalAuthGuards: [],
        globalValidationPipes: [], registrations: [],
      };
    }
  }

  // 需要跳过 node_modules / 测试文件（它们在多个扫描里重复出现，抽出来一次）
  const sourceFiles = project
    .getSourceFiles()
    .filter(
      (f) =>
        !f.getFilePath().includes("node_modules") &&
        !/\.(test|spec)\.ts$/.test(f.getFilePath())
    );

  // ── 注册事件（§52）：一次性收集全部 app-level provider ──
  const registrations = collectAppLevelProviders(sourceFiles);
  const analysis: NestJSAnalysis = {
    controllers: [],
    routes: [],
    issues: [],
    globalAuthGuards: [],
    globalValidationPipes: registrations
      .filter((r) => r.token === "APP_PIPE")
      .map((r) => r.impl)
      .filter((n): n is string => !!n),
    registrations,
  };

  // 全局认证守卫 = APP_GUARD 注册事件里名字分类为「认证」的那些
  for (const reg of registrations.filter((r) => r.token === "APP_GUARD")) {
    const name = reg.impl;
    if (name && isAuthGuardName(name) && !analysis.globalAuthGuards.includes(name)) {
      analysis.globalAuthGuards.push(name);
    }
  }
  const hasGlobalAuthGuard = analysis.globalAuthGuards.length > 0;

  // ── 全局校验管道（两条官方注册途径：bootstrap useGlobalPipes / DI APP_PIPE）──
  // 注：`useGlobalPipes()` 的参数不限管道类名——hedgedoc 的形态是
  // useGlobalPipes(setupValidationPipe(logger))，管道经辅助函数创建，
  // 字面 ValidationPipe 不在调用处。
  const bootstrapPipeCall = sourceFiles.some((f) =>
    /\.useGlobalPipes\s*\(/.test(f.getText())
  );
  const hasGlobalValidationPipe =
    bootstrapPipeCall || analysis.globalValidationPipes.length > 0;
  if (hasGlobalValidationPipe && bootstrapPipeCall) {
    // bootstrap 途径拿不到实现名（参数可能是任意表达式），留占位便于报告展示
    analysis.globalValidationPipes.push("useGlobalPipes()");
  }

  // ── 已校验 DTO 类名集合（E3 通道同款实现，import 落地代码而非重写）──
  const validatedDtos = hasGlobalValidationPipe
    ? validatedDtoClassNames(project)
    : new Set<string>();

  // ── 继承闭包（2026-09-29 docmost 实测：RemoveFavoriteDto extends AddFavoriteDto）──
  // E3 集合只收「类自身带校验装饰器」的类，继承来的装饰器看不到。
  // 只扩 detector 侧集合，不动 E3 函数（后者影响 safeguard 盲测基线）。
  for (const file of project.getSourceFiles()) {
    if (file.getFilePath().includes("node_modules")) continue;
    for (const cls of file.getClasses()) {
      let base = cls.getBaseClass();
      while (base) {
        const baseName = base.getName();
        if (baseName && validatedDtos.has(baseName)) {
          const clsName = cls.getName();
          if (clsName) validatedDtos.add(clsName);
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
    if (file.getFilePath().includes("node_modules")) continue;
    for (const cls of file.getClasses()) {
      const ext = cls.getExtends();
      if (!ext) continue;
      if (/createZodDto\s*\(/.test(ext.getText())) {
        const clsName = cls.getName();
        if (clsName) validatedDtos.add(clsName);
      }
    }
  }


  // ── 第二遍：模块级中间件保护（Nest 5 时代惯用法）──
  // class XxxModule implements NestModule { configure(consumer) {
  //   consumer.apply(AuthMiddleware).forRoutes({path, method}, ...) } }
  // 覆盖关系：controller → [{path, methods}]（REALWORLD_STRUCTURAL_V1：
  // guard 单一模型漏掉 configure/forRoutes 中间件保护 → 23 issues 全 FP）
  const ctrlMiddleware = new Map<string, Array<{ path: string; methods: string[] }>>();
  for (const file of project.getSourceFiles()) {
    if (file.getFilePath().includes("node_modules")) continue;
    for (const cls of file.getClasses()) {
      const moduleDec = cls.getDecorator("Module");
      if (!moduleDec) continue;
      const configure = cls.getMethods().find((mm) => mm.getName() === "configure");
      if (!configure) continue;
      const coverage = extractMiddlewareForRoutes(configure.getText());
      if (coverage.length === 0) continue;
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
  const allRoutePaths: string[] = [];
  for (const file of project.getSourceFiles()) {
    if (file.getFilePath().includes("node_modules")) continue;
    if (/\.(test|spec)\.ts$/.test(file.getFilePath())) continue;
    for (const cls of file.getClasses()) {
      const ctrlDec = cls.getDecorator("Controller");
      if (!ctrlDec) continue;
      const basePaths = getRoutePaths(ctrlDec);
      for (const method of cls.getMethods()) {
        const httpDec = method.getDecorators().find((d) => isHttpDecorator(d));
        if (!httpDec) continue;
        for (const p of joinRoutePaths(basePaths, getRoutePaths(httpDec))) allRoutePaths.push(p);
      }
    }
  }
  const registerRoots = collectRegisterRoots(allRoutePaths);

  for (const file of project.getSourceFiles()) {
    // Skip node_modules and test files
    if (file.getFilePath().includes("node_modules")) continue;
    if (/\.(test|spec)\.ts$/.test(file.getFilePath())) continue;

    for (const cls of file.getClasses()) {
      const ctrlDec = cls.getDecorator("Controller");
      if (!ctrlDec) continue;

      const controllerName = cls.getName() || "UnknownController";
      analysis.controllers.push(controllerName);

      const basePaths = getRoutePaths(ctrlDec);
      const classGuards = extractGuardNames(cls.getDecorator("UseGuards"));
      const classPipes = extractGuardNames(cls.getDecorator("UsePipes"));
      const classPublic = cls.getDecorator("Public") !== undefined
        || cls.getDecorator("SkipAuth") !== undefined
        || cls.getDecorator("AllowAnon") !== undefined;

      for (const method of cls.getMethods()) {
        const httpMethod = getHttpMethod(method);
        if (!httpMethod) continue;

        // 一条 handler 可以注册多个路径别名 ⇒ 每条路径各自出一条 route、各自判一次
        // （§52：路径畸变会让依赖 path 的判据静默失准，见 getRoutePaths 注释）
        const routePaths = joinRoutePaths(
          basePaths,
          getRoutePaths(method.getDecorators().find(d => isHttpDecorator(d))!)
        );

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
          if (!decNames.some((n) => ["Body", "Query", "Param"].includes(n))) return false;
          const typeText = param.getType().getText();
          const ids = typeText.match(/[A-Za-z_$][\w$]*/g) || [];
          return ids.some((id) => validatedDtos.has(id));
        });

        // 无结构化输入：入参没有 @Body/@Query/@Param——只有 AuthUser/Req/Res/
        // UploadedFile 等上下文注入或文件对象（2026-09-29 docmost 实测：
        // auth/collab-token、auth/logout 等无 body 路由被误报 NO_VALIDATION）。
        // 没有可校验的 DTO 输入，规则判定面不覆盖，不报。
        const hasStructuredInput = method.getParameters().some((param) =>
          param.getDecorators().some((d) =>
            ["Body", "Query", "Param"].includes(d.getName())
          )
        );

        for (const fullPath of routePaths) {
          const route: NestJSRoute = {
            method: httpMethod,
            path: fullPath,
            controller: controllerName,
            handler: method.getName() || "unknown",
            hasAuthGuard: authGuards.length > 0,
            hasValidationPipe: pipes.length > 0,
            hasValidatedDto,
            hasStructuredInput,
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
            const isRegisterPost = httpMethod === "POST" && isRegisterRoot(fullPath, registerRoots);
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
  }

  return analysis;
}

// ── Helpers ──

/**
 * 守卫名认证分类：auth/jwt/session/permission/role/access 等为认证守卫；
 * throttler/rate/logger 等非认证守卫不算（限流≠认证——实测误报源）。
 */
function isAuthGuardName(name: string): boolean {
  const lower = name.toLowerCase();
  if (/throttler|rate.?limit|logger|logging|cache/.test(lower)) return false;
  return /auth|jwt|session|permission|role|access|apikey|api_key|token|login|passport/.test(lower);
}

// ═══════════════════════════════════════════════════════════════
//  §52（2026-10-03）：App-level provider 注册事件收集
// ═══════════════════════════════════════════════════════════════
//
// 三条发现途径，取并集，每条都留 (file, line) 供复核：
//   A. `@Module({ providers: [...] })` 装饰器数组
//   B. `providers = [...]` 类属性
//   C. 任意数组常量 `const xxx = [...]`（含沿 spread 回溯）+ 逐行文本兜底
//
// C 存在的理由正是 immich：
//     const commonMiddleware = [ { provide: APP_PIPE, useClass: ZodValidationPipe }, ... ];
//     const apiMiddleware   = [ FileUploadInterceptor, ...commonMiddleware, {...} ];
//     @Module({ providers: [...common, ...apiMiddleware, ...] })
// `APP_PIPE` 离 `@Module` 隔了两跳 spread，只看装饰器那一层永远看不到。
//
// 「哪里表达了注册意图」与「它最终被挂在哪个模块上」是两件事 ——
// 判定「是否存在全局校验管道」只需要前者；把两者绑死（要求 spread 必须
// 追溯到某个 @Module）会让判定再次退化为形态枚举。见 §52 报告。

const APP_TOKEN_RE = /^APP_(PIPE|GUARD|INTERCEPTOR|FILTER)$/;

function appTokenOf(text: string | undefined): AppLevelProviderToken | null {
  if (!text) return null;
  // 处理 import("@nestjs/core").APP_PIPE / 'APP_PIPE' 等形态
  const cleaned = text.replace(/^['"]|['"]$/g, "").replace(/^.*\./, "").trim();
  return APP_TOKEN_RE.test(cleaned) ? (cleaned as AppLevelProviderToken) : null;
}

/** useClass/useExisting 的实现类名（useFactory/useValue 取不到 ⇒ null，保守不动） */
function implNameOf(obj: Expression): string | null {
  const pick = (key: string): string | null => {
    const prop = (obj as any).getProperty?.(key);
    const init = prop?.getInitializer?.();
    const text = init?.getText?.() ?? "";
    const m = /^[A-Za-z_$][\w$]*$/.exec(text.trim());
    return m ? m[0] : null;
  };
  return pick("useClass") ?? pick("useExisting");
}

function providersArrayOf(obj: Expression | undefined): any {
  if (!obj) return undefined;
  const lit = obj.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!lit) return undefined;
  const prop = lit.getProperty("providers");
  if (!prop) return undefined;
  return (prop as any).getInitializer?.()?.asKind?.(SyntaxKind.ArrayLiteralExpression);
}

export function collectAppLevelProviders(
  sourceFiles: any[]
): AppLevelProviderRegistration[] {
  const out: AppLevelProviderRegistration[] = [];
  const seen = new Set<string>();

  const add = (r: AppLevelProviderRegistration) => {
    const key = `${r.token}|${r.impl}|${r.file}|${r.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };

  // 文件级预筛：没出现 APP_* token 的文件直接跳过（绝大多数文件）
  const candidates = sourceFiles.filter(
    (f: any) =>
      /APP_(PIPE|GUARD|INTERCEPTOR|FILTER)\b/.test(f.getFullText()) &&
      // 测试脚手架里的 providers 是给「测试 app」搭的，不是生产注册证据。
      // immich 实测：`test/utils.ts` 里有一整套 APP_PIPE/APP_GUARD 用于构造测试用的
      // Nest app —— 采信它等于拿测试环境的配置豁免生产代码。
      !/\.(test|spec)\.ts$/.test(f.getFilePath()) &&
      !/\/(test|tests|__tests__|__mocks__|e2e)\//.test(f.getFilePath())
  );
  if (candidates.length === 0) return out;

  // ── 顶层/模块级变量索引（回溯用，§52）──
  //   数组变量：spread 引用链 `...middleware` 的目标
  //   对象变量：`@Module(configVar)` 的装饰器参数（nocodb 形态普查：7 个 @Module 里
  //              **5 个（71%）是变量**而不是对象字面量 —— 主流写法，不是边角情况）
  // ⚠ 索引**不做 APP_ 过滤**：中间变量往往不直接含 token
  //   （immich 的 `apiMiddleware` 只含 APP_GUARD，APP_PIPE 在再下一跳的 `commonMiddleware` 里）。
  const arrayVars = new Map<string, any>();
  const objectVars = new Map<string, any>();
  for (const sf of candidates) {
    for (const vs of sf.getVariableStatements()) {
      for (const vd of vs.getDeclarations()) {
        const init = vd.getInitializer();
        if (!init) continue;
        const name = vd.getName();
        const arr = init.asKind?.(SyntaxKind.ArrayLiteralExpression);
        if (arr) {
          if (!arrayVars.has(name)) arrayVars.set(name, arr);
          continue;
        }
        const obj = init.asKind?.(SyntaxKind.ObjectLiteralExpression);
        if (obj && !objectVars.has(name)) objectVars.set(name, obj);
      }
    }
  }

  const recordFromObj = (obj: any, source: any, via: string[]) => {
    const provideProp = obj.getProperty("provide");
    if (!provideProp) return;
    const init = (provideProp as any).getInitializer?.();
    const token = appTokenOf(init?.getText?.() ?? provideProp.getText());
    if (!token) return;
    add({
      token,
      impl: implNameOf(obj),
      source,
      via,
      file: obj.getSourceFile().getFilePath(),
      line: obj.getStartLineNumber(),
    });
  };

  const parseArray = (arr: any, source: any, via: string[], depth: number): void => {
    if (depth > 5) return;
    for (const el of arr.getElements()) {
      const obj = el.asKind(SyntaxKind.ObjectLiteralExpression);
      if (obj) {
        recordFromObj(obj, source, via);
        continue;
      }
      const spread = el.asKind(SyntaxKind.SpreadElement);
      if (!spread) continue;
      const id = /^[A-Za-z_$][\w$]*$/.exec(spread.getExpression().getText().trim());
      if (!id) continue;
      if (via.includes(id[0])) continue; // 防止循环引用
      const target = arrayVars.get(id[0]);
      if (target) parseArray(target, "array-literal", [...via, id[0]], depth + 1);
    }
  };

  for (const sf of candidates) {
    // A + B：@Module 装饰器 / 类属性 providers
    for (const cls of sf.getClasses()) {
      const moduleDec = cls.getDecorator("Module");
      if (!moduleDec) continue;
      const rawArg = moduleDec.getArguments()[0] as Expression | undefined;
      // `@Module(configVar)`：装饰器参数是变量 ⇒ 回溯到它的对象字面量定义
      let decArg: Expression | undefined = rawArg;
      if (rawArg?.getKind() === SyntaxKind.Identifier) {
        decArg = objectVars.get(rawArg.getText().trim()) as Expression | undefined;
      }
      const decArr = providersArrayOf(decArg);
      if (decArr) parseArray(decArr, "module-decorator", [], 0);
      for (const prop of cls.getProperties()) {
        if (prop.getName() !== "providers") continue;
        const pArr = prop.getInitializer()?.asKind?.(SyntaxKind.ArrayLiteralExpression);
        if (pArr) parseArray(pArr, "module-property", [], 0);
      }
    }
    // C：数组常量（不要求被某个 @Module 引用）
    for (const vs of sf.getVariableStatements()) {
      for (const vd of vs.getDeclarations()) {
        const arr = vd.getInitializer()?.asKind?.(SyntaxKind.ArrayLiteralExpression);
        if (!arr) continue;
        if (!/APP_(PIPE|GUARD|INTERCEPTOR|FILTER)\b/.test(arr.getText())) continue;
        parseArray(arr, "array-literal", [], 0);
      }
    }
  }

  // 逐行文本兜底：覆盖 AST 路径之外的写法（函数体内构造、动态拼装等）。
  // 只补结构化解析没抓到的行，且跳过注释行。
  const knownLines = new Set(out.map((r) => `${r.file}:${r.line}`));
  for (const sf of candidates) {
    const filePath = sf.getFilePath();
    sf.getFullText()
      .split("\n")
      .forEach((line: string, i: number) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        const m = /\{\s*provide\s*:\s*(?:[^A-Za-z]*?)APP_(PIPE|GUARD|INTERCEPTOR|FILTER)\b/.exec(line);
        if (!m) return;
        const key = `${filePath}:${i + 1}`;
        if (knownLines.has(key)) return;
        const implM = /useClass\s*:\s*([A-Za-z_$][\w$]*)/.exec(line);
        add({
          token: `APP_${m[1]}` as AppLevelProviderToken,
          impl: implM ? implM[1] : null,
          source: "text-fallback",
          via: [],
          file: filePath,
          line: i + 1,
        });
      });
  }

  return out;
}

/**
 * 从 @Module 装饰器的 providers 提取 APP_GUARD 类名：
 *   providers: [{ provide: APP_GUARD, useClass: AuthGuard }]
 * 支持装饰器参数对象字面量与类属性 providers 两种形态。
 *
 * ⚠ 保留仅为兼容（早期调用方）：内含 spread 的形态（`...commonMiddleware`）
 * 解析不了，真实注册事件请用 collectAppLevelProviders()（§52）。
 */
function extractAppGuardNames(moduleDec: Decorator, cls: ClassDeclaration): string[] {
  const names: string[] = [];
  const scanProviders = (arg: Expression | undefined) => {
    if (!arg) return;
    // @Module({ providers: [...] })
    const obj = arg.asKind(SyntaxKind.ObjectLiteralExpression);
    if (obj) {
      const providersProp = obj.getProperty("providers");
      if (providersProp) {
        const initializer = (providersProp as any).getInitializer?.();
        if (initializer && initializer.asKind(SyntaxKind.ArrayLiteralExpression)) {
          for (const el of initializer.getElements()) {
            const elObj = el.asKind(SyntaxKind.ObjectLiteralExpression);
            if (!elObj) continue;
            const provideProp = elObj.getProperty("provide");
            const useClassProp = elObj.getProperty("useClass");
            const provideName = (provideProp as any)?.getInitializer?.()?.getText?.();
            const useClassName = (useClassProp as any)?.getInitializer?.()?.getText?.();
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
  scanProviders(decArg as Expression | undefined);
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
function extractMiddlewareForRoutes(configureText: string): Array<{ path: string; methods: string[] }> {
  const out: Array<{ path: string; methods: string[] }> = [];
  // consumer.apply(X).forRoutes({...}, {...}) / .forRoutes('path', ...)
  const frIndexes: number[] = [];
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
      if (configureText[end] === "(") depth++;
      else if (configureText[end] === ")") depth--;
      end++;
    }
    const argsText = configureText.slice(start, end - 1);
    // 逐顶层参数（逗号切分，深度感知）
    const args: string[] = [];
    let cur = "";
    let d = 0;
    for (const ch of argsText) {
      if (ch === "(" || ch === "[" || ch === "{") d++;
      else if (ch === ")" || ch === "]" || ch === "}") d--;
      if (ch === "," && d === 0) { args.push(cur); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) args.push(cur);

    for (const arg of args) {
      const trimmed = arg.trim();
      const pathM = trimmed.match(/path\s*:\s*['"]([^'"]+)['"]/);
      const methodM = trimmed.match(/method\s*:\s*RequestMethod\.(\w+)/);
      const plain = trimmed.match(/^['"]([^'"]+)['"]$/);
      const path = pathM ? pathM[1] : plain ? plain[1] : null;
      if (!path) continue;
      const method = methodM ? methodM[1] : "*";
      out.push({ path, methods: [method] });
    }
  }
  return out;
}

/** @Module({ controllers: [A, B] }) 里的控制器类名 */
function extractModuleControllerNames(moduleDec: Decorator): string[] {
  const out: string[] = [];
  const text = moduleDec.getText();
  const m = text.match(/controllers\s*:\s*\[([^\]]*)\]/);
  if (!m) return out;
  for (const name of m[1].split(",")) {
    const n = name.trim().replace(/\s+as\s+\w+$/, "").split(".").pop();
    if (n && /^[A-Za-z_$]/.test(n)) out.push(n);
  }
  return out;
}

/** route（method, fullPath）是否被 controller 的模块中间件覆盖 */
function middlewareCovers(
  ctrlMiddleware: Map<string, Array<{ path: string; methods: string[] }>>,
  controllerName: string,
  httpMethod: string,
  fullPath: string,
): boolean {
  const entries = ctrlMiddleware.get(controllerName);
  if (!entries || entries.length === 0) return false;
  const norm = (p: string): string => p.replace(/^\/+|\/+$/g, "");
  const routePath = norm(fullPath);
  return entries.some((e) => {
    const em = e.methods[0] || "*";
    // RequestMethod.ALL 与通配 * 匹配任意方法
    if (em !== "*" && em !== "ALL" && em !== httpMethod) return false;
    return norm(e.path) === routePath;
  });
}

/** Check if a route is intentionally public (login, register, health, etc.). */
function isPublicRoute(path: string): boolean {
  // Normalize: ensure leading slash for consistent matching
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const publicPatterns = [
    /\/auth\/login$/i,     /\/login$/i,
    /\/auth\/register$/i,  /\/register$/i,  /\/signup$/i,
    /\/auth\/signup$/i,    /\/auth\/signin$/i, /\/signin$/i,
    /\/auth\/refresh$/i,   /\/auth\/forgot/i,  /\/auth\/reset/i,
    // auth 流程自身端点（2026-09-29 docmost 实测：auth/setup、
    // auth/password-reset、auth/verify-token 被误报 NO_AUTH——
    // 用户尚未登录，这些端点天生无认证；原 /auth/reset 匹配不了 password-reset）
    /\/auth\/password-reset$/i, /\/auth\/reset-password$/i,
    /\/auth\/verify-token$/i,   /\/auth\/verify$/i,
    /\/auth\/setup$/i,          /\/auth\/init$/i,
    /\/health$/i,          /\/healthcheck$/i,  /\/ping$/i, /\/status$/i,
    /\/public\//i,         /\/static\//i,
  ];
  return publicPatterns.some(p => p.test(normalized));
}

// ── Low-level Helpers ──

function getHttpMethod(method: MethodDeclaration): string | null {
  for (const dec of method.getDecorators()) {
    const name = dec.getName();
    if (["Get", "Post", "Put", "Delete", "Patch", "Options", "Head", "All"].includes(name)) {
      return name.toUpperCase();
    }
  }
  return null;
}

function isHttpDecorator(dec: Decorator): boolean {
  return ["Get", "Post", "Put", "Delete", "Patch", "Options", "Head", "All"].includes(dec.getName());
}

/**
 * HTTP/Controller 装饰器的**全部**路径（Nest 允许一条 handler 注册多个路径别名）。
 *
 * §52 形态普查发现这不是边角写法：nocodb 348 个路由装饰器里 **250 个（72%）是数组形态**
 *   @Post(['/api/v1/db/meta/projects/:baseId/api-tokens',
 *          '/api/v2/meta/bases/:baseId/api-tokens'])
 * 旧实现把整段数组文本当成一个路径 ⇒ path 变成形如 `/[\n '/api/v1...',\n ...]` 的畸形串，
 * 于是依赖 path 的判据 —— isPublicRoute / middlewareCovers / registerRoots —— **全线静默失效**：
 * 既匹配不到公开端点（该豁免的没豁免），也匹配不到中间件覆盖。
 * ⇒ 这是「读不出来」而不是「判错」，属于接线缺陷，不是判据缺陷。
 *
 * 处理：字符串/数组逐项展开；模板字符串含 `${}` 无法静态求值 ⇒ 保留原文（不静默丢弃）。
 */
function getRoutePaths(decorator: Decorator | undefined): string[] {
  if (!decorator) return [""];
  const arg = decorator.getArguments()[0];
  const strip = (t: string) => t.replace(/^['"`]|['"`]$/g, "");
  if (!arg) return [""];
  const arr = arg.asKind(SyntaxKind.ArrayLiteralExpression);
  if (arr) {
    const out: string[] = [];
    for (const el of arr.getElements()) {
      const kind = el.getKind();
      if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
        out.push(strip(el.getText()));
      }
      // 其它形态（模板表达式、标识符）不可静态求值 ⇒ 跳过（宁可不展开，不产生脏路径）
    }
    return out.length > 0 ? out : [""];
  }
  return [strip(arg.getText())];
}

/** 拼接 controller 基路径与方法路径（Nest 的 join 语义） */
function joinRoutePaths(basePaths: string[], routePaths: string[]): string[] {
  const out: string[] = [];
  for (const b of basePaths) {
    for (const r of routePaths) {
      out.push(b + (r.startsWith("/") || r === "" ? r : `/${r}`));
    }
  }
  return out;
}

function getStringArg(decorator: Decorator | undefined, index: number): string | undefined {
  if (!decorator) return undefined;
  const args = decorator.getArguments();
  if (args.length <= index) return undefined;
  const text = args[index].getText();
  return text.replace(/^['"]|['"]$/g, "");
}

/**
 * @UseGuards / @UsePipes 参数里被注册的类名（取每个参数的**首个**标识符）。
 *
 * §52 修正：此前只收 `(?:Guard|Pipe|Interceptor)` 后缀的名字 ⇒
 * `@UsePipes(ZodValidationPipe)` 好用、`@UsePipes(customBodyValidator)` 或
 * `@UseGuards(Auth)` 全都看不见。但 Nest 强制 @UsePipes 的参数实现
 * PipeTransform、@UseGuards 的参数实现 CanActivate ——
 * **装饰器本身已经确定了它们是管道/守卫，不需要再从名字上确认一遍。**
 *
 * 「它是不是认证守卫」（ThrottlerGuard ≠ 认证）是另一件事，由 isAuthGuardName
 * 单独判断。这两个关注点此前混在一起，导致「名字不像 ⇒ 连存在都看不见」。
 *
 * 只取首个标识符是为了避免把 `AuthGuard('JWT')` 里的 JWT 也当成守卫名
 * （那会凭空多出一条认证证据，属反向误判）。
 */
function extractGuardNames(decorator: Decorator | undefined): string[] {
  if (!decorator) return [];
  const result: string[] = [];
  for (const arg of decorator.getArguments()) {
    const text = arg
      .getText()
      .trim()
      .replace(/^(?:new|await|void|typeof)\s+/, "")
      .replace(/^this\./, "");
    const m = /^[A-Za-z_$][\w$]*/.exec(text);
    if (m) result.push(m[0]);
  }
  return result;
}

// ── File-level and Project-level Convenience ──

/**
 * Analyze a single TypeScript file for NestJS controllers.
 */
export function analyzeNestJSFile(filePath: string): NestJSAnalysis | null {
  const fs = require("fs");
  if (!fs.existsSync(filePath)) return null;

  const code = fs.readFileSync(filePath, "utf-8");
  // Quick check: does this file look like NestJS?
  if (!/@Controller\b/.test(code) && !/@nestjs\/common/.test(code)) return null;

  const project = new Project();
  try {
    project.addSourceFileAtPath(filePath);
  } catch {
    return null;
  }

  // Parse using the same logic as analyzeNestJSProject
  const analysis: NestJSAnalysis = {
    controllers: [],
    routes: [],
    issues: [],
    globalAuthGuards: [], // 单文件分析无全局守卫上下文（项目级请用 analyzeNestJSProject）
    globalValidationPipes: [],
    registrations: [],
  };

  for (const file of project.getSourceFiles()) {
    for (const cls of file.getClasses()) {
      const ctrlDec = cls.getDecorator("Controller");
      if (!ctrlDec) continue;

      // ... (same parsing logic)
      const controllerName = cls.getName() || "UnknownController";
      analysis.controllers.push(controllerName);

      const basePaths = getRoutePaths(ctrlDec);
      const classGuards = extractGuardNames(cls.getDecorator("UseGuards"));
      const classPipes = extractGuardNames(cls.getDecorator("UsePipes"));

      for (const method of cls.getMethods()) {
        const httpMethod = getHttpMethod(method);
        if (!httpMethod) continue;

        const routePaths = joinRoutePaths(
          basePaths,
          getRoutePaths(method.getDecorators().find(d => isHttpDecorator(d))!)
        );

        const methodGuards = extractGuardNames(method.getDecorator("UseGuards"));
        const methodPipes = extractGuardNames(method.getDecorator("UsePipes"));
        const guards = methodGuards.length > 0 ? methodGuards : classGuards;
        const pipes = methodPipes.length > 0 ? methodPipes : classPipes;

        for (const fullPath of routePaths) {
          const route: NestJSRoute = {
            method: httpMethod,
            path: fullPath,
            controller: controllerName,
            handler: method.getName() || "unknown",
            hasAuthGuard: guards.filter(isAuthGuardName).length > 0,
            hasValidationPipe: pipes.length > 0,
            hasValidatedDto: false, // 单文件分析无跨文件 DTO 上下文（项目级用 analyzeNestJSProject）
            hasStructuredInput: true, // 单文件分析不区分（项目级解析真实入参）
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
  }

  return analysis;
}

/**
 * Format a summary report for CLI output.
 */
export function formatNestJSReport(analysis: NestJSAnalysis): string {
  if (analysis.controllers.length === 0) {
    return "Not a NestJS project (no @Controller classes found).";
  }

  const lines: string[] = [
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
