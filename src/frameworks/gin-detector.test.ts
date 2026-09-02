/**
 * gin-detector.test.ts — Gin 框架适配器规则回归（纯函数，无文件 I/O）
 */
import { describe, it, expect } from "vitest";
import { analyzeGinApp } from "./gin-detector";

const app = (routes: string, extra = ""): string => `
import "github.com/gin-gonic/gin"

func main() {
	r := gin.Default()
	${extra}
	${routes}
}
`;

describe("gin-detector", () => {
  it("R1：无认证中间件的 mutation 路由 → GIN_ROUTE_NO_AUTH", () => {
    const { issues } = analyzeGinApp(app(`
	r.POST("/transfer", func(c *gin.Context) {})
`));
    expect(issues.map((i) => i.rule)).toContain("GIN_ROUTE_NO_AUTH");
  });

  it("R1：路由级认证中间件保护不报", () => {
    const { issues } = analyzeGinApp(app(`
	r.POST("/transfer", authMiddleware, func(c *gin.Context) {})
`));
    expect(issues).toHaveLength(0);
  });

  it("R1：组级 Use 认证中间件保护不报", () => {
    const { issues } = analyzeGinApp(
      app(
        `r.POST("/transfer", func(c *gin.Context) {})`,
        `r.Use(authMiddleware)`
      )
    );
    expect(issues).toHaveLength(0);
  });

  it("R1：Group 认证中间件保护不报", () => {
    const { issues } = analyzeGinApp(app(`
	api := r.Group("/api", authMiddleware)
	api.POST("/transfer", func(c *gin.Context) {})
`));
    expect(issues).toHaveLength(0);
  });

  it("R1：非认证中间件（logger）不视为保护", () => {
    const { issues } = analyzeGinApp(app(`
	r.POST("/transfer", loggerMiddleware, func(c *gin.Context) {})
`));
    expect(issues.map((i) => i.rule)).toContain("GIN_ROUTE_NO_AUTH");
  });

  it("R1：GET 读操作不报", () => {
    const { issues } = analyzeGinApp(app(`
	r.GET("/articles", func(c *gin.Context) {})
`));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：login 认证入口路径不报", () => {
    const { issues } = analyzeGinApp(app(`
	r.POST("/login", func(c *gin.Context) {})
`));
    expect(issues).toHaveLength(0);
  });

  it("非 Gin 代码不产生任何问题", () => {
    const { hasGin, issues } = analyzeGinApp(`import express from "express";`);
    expect(hasGin).toBe(false);
    expect(issues).toHaveLength(0);
  });
});

// ── V7 修复轮回归：Use 点限定捕获 / 窗口边界 / 空路径 ──

describe("gin-detector V7 修复回归", () => {
  it("Use 点限定成员（users.AuthMiddleware）被识别为认证中间件（旧版只捕 'users'）", () => {
    const { issues, authGroupMiddleware } = analyzeGinApp(app(`
	v1 := r.Group("/api")
	v1.Use(users.AuthMiddleware(true))
	v1.POST("/pay", createPayment)
`));
    expect(authGroupMiddleware).toContain("users.AuthMiddleware");
    expect(issues).toHaveLength(0);
  });

  it("窗口不跨路由串扰：后面路由的认证中间件不保护前面的公开路由", () => {
    const { issues, routes } = analyzeGinApp(app(`
	v1.POST("/users", UsersRegistration)
	v1.POST("/articles", AuthMiddleware(), ArticleCreate)
`));
    const reg = routes.find((x) => x.path === "/users");
    const art = routes.find((x) => x.path === "/articles");
    expect(reg!.protected).toBe(false);
    expect(art!.protected).toBe(true);
    expect(issues.map((i) => i.route)).toContain("POST /users");
    expect(issues.map((i) => i.route)).not.toContain("POST /articles");
  });

  it("handler 名含 auth 词不误判为认证（UsersLogin 是 handler 不是中间件）", () => {
    const { routes } = analyzeGinApp(app(`
	v1.POST("/login", UsersLogin)
`));
    const login = routes.find((x) => x.path === "/login");
    expect(login!.protected).toBe(false);
  });

  it("空路径注册可见（realworld 惯用 POST(\"\", ...)）", () => {
    const { routes } = analyzeGinApp(app(`
	v1.POST("", UsersRegistration)
`));
    expect(routes.some((x) => x.path === "")).toBe(true);
  });
});
