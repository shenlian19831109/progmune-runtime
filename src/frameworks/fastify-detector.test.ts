/**
 * fastify-detector.test.ts — Fastify 框架适配器规则回归（纯函数，无文件 I/O）
 *
 * 代码串级分析（镜像 express-detector）：路由注册 + preHandler/preValidation
 * 认证选项 + addHook 认证钩子。
 */
import { describe, it, expect } from "vitest";
import { analyzeFastifyApp } from "./fastify-detector";

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
