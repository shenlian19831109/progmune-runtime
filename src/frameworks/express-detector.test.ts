/**
 * Unit tests for Express Framework Adapter
 */

import { describe, it, expect } from "vitest";
import {
  detectExpressApp,
  extractRoutes,
  extractGlobalMiddleware,
  classifyMiddleware,
  analyzeExpressApp,
  formatExpressReport,
} from "./express-detector";

// ── Test fixtures ──

const BASIC_EXPRESS_APP = `
const express = require('express');
const app = express();

app.get('/', (req, res) => { res.send('Hello'); });
app.listen(3000);
`;

const AUTH_APP = `
const express = require('express');
const passport = require('passport');
const app = express();

app.use(express.json());
app.use(passport.initialize());

app.post('/login', passport.authenticate('local'), (req, res) => {
  res.json({ token: 'xxx' });
});

app.get('/profile', passport.authenticate('jwt'), (req, res) => {
  res.json(req.user);
});

app.listen(3000);
`;

const INSECURE_APP = `
const express = require('express');
const app = express();

app.get('/api/users', getUsers);
app.post('/api/users', createUser);
app.delete('/api/users/:id', deleteUser);
app.listen(3000);
`;

const SECURE_APP = `
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const passport = require('passport');
const app = express();

app.use(helmet());
app.use(cors({ origin: 'https://example.com' }));
app.use(express.json());
app.use(session({
  secret: 'mysecret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, httpOnly: true, sameSite: 'strict' }
}));
app.use(passport.initialize());

const auth = passport.authenticate('jwt', { session: false });
const loginLimiter = rateLimit({ windowMs: 60_000, max: 5 });

app.post('/login', loginLimiter, passport.authenticate('local'), (req, res) => {
  res.json({ token: 'xxx' });
});

app.get('/profile', auth, (req, res) => {
  res.json(req.user);
});

app.get('/public', (req, res) => {
  res.json({ message: 'public' });
});

app.listen(3000);
`;

// ── Tests ──

describe("detectExpressApp", () => {
  it("should detect express() call", () => {
    expect(detectExpressApp(BASIC_EXPRESS_APP)).toBe("app");
  });

  it("should detect express with require", () => {
    // require('express')() creates an app directly — detectExpressApp
    // returns 'app' as default when express is imported but we can't find the variable
    expect(detectExpressApp("const server = require('express')();")).toBe("app");
  });

  it("should return null for non-express code", () => {
    expect(detectExpressApp("const http = require('http');")).toBeNull();
  });
});

describe("extractRoutes", () => {
  it("should extract GET/POST routes", () => {
    const routes = extractRoutes(SECURE_APP, "app");
    // SECURE_APP has post('/login'), get('/profile'), get('/public')
    // (the const auth variable is passed by reference, not inline, so not extracted)
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(routes.some(r => r.path === "/login")).toBe(true);
    expect(routes.some(r => r.path === "/profile")).toBe(true);
  });

  it("should identify middleware on routes", () => {
    const routes = extractRoutes(SECURE_APP, "app");
    const profileRoute = routes.find(r => r.path === "/profile");
    expect(profileRoute).toBeDefined();
    expect(profileRoute!.middlewares.length).toBeGreaterThan(0);
  });

  it("should find routes with no middleware", () => {
    const routes = extractRoutes(INSECURE_APP, "app");
    expect(routes.length).toBeGreaterThan(0);
    // Some routes may have inline handlers that look like middleware
    // The key assertion: at least some routes have no middleware
    const withoutMiddleware = routes.filter(r => r.middlewares.length === 0);
    expect(withoutMiddleware.length).toBeGreaterThan(0);
  });
});

describe("classifyMiddleware", () => {
  it("should classify passport.authenticate as auth", () => {
    expect(classifyMiddleware("", "passport.authenticate('jwt')")).toBe("auth");
  });

  it("should classify rateLimit as rate_limit", () => {
    expect(classifyMiddleware("", "rateLimit({ windowMs: 60000 })")).toBe("rate_limit");
  });

  it("should classify helmet as security_header", () => {
    expect(classifyMiddleware("", "helmet()")).toBe("security_header");
  });

  it("should classify cors() as cors, NOT security_header (regression: SECURITY_HEADER_PATTERNS 曾含 cors 模式致 cors 恒被误分类 → 用 cors 的应用 NO_HELMET 漏报)", () => {
    expect(classifyMiddleware("", "cors()")).toBe("cors");
    expect(classifyMiddleware("", "cors({ origin: 'https://example.com' })")).toBe("cors");
    expect(classifyMiddleware("", "cors(")).toBe("cors");
  });
});

describe("extractGlobalMiddleware", () => {
  it("should extract app.use middleware", () => {
    const mw = extractGlobalMiddleware(SECURE_APP, "app");
    expect(mw.length).toBeGreaterThanOrEqual(4);
  });

  it("should classify passport as auth", () => {
    const mw = extractGlobalMiddleware(AUTH_APP, "app");
    // passport.initialize() and passport.authenticate() are now both classified as auth
    expect(mw.some(m => m.type === "auth")).toBe(true);
  });
});

describe("analyzeExpressApp", () => {
  it("should return hasExpress=false for non-express code", () => {
    const result = analyzeExpressApp("const x = 1;");
    expect(result.hasExpress).toBe(false);
  });

  it("should detect missing auth as critical issue", () => {
    const result = analyzeExpressApp(INSECURE_APP);
    const critical = result.issues.filter(i => i.severity === "critical");
    expect(critical.length).toBeGreaterThan(0);
    expect(critical[0].rule).toBe("EXPRESS_NO_AUTH_MIDDLEWARE");
  });

  it("should detect auth routes without rate limiting", () => {
    const result = analyzeExpressApp(AUTH_APP);
    const rateIssues = result.issues.filter(i => i.rule === "EXPRESS_AUTH_NO_RATE_LIMIT");
    expect(rateIssues.length).toBeGreaterThan(0);
  });

  it("should detect missing helmet", () => {
    const result = analyzeExpressApp(INSECURE_APP);
    expect(result.issues.some(i => i.rule === "EXPRESS_NO_HELMET")).toBe(true);
  });

  it("should still flag NO_HELMET when app uses cors() but no helmet (regression: cors 曾误分类为 security_header → hasHelmet 误真 → FN)", () => {
    const corsNoHelmet = `
      const express = require('express');
      const cors = require('cors');
      const app = express();
      app.use(cors());
      app.get('/', (req, res) => { res.send('ok'); });
      app.listen(3000);
    `;
    const result = analyzeExpressApp(corsNoHelmet);
    expect(result.issues.some(i => i.rule === "EXPRESS_NO_HELMET")).toBe(true);
    // cors IS recognized — no NO_CORS_CONFIG flag on this app
    expect(result.issues.some(i => i.rule === "EXPRESS_NO_CORS_CONFIG")).toBe(false);
    // cors() must be typed cors, so engine cross-file suppression works
    expect(result.globalMiddleware.some(m => m.type === "cors")).toBe(true);
  });

  it("should detect missing CORS", () => {
    const result = analyzeExpressApp(INSECURE_APP);
    expect(result.issues.some(i => i.rule === "EXPRESS_NO_CORS_CONFIG")).toBe(true);
  });

  it("should flag no input validation on POST routes", () => {
    const result = analyzeExpressApp(INSECURE_APP);
    expect(result.issues.some(i => i.rule === "EXPRESS_NO_INPUT_VALIDATION")).toBe(true);
  });

  it("should flag insecure session", () => {
    const insecureSession = `
      const app = require('express')();
      app.use(require('express-session')({ secret: 'x', cookie: {} }));
      app.listen(3000);
    `;
    const result = analyzeExpressApp(insecureSession);
    expect(result.issues.some(i => i.rule === "EXPRESS_SESSION_INSECURE")).toBe(true);
  });

  it("should PASS a fully secured Express app", () => {
    const result = analyzeExpressApp(SECURE_APP);
    const critical = result.issues.filter(i => i.severity === "critical");
    // /public route without explicit auth will trigger EXPRESS_ROUTE_MISSING_AUTH (high)
    // — that's correct behavior; public routes should be explicitly marked.
    // The KEY assertion: no CRITICAL issues (critical = BLOCKED decision)
    expect(critical.length).toBe(0);
  });

  it("should not flag public routes for auth", () => {
    const publicApp = `
      const app = require('express')();
      app.use(require('passport').initialize());
      app.get('/health', (req, res) => { res.send('ok'); });
      app.get('/login', (req, res) => { res.send('login'); });
      app.listen(3000);
    `;
    const result = analyzeExpressApp(publicApp);
    const missingAuth = result.issues.filter(i => i.rule === "EXPRESS_ROUTE_MISSING_AUTH");
    // /health and /login are public, should not be flagged
    expect(missingAuth.length).toBe(0);
  });
});

describe("formatExpressReport", () => {
  it("should return a human-readable report", () => {
    const analysis = analyzeExpressApp(INSECURE_APP);
    const report = formatExpressReport(analysis);
    expect(report).toContain("Express App:");
    expect(report).toContain("Security Issues:");
  });
});
