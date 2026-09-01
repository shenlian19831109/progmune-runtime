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
