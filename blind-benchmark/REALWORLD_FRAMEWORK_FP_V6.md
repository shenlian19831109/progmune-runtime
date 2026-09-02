# Real-World Framework FP v6 — Hapi：gate 时代失配 + 声明式路由不可见

> 2026-09-02 — 启发式探测器第六个真实数据点（v1 FP 形态失配 / v2 全盲 /
> v3 分类器串扰 / v4 嵌套括号失明 / v5 webhook 词表缺口 / **v6 最外层
> gate 失明——真实应用 0 文件进入**）。
> 语料：gothinkster/hapijs-realworld-example-app（vendored
> benchmarks/ts-apps/hapi-realworld，gothinkster 官方 Hapi RealWorld，
> 系列第 4 个同族语料；**hapi v16 时代**（2016）技术栈：
> `hapi@^16.4.3` + hapi-auth-jwt2 + glue + mongoose4——@hapi scope
> 改名前的真实形态）。

## 扫描结果（与金标对照）

| 项 | 检测器所见 | 金标（人工核实） |
|----|-----------|------------------|
| 扫描文件 | 38（排除 node_modules/test） | 同左 |
| hapi 文件 | **0**（import 门全灭） | 路由分布在 5 个模块 |
| 路由 | 0 | **20**（articles 11 + profiles 3 + tags 1 + users 4 + status 1） |
| 认证 | 0 | `server.auth.strategy('jwt', 'jwt', {...})`（auth 模块）+ **12 路由 `config.auth: 'jwt'`**（8 个 mutation 全保护，login/register 按 spec 公开） |
| issues | **0** | 0（spec 合规） |

**0 issues 是「根本没进去」——检测器对整应用不可见，比 v2 Fastify 更靠外一层。**

## 失明根因（两层）

1. **import 门时代失配（最外层）**——`analyzeHapiFile` 门与 `hasHapi`
   只认 `@hapi/hapi` 字面量 / `Hapi.server` / `hapi.server` 调用。
   hapi v16 时代真实应用写 `require('hapi')` + 插件形态
   `register(server, options, next)`（server 是参数不是 `Hapi.server`）
   → **全应用 0 文件通过门**。宽松门（凡提到 hapi 即分析）后仍 0：
   hasHapi 正则同样不认 v16 写法。
2. **声明式路由不可见（内层）**——真实 hapi（glue/pal/插件风格）路由
   以**数组声明 + 框架注册**：`module.exports = (server) => [{method,
   path, config: { auth: 'jwt' }, handler}, ...]`；auth 嵌套在
   `config.auth` 而非顶层 `options.auth`。检测器只匹配字面
   `server.route({` **单对象**调用（`server.route([` 数组形态也不匹配）
   + 500 字符窗口——声明文件里根本没有 `.route(` 调用。

## 正例对照（规则内核在现代形态下可用）

| 输入（v17 单对象形态 sanity） | 结果 |
|------|------|
| `route({POST /articles, options:{auth:'jwt'}})` | 正确不报 ✓ |
| `route({POST /payments})`（无 auth） | HAPI_ROUTE_NO_AUTH ✓ |
| `route({POST /users, options:{auth:false}})` | 报「显式公开」——**但在 realworld 语义下 register 就该公开 → 若可见会是 FP**（路径豁免词表不含 "/users"，同 Koa register 缺口） |

## 结论

- **Hapi 维持「启发式 ⚠️」有据（最外层 gate 失明侧）**：真实语料
  0/38 文件进入——检测器只覆盖 @hapi-scoped（v17+）且**单对象** `.route({`
  形态；真实 hapi 生态（v16 插件时代 + v17 声明式数组）整个在外。
  变异实验无意义（连入口都没有：摘光认证输出同样为 0/0/0）
- 语料方法论第 6 次产出可修缺陷：门与 hasHapi 需兼容 `require('hapi')`
  （去 scope 前缀匹配）；路由提取需支持数组形态 + `config.auth` 嵌套
  + 插件模块的声明式注册（routes 数组 → 需在注册点外推或接受声明式
  扫描）；豁免词表补 "/users" 注册形态
- 诚实注：语料为 2016 技术栈（真实但陈旧），作为「gate 时代失配」
  证据有力；v17+ 现代语料可作为后续补充验证
- 谱系：v1 形态失配 FP / v2 路由全盲 / v3 分类器串扰 / v4 括号失明 /
  v5 webhook 词表缺口 / **v6 gate 时代失配（0 文件进入）**

## ✅ 修复记录（2026-09-02 修复轮）

**gate/hasHapi 兼容 v16 已修**（`hapi-detector.ts`）：
- `analyzeHapiFile` gate 与 `analyzeHapiApp` hasHapi 补
  `require('hapi')` / `from 'hapi'`（v16 时代直接 import 形态；闭合引号
  紧随要求避免误收 `hapi-auth-jwt2` 等子包）
- 回归测试 +2（10 green）：v16 直连形态（`require('hapi')` +
  `server.auth.strategy` + `server.route`）现可完整分析（策略识别、
  auth 字段读取、缺失认证触发）；gate 不误收 hapi-auth-jwt2

**本语料重测仍 0 文件进门——如实归因**：gothinkster hapi realworld
是 **glue/manifest 声明式**应用（`Glue.compose(manifest)` 建 server，
零文件直接 `require('hapi')`，路由以数组声明导出）——gate 修复覆盖
v16 **直连**形态；声明式（manifest/glue/pal）形态需转正级
「声明式路由 + config.auth 嵌套解析」（V6 转正清单），非本次范围。
v17+ 现代直连语料可作为后续补充验证
