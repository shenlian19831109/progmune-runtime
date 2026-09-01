/**
 * koa-detector.test.ts — Koa 框架适配器规则回归（纯函数，无文件 I/O）
 */
import { describe, it, expect } from "vitest";
import { analyzeKoaApp } from "./koa-detector";

const app = (routes: string, extra = ""): string => `
import Koa from "koa";
import Router from "@koa/router";
const app = new Koa();
const router = new Router();
${extra}
${routes}
app.use(router.routes());
`;

describe("koa-detector", () => {
  it("R1：无认证中间件的 mutation 路由 → KOA_ROUTE_NO_AUTH", () => {
    const { issues } = analyzeKoaApp(app(`
router.post("/transfer", async (ctx) => { ctx.body = "ok"; });
`));
    expect(issues.map((i) => i.rule)).toContain("KOA_ROUTE_NO_AUTH");
  });

  it("R1：路由级认证中间件保护不报", () => {
    const { issues } = analyzeKoaApp(app(`
router.post("/transfer", authenticate, async (ctx) => { ctx.body = "ok"; });
`));
    expect(issues).toHaveLength(0);
  });

  it("R1：全局 app.use 认证中间件保护不报", () => {
    const { issues } = analyzeKoaApp(
      app(
        `router.post("/transfer", async (ctx) => { ctx.body = "ok"; });`,
        `app.use(authenticate);`
      )
    );
    expect(issues).toHaveLength(0);
  });

  it("R1：非认证中间件（日志）不视为保护", () => {
    const { issues } = analyzeKoaApp(app(`
router.post("/transfer", logger, async (ctx) => { ctx.body = "ok"; });
`));
    expect(issues.map((i) => i.rule)).toContain("KOA_ROUTE_NO_AUTH");
  });

  it("R1：GET 读操作不报", () => {
    const { issues } = analyzeKoaApp(app(`
router.get("/articles", async (ctx) => { ctx.body = []; });
`));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：login 认证入口路径不报", () => {
    const { issues } = analyzeKoaApp(app(`
router.post("/login", async (ctx) => { ctx.body = "token"; });
`));
    expect(issues).toHaveLength(0);
  });

  it("非 Koa 代码不产生任何问题", () => {
    const { hasKoa, issues } = analyzeKoaApp(
      `import express from "express"; const app = express(); app.post("/x", h);`
    );
    expect(hasKoa).toBe(false);
    expect(issues).toHaveLength(0);
  });
});
