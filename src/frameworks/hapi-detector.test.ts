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
