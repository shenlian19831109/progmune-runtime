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

import { Project, ClassDeclaration, MethodDeclaration, Decorator } from "ts-morph";

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
      return { controllers: [], routes: [], issues: [] };
    }
  }

  const analysis: NestJSAnalysis = {
    controllers: [],
    routes: [],
    issues: [],
  };

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

        const route: NestJSRoute = {
          method: httpMethod,
          path: fullPath,
          controller: controllerName,
          handler: method.getName() || "unknown",
          hasAuthGuard: guards.length > 0,
          hasValidationPipe: pipes.length > 0,
          guards,
          pipes,
        };

        analysis.routes.push(route);

        // ── Security Checks ──

        // POST/PUT/DELETE without auth guard
        if (["POST", "PUT", "DELETE", "PATCH"].includes(httpMethod)) {
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

        // Sensitive GET routes without auth
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

// ── Helpers ──

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
