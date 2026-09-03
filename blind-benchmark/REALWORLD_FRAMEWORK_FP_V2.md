# Real-World Framework FP v2 — Fastify：结构失明数据点（0/20 路由可见）

> 2026-09-02 — 启发式探测器第二个真实数据点（v1 = Express，FP 侧证据；
> v2 = Fastify，**recall 侧证据**）。
> 语料：avanelli/fastify-realworld-example-app（vendored
> benchmarks/ts-apps/fastify-realworld，真实开源项目 25★，
> Fastify 4 + @fastify/jwt + @fastify/cors + Knex，RealWorld/Conduit 后端规格）。

## 扫描结果（与金标对照）

| 项 | 检测器所见 | 金标（人工核实） |
|----|-----------|------------------|
| 扫描文件 | 29（排除 node_modules/test；JS 实现非 TS） | 同左 |
| 命中文件 | 1（index.js——import 门只认 `require('fastify')`；plugin 模块均被跳过） | 真实路由分布在 6 个 plugin 模块 |
| 路由 | **0** | **20**（`server.route({...})` object 形态） |
| 认证钩子 | **0** | jwt 插件 `decorate('authenticate'/'authenticate_optional')` + **17 路由级 `onRequest: [server.authenticate]`**（3 个公开入口：login/register/tags，spec 规定） |
| issues | **0** | 协议级违规 0（spec 合规）——理想输出也是 0 |

**结论性判别：0 flags 是盲区巧合，不是验证通过。**

## 反证实验（检测器无感）

把 `POST /articles` 的 `onRequest: [server.authenticate]` 摘掉（真实违规场景）再扫：

| 输入 | 路由可见 | issues |
|------|---------|--------|
| 原文（安全） | 0 | 0 |
| 变异（摘掉认证） | 0 | **0** |

→ 检测器**无法区分安全应用与已破坏应用**。协议验证工具最不该有的性质：
对「删保护」零反应。若 0 flags 被当作「通过」，一个删光认证的 Fastify
应用同样「通过」。

## 失明根因（转正 = 结构性重写，非增量修）

1. **object-form 路由不可见**——真实 Fastify 应用用
   `server.route({ method, path: options.prefix + 'x', ... })`，
   检测器正则只认位置形态 `.get('path', ...)`；20/20 全部失配
2. **plugin 注入形态不可见**——路由模块是 fastify-plugin 包裹的
   函数（`module.exports = fp(users)`），接收 server 实例而非
   `require('fastify')`——import 门直接跳过（宽松门后仍 0，见下）
3. **认证形态不认**——真实认证是 jwt 插件的 `decorate('authenticate')`
   挂在路由选项 `onRequest: [server.authenticate]`；检测器只认
   `preHandler|preValidation` 选项值里的裸函数名词表
4. **全局插件链不可见**——cors/jwt 经 `.register()` + @fastify/autoload
   注册，代码串级无法关联

> 公平性注：绕过 import 门（凡提到 fastify 即分析，14 文件）重扫仍
> 0 路由/0 钩子/0 issues——失明在惯用法正则层，不在入口门。

## 方法学意义（两代数据点互补）

- **v1 Express**：有 flags 时协议级精确率 0%（19→20 条全是 FP/加固类）
- **v2 Fastify**：真实惯用法下连 flags 都产生不了（0/20 路由、0/17
  认证可见）——recall 侧结构性失明
- 两类证据指向同一结论：**启发式 ⚠️ 标签不配转正**；且 Fastify 的
  转正代价显著高于 Express（重写路由/认证/插件解析，而非补模式）
- 后续 6 个启发式（tRPC/Next.js/Koa/Hapi/Gin/Fiber）沿用本方法学

## ✅ 结构性重写（转正功能，2026-09-02 后续修复）

`fastify-detector.ts` 重写四项（V2 失明链逐项解决）：
1. **object-form 路由解析**：`server.route({ method, path, ... })`（20/20
   真实路由形态）——平衡块扫描，path 支持 `options.prefix + 'x'` 拼接取
   字面量
2. **plugin 模块进门**：analyzeFastifyFile 门补 `fastify-plugin`
   （真实路由模块是 fp(plugin) 包裹、接收 server 实例）
3. **onRequest 认证识别**：选项名集 preHandler/preValidation → 补
   onRequest；支持点限定 `server.authenticate`（词表含 auth）
4. register 集合豁免接入（users/login 姊妹佐证 → POST users 公开注册）

**fastify-realworld 重测：0 路由/0 issues → 20 路由全见 / 0 issues**
（13 mutation：11 受保护正确识别 + login/register 公开）。**反证闭合**：
摘 POST articles 的 onRequest → NO_AUTH 0→1（V2 无感反证消除）。
回归测试 +5（13 green）；全框架 139 tests green。

## 结论

- **Fastify 维持「启发式 ⚠️」有据（recall 侧）**：真实语料 0/20 路由可见，
  无感反证成立
- 转正工作清单 = 结构性重写 4 项（object-form 路由/plugin 注入/
  onRequest + decorator 认证/register 链全局件），完成后在本语料
  重扫须满足：20 路由全见、17 认证全识别、变异实验有反应
- 语料方法论第 2 例落地：真实开源应用 → 扫描 → 金标对照 → 反证
