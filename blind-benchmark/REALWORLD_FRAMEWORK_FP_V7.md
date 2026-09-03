# Real-World Framework FP v7 — Gin：组级认证跨文件不可见（11 flags 全 FP）

> 2026-09-02 — 启发式探测器第七个真实数据点（第 3 个 FP 侧，机制：
> **组级认证跨文件不可见**）。语料：gothinkster/golang-gin-realworld-
> example-app（vendored benchmarks/go-apps/gin-realworld，2717★，
> gothinkster 官方 Go+Gin RealWorld——系列第 5 个同族语料）。

## 扫描结果（与金标对照）

| 项 | 检测器所见 | 金标（人工核实） |
|----|-----------|------------------|
| 扫描文件 | 16（.go，排除 _test） | 同左 |
| gin 文件 | 9 | — |
| 路由 | 21（**空路径注册全不可见**：`POST("", ...)` 惯用形态 ×N） | ~30（含 "" 与 "/" 双注册） |
| issues | **11**（articles 8 + users 3：PUT /、follow POST/DEL） | 0 协议级违规（spec 合规） |

**11 条 mutation flag 全部 FP（0/11 协议级 TP）**——这些路由都被保护。

## 真实认证架构（金标）

hello.go 组级中间件（路由文件**零逐路由认证**——Go/Gin 真实惯例）：

```go
v1 := r.Group("/api")
users.UsersRegister(v1.Group("/users"))          // login/register —— 公开
v1.Use(users.AuthMiddleware(false))              // 公开读组
articles.ArticlesAnonymousRegister(...)          // 匿名 GET
v1.Use(users.AuthMiddleware(true))               // ← 保护全部 mutation 的一行
users.UserRegister(v1.Group("/user"))            // PUT/GET user
articles.ArticlesRegister(v1.Group("/articles")) // 全部 mutation
```

## 失明链（三层）

1. **组级认证跨文件不可见（主因）**——保护逻辑在 hello.go 的
   `v1.Use(users.AuthMiddleware(true))`，mutation 注册在 articles/users/
   profiles 的 routers.go；检测器逐文件分析，路由文件内既无逐路由
   认证也无 Use → 全报 unprotected
2. **`.Use` 点限定参数捕获缺陷（同文件也失效）**——useRe
   `\.Use\s*\(\s*([A-Za-z_][\w]*)` 对 `v1.Use(users.AuthMiddleware(true))`
   捕获的是限定符 **"users"** 而非 `AuthMiddleware` → authGroup 恒空。
   反证：同文件 `v1.Use(users.AuthMiddleware(true))` + `POST /pay` 仍报
   （POST /pay 无保护 → 误报）
3. **空路径注册不可见**——realworld 惯用 `router.POST("", X)`（register/
   login/user-update），正则 `"([^"]+)"` 需 ≥1 字符 → 隐身。user-update
   靠其 "/" 别名才被看见并误报

**反证实验**：删除 hello.go 的 `v1.Use(users.AuthMiddleware(true))`
（保护全部 mutation 的那一行）→ 检测器输出**完全不变**（authGroup 前后
皆空）→ 对「组认证被删」无感——0 flags 与 11 flags 在它眼里无区别
（它根本没看见那行）。

**附带**：窗口串扰在 Gin 复现——users POST / 与 /login 被后续
`UsersLogin` 标识符（含 "login"）洗成 protected（Koa 同款缺陷）。

## 结论

- **Gin 维持「启发式 ⚠️」有据（FP 侧第 3 例）**：11 flags 全 FP
  （0/11 协议级 TP）。Go/Gin 的真实认证惯例是**组级 Use + 独立路由
  文件**——检测器的文件级窗口对该架构系统性失明
- 修复方向：Use/Group 捕获支持点限定成员（users.AuthMiddleware）；
  组认证需跨文件传播（hello.go 的 Use → 该组注册的所有路由）；
  路由正则支持空路径；窗口串扰同 Koa 修法（按调用边界截断）
- 谱系：v1 形态失配 / v2 全盲 / v3 分类器串扰 / v4 括号失明 /
  v5 webhook 词表 / v6 gate 时代失配 / **v7 组级认证跨文件不可见**

## ✅ 修复记录（2026-09-02 修复轮）

**Use 点限定捕获 + 窗口边界 + 空路径 三项已修**（`gin-detector.ts`，
与 Fiber 共用新模块 `route-window.ts`）：
1. `\.Use` / `\.Group` 捕获支持点限定成员（`users.AuthMiddleware`）——
   整名送词表（旧版只捕限定符 "users"，同文件组认证也失效）
2. 认证窗口 = **本次调用边界内**（括号深度感知，共享
   `routeCallWindow`）+ 末参 handler 排除（共享
   `middlewareNamesFromWindow`）——跨路由 bleed 消除、handler 名
   含 auth 词不再误判
3. 路由正则支持**空路径** `POST("", …)`（realworld 惯用双注册）

回归测试 +4（gin 12 / fiber 9 / 共 21 green）。**重测 gin-realworld**：
- 路由 21→27（空路径可见，提取完整）
- issues 11→15：**全部仍为跨文件组认证 FP**（保护在 hello.go 的
  `v1.Use(users.AuthMiddleware(true))`，mutation 在独立 routers.go）+
  register 空路径/"/" 双注册的 register 语义 FP（同 Koa/Next 豁免缺口）
- **剩余唯一根因 = 组认证跨文件传播**（hello.go 的 Use 需作用到该组
  注册的所有路由）——属转正级功能改造，非本次缺陷修复范围；per-file
  逻辑现已正确（单测锁定同文件场景）

## ✅ register 集合豁免（语义层，2026-09-02 后续修复）

同文件有 `/login` 姊妹佐证 ⇒ POST ""/"/"（users 双注册）豁免（共享
route-window helpers）。**gin-realworld 重测：15 → 13 issues**（register
两行消除；articles 的 POST ""/"/" 是 ArticleCreate（非注册、无 login
姊妹）与 user-update PUT 双注册保持报出——跨文件组认证 FP 未动，
POST-only 保证不误伤）
