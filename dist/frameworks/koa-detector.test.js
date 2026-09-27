"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * koa-detector.test.ts — Koa 框架适配器规则回归（纯函数，无文件 I/O）
 */
const vitest_1 = require("vitest");
const koa_detector_1 = require("./koa-detector");
const app = (routes, extra = "") => `
import Koa from "koa";
import Router from "@koa/router";
const app = new Koa();
const router = new Router();
${extra}
${routes}
app.use(router.routes());
`;
(0, vitest_1.describe)("koa-detector", () => {
    (0, vitest_1.it)("R1：无认证中间件的 mutation 路由 → KOA_ROUTE_NO_AUTH", () => {
        const { issues } = (0, koa_detector_1.analyzeKoaApp)(app(`
router.post("/transfer", async (ctx) => { ctx.body = "ok"; });
`));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("KOA_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：路由级认证中间件保护不报", () => {
        const { issues } = (0, koa_detector_1.analyzeKoaApp)(app(`
router.post("/transfer", authenticate, async (ctx) => { ctx.body = "ok"; });
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：全局 app.use 认证中间件保护不报", () => {
        const { issues } = (0, koa_detector_1.analyzeKoaApp)(app(`router.post("/transfer", async (ctx) => { ctx.body = "ok"; });`, `app.use(authenticate);`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：非认证中间件（日志）不视为保护", () => {
        const { issues } = (0, koa_detector_1.analyzeKoaApp)(app(`
router.post("/transfer", logger, async (ctx) => { ctx.body = "ok"; });
`));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("KOA_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：GET 读操作不报", () => {
        const { issues } = (0, koa_detector_1.analyzeKoaApp)(app(`
router.get("/articles", async (ctx) => { ctx.body = []; });
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1 豁免：login 认证入口路径不报", () => {
        const { issues } = (0, koa_detector_1.analyzeKoaApp)(app(`
router.post("/login", async (ctx) => { ctx.body = "token"; });
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("非 Koa 代码不产生任何问题", () => {
        const { hasKoa, issues } = (0, koa_detector_1.analyzeKoaApp)(`import express from "express"; const app = express(); app.post("/x", h);`);
        (0, vitest_1.expect)(hasKoa).toBe(false);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("回归：窗口不跨路由串扰——公开路由后面的 auth 路由不再把它洗成 protected（修复 300 字符 bleed）", () => {
        const { issues, routes } = (0, koa_detector_1.analyzeKoaApp)(app(`
router.post("/users", ctrl.post);            // 公开 register —— 应报
router.post("/articles", auth, ctrl.create); // 受保护 —— 不报
`));
        const register = routes.find((r) => r.path === "/users");
        const article = routes.find((r) => r.path === "/articles");
        (0, vitest_1.expect)(register.protected).toBe(false);
        (0, vitest_1.expect)(article.protected).toBe(true);
        (0, vitest_1.expect)(issues.map((i) => i.route)).toContain("POST /users");
        (0, vitest_1.expect)(issues.map((i) => i.route)).not.toContain("POST /articles");
    });
    (0, vitest_1.it)("回归：config.get('secret') 不再是幻影路由（接收者限定 router/app）", () => {
        const { routes } = (0, koa_detector_1.analyzeKoaApp)(app(`
const secret = config.get("secret");
router.post("/x", auth, h);
`));
        (0, vitest_1.expect)(routes.map((r) => r.path)).not.toContain("secret");
        (0, vitest_1.expect)(routes.map((r) => r.path)).toContain("/x");
    });
});
(0, vitest_1.describe)("koa-detector register 集合豁免（语义层）", () => {
    (0, vitest_1.it)("有 /users/login 姊妹佐证：POST /users（公开注册）不报", () => {
        const { issues } = (0, koa_detector_1.analyzeKoaApp)(app(`
router.post("/users/login", ctrl.login);
router.post("/users", ctrl.register);
router.post("/articles", auth, ctrl.create);
`));
        (0, vitest_1.expect)(issues.map((i) => i.route)).not.toContain("POST /users");
        (0, vitest_1.expect)(issues.map((i) => i.route)).not.toContain("POST /users/login");
        (0, vitest_1.expect)(issues.map((i) => i.route)).not.toContain("POST /articles");
    });
    (0, vitest_1.it)("无姊妹佐证：POST /users 仍报（管理员建用户类端点不豁免）", () => {
        const { issues } = (0, koa_detector_1.analyzeKoaApp)(app(`
router.post("/users", ctrl.createUser);
`));
        (0, vitest_1.expect)(issues.map((i) => i.route)).toContain("POST /users");
    });
});
