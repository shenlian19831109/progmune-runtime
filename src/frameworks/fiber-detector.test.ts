/**
 * fiber-detector.test.ts — Fiber 框架适配器规则回归（纯函数，无文件 I/O）
 */
import { describe, it, expect } from "vitest";
import { analyzeFiberApp, fiberProtectedRegisterFns, fiberEnclosingFunc, analyzeFiberProject } from "./fiber-detector";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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

// ── V8 修复轮回归：窗口边界（单点摘保护不再被后续路由掩盖）──

describe("fiber-detector V8 修复回归", () => {
  it("窗口不跨路由串扰：下一路由的 Protected 不掩盖上一路由摘保护", () => {
    const { issues, routes } = analyzeFiberApp(app(`
	api.Post("/logout", logoutHandler)
	api.Post("/refresh-token", middleware.Protected(), refreshHandler)
`));
    const logout = routes.find((x) => x.path === "/logout");
    const refresh = routes.find((x) => x.path === "/refresh-token");
    expect(logout!.protected).toBe(false);
    expect(refresh!.protected).toBe(true);
    expect(issues.map((i) => i.route)).toContain("POST /logout");
    expect(issues.map((i) => i.route)).not.toContain("POST /refresh-token");
  });

  it("handler 名含 auth 词不误判（logoutHandler 不被当认证）", () => {
    const { routes } = analyzeFiberApp(app(`
	api.Post("/logout", authHandler.Logout)
`));
    expect(routes.find((x) => x.path === "/logout")!.protected).toBe(false);
  });
});

// ── Fiber 组认证跨文件传播（gin 同款模型移植）──

const FBOOT = `package main
import "github.com/gofiber/fiber/v2"
func main() {
	app := fiber.New()
	api := app.Group("/api")
	users.UsersRegister(api.Group("/users"))
	api.Use(middleware.Protected())
	users.UserRegister(api.Group("/user"))
	articles.ArticlesRegister(api.Group("/articles"))
}
`;

const FROUTERS = `package users
import "github.com/gofiber/fiber/v2"
func UsersRegister(router fiber.Router) {
	router.Post("/login", UsersLogin)
	router.Post("", UsersRegistration)
}
func UserRegister(router fiber.Router) {
	router.Put("", UserUpdate)
}
`;

describe("fiberProtectedRegisterFns 组认证相位", () => {
  it("Use 之后的 Register 受保护，Use 之前的公开", () => {
    const p = fiberProtectedRegisterFns(FBOOT);
    expect(p.get("UserRegister")).toBe(true);
    expect(p.get("ArticlesRegister")).toBe(true);
    expect(p.get("UsersRegister")).toBeUndefined();
  });
});

describe("fiberEnclosingFunc 归属", () => {
  it("按 func 头行号归属", () => {
    // FROUTERS：1 package / 2 import / 3 func UsersRegister / 6 func UserRegister
    expect(fiberEnclosingFunc(FROUTERS, 4)).toBe("UsersRegister");
    expect(fiberEnclosingFunc(FROUTERS, 7)).toBe("UserRegister");
  });
});

describe("analyzeFiberProject 跨文件传播", () => {
  function makeProject(withUse: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-proj-"));
    const boot = withUse ? FBOOT : FBOOT.replace(/\s*api\.Use\(middleware\.Protected\(\)\)\n/, "");
    fs.writeFileSync(path.join(dir, "main.go"), boot);
    fs.writeFileSync(path.join(dir, "routers.go"), FROUTERS);
    return dir;
  }

  it("Use 保护下跨文件 mutation 不报", () => {
    const dir = makeProject(true);
    try {
      const a = analyzeFiberProject(dir);
      expect(a.issues.filter((i) => i.rule === "FIBER_ROUTE_NO_AUTH")).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("删 Use → mutation 重现（敏感性保留）", () => {
    const dir = makeProject(false);
    try {
      const a = analyzeFiberProject(dir);
      const routes = a.issues.filter((i) => i.rule === "FIBER_ROUTE_NO_AUTH").map((i) => i.route);
      expect(routes).toContain("PUT "); // UserRegister mutation 重现
      // POST "" 是 register（/login 姊妹佐证豁免，公开）——不报正确
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 多层 Register 链（journalist 式 main→api(Group+Use)→v1→模块）──

function makeNestedProject(withUse: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-nest-"));
  const mk = (rel: string, content: string) => {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  };
  mk("main/main.go", `package main
import "github.com/gofiber/fiber/v2"
func main() {
	app := fiber.New()
	api.Register(app)
}
`);
  mk("api/api.go", `package api
import "github.com/gofiber/fiber/v2"
func Register(fiberApp *fiber.App) {
	api := fiberApp.Group("/api")
${withUse ? "\tapi.Use(middleware.Protected())\n" : ""}\tv1.Register(&api)
}
`);
  mk("v1/v1.go", `package v1
import "github.com/gofiber/fiber/v2"
func Register(router *fiber.Router) {
	feeds.Register(router)
}
`);
  mk("feeds/feeds.go", `package feeds
import "github.com/gofiber/fiber/v2"
func Register(router *fiber.Router) {
	router.Post("/", CreateFeed)
	router.Put("/:id", UpdateFeed)
}
`);
  return dir;
}

describe("analyzeFiberProject 多层 Register 链（journalist 式）", () => {
  it("api(Group+Use)→v1→feeds 链：跨层 mutation 不报", () => {
    const dir = makeNestedProject(true);
    try {
      const a = analyzeFiberProject(dir);
      expect(a.issues.filter((i) => i.rule === "FIBER_ROUTE_NO_AUTH")).toHaveLength(0);
      expect(a.protectedFunctions).toContain("feeds:Register");
      expect(a.protectedFunctions).toContain("v1:Register");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("删中间层 api.Use → feeds mutation 重现（敏感性穿透多层）", () => {
    const dir = makeNestedProject(false);
    try {
      const a = analyzeFiberProject(dir);
      const routes = a.issues.filter((i) => i.rule === "FIBER_ROUTE_NO_AUTH").map((i) => i.route);
      expect(routes).toContain("POST /");
      expect(routes).toContain("PUT /:id");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
