# Real-World Framework FP v3 — Koa：窗口串扰缺陷数据点（单点违规无感）

> 2026-09-02 — 启发式探测器第三个真实数据点（v1 Express FP 侧 /
> v2 Fastify recall 侧 / **v3 Koa 分类器串扰缺陷侧**）。
> 语料：gothinkster/koa-knex-realworld-example（vendored
> benchmarks/ts-apps/koa-realworld，真实开源 233★，Koa2 + koa-router +
> koa-jwt + koa-helmet + kcors，RealWorld/Conduit 后端规格——与 v1
> express 同属 gothinkster 官方实现家族）。

## 扫描结果（与金标对照）

| 项 | 检测器所见 | 金标（人工核实） |
|----|-----------|------------------|
| 扫描文件 | 34（排除 node_modules/test/seeds/migrations/config） | 同左 |
| koa 文件 | 7（import 门含 `require("koa-router")` 误收——本语料恰好需要） | — |
| 路由提取 | **19 真 + 2 幻影**（`config.get("secret")` 被当 `.get("secret")` 路由） | **19**（位置形态 `router.post("/x", auth, ctrl.x)`，提取层工作正常） |
| 保护分类 | **19/19 全标 protected**（含公开 login/register/公开 GET×3） | **12 protected / 7 open**（register 与 login 按 spec 公开） |
| issues | **0** | 0 协议级违规（spec 合规）——理想输出也是 0 |

**0 issues 是分类器串扰的巧合，不是逐路由验证的结果。**

## 核心缺陷：300 字符前向窗口跨路由串扰（bleed）

`protected` 判定取路径串后 **300 字符窗口**内的全部标识符——窗口越过
当前路由调用边界，扫进下方路由的 `auth` 名 → 前面的路由全部被洗成
protected（含公开 GET 与公开 register/login）。规则 `KOA_ROUTE_NO_AUTH`
只在「全文件无 auth」时才能触发 → **all-or-nothing，非逐路由验证**。

## 反证实验（articles-router.js 受控变异）

| 输入 | protected | issues |
|------|-----------|--------|
| E1 原文（安全） | 11/11 | 0 |
| E2 摘 `PUT /articles/:slug` 的 auth（**真实单点回归**） | 11/11 | **0** ——无感 |
| E3 摘全部 auth（全裸） | 0/11 | 7 条 mutation 全报（规则内核有效） |

→ **单点违规不可见**：真实故障形态（某条路由丢了认证、其余完好）
检测器无反应；只有整个文件裸奔才报。协议验证器最该抓的场景抓不到。

## 幻影路由缺陷（次要）

路由正则 `.get('...')` 未限定接收者，`config.get("secret")`（jwt
middleware、app.js 各一处）被提取为 `GET secret` 路由——虚增计数
21 vs 真实 19。

## 结论

- **Koa 维持「启发式 ⚠️」有据（分类器缺陷侧）**：真实语料 0 issues 但
  保护分类 19/19 全错（7 个公开路由误标 protected）、单点违规反证无感
- 语料方法论第 3 次产出真缺陷：**窗口串扰（bleed）**——修复方向：
  窗口按路由调用边界截断（路径串后首个语句结束 `)` 处止），不跨路由；
  幻影路由修复方向：方法名限定在 router/app 实例调用上
- 预判：修复 bleed 后本语料将报出 register（POST /users）→ 公开注册
  被误判缺认证 → 揭示豁免词表缺口（真实 world 的 register 路径是
  `/users` 不含 "regist"）——届时 0/1 协议级 TP 的 FP 数据点成立
- 三语料互补：Express=有 flags 全 FP；Fastify=连路由都看不见；
  Koa=提取 OK 但分类器把公开路由全标 protected、单点违规无感
