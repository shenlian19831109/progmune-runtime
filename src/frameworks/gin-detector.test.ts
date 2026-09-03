/**
 * gin-detector.test.ts — Gin 框架适配器规则回归（纯函数，无文件 I/O）
 */
import { describe, it, expect } from "vitest";
import { analyzeGinApp, ginProtectedRegisterFns, ginEnclosingFunc, analyzeGinProject } from "./gin-detector";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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

// ── register 集合豁免（语义层）──

describe("gin-detector register 集合豁免", () => {
  it("有 /login 姊妹佐证：POST \"\"/\"/\"（公开注册双注册）不报", () => {
    const { issues } = analyzeGinApp(app(`
	v1.POST("", UsersRegistration)
	v1.POST("/", UsersRegistration)
	v1.POST("/login", UsersLogin)
`));
    expect(issues.map((i) => i.route)).not.toContain("POST ");
    expect(issues.map((i) => i.route)).not.toContain("POST /");
    expect(issues.map((i) => i.route)).not.toContain("POST /login");
  });

  it("POST-only：同根的 PUT 不豁免（user-update 类仍查）", () => {
    const { issues } = analyzeGinApp(app(`
	v1.POST("", UsersRegistration)
	v1.POST("/login", UsersLogin)
	v1.PUT("", UserUpdate)
`));
    expect(issues.map((i) => i.route)).not.toContain("POST ");
    expect(issues.map((i) => i.route)).toContain("PUT ");
  });

  it("无姊妹佐证：POST \"/users\" 仍报（管理员建用户不豁免）", () => {
    const { issues } = analyzeGinApp(app(`
	v1.POST("/users", AdminCreateUser)
`));
    expect(issues.map((i) => i.route)).toContain("POST /users");
  });
});

// ── V7 转正：组认证跨文件传播 ──

const BOOTSTRAP = `package main
import "github.com/gin-gonic/gin"
func main() {
	r := gin.Default()
	v1 := r.Group("/api")
	users.UsersRegister(v1.Group("/users"))            // Use 之前 → 公开
	v1.Use(users.AuthMiddleware(false))                // 可选认证
	tags.TagsRegister(v1.Group("/tags"))
	v1.Use(users.AuthMiddleware(true))
	users.UserRegister(v1.Group("/user"))
	articles.ArticlesRegister(v1.Group("/articles"))
}
`;

const ROUTERS = `package users
import "github.com/gin-gonic/gin"
func UsersRegister(router *gin.RouterGroup) {
	router.POST("/login", UsersLogin)
	router.POST("", UsersRegistration)
}
func UserRegister(router *gin.RouterGroup) {
	router.PUT("", UserUpdate)
	router.PUT("/", UserUpdate)
}
`;

describe("ginProtectedRegisterFns 组认证相位推导", () => {
  it("Use(true) 之后的 Register 调用受保护，Use 之前的公开", () => {
    const p = ginProtectedRegisterFns(BOOTSTRAP);
    expect(p.get("UserRegister")).toBe(true);
    expect(p.get("ArticlesRegister")).toBe(true);
    expect(p.get("UsersRegister")).toBeUndefined(); // Use 之前注册（register/login 公开）
    expect(p.get("TagsRegister")).toBeUndefined();  // 仅可选 Use(false) 之下
  });

  it("可选认证 Use(false) 不视为保护（否则删 required 后被掩盖）", () => {
    const p = ginProtectedRegisterFns(BOOTSTRAP.replace("v1.Use(users.AuthMiddleware(true))\n", ""));
    expect(p.get("UserRegister")).toBeUndefined();
    expect(p.get("ArticlesRegister")).toBeUndefined();
  });
});

describe("ginEnclosingFunc 路由函数归属", () => {
  it("按 func 头行号归属", () => {
    const lines = ROUTERS.split("\n");
    const lineNo = (i: number) => i + 1;
    const fnAt = (text: string, ln: number) => ginEnclosingFunc(text, ln);
    // ROUTERS：1 package / 2 import / 3 func UsersRegister … 7 func UserRegister
    expect(fnAt(ROUTERS, lineNo(3))).toBe("UsersRegister");
    expect(fnAt(ROUTERS, lineNo(7))).toBe("UserRegister");
    expect(fnAt(ROUTERS, lineNo(1))).toBeNull(); // package 行无函数
  });
});

describe("analyzeGinProject 跨文件传播", () => {
  function makeProject(withRequiredUse: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gin-proj-"));
    const boot = withRequiredUse ? BOOTSTRAP : BOOTSTRAP.replace(/\tv1\.Use\(users\.AuthMiddleware\(true\)\)\n/, "");
    fs.writeFileSync(path.join(dir, "hello.go"), boot);
    fs.writeFileSync(path.join(dir, "routers.go"), ROUTERS);
    return dir;
  }

  it("Use(true) 保护下：跨文件 mutation 不报", () => {
    const dir = makeProject(true);
    try {
      const a = analyzeGinProject(dir);
      // UserRegister 的 PUT 受组认证保护（跨文件传播）
      expect(a.issues.filter((i) => i.rule === "GIN_ROUTE_NO_AUTH")).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("删掉 Use(true)：mutation 重新被报（敏感性保留）", () => {
    const dir = makeProject(false);
    try {
      const a = analyzeGinProject(dir);
      const routes = a.issues.filter((i) => i.rule === "GIN_ROUTE_NO_AUTH").map((i) => i.route);
      expect(routes).toContain("PUT ");
      expect(routes).toContain("PUT /");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
