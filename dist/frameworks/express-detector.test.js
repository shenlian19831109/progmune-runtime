"use strict";
/**
 * Unit tests for Express Framework Adapter
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const express_detector_1 = require("./express-detector");
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
(0, vitest_1.describe)("detectExpressApp", () => {
    (0, vitest_1.it)("should detect express() call", () => {
        (0, vitest_1.expect)((0, express_detector_1.detectExpressApp)(BASIC_EXPRESS_APP)).toBe("app");
    });
    (0, vitest_1.it)("should detect express with require", () => {
        // require('express')() creates an app directly — detectExpressApp
        // returns 'app' as default when express is imported but we can't find the variable
        (0, vitest_1.expect)((0, express_detector_1.detectExpressApp)("const server = require('express')();")).toBe("app");
    });
    (0, vitest_1.it)("should return null for non-express code", () => {
        (0, vitest_1.expect)((0, express_detector_1.detectExpressApp)("const http = require('http');")).toBeNull();
    });
});
(0, vitest_1.describe)("extractRoutes", () => {
    (0, vitest_1.it)("should extract GET/POST routes", () => {
        const routes = (0, express_detector_1.extractRoutes)(SECURE_APP, "app");
        // SECURE_APP has post('/login'), get('/profile'), get('/public')
        // (the const auth variable is passed by reference, not inline, so not extracted)
        (0, vitest_1.expect)(routes.length).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(routes.some(r => r.path === "/login")).toBe(true);
        (0, vitest_1.expect)(routes.some(r => r.path === "/profile")).toBe(true);
    });
    (0, vitest_1.it)("should identify middleware on routes", () => {
        const routes = (0, express_detector_1.extractRoutes)(SECURE_APP, "app");
        const profileRoute = routes.find(r => r.path === "/profile");
        (0, vitest_1.expect)(profileRoute).toBeDefined();
        (0, vitest_1.expect)(profileRoute.middlewares.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("should find routes with no middleware", () => {
        const routes = (0, express_detector_1.extractRoutes)(INSECURE_APP, "app");
        (0, vitest_1.expect)(routes.length).toBeGreaterThan(0);
        // Some routes may have inline handlers that look like middleware
        // The key assertion: at least some routes have no middleware
        const withoutMiddleware = routes.filter(r => r.middlewares.length === 0);
        (0, vitest_1.expect)(withoutMiddleware.length).toBeGreaterThan(0);
    });
});
(0, vitest_1.describe)("classifyMiddleware", () => {
    (0, vitest_1.it)("should classify passport.authenticate as auth", () => {
        (0, vitest_1.expect)((0, express_detector_1.classifyMiddleware)("", "passport.authenticate('jwt')")).toBe("auth");
    });
    (0, vitest_1.it)("should classify rateLimit as rate_limit", () => {
        (0, vitest_1.expect)((0, express_detector_1.classifyMiddleware)("", "rateLimit({ windowMs: 60000 })")).toBe("rate_limit");
    });
    (0, vitest_1.it)("should classify helmet as security_header", () => {
        (0, vitest_1.expect)((0, express_detector_1.classifyMiddleware)("", "helmet()")).toBe("security_header");
    });
    (0, vitest_1.it)("should classify cors() as cors, NOT security_header (regression: SECURITY_HEADER_PATTERNS 曾含 cors 模式致 cors 恒被误分类 → 用 cors 的应用 NO_HELMET 漏报)", () => {
        (0, vitest_1.expect)((0, express_detector_1.classifyMiddleware)("", "cors()")).toBe("cors");
        (0, vitest_1.expect)((0, express_detector_1.classifyMiddleware)("", "cors({ origin: 'https://example.com' })")).toBe("cors");
        (0, vitest_1.expect)((0, express_detector_1.classifyMiddleware)("", "cors(")).toBe("cors");
    });
});
(0, vitest_1.describe)("extractGlobalMiddleware", () => {
    (0, vitest_1.it)("should extract app.use middleware", () => {
        const mw = (0, express_detector_1.extractGlobalMiddleware)(SECURE_APP, "app");
        (0, vitest_1.expect)(mw.length).toBeGreaterThanOrEqual(4);
    });
    (0, vitest_1.it)("should classify passport as auth", () => {
        const mw = (0, express_detector_1.extractGlobalMiddleware)(AUTH_APP, "app");
        // passport.initialize() and passport.authenticate() are now both classified as auth
        (0, vitest_1.expect)(mw.some(m => m.type === "auth")).toBe(true);
    });
});
(0, vitest_1.describe)("analyzeExpressApp", () => {
    (0, vitest_1.it)("should return hasExpress=false for non-express code", () => {
        const result = (0, express_detector_1.analyzeExpressApp)("const x = 1;");
        (0, vitest_1.expect)(result.hasExpress).toBe(false);
    });
    (0, vitest_1.it)("should detect missing auth as critical issue", () => {
        const result = (0, express_detector_1.analyzeExpressApp)(INSECURE_APP);
        const critical = result.issues.filter(i => i.severity === "critical");
        (0, vitest_1.expect)(critical.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(critical[0].rule).toBe("EXPRESS_NO_AUTH_MIDDLEWARE");
    });
    (0, vitest_1.it)("should detect auth routes without rate limiting", () => {
        const result = (0, express_detector_1.analyzeExpressApp)(AUTH_APP);
        const rateIssues = result.issues.filter(i => i.rule === "EXPRESS_AUTH_NO_RATE_LIMIT");
        (0, vitest_1.expect)(rateIssues.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("should detect missing helmet", () => {
        const result = (0, express_detector_1.analyzeExpressApp)(INSECURE_APP);
        (0, vitest_1.expect)(result.issues.some(i => i.rule === "EXPRESS_NO_HELMET")).toBe(true);
    });
    (0, vitest_1.it)("should still flag NO_HELMET when app uses cors() but no helmet (regression: cors 曾误分类为 security_header → hasHelmet 误真 → FN)", () => {
        const corsNoHelmet = `
      const express = require('express');
      const cors = require('cors');
      const app = express();
      app.use(cors());
      app.get('/', (req, res) => { res.send('ok'); });
      app.listen(3000);
    `;
        const result = (0, express_detector_1.analyzeExpressApp)(corsNoHelmet);
        (0, vitest_1.expect)(result.issues.some(i => i.rule === "EXPRESS_NO_HELMET")).toBe(true);
        // cors IS recognized — no NO_CORS_CONFIG flag on this app
        (0, vitest_1.expect)(result.issues.some(i => i.rule === "EXPRESS_NO_CORS_CONFIG")).toBe(false);
        // cors() must be typed cors, so engine cross-file suppression works
        (0, vitest_1.expect)(result.globalMiddleware.some(m => m.type === "cors")).toBe(true);
    });
    (0, vitest_1.it)("should detect missing CORS", () => {
        const result = (0, express_detector_1.analyzeExpressApp)(INSECURE_APP);
        (0, vitest_1.expect)(result.issues.some(i => i.rule === "EXPRESS_NO_CORS_CONFIG")).toBe(true);
    });
    (0, vitest_1.it)("should flag no input validation on POST routes", () => {
        const result = (0, express_detector_1.analyzeExpressApp)(INSECURE_APP);
        (0, vitest_1.expect)(result.issues.some(i => i.rule === "EXPRESS_NO_INPUT_VALIDATION")).toBe(true);
    });
    (0, vitest_1.it)("should flag insecure session", () => {
        const insecureSession = `
      const app = require('express')();
      app.use(require('express-session')({ secret: 'x', cookie: {} }));
      app.listen(3000);
    `;
        const result = (0, express_detector_1.analyzeExpressApp)(insecureSession);
        (0, vitest_1.expect)(result.issues.some(i => i.rule === "EXPRESS_SESSION_INSECURE")).toBe(true);
    });
    (0, vitest_1.it)("should PASS a fully secured Express app", () => {
        const result = (0, express_detector_1.analyzeExpressApp)(SECURE_APP);
        const critical = result.issues.filter(i => i.severity === "critical");
        // /public route without explicit auth will trigger EXPRESS_ROUTE_MISSING_AUTH (high)
        // — that's correct behavior; public routes should be explicitly marked.
        // The KEY assertion: no CRITICAL issues (critical = BLOCKED decision)
        (0, vitest_1.expect)(critical.length).toBe(0);
    });
    (0, vitest_1.it)("should not flag public routes for auth", () => {
        const publicApp = `
      const app = require('express')();
      app.use(require('passport').initialize());
      app.get('/health', (req, res) => { res.send('ok'); });
      app.get('/login', (req, res) => { res.send('login'); });
      app.listen(3000);
    `;
        const result = (0, express_detector_1.analyzeExpressApp)(publicApp);
        const missingAuth = result.issues.filter(i => i.rule === "EXPRESS_ROUTE_MISSING_AUTH");
        // /health and /login are public, should not be flagged
        (0, vitest_1.expect)(missingAuth.length).toBe(0);
    });
});
(0, vitest_1.describe)("formatExpressReport", () => {
    (0, vitest_1.it)("should return a human-readable report", () => {
        const analysis = (0, express_detector_1.analyzeExpressApp)(INSECURE_APP);
        const report = (0, express_detector_1.formatExpressReport)(analysis);
        (0, vitest_1.expect)(report).toContain("Express App:");
        (0, vitest_1.expect)(report).toContain("Security Issues:");
    });
});
// ── V1 转正回归：接收者路由 / 路由级 auth / 逐路由缺失 / 真 app 门 / 前缀入口 ──
const ROUTER_MODULE = `
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
router.get('/articles', async (req, res) => { res.json([]); });
router.post('/articles', auth.required, async (req, res) => { res.json({}); });
router.post('/payments', async (req, res) => { res.json({}); });
module.exports = router;
`;
const ROUTER_WITH_LOGIN = `
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
router.post('/users/login', async (req, res) => { res.json({}); });   // 公开登录
router.post('/users', async (req, res) => { res.json({}); });          // 公开注册（有 login 姊妹）
router.put('/user', auth.required, async (req, res) => { res.json({}); });
module.exports = router;
`;
(0, vitest_1.describe)("express V1 转正回归", () => {
    (0, vitest_1.it)("router 接收者路由可提取（旧版只认 app.——20+ 路由只提取 1 条）", () => {
        const { routes } = (0, express_detector_1.analyzeExpressApp)(ROUTER_MODULE);
        (0, vitest_1.expect)(routes.some((r) => r.method === "post" && r.path === "/articles")).toBe(true);
    });
    (0, vitest_1.it)("路由级 auth.required 保护不报；同文件其他无认证 mutation 报 ROUTE_MISSING_AUTH", () => {
        const { issues } = (0, express_detector_1.analyzeExpressApp)(ROUTER_MODULE);
        const missing = issues.filter((i) => i.rule === "EXPRESS_ROUTE_MISSING_AUTH").map((i) => i.route);
        (0, vitest_1.expect)(missing).not.toContain("POST /articles");
        (0, vitest_1.expect)(missing).toContain("POST /payments");
        // 路由模块不是 app：NO_AUTH/NO_HELMET/NO_CORS 不报（V1 per-file 计数虚高修复）
        (0, vitest_1.expect)(issues.some((i) => i.rule === "EXPRESS_NO_AUTH_MIDDLEWARE")).toBe(false);
        (0, vitest_1.expect)(issues.some((i) => i.rule === "EXPRESS_NO_HELMET")).toBe(false);
    });
    (0, vitest_1.it)("前缀登录/注册入口豁免：/users/login 与 /users（姊妹佐证）不报", () => {
        const { issues } = (0, express_detector_1.analyzeExpressApp)(ROUTER_WITH_LOGIN);
        const missing = issues.filter((i) => i.rule === "EXPRESS_ROUTE_MISSING_AUTH").map((i) => i.route);
        (0, vitest_1.expect)(missing).not.toContain("POST /users/login");
        (0, vitest_1.expect)(missing).not.toContain("POST /users");
        (0, vitest_1.expect)(missing).not.toContain("PUT /user");
    });
    (0, vitest_1.it)("摘掉某条 auth.required（其余仍受保护）→ 该 mutation 报 ROUTE_MISSING_AUTH（敏感性）", () => {
        const twoProtected = ROUTER_MODULE.replace("router.post('/payments', async", "router.put('/admin', auth.required, async");
        const stripped = twoProtected.replace("router.post('/articles', auth.required,", "router.post('/articles',");
        const { issues } = (0, express_detector_1.analyzeExpressApp)(stripped);
        (0, vitest_1.expect)(issues.some((i) => i.rule === "EXPRESS_ROUTE_MISSING_AUTH" && i.route === "POST /articles")).toBe(true);
        (0, vitest_1.expect)(issues.some((i) => i.rule === "EXPRESS_ROUTE_MISSING_AUTH" && i.route === "PUT /admin")).toBe(false);
    });
});
