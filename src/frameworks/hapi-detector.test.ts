/**
 * hapi-detector.test.ts — Hapi 框架适配器规则回归（纯函数，无文件 I/O）
 */
import { describe, it, expect } from "vitest";
import { analyzeHapiApp } from "./hapi-detector";

const app = (routes: string, extra = ""): string => `
import Hapi from "@hapi/hapi";
const server = Hapi.server({ port: 3000 });
${extra}
${routes}
`;

describe("hapi-detector", () => {
  it("R1：无 auth 字段的 mutation 路由 → HAPI_ROUTE_NO_AUTH", () => {
    const { issues } = analyzeHapiApp(app(`
server.route({ method: "POST", path: "/transfer", handler: () => "ok" });
`));
    expect(issues.map((i) => i.rule)).toContain("HAPI_ROUTE_NO_AUTH");
  });

  it("R1：options.auth 策略引用保护不报", () => {
    const { issues } = analyzeHapiApp(app(`
server.route({ method: "POST", path: "/transfer", options: { auth: "jwt" }, handler: () => "ok" });
`));
    expect(issues).toHaveLength(0);
  });

  it("R1：auth 对象形态（strategy 字段）保护不报", () => {
    const { issues } = analyzeHapiApp(app(`
server.route({ method: "PUT", path: "/update", options: { auth: { strategy: "jwt" } }, handler: () => "ok" });
`));
    expect(issues).toHaveLength(0);
  });

  it("R1：显式 auth: false → 报（显式公开 mutation）", () => {
    const { issues } = analyzeHapiApp(app(`
server.route({ method: "POST", path: "/transfer", options: { auth: false }, handler: () => "ok" });
`));
    expect(issues.map((i) => i.rule)).toContain("HAPI_ROUTE_NO_AUTH");
  });

  it("R1：GET 读操作不报", () => {
    const { issues } = analyzeHapiApp(app(`
server.route({ method: "GET", path: "/articles", handler: () => [] });
`));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：login 认证入口路径不报", () => {
    const { issues } = analyzeHapiApp(app(`
server.route({ method: "POST", path: "/login", handler: () => "token" });
`));
    expect(issues).toHaveLength(0);
  });

  it("策略声明被记录（auth.strategy 提取）", () => {
    const { strategies } = analyzeHapiApp(app(
      `server.route({ method: "GET", path: "/me", options: { auth: "jwt" }, handler: () => "me" });`,
      `server.auth.strategy("jwt", "jwt", { keys: ["secret"] });`
    ));
    expect(strategies).toContain("jwt");
  });

  it("非 Hapi 代码不产生任何问题", () => {
    const { hasHapi, issues } = analyzeHapiApp(
      `import express from "express"; const app = express(); app.post("/x", h);`
    );
    expect(hasHapi).toBe(false);
    expect(issues).toHaveLength(0);
  });
});

// ── V6 修复轮回归：v16 时代 require('hapi') gate 兼容 ──

describe("hapi-detector V6 gate 修复回归", () => {
  it("v16 形态 require('hapi') + server.route 可被分析（旧 gate 只认 @hapi-scoped）", () => {
    const code = `
const Hapi = require("hapi");
const server = new Hapi.Server();
server.connection({ port: 3000 });
server.auth.strategy("jwt", "jwt", { key: "s" });
server.route({ method: "POST", path: "/articles", config: { auth: "jwt" }, handler: (r, reply) => reply({}) });
server.route({ method: "POST", path: "/payments", handler: (r, reply) => reply({}) });
`;
    const { hasHapi, strategies, routes, issues } = analyzeHapiApp(code);
    expect(hasHapi).toBe(true);
    expect(strategies).toContain("jwt");
    const articles = routes.find((r) => r.path === "/articles");
    const payments = routes.find((r) => r.path === "/payments");
    expect(articles).toBeDefined();
    expect(articles!.authOption).toBe("jwt"); // config.auth 嵌套亦被窗口文本捕获
    expect(issues.map((i) => i.rule)).toContain("HAPI_ROUTE_NO_AUTH");
    expect(issues.map((i) => i.route)).not.toContain("POST /articles");
  });

  it("gate 不误收 hapi-auth-jwt2（require('hapi') 需闭合引号紧随）", () => {
    const { hasHapi } = analyzeHapiApp(`
const hapiAuth = require("hapi-auth-jwt2");
module.exports = (server) => { return []; };
`);
    expect(hasHapi).toBe(false);
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

describe("hapi 声明式数组路由（V6 修复回归）", () => {
  it("module.exports=(server)+数组路由对象被识别，config.auth 保护生效", () => {
    const { hasHapi, routes, issues } = analyzeHapiApp(DECLARATIVE);
    expect(hasHapi).toBe(true);
    expect(routes.length).toBe(3);
    const create = routes.find((r) => r.method === "post" && r.path === "/articles");
    expect(create!.authOption).toBe("jwt");
    const missing = issues.filter((i) => i.rule === "HAPI_ROUTE_NO_AUTH").map((i) => i.route);
    expect(missing).toContain("POST /payments");
    expect(missing).not.toContain("POST /articles");
  });

  it("摘 config.auth → mutation 报（敏感性）", () => {
    const stripped = DECLARATIVE.replace(
      "config: { auth: 'jwt', response: {} }",
      "config: { response: {} }"
    );
    const { issues } = analyzeHapiApp(stripped);
    expect(issues.some((i) => i.rule === "HAPI_ROUTE_NO_AUTH" && i.route === "POST /articles")).toBe(true);
  });

  it("register/login 公开：users/login + users（姊妹佐证）不报", () => {
    const { issues } = analyzeHapiApp(DECLARATIVE_USERS);
    const missing = issues.filter((i) => i.rule === "HAPI_ROUTE_NO_AUTH").map((i) => i.route);
    expect(missing).not.toContain("POST /users/login");
    expect(missing).not.toContain("POST /users");
    expect(missing).not.toContain("PUT /user");
  });
});
