"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * hapi-detector.test.ts — Hapi 框架适配器规则回归（纯函数，无文件 I/O）
 */
const vitest_1 = require("vitest");
const hapi_detector_1 = require("./hapi-detector");
const app = (routes, extra = "") => `
import Hapi from "@hapi/hapi";
const server = Hapi.server({ port: 3000 });
${extra}
${routes}
`;
(0, vitest_1.describe)("hapi-detector", () => {
    (0, vitest_1.it)("R1：无 auth 字段的 mutation 路由 → HAPI_ROUTE_NO_AUTH", () => {
        const { issues } = (0, hapi_detector_1.analyzeHapiApp)(app(`
server.route({ method: "POST", path: "/transfer", handler: () => "ok" });
`));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("HAPI_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：options.auth 策略引用保护不报", () => {
        const { issues } = (0, hapi_detector_1.analyzeHapiApp)(app(`
server.route({ method: "POST", path: "/transfer", options: { auth: "jwt" }, handler: () => "ok" });
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：auth 对象形态（strategy 字段）保护不报", () => {
        const { issues } = (0, hapi_detector_1.analyzeHapiApp)(app(`
server.route({ method: "PUT", path: "/update", options: { auth: { strategy: "jwt" } }, handler: () => "ok" });
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：显式 auth: false → 报（显式公开 mutation）", () => {
        const { issues } = (0, hapi_detector_1.analyzeHapiApp)(app(`
server.route({ method: "POST", path: "/transfer", options: { auth: false }, handler: () => "ok" });
`));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("HAPI_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：GET 读操作不报", () => {
        const { issues } = (0, hapi_detector_1.analyzeHapiApp)(app(`
server.route({ method: "GET", path: "/articles", handler: () => [] });
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1 豁免：login 认证入口路径不报", () => {
        const { issues } = (0, hapi_detector_1.analyzeHapiApp)(app(`
server.route({ method: "POST", path: "/login", handler: () => "token" });
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("策略声明被记录（auth.strategy 提取）", () => {
        const { strategies } = (0, hapi_detector_1.analyzeHapiApp)(app(`server.route({ method: "GET", path: "/me", options: { auth: "jwt" }, handler: () => "me" });`, `server.auth.strategy("jwt", "jwt", { keys: ["secret"] });`));
        (0, vitest_1.expect)(strategies).toContain("jwt");
    });
    (0, vitest_1.it)("非 Hapi 代码不产生任何问题", () => {
        const { hasHapi, issues } = (0, hapi_detector_1.analyzeHapiApp)(`import express from "express"; const app = express(); app.post("/x", h);`);
        (0, vitest_1.expect)(hasHapi).toBe(false);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
});
// ── V6 修复轮回归：v16 时代 require('hapi') gate 兼容 ──
(0, vitest_1.describe)("hapi-detector V6 gate 修复回归", () => {
    (0, vitest_1.it)("v16 形态 require('hapi') + server.route 可被分析（旧 gate 只认 @hapi-scoped）", () => {
        const code = `
const Hapi = require("hapi");
const server = new Hapi.Server();
server.connection({ port: 3000 });
server.auth.strategy("jwt", "jwt", { key: "s" });
server.route({ method: "POST", path: "/articles", config: { auth: "jwt" }, handler: (r, reply) => reply({}) });
server.route({ method: "POST", path: "/payments", handler: (r, reply) => reply({}) });
`;
        const { hasHapi, strategies, routes, issues } = (0, hapi_detector_1.analyzeHapiApp)(code);
        (0, vitest_1.expect)(hasHapi).toBe(true);
        (0, vitest_1.expect)(strategies).toContain("jwt");
        const articles = routes.find((r) => r.path === "/articles");
        const payments = routes.find((r) => r.path === "/payments");
        (0, vitest_1.expect)(articles).toBeDefined();
        (0, vitest_1.expect)(articles.authOption).toBe("jwt"); // config.auth 嵌套亦被窗口文本捕获
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("HAPI_ROUTE_NO_AUTH");
        (0, vitest_1.expect)(issues.map((i) => i.route)).not.toContain("POST /articles");
    });
    (0, vitest_1.it)("gate 不误收 hapi-auth-jwt2（require('hapi') 需闭合引号紧随）", () => {
        const { hasHapi } = (0, hapi_detector_1.analyzeHapiApp)(`
const hapiAuth = require("hapi-auth-jwt2");
module.exports = (server) => { return []; };
`);
        (0, vitest_1.expect)(hasHapi).toBe(false);
    });
});
// ── V6 遗留缺口：声明式数组路由 + config.auth 嵌套 ──
const DECLARATIVE = `
module.exports = (server) => {
  const handlers = require('./handlers')(server)
  return [
    // GET 公开
    {
      method: 'GET',
      path: '/articles',
      config: { description: 'list' },
      handler: handlers.list
    },
    // mutation 受保护（config.auth 嵌套）
    {
      method: 'POST',
      path: '/articles',
      config: { auth: 'jwt', response: {} },
      handler: handlers.create
    },
    // 无认证 mutation
    {
      method: 'POST',
      path: '/payments',
      config: {},
      handler: handlers.pay
    }
  ]
}
`;
const DECLARATIVE_USERS = `
module.exports = (server) => {
  return [
    { method: 'POST', path: '/users/login', config: {}, handler: h },
    { method: 'POST', path: '/users', config: {}, handler: h },
    { method: 'PUT', path: '/user', config: { auth: 'jwt' }, handler: h }
  ]
}
`;
(0, vitest_1.describe)("hapi 声明式数组路由（V6 修复回归）", () => {
    (0, vitest_1.it)("module.exports=(server)+数组路由对象被识别，config.auth 保护生效", () => {
        const { hasHapi, routes, issues } = (0, hapi_detector_1.analyzeHapiApp)(DECLARATIVE);
        (0, vitest_1.expect)(hasHapi).toBe(true);
        (0, vitest_1.expect)(routes.length).toBe(3);
        const create = routes.find((r) => r.method === "post" && r.path === "/articles");
        (0, vitest_1.expect)(create.authOption).toBe("jwt");
        const missing = issues.filter((i) => i.rule === "HAPI_ROUTE_NO_AUTH").map((i) => i.route);
        (0, vitest_1.expect)(missing).toContain("POST /payments");
        (0, vitest_1.expect)(missing).not.toContain("POST /articles");
    });
    (0, vitest_1.it)("摘 config.auth → mutation 报（敏感性）", () => {
        const stripped = DECLARATIVE.replace("config: { auth: 'jwt', response: {} }", "config: { response: {} }");
        const { issues } = (0, hapi_detector_1.analyzeHapiApp)(stripped);
        (0, vitest_1.expect)(issues.some((i) => i.rule === "HAPI_ROUTE_NO_AUTH" && i.route === "POST /articles")).toBe(true);
    });
    (0, vitest_1.it)("register/login 公开：users/login + users（姊妹佐证）不报", () => {
        const { issues } = (0, hapi_detector_1.analyzeHapiApp)(DECLARATIVE_USERS);
        const missing = issues.filter((i) => i.rule === "HAPI_ROUTE_NO_AUTH").map((i) => i.route);
        (0, vitest_1.expect)(missing).not.toContain("POST /users/login");
        (0, vitest_1.expect)(missing).not.toContain("POST /users");
        (0, vitest_1.expect)(missing).not.toContain("PUT /user");
    });
});
