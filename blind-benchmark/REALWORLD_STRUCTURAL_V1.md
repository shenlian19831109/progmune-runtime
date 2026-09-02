# Real-World Structural v1 — NestJS：guard 单一惯用法失明（中间件时代语料 0 反应）

> 2026-09-02 — **AST 结构级检测器的第一个真实语料考核**。方法学沿用
> V1-V8（真实开源应用 → 扫描 → 金标对照 → 反证）。此前 4 个结构级
> 检测器仅有「合成金标 P=R=100%」背书——与启发式被 V1-V8 揭穿前的
> 说法同类，本次补齐。
> 语料：lujakob/nestjs-realworld-example-app（vendored
> benchmarks/ts-apps/nestjs-realworld，**2.6k★，NestJS RealWorld 的
> 标准实现**，Nest 5 时代（2018）技术栈）。

## 真实认证架构（金标）

**Nest 5 时代惯用法 = 中间件 + configure() 逐路由接线**，非 @UseGuards：

```ts
// article.module.ts
consumer.apply(AuthMiddleware).forRoutes(
  {path: 'articles', method: POST},           // 全部 mutation 均在此保护
  {path: 'articles/:slug', method: PUT|DELETE},
  {path: 'articles/:slug/comments', method: POST},
  {path: 'articles/:slug/comments/:id', method: DELETE},
  {path: 'articles/:slug/favorite', method: POST|DELETE},
  ...);
// user.module.ts: GET|PUT /user；profile.module.ts: follow 全方法
```
`AuthMiddleware` = passport-jwt bearer 校验，无 token 即 401。

金标：**10 个 mutation 全部受保护**（articles 7 + user PUT 1 + follow 2），
register/login/读路由按 spec 公开 → 0 协议级违规（理想输出 0）。

## 检测器所见

| 项 | 值 |
|----|----|
| controllers / routes | 5 / 21 |
| 守卫识别 | **0/21 有 guard**、globalAuthGuards 空——检测器只认 @UseGuards/APP_GUARD |
| issues | **23** = NESTJS_NO_AUTH ×11（10 受保护 mutation + register 公开路由）+ 无 @UsePipes ×12 |

## 反证实验

清空 article.module.ts 的 forRoutes（**真实违规：摘光全部 mutation 认证**）：

| 输入 | issues |
|------|--------|
| 原文（受保护） | 23 |
| 变异（认证全摘） | **23 —— 无感** |

→ 检测器从未看见中间件形态的保护；它无法区分本应用与「删光认证的
同款应用」。合成金标「P=R=100%」只证明它在 **guard 惯用法**上自洽。

## 根因与标注

- **guard 单一惯用法失明（主因）**：检测器模型 = 现代（Nest 6+）
  装饰器惯用法；真实生态的中间件时代（Nest 5 及大量生产代码仍用
  configure/forRoutes）整体不可见——**AST 解决的是「读得懂装饰器」，
  不是「认得全保护形态」**。10 个受保护 mutation 的 NESTJS_NO_AUTH
  全为 **FP**
- **register 语义缺口复现**：POST /users（公开注册）路径不在豁免词表
  → FP（跨框架同源：Koa/Gin/Next 全有）
- **@UsePipes ×12 事实为真但规范类**：应用确无运行时校验（DTO 仅
  类型层）——真缺陷但非协议生命周期违规（同 Express NO_HELMET 口径）

## 结论

- **NestJS 结构级标签「合成金标 100%」不可作为真实背书**——首个真实
  语料 0/23 协议级 TP、摘保护无感。结构级 ≠ 免疫真实惯用法失明
- 修复方向：模型需覆盖中间件形态（module.configure + forRoutes 逐
  路由方法接线——AST 可精确读取，这是结构级的优势，只是没实现）；
  register 豁免同语义层
- **方法学意义**：4 结构级检测器的「结构级更可靠」假设首次被真实数据
  检验——NestJS 未通过。待 FastAPI/Django/Flask 三语料补齐后定论
