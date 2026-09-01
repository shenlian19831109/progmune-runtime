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

// ── Types ──

export interface NestJSRoute {
  method: string;
  path: string;
  controller: string;
  handler: string;
  hasAuthGuard: boolean;
  hasValidationPipe: boolean;
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

export interface NestJSAnalysis {
  controllers: string[];
  routes: NestJSRoute[];
  issues: NestJSSecurityIssue[];
  /** 全局认证守卫（@Module providers 里的 APP_GUARD，认证名分类后） */
  globalAuthGuards: string[];
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
      return { controllers: [], routes: [], issues: [], globalAuthGuards: [] };
    }
  }

  const analysis: NestJSAnalysis = {
    controllers: [],
    routes: [],
    issues: [],
    globalAuthGuards: [],
  };

  // ── 第一遍：全局守卫（@Module providers 里的 APP_GUARD）──
  for (const file of project.getSourceFiles()) {
    if (file.getFilePath().includes("node_modules")) continue;
    if (/\.(test|spec)\.ts$/.test(file.getFilePath())) continue;

    for (const cls of file.getClasses()) {
      const moduleDec = cls.getDecorator("Module");
      if (!moduleDec) continue;
      const guardNames = extractAppGuardNames(moduleDec, cls);
      for (const name of guardNames) {
        if (isAuthGuardName(name) && !analysis.globalAuthGuards.includes(name)) {
          analysis.globalAuthGuards.push(name);
        }
      }
    }
  }
  const hasGlobalAuthGuard = analysis.globalAuthGuards.length > 0;

  for (const file of project.getSourceFiles()) {
    // Skip node_modules and test files
    if (file.getFilePath().includes("node_modules")) continue;
    if (/\.(test|spec)\.ts$/.test(file.getFilePath())) continue;

    for (const cls of file.getClasses()) {
      const ctrlDec = cls.getDecorator("Controller");
      if (!ctrlDec) continue;

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
        if (!httpMethod) continue;

        const routePath = getStringArg(
          method.getDecorators().find(d => isHttpDecorator(d))!,
          0
        ) || "";

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

        const route: NestJSRoute = {
          method: httpMethod,
          path: fullPath,
          controller: controllerName,
          handler: method.getName() || "unknown",
          hasAuthGuard: authGuards.length > 0,
          hasValidationPipe: pipes.length > 0,
          guards,
          pipes,
          isPublicDecorated,
        };

        analysis.routes.push(route);

        // 路由级保护判定：类/方法认证守卫，或全局 APP_GUARD（除非 @Public 豁免）
        const protectedByGlobal = hasGlobalAuthGuard && !isPublicDecorated;

        // ── Security Checks ──

        // POST/PUT/DELETE without auth guard
        // Skip intentionally public routes (login, register, health, etc.)
        if (["POST", "PUT", "DELETE", "PATCH"].includes(httpMethod) && !isPublicRoute(fullPath)) {
          if (!route.hasAuthGuard && !protectedByGlobal) {
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

        // Sensitive GET routes without auth
        if (httpMethod === "GET") {
          const sensitiveTerms = ["admin", "private", "secret", "manage"];
          if (sensitiveTerms.some(t => fullPath.toLowerCase().includes(t))
              && !route.hasAuthGuard && !protectedByGlobal) {
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
function isAuthGuardName(name: string): boolean {
  const lower = name.toLowerCase();
  if (/throttler|rate.?limit|logger|logging|cache/.test(lower)) return false;
  return /auth|jwt|session|permission|role|access|apikey|api_key|token|login|passport/.test(lower);
}

/**
 * 从 @Module 装饰器的 providers 提取 APP_GUARD 类名：
 *   providers: [{ provide: APP_GUARD, useClass: AuthGuard }]
 * 支持装饰器参数对象字面量与类属性 providers 两种形态。
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

/** Check if a route is intentionally public (login, register, health, etc.). */
function isPublicRoute(path: string): boolean {
  // Normalize: ensure leading slash for consistent matching
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const publicPatterns = [
    /\/auth\/login$/i,     /\/login$/i,
    /\/auth\/register$/i,  /\/register$/i,  /\/signup$/i,
    /\/auth\/signup$/i,    /\/auth\/signin$/i, /\/signin$/i,
    /\/auth\/refresh$/i,   /\/auth\/forgot/i,  /\/auth\/reset/i,
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

function getStringArg(decorator: Decorator | undefined, index: number): string | undefined {
  if (!decorator) return undefined;
  const args = decorator.getArguments();
  if (args.length <= index) return undefined;
  const text = args[index].getText();
  return text.replace(/^['"]|['"]$/g, "");
}

function extractGuardNames(decorator: Decorator | undefined): string[] {
  if (!decorator) return [];
  const args = decorator.getArguments();
  const result: string[] = [];
  for (const arg of args) {
    const text = arg.getText();
    // Handle: @UseGuards(AuthGuard) or @UseGuards(AuthGuard, AdminGuard)
    const matches = text.match(/\b([A-Z][a-zA-Z0-9]*(?:Guard|Pipe|Interceptor))\b/g);
    if (matches) result.push(...matches);
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
  };

  for (const file of project.getSourceFiles()) {
    for (const cls of file.getClasses()) {
      const ctrlDec = cls.getDecorator("Controller");
      if (!ctrlDec) continue;

      // ... (same parsing logic)
      const controllerName = cls.getName() || "UnknownController";
      analysis.controllers.push(controllerName);

      const basePath = getStringArg(ctrlDec, 0) || "";
      const classGuards = extractGuardNames(cls.getDecorator("UseGuards"));
      const classPipes = extractGuardNames(cls.getDecorator("UsePipes"));

      for (const method of cls.getMethods()) {
        const httpMethod = getHttpMethod(method);
        if (!httpMethod) continue;

        const routePath = getStringArg(
          method.getDecorators().find(d => isHttpDecorator(d))!,
          0
        ) || "";

        const fullPath = basePath + (routePath.startsWith("/") ? routePath : `/${routePath}`);

        const methodGuards = extractGuardNames(method.getDecorator("UseGuards"));
        const methodPipes = extractGuardNames(method.getDecorator("UsePipes"));
        const guards = methodGuards.length > 0 ? methodGuards : classGuards;
        const pipes = methodPipes.length > 0 ? methodPipes : classPipes;

        const route: NestJSRoute = {
          method: httpMethod,
          path: fullPath,
          controller: controllerName,
          handler: method.getName() || "unknown",
          hasAuthGuard: guards.filter(isAuthGuardName).length > 0,
          hasValidationPipe: pipes.length > 0,
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
