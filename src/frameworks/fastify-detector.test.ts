/**
 * fastify-detector.test.ts — Fastify 框架适配器规则回归（纯函数，无文件 I/O）
 *
 * 代码串级分析（镜像 express-detector）：路由注册 + preHandler/preValidation
 * 认证选项 + addHook 认证钩子。
 */
import { describe, it, expect } from "vitest";
import { analyzeFastifyApp, analyzeFastifyFile } from "./fastify-detector";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const app = (routes: string, hooks = ""): string => `
import Fastify from "fastify";
const fastify = Fastify();
${routes}
${hooks}
`;

describe("fastify-detector", () => {
  it("R1：无保护 mutation 路由 → FASTIFY_ROUTE_NO_AUTH", () => {
    const { issues } = analyzeFastifyApp(app(`
fastify.post("/transfer", async (req, reply) => ({ ok: true }));
`));
    expect(issues.map((i) => i.rule)).toContain("FASTIFY_ROUTE_NO_AUTH");
  });

  it("R1：preHandler 认证选项保护不报", () => {
    const { issues } = analyzeFastifyApp(app(`
fastify.post("/transfer", { preHandler: [authenticate] }, async (req, reply) => ({ ok: true }));
`));
    expect(issues).toHaveLength(0);
  });

  it("R1：preValidation 认证选项保护不报", () => {
    const { issues } = analyzeFastifyApp(app(`
fastify.put("/update", { preValidation: [checkToken] }, async (req, reply) => ({ ok: true }));
`));
    expect(issues).toHaveLength(0);
  });

  it("R1：addHook 认证钩子全局保护不报", () => {
    const { issues } = analyzeFastifyApp(
      app(
        `fastify.post("/transfer", async (req, reply) => ({ ok: true }));`,
        `fastify.addHook("preHandler", authenticate);`
      )
    );
    expect(issues).toHaveLength(0);
  });

  it("R1：非认证 addHook（如日志）不视为保护", () => {
    const { issues } = analyzeFastifyApp(
      app(
        `fastify.post("/transfer", async (req, reply) => ({ ok: true }));`,
        `fastify.addHook("onRequest", logRequest);`
      )
    );
    expect(issues.map((i) => i.rule)).toContain("FASTIFY_ROUTE_NO_AUTH");
  });

  it("R1：GET 读操作不报", () => {
    const { issues } = analyzeFastifyApp(app(`
fastify.get("/articles", async (req, reply) => ({ items: [] }));
`));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：login/regist/token 认证入口路径不报", () => {
    const { issues } = analyzeFastifyApp(app(`
fastify.post("/login", async (req, reply) => ({ token: "t" }));
fastify.post("/register", async (req, reply) => ({ ok: true }));
`));
    expect(issues).toHaveLength(0);
  });

  it("非 Fastify 代码不产生任何问题", () => {
    const { hasFastify, issues } = analyzeFastifyApp(
      `import express from "express"; const app = express(); app.post("/x", h);`
    );
    expect(hasFastify).toBe(false);
    expect(issues).toHaveLength(0);
  });
});

// ── V2 结构性重写回归：object-form / onRequest / plugin 门 / register 豁免 ──

describe("fastify-detector object-form 路由（V2 修复回归）", () => {
  it("server.route({method,path,onRequest:[server.authenticate]}) 受保护不报", () => {
    const { issues, routes } = analyzeFastifyApp(app(`
server.route({
  method: 'POST',
  path: options.prefix + 'articles',
  onRequest: [server.authenticate],
  handler: onCreate
});
`));
    expect(routes.find((r) => r.path === "articles")!.protected).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("object-form 无认证 mutation → 报", () => {
    const { issues } = analyzeFastifyApp(app(`
server.route({
  method: 'POST',
  path: options.prefix + 'payments',
  handler: onPay
});
`));
    expect(issues.map((i) => i.route)).toContain("POST payments");
  });

  it("点限定 server.authenticate 在 onRequest 数组被识别（词表含 auth）", () => {
    const { routes } = analyzeFastifyApp(app(`
server.route({ method: 'DELETE', path: 'x', onRequest: [server.authenticate], handler: h });
`));
    expect(routes[0]!.protected).toBe(true);
  });

  it("register 集合豁免：POST users（有 users/login 姊妹）不报", () => {
    const { issues } = analyzeFastifyApp(app(`
server.route({ method: 'POST', path: options.prefix + 'users/login', handler: onLogin });
server.route({ method: 'POST', path: options.prefix + 'users', handler: onRegister });
`));
    expect(issues.map((i) => i.route)).not.toContain("POST users");
    expect(issues.map((i) => i.route)).not.toContain("POST users/login");
  });
});

describe("fastify-detector plugin 门（V2 修复回归）", () => {
  it("fastify-plugin 模块（fp(plugin) 路由文件）现可被分析", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fastify-det-"));
    try {
      const fp = path.join(dir, "routes-users.js");
      fs.writeFileSync(fp, `
const fp = require('fastify-plugin')
async function users (server, options, done) {
  server.route({ method: 'POST', path: 'articles', onRequest: [server.authenticate], handler: h })
  server.route({ method: 'POST', path: 'open', handler: h })
}
module.exports = fp(users)
`);
      const a = analyzeFastifyFile(fp);
      expect(a).not.toBeNull();
      expect(a!.routes.length).toBe(2);
      expect(a!.issues.map((i) => i.route)).toContain("POST open");
      expect(a!.issues.map((i) => i.route)).not.toContain("POST articles");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
