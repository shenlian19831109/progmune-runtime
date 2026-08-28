/**
 * flask-detector.test.ts — Flask 框架适配器规则回归（纯函数，无文件 I/O）
 */
import { describe, it, expect } from "vitest";
import { analyzeFlaskStructure } from "./flask-detector";
import type { FlaskStructure } from "./flask-detector";

function structure(partial: Partial<FlaskStructure>): FlaskStructure {
  return {
    hasFlask: true,
    apps: ["app"],
    blueprints: [],
    routes: [],
    beforeRequestAuth: [],
    filesScanned: 1,
    ...partial,
  };
}

const route = (p: {
  methods: string[]; handler: string; path?: string;
  authDecorators?: string[];
}) => ({
  methods: p.methods,
  path: p.path || "",
  handler: p.handler,
  file: "app.py",
  line: 1,
  target: "app",
  authDecorators: p.authDecorators || [],
});

describe("flask-detector", () => {
  it("R1：无保护 mutation 路由 → FLASK_ROUTE_NO_AUTH", () => {
    const { issues } = analyzeFlaskStructure(structure({
      routes: [route({ methods: ["POST"], handler: "transfer_money" })],
    }));
    expect(issues.map((i) => i.rule)).toContain("FLASK_ROUTE_NO_AUTH");
  });

  it("R1：@login_required 保护不报", () => {
    const { issues } = analyzeFlaskStructure(structure({
      routes: [route({
        methods: ["POST"], handler: "transfer_money",
        authDecorators: ["login_required"],
      })],
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1：before_request 认证守卫存在时不报（全局保护）", () => {
    const { issues } = analyzeFlaskStructure(structure({
      beforeRequestAuth: ["authenticate"],
      routes: [route({ methods: ["POST"], handler: "transfer_money" })],
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1：缺省 methods 的 GET 路由不报（Flask 缺省=GET only）", () => {
    const { issues } = analyzeFlaskStructure(structure({
      routes: [route({ methods: ["GET"], handler: "home" })],
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：login/regist 认证入口端点不报", () => {
    const { issues } = analyzeFlaskStructure(structure({
      routes: [
        route({ methods: ["POST"], path: "/login", handler: "login" }),
        route({ methods: ["POST"], path: "/register", handler: "register_user" }),
      ],
    }));
    expect(issues).toHaveLength(0);
  });

  it("非 Flask 结构不产生任何问题", () => {
    const { hasFlask, issues } = analyzeFlaskStructure(
      structure({ hasFlask: false, routes: [] })
    );
    expect(hasFlask).toBe(false);
    expect(issues).toHaveLength(0);
  });
});
