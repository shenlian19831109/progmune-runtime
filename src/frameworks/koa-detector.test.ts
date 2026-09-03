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

  it("回归：窗口不跨路由串扰——公开路由后面的 auth 路由不再把它洗成 protected（修复 300 字符 bleed）", () => {
    const { issues, routes } = analyzeKoaApp(app(`
router.post("/users", ctrl.post);            // 公开 register —— 应报
router.post("/articles", auth, ctrl.create); // 受保护 —— 不报
`));
    const register = routes.find((r) => r.path === "/users");
    const article = routes.find((r) => r.path === "/articles");
    expect(register!.protected).toBe(false);
    expect(article!.protected).toBe(true);
    expect(issues.map((i) => i.route)).toContain("POST /users");
    expect(issues.map((i) => i.route)).not.toContain("POST /articles");
  });

  it("回归：config.get('secret') 不再是幻影路由（接收者限定 router/app）", () => {
    const { routes } = analyzeKoaApp(app(`
const secret = config.get("secret");
router.post("/x", auth, h);
`));
    expect(routes.map((r) => r.path)).not.toContain("secret");
    expect(routes.map((r) => r.path)).toContain("/x");
  });
});

describe("koa-detector register 集合豁免（语义层）", () => {
  it("有 /users/login 姊妹佐证：POST /users（公开注册）不报", () => {
    const { issues } = analyzeKoaApp(app(`
router.post("/users/login", ctrl.login);
router.post("/users", ctrl.register);
router.post("/articles", auth, ctrl.create);
`));
    expect(issues.map((i) => i.route)).not.toContain("POST /users");
    expect(issues.map((i) => i.route)).not.toContain("POST /users/login");
    expect(issues.map((i) => i.route)).not.toContain("POST /articles");
  });

  it("无姊妹佐证：POST /users 仍报（管理员建用户类端点不豁免）", () => {
    const { issues } = analyzeKoaApp(app(`
router.post("/users", ctrl.createUser);
`));
    expect(issues.map((i) => i.route)).toContain("POST /users");
  });
});
