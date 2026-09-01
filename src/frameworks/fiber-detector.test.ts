/**
 * fiber-detector.test.ts — Fiber 框架适配器规则回归（纯函数，无文件 I/O）
 */
import { describe, it, expect } from "vitest";
import { analyzeFiberApp } from "./fiber-detector";

const app = (routes: string, extra = ""): string => `
import "github.com/gofiber/fiber/v2"

func main() {
	app := fiber.New()
	${extra}
	${routes}
}
`;

describe("fiber-detector", () => {
  it("R1：无认证中间件的 mutation 路由 → FIBER_ROUTE_NO_AUTH", () => {
    const { issues } = analyzeFiberApp(app(`
	app.Post("/transfer", func(c *fiber.Ctx) error { return nil })
`));
    expect(issues.map((i) => i.rule)).toContain("FIBER_ROUTE_NO_AUTH");
  });

  it("R1：路由级认证中间件保护不报", () => {
    const { issues } = analyzeFiberApp(app(`
	app.Post("/transfer", authMiddleware, func(c *fiber.Ctx) error { return nil })
`));
    expect(issues).toHaveLength(0);
  });

  it("R1：全局 Use 认证中间件保护不报", () => {
    const { issues } = analyzeFiberApp(
      app(
        `app.Post("/transfer", func(c *fiber.Ctx) error { return nil })`,
        `app.Use(authMiddleware)`
      )
    );
    expect(issues).toHaveLength(0);
  });

  it("R1：非认证中间件不视为保护", () => {
    const { issues } = analyzeFiberApp(app(`
	app.Post("/transfer", logger, func(c *fiber.Ctx) error { return nil })
`));
    expect(issues.map((i) => i.rule)).toContain("FIBER_ROUTE_NO_AUTH");
  });

  it("R1：GET 读操作不报", () => {
    const { issues } = analyzeFiberApp(app(`
	app.Get("/articles", func(c *fiber.Ctx) error { return nil })
`));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：login 认证入口路径不报", () => {
    const { issues } = analyzeFiberApp(app(`
	app.Post("/login", func(c *fiber.Ctx) error { return nil })
`));
    expect(issues).toHaveLength(0);
  });

  it("非 Fiber 代码不产生任何问题", () => {
    const { hasFiber, issues } = analyzeFiberApp(`import express from "express";`);
    expect(hasFiber).toBe(false);
    expect(issues).toHaveLength(0);
  });
});
