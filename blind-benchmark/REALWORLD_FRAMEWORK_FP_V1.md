# Real-World Framework FP v1 — 启发式探测器的第一个真实数据点（Express）

> 2026-09-02 — 诚实分层的配套数据（「8 启发式的 FP 率多少？」的第一个答案）。
> 方法论：C real-corpus 延伸——真实应用 → 检测器扫描 → 逐条人工标注。
> 语料：gothinkster/node-express-realworld-example-app（vendored
> benchmarks/ts-apps/express-realworld，真实开源项目、非合成非演示）。

## 扫描结果

| 项 | 值 |
|----|----|
| 扫描文件 | 28（.ts，排除 tests/e2e/node_modules） |
| hasExpress 命中 | 7 文件（含 6 个路由模块——per-file 计数虚高，见下） |
| 路由提取 | 仅 1 条（检测器路由正则与真实注册形态失配，见下） |
| issues | 19 条 = 7 × (NO_AUTH_MIDDLEWARE + NO_HELMET + NO_CORS_CONFIG) |

## 逐条标注（全部人工核实）

| 规则 | 条数 | 标注 | 依据 |
|------|------|------|------|
| EXPRESS_NO_AUTH_MIDDLEWARE | 7 | **FP ×7** | 真实应用有**路由级认证**（`auth.required` / `auth.optional` 每路由中间件，article.controller.ts 等）——检测器只看全局 `app.use`，路由级中间件不可见 |
| EXPRESS_NO_CORS_CONFIG | 7 | **FP ×7** | main.ts 显式 `app.use(cors())`——检测器未识别 cors 包的该形态 |
| EXPRESS_NO_HELMET | 7 | **真实但非协议级** | 应用确实未用 helmet（CSP/HSTS 缺失属实），但属安全加固建议类，非协议生命周期违规 |

**真实语料标记精确率（协议级 TP）：0 / 19 = 0%。**

## 检测器结构缺陷（转正门槛的具体工作）

1. **路由级中间件不可见**（根因）——真实 Express 应用的认证惯例是
   每路由 `auth.required` 中间件，而非全局 `app.use`。转正需支持
   路由级中间件链识别（auth 名分类已有，缺的是把路由参数里的
   中间件名纳入保护判定）
2. **路由提取失配**——真实应用 20+ 路由仅提取 1 条（检测器正则与
   `router.get('/x', ...)` 分号/多行形态失配待查）
3. **per-file app 计数虚高**——路由模块 import Router 即算一个
   「express app」，7 个文件产生 7 份重复 flags（同 3 类问题）
4. **规则语义边界**——NO_HELMET/NO_CORS 是加固建议类，与
   协议生命周期违规混在一个 issues 数组里（严重度/口径需分离）

## 结论

- **Express 维持「启发式 ⚠️」标签有据**：首个真实数据点 0/19 协议级 TP
- **转正工作清单明确**：路由级中间件识别（1）+ 路由提取修复（2）+
   app 计数口径（3）——做完重测本语料，TP/FP 数据变化即转正依据
- 方法学确立：后续 7 个启发式探测器（tRPC/Fastify/Next.js/Koa/Hapi/
  Gin/Fiber）各补一个同类真实数据点（语料：真实开源应用 vendored
  benchmarks/ts-apps/ + benchmarks/go-apps/）
