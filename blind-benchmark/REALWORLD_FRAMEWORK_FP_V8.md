# Real-World Framework FP v8 — Fiber：同缺陷族复现 + 生态约束（收官）

> 2026-09-02 — 启发式探测器第八个（收官）真实数据点。语料约束如实
> 声明：**Fiber 生态缺乏生产级开源语料**（无 gothinkster 级实现、无
> 大型 OSS 生产应用——多为小型私有服务），本数据点用官方
> gofiber/recipes（vendored benchmarks/go-apps/fiber-recipes，
> 真实可运行代码、被广泛用作生产参考，**参考级非有机生产应用**）。

## 扫描结果

| 项 | 值 |
|----|----|
| 扫描文件 | 369（.go，排除 _test） |
| fiber 文件 | 189（~70 个 recipe 应用） |
| 路由 | 289 |
| issues | **57** |

## 三类标注（全部人工核实）

**A. 认证类 recipe（auth-jwt / auth-docker-postgres-jwt / jwt /
firebase-auth / oauth2 / csrf 等 ~6 应用 ~53 路由）：0 flags**
- 认证接线 = `middleware.Protected()`（jwtware）内联路由链 + 组级 Use
  ——恰在检测器设计形态内 → 0 误报看似成立
- **但不可全信（见反证）**：300 字符窗口串扰会把后续路由的
  `RefreshToken`（含 token）等标识符扫进前一路由窗口 → 部分 0 是
  bleed 掩盖而非逐路由验证

**B. CRUD/工具 demo（clean-architecture/gorm/mongodb/mysql 等 ~30 应用
57 flags）：语境噪声**
- 事实为真（这些 demo 确实无认证）但**无安全姿态承诺**——示例 CRUD
  报 missing-auth 是语境误报，既不构成 FP 证据也不算 TP。暴露语义
  边界缺陷（同 Koa/Express 缺陷 4）：对无认证声明的代码报
  missing-auth 需「该代码应当有认证」的前提，demo/内部工具不满足

**C. 反证（单点摘保护无感——Koa E2 缺陷完整复现）**

auth-jwt router.go：摘掉 `POST /logout` 的 `middleware.Protected()` →

| 输入 | issues |
|------|--------|
| 原文 | 0 |
| 摘 logout 保护 | **0**（下一行 `/refresh-token` 的 RefreshToken 标识符 bleed 掩盖） |

## 结论

- **Fiber 维持「启发式 ⚠️」有据（收官）**：Fiber 检测器 = Gin 双胞胎
  （同款 300 字符窗口串扰 + `.Use` 捕获 + 文件级窗口）——单点摘保护
  无感反证成立；官方 recipes 上 57 flags 全为语境噪声（demo 无认证
  意图），认证类 recipe 的 0 flags 部分空洞（bleed）
- **生态约束如实记录**：Fiber 的 FP 率问题在可得语料上**不可测定**
  （无生产级金标）——转正路径 = 需真实生产 Fiber 语料（社区公认
  实现/大型开源应用），当前悬置
- 八语料收官谱系：v1 Express 形态失配 FP → v2 Fastify 全盲 → v3 Koa
  分类器串扰 → v4 tRPC 括号失明（0 FP）→ v5 Next.js webhook 词表 →
  v6 Hapi gate 时代失配 → v7 Gin 组认证跨文件 → v8 Fiber 同缺陷族复现
  + 生态约束。**核心归纳：代码串启发式在真实语料上 8/8 未通过转正
  门槛；跨框架反复出现的三类根因 = ① 300 字符窗口串扰（Koa/Gin/
  Fiber）② 真实框架的声明式/组级/跨文件认证形态不可见（Fastify/
  Hapi/Gin）③ 词表与豁免缺口（Express/Next.js/tRPC/Koa register）**

## ✅ 修复记录（2026-09-02 修复轮）

**窗口边界 + handler 排除 + Use 点限定捕获 已修**（`fiber-detector.ts`
与 Gin 同步，共用 `route-window.ts`）：
- 认证窗口改为本次调用边界内（不再 300 字符跨路由）——单点摘
  Protected 不再被下一路由的 RefreshToken 等标识符掩盖（C 反证消除）
- 末参 handler 排除（authHandler.Logout 不再被当认证中间件）
- `.Use` 捕获支持点限定成员

回归测试 +2（fiber 9 / gin 12 / 共 21 green）。**重测 fiber-recipes**：
- 认证类 recipe（auth-jwt 等）0 flags 现为**真实**（窗口正确、不再靠
  bleed）；0-issue 应用 74 个
- CRUD demo 的 61 flags 仍为语境噪声（demo 无认证意图——语义边界
  缺陷，转正待办）；Fiber 生态无生产语料 → FP 率仍不可测定（悬置）
