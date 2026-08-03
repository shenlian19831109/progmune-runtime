/**
 * Express Framework Adapter — Protocol Detection for Express.js
 *
 * Detects Express-specific patterns that the generic \w* regex detector
 * cannot see: middleware chains, route handlers, auth guards, and the
 * relationship between them.
 *
 * This is the FIRST framework adapter. Before this, Progmune had 0/13
 * framework adapters despite TS being its primary language.
 *
 * Key Express patterns detected:
 *   - App initialization: express(), const app = express()
 *   - Middleware registration: app.use(fn), router.use(fn)
 *   - Route handlers: app.get(), app.post(), router.get(), etc.
 *   - Auth middleware: passport.authenticate(), express-jwt, custom auth
 *   - Missing auth: route without middleware when auth middleware exists
 */

import * as fs from "fs";

// ── Types ──

export interface ExpressRoute {
  method: "get" | "post" | "put" | "delete" | "patch" | "all" | "use";
  path: string;
  handler: string;
  middlewares: string[];
  line: number;
}

export interface ExpressMiddlewareChain {
  name: string;
  type: "auth" | "validation" | "rate_limit" | "security_header" | "session" | "cors" | "logging" | "error_handler" | "unknown";
  registeredAt: number;
}

export interface ExpressAppAnalysis {
  hasExpress: boolean;
  appName: string;
  routes: ExpressRoute[];
  globalMiddleware: ExpressMiddlewareChain[];
  issues: ExpressSecurityIssue[];
}

export interface ExpressSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  line: number;
  fix: string;
}

// ── Known auth/security middleware patterns ──

const AUTH_MIDDLEWARE_PATTERNS = [
  /\bpassport\.initialize\b/,
  /\bpassport\.authenticate\b/,
  /\bexpress-jwt\b/,
  /\bjwt\s*\(\s*\{/,
  /\bauthMiddleware\b/,
  /\brequireAuth\b/,
  /\bwithAuth\b/,
  /\bauthenticateToken\b/,
  /\bverifyToken\b/,
  /\bvalidateToken\b/,
  /\bisAuthenticated\b/,
  /\bensureAuthenticated\b/,
  /\bauthGuard\b/,
  /\bAuthGuard\b/,
  /\brequire\w*[Aa]uth\b/,
  /\bcheckAuth\b/,
  /\bprotect\b/,
  /\bauthenticateRequest\b/,
  // Variable references — common Express convention (e.g., const auth = passport.authenticate(...))
  // These are standalone identifiers in middleware position
  /^auth$/i,
  /^authMw$/i,
  /^jwtAuth$/i,
  /^tokenAuth$/i,
];

const RATE_LIMIT_MIDDLEWARE_PATTERNS = [
  /\bexpress-rate-limit\b/,
  /\brateLimit\b/,
  /\brate_limiter\b/,
  /\bRateLimiter\b/,
  /\bthrottle\b/,
  // Common variable references
  /^loginLimiter$/i,
  /^apiLimiter$/i,
  /^rateLimiter$/i,
  /^limiter$/i,
];

const VALIDATION_MIDDLEWARE_PATTERNS = [
  /\bexpress-validator\b/,
  /\bcheck\s*\(/,
  /\bbody\s*\(/,
  /\bparam\s*\(/,
  /\bquery\s*\(/,
  /\bvalidate\b/,
  /\bcelebrate\b/,
  /\bJoi\./,
  /\bzod\b/,
  /\byup\b/,
];

const SECURITY_HEADER_PATTERNS = [
  /\bhelmet\b/,
  /\bcors\s*\(/,
  /\bcors\b/,
  /\bcsp\b/,
  /\bcontentSecurityPolicy\b/,
  /\bhsts\b/,
];

const SESSION_PATTERNS = [
  /\bexpress-session\b/,
  /\bcookie-session\b/,
  /\bcookieParser\b/,
  /\bsession\s*\(/,
];

// ── Detection Functions ──

/**
 * Detect Express app initialization from source code.
 * Returns the app variable name if found.
 */
export function detectExpressApp(code: string): string | null {
  // Pattern: const app = express()
  const m = code.match(/(?:const|let|var)\s+(\w+)\s*=\s*express\s*\(\s*\)/);
  if (m) return m[1];

  // Pattern: import express from 'express' ... const app = express()
  if (/\brequire\s*\(\s*['"]express['"]\s*\)/.test(code) || /from\s+['"]express['"]/.test(code)) {
    const varMatch = code.match(/(?:const|let|var)\s+(\w+)\s*=\s*express\s*\(\s*\)/);
    if (varMatch) return varMatch[1];
    // Couldn't find app variable, but express is imported
    return "app"; // default convention
  }

  return null;
}

/**
 * Extract all routes registered on an Express app or router.
 */
export function extractRoutes(code: string, appName: string): ExpressRoute[] {
  const routes: ExpressRoute[] = [];
  const methods = ["get", "post", "put", "delete", "patch", "all", "use"] as const;

  for (const method of methods) {
    // Pattern: app.get('/path', middleware1, middleware2, handler)
    // or: router.post('/path', handler)
    const routeRegex = new RegExp(
      `${appName}\\.${method}\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*,([^;]+)\\)`,
      "gi"
    );

    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(code)) !== null) {
      const rawArgs = match[2].trim();
      const args = rawArgs.split(",").map(a => a.trim()).filter(a => a.length > 0);

      // Last arg is the handler, everything before is middleware
      const handler = args[args.length - 1] || "anonymous";
      const middlewares = args.slice(0, -1);

      routes.push({
        method,
        path: match[1],
        handler,
        middlewares,
        line: code.slice(0, match.index).split("\n").length,
      });
    }
  }

  return routes;
}

/**
 * Identify the type of a middleware function from its name or pattern.
 */
export function classifyMiddleware(code: string, name: string): ExpressMiddlewareChain["type"] {
  const trimmed = name.trim();

  for (const p of AUTH_MIDDLEWARE_PATTERNS) {
    if (p.test(trimmed)) return "auth";
  }
  for (const p of RATE_LIMIT_MIDDLEWARE_PATTERNS) {
    if (p.test(trimmed)) return "rate_limit";
  }
  for (const p of VALIDATION_MIDDLEWARE_PATTERNS) {
    if (p.test(trimmed)) return "validation";
  }
  for (const p of SECURITY_HEADER_PATTERNS) {
    if (p.test(trimmed)) return "security_header";
  }
  for (const p of SESSION_PATTERNS) {
    if (p.test(trimmed)) return "session";
  }

  if (/\bcors\b/i.test(trimmed)) return "cors";
  if (/\berrorHandler\b|\bhandleError\b|\berror_handler\b/i.test(trimmed)) return "error_handler";
  if (/\blogger\b|\bmorgan\b|\blogging\b/i.test(trimmed)) return "logging";

  return "unknown";
}

/**
 * Extract global middleware registrations (app.use(fn)).
 */
export function extractGlobalMiddleware(code: string, appName: string): ExpressMiddlewareChain[] {
  const middleware: ExpressMiddlewareChain[] = [];
  const useRegex = new RegExp(`${appName}\\.use\\s*\\(([^)]+)\\)`, "gi");

  let match: RegExpExecArray | null;
  while ((match = useRegex.exec(code)) !== null) {
    const args = match[1].split(",").map(a => a.trim());
    for (const arg of args) {
      if (arg.startsWith("'") || arg.startsWith('"')) continue; // skip path strings
      if (/^(express|router|Router)\./.test(arg)) continue; // skip sub-routers (handled separately)

      middleware.push({
        name: arg,
        type: classifyMiddleware(code, arg),
        registeredAt: code.slice(0, match.index).split("\n").length,
      });
    }
  }

  return middleware;
}

/**
 * Analyze an Express app for security issues.
 * This is the main entry point — call this function on an Express source file.
 */
export function analyzeExpressApp(code: string): ExpressAppAnalysis {
  const appName = detectExpressApp(code);
  if (!appName) {
    return { hasExpress: false, appName: "", routes: [], globalMiddleware: [], issues: [] };
  }

  const routes = extractRoutes(code, appName);
  const globalMiddleware = extractGlobalMiddleware(code, appName);
  const issues: ExpressSecurityIssue[] = [];

  // Check 1: Does the app have any auth middleware at all?
  const hasGlobalAuth = globalMiddleware.some(m => m.type === "auth");
  const hasAnyAuth = hasGlobalAuth || routes.some(r =>
    r.middlewares.some(m => AUTH_MIDDLEWARE_PATTERNS.some(p => p.test(m)))
  );

  // Check 2: Does the app have rate limiting on auth routes?
  const hasRateLimit = globalMiddleware.some(m => m.type === "rate_limit");
  const authRoutes = routes.filter(r =>
    /\b(login|signin|signup|register|auth|token|password)\b/i.test(r.path)
  );

  // Check 3: Does the app have security headers (helmet)?
  const hasHelmet = globalMiddleware.some(m => m.type === "security_header") ||
    /\bhelmet\s*\(/.test(code);

  // Check 4: Does the app have input validation on POST/PUT routes?
  const hasValidation = globalMiddleware.some(m => m.type === "validation");

  // Check 5: Does the app have CORS configured?
  const hasCors = globalMiddleware.some(m => m.type === "cors") || /\bcors\s*\(/.test(code);

  // Check 6: Does the app have session management?
  const hasSession = globalMiddleware.some(m => m.type === "session") || /\bsession\s*\(/.test(code);

  // ── Generate Issues ──

  if (!hasAnyAuth) {
    issues.push({
      severity: "critical",
      rule: "EXPRESS_NO_AUTH_MIDDLEWARE",
      message: "Express app has no authentication middleware registered. All routes are publicly accessible.",
      line: 1,
      fix: "Add an auth middleware (e.g., passport.authenticate('jwt'), express-jwt, or a custom auth middleware) to protect routes.",
    });
  }

  // Check for routes without auth middleware (when auth middleware exists globally)
  if (hasAnyAuth) {
    for (const route of routes) {
      if (["use", "all"].includes(route.method)) continue; // skip middleware registrations

      const routeHasAuth = route.middlewares.some(m =>
        AUTH_MIDDLEWARE_PATTERNS.some(p => p.test(m))
      );

      if (!routeHasAuth && !hasGlobalAuth) {
        // Route has no auth middleware AND no global auth → each route needs its own
        // (already reported as EXPRESS_NO_AUTH_MIDDLEWARE above)
        continue;
      }

      if (!routeHasAuth && hasGlobalAuth && !isPublicRoute(route.path)) {
        issues.push({
          severity: "high",
          rule: "EXPRESS_ROUTE_MISSING_AUTH",
          message: `Route ${route.method.toUpperCase()} ${route.path} has no auth middleware. It may be inadvertently public.`,
          route: `${route.method.toUpperCase()} ${route.path}`,
          line: route.line,
          fix: `Add auth middleware to the route: app.${route.method}('${route.path}', authMiddleware, ${route.handler})`,
        });
      }
    }
  }

  // Auth routes without rate limiting
  if (authRoutes.length > 0 && !hasRateLimit) {
    for (const route of authRoutes) {
      issues.push({
        severity: "high",
        rule: "EXPRESS_AUTH_NO_RATE_LIMIT",
        message: `Auth route ${route.method.toUpperCase()} ${route.path} has no rate limiting. Vulnerable to brute-force attacks.`,
        route: `${route.method.toUpperCase()} ${route.path}`,
        line: route.line,
        fix: "Add express-rate-limit middleware to auth routes: max 5 attempts per minute per IP.",
      });
    }
  }

  // Missing security headers
  if (!hasHelmet) {
    issues.push({
      severity: "medium",
      rule: "EXPRESS_NO_HELMET",
      message: "Express app does not use helmet middleware. Missing security headers (CSP, HSTS, X-Frame-Options, etc.).",
      line: 1,
      fix: "Add helmet middleware: app.use(helmet())",
    });
  }

  // POST/PUT routes without validation
  const mutationRoutes = routes.filter(r => ["post", "put", "patch"].includes(r.method));
  if (mutationRoutes.length > 0 && !hasValidation) {
    issues.push({
      severity: "medium",
      rule: "EXPRESS_NO_INPUT_VALIDATION",
      message: `${mutationRoutes.length} POST/PUT/PATCH routes have no input validation middleware.`,
      line: mutationRoutes[0]?.line ?? 1,
      fix: "Add express-validator or zod validation to mutation routes.",
    });
  }

  // Missing CORS configuration
  if (!hasCors) {
    issues.push({
      severity: "low",
      rule: "EXPRESS_NO_CORS_CONFIG",
      message: "Express app has no explicit CORS configuration. Defaults to same-origin only — may break legitimate cross-origin requests or be overly permissive.",
      line: 1,
      fix: "Add explicit CORS configuration: app.use(cors({ origin: 'https://your-domain.com' }))",
    });
  }

  // Session without secure settings (if present)
  if (hasSession) {
    const sessionSecure = /secure\s*:\s*true/.test(code) && /httpOnly\s*:\s*true/.test(code) && /sameSite\s*:\s*['"](?:strict|lax)['"]/.test(code);
    if (!sessionSecure) {
      issues.push({
        severity: "medium",
        rule: "EXPRESS_SESSION_INSECURE",
        message: "Express session configured without secure, httpOnly, or sameSite cookie flags.",
        line: 1,
        fix: "Set cookie: { secure: true, httpOnly: true, sameSite: 'strict' } in session config.",
      });
    }
  }

  return { hasExpress: true, appName, routes, globalMiddleware, issues };
}

/**
 * Check if a route is intentionally public (login, health, static, etc.).
 */
function isPublicRoute(path: string): boolean {
  const publicPatterns = [
    /^\/login$/i,
    /^\/signin$/i,
    /^\/signup$/i,
    /^\/register$/i,
    /^\/auth\//i,
    /^\/health$/i,
    /^\/healthcheck$/i,
    /^\/ping$/i,
    /^\/status$/i,
    /^\/public\//i,
    /^\/static\//i,
    /^\/assets\//i,
    /^\/favicon/i,
    /^\/robots\.txt/i,
    /^\/$/,
  ];
  return publicPatterns.some(p => p.test(path));
}

/**
 * Analyze a file on disk. Returns null if not an Express app.
 */
export function analyzeExpressFile(filePath: string): ExpressAppAnalysis | null {
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, "utf-8");

  // Quick check: does this file import express?
  if (!/\bexpress\b/.test(code) && !/from\s+['"]express['"]/.test(code)) return null;

  return analyzeExpressApp(code);
}

/**
 * Batch analyze multiple files and return summary.
 */
export function analyzeExpressProject(filePaths: string[]): {
  files: number;
  expressApps: number;
  totalRoutes: number;
  issues: ExpressSecurityIssue[];
} {
  let expressApps = 0;
  let totalRoutes = 0;
  const allIssues: ExpressSecurityIssue[] = [];

  for (const fp of filePaths) {
    const analysis = analyzeExpressFile(fp);
    if (analysis && analysis.hasExpress) {
      expressApps++;
      totalRoutes += analysis.routes.length;
      allIssues.push(...analysis.issues);
    }
  }

  return {
    files: filePaths.length,
    expressApps,
    totalRoutes,
    issues: allIssues,
  };
}

/**
 * Format a summary report for CLI output.
 */
export function formatExpressReport(analysis: ExpressAppAnalysis): string {
  if (!analysis.hasExpress) {
    return "Not an Express app (no express import found).";
  }

  const lines: string[] = [
    `Express App: ${analysis.appName}`,
    `Routes: ${analysis.routes.length}`,
    `Global Middleware: ${analysis.globalMiddleware.length}`,
    `Security Issues: ${analysis.issues.length}`,
    "",
  ];

  if (analysis.issues.length === 0) {
    lines.push("✅ No Express security issues detected.");
    return lines.join("\n");
  }

  const bySeverity = {
    critical: analysis.issues.filter(i => i.severity === "critical"),
    high: analysis.issues.filter(i => i.severity === "high"),
    medium: analysis.issues.filter(i => i.severity === "medium"),
    low: analysis.issues.filter(i => i.severity === "low"),
  };

  for (const [sev, issues] of Object.entries(bySeverity)) {
    if (issues.length === 0) continue;
    const emoji = sev === "critical" ? "🔴" : sev === "high" ? "🟠" : sev === "medium" ? "🟡" : "🔵";
    lines.push(`${emoji} ${sev.toUpperCase()} (${issues.length})`);
    for (const issue of issues) {
      lines.push(`  [${issue.rule}] ${issue.message}`);
      if (issue.route) lines.push(`    Route: ${issue.route} (line ${issue.line})`);
      lines.push(`    Fix: ${issue.fix}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
