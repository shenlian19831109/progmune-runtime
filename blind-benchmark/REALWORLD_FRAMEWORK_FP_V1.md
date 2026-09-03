# Real-World Framework FP v1 — 启发式探测器的第一个真实数据点（Express）

> 2026-09-02 — 诚实分层的配套数据（「8 启发式的 FP 率多少？」的第一个答案）。
> 方法论：C real-corpus 延伸——真实应用 → 检测器扫描 → 逐条人工标注。
> 语料：gothinkster/node-express-realworld-example-app（vendored
> benchmarks/ts-apps/express-realworld，真实开源项目、非合成非演示）。
> 版本历程：v1（初扫）→ 二勘（计数/归因修正，7/7/7→7/6/6）→
> 缺陷 5 修复后重扫（NO_HELMET 6→7，总数 20，main.ts 归位）。

## 扫描结果（缺陷 5 修复后）

| 项 | 值 |
|----|----|
| 扫描文件 | 27（src 下 .ts 共 32 − 5 个 `*.test.*` 命名文件；CLI 只按文件名排除 .test. 与 node_modules，tests/ 下非 .test. 文件仍计入但无 express） |
| hasExpress 命中 | 7 文件（含 6 个路由模块——per-file 计数虚高，见下） |
| 路由提取 | 仅 1 条（检测器路由正则与真实注册形态失配，见下） |
| issues | 20 条 = NO_AUTH_MIDDLEWARE ×7 + NO_HELMET ×7 + NO_CORS_CONFIG ×6 |

## 逐条标注（全部人工核实 + 检测器源码复核）

| 规则 | 条数 | 标注 | 依据 |
|------|------|------|------|
| EXPRESS_NO_AUTH_MIDDLEWARE | 7 | **FP ×7** | 真实应用有**路由级认证**（`auth.required` / `auth.optional` 每路由中间件，auth/profile.controller.ts 等 20+ 路由）——但检测器路由提取仅得 1 条 + 只看全局 `app.use`，路由级中间件不可见 |
| EXPRESS_NO_CORS_CONFIG | 6 | **FP ×6** | 真实应用 main.ts 显式 `app.use(cors())`（检测器 `/\bcors\s*\(/` 正则**能**识别，main.ts 因此未被标记）。6 条来自 6 个路由模块被误判为独立「express app」——它们从不挂载中间件，per-file 计数虚高所致 |
| EXPRESS_NO_HELMET | 7 | **真实但非协议级** | 应用确实未用 helmet（7/7 文件皆无，CSP/HSTS 缺失属实），属安全加固建议类，非协议生命周期违规。main.ts 初始未出此 flag 是缺陷 5（FN），修复后已归位 |

**真实语料标记精确率（协议级 TP）：0 / 20 = 0%。**

> 二勘注（2026-09-02）：初版标注 NO_CORS/NO_HELMET 记 ×7 有误。
> 逐条重扫 JSON 显示 main.ts 仅 NO_AUTH 1 条——cors 被正则识别 +
> helmet 检查被缺陷 5 抑制；6 个路由模块各 3 条 → 19 = 7+6+6。
> 缺陷 5 修复后 main.ts 补上 NO_HELMET → 20 = 7+7+6，结论不变。

## 检测器结构缺陷（转正门槛的具体工作）

1. **路由级中间件不可见**（根因）——真实 Express 应用的认证惯例是
   每路由 `auth.required` 中间件，而非全局 `app.use`。转正需支持
   路由级中间件链识别（auth 名分类已有，缺的是把路由参数里的
   中间件名纳入保护判定）
2. **路由提取失配**——真实应用 20+ 路由仅提取 1 条（检测器正则与
   `router.get('/x', ...)` 分号/多行形态失配待查）
3. **per-file app 计数虚高**——路由模块 import Router 即算一个
   「express app」，7 个文件按文件产出重复 flags（NO_CORS ×6 即此
   根因——6 个路由模块从不挂中间件却各自被问「你的 CORS 呢」）
4. **规则语义边界**——NO_HELMET/NO_CORS 是加固建议类，与
   协议生命周期违规混在一个 issues 数组里（严重度/口径需分离）

## 已修复缺陷（真实语料方法论产出）

5. **classifyMiddleware 顺序缺陷 ✅ 已修复（2026-09-02）**——
   `SECURITY_HEADER_PATTERNS` 曾含 `/\bcors\b/` 且先于显式 cors 分类
   判定，导致 `cors()` 恒被分类为 `security_header` 而非 `cors`。
   后果：任何用 cors 的应用 `hasHelmet` 误真 → **NO_HELMET 漏报**
   （FN，main.ts 即此例）；trust engine 的跨文件抑制
   （`allGlobalMiddleware.has("cors")`）对标准形态永远不生效。
   修法：从 SECURITY_HEADER_PATTERNS 移除 cors 模式（cors 是跨域
   配置，非安全头加固）。回归测试 ×2 已入
   `src/frameworks/express-detector.test.ts`（23 tests green）。
   修复后重扫：NO_HELMET 6→7、总数 19→20、协议级 TP 0/20 不变。

## ✅ 转正修复（2026-09-02，Express 清单 4 项逐步落地）

1. **路由提取接收者化**：app.get + router/Router/*Router——真实路由注册在
   Router 实例上（V1：20+ 路由只提取 1 条 → 现 20 条全见）
2. **路由级中间件识别（根因项）**：AUTH_MIDDLEWARE_PATTERNS 补
   `auth.required/auth.optional`（realworld 惯用法 `const auth = …;
   router.post('/x', auth.required, …)`）→ 受保护 mutation 不再误报
3. **per-file app 计数口径**：真 app 判定（代码实例化 express()）——
   NO_AUTH/NO_HELMET/NO_CORS/validation/session 只对真 app 报；route 模块
   只贡献路由与逐路由缺失认证（NO_HELMET 7→1、NO_CORS 6→0）
4. **逐路由缺失认证**：EXPRESS_ROUTE_MISSING_AUTH 扩展到路由级认证环境
   （不再要求全局 auth），mutation-only + 前缀登录/register 豁免
   （/users/login 等真实 world 形态）

**express-realworld 重测：20 issues → 1**（剩 main.ts NO_HELMET——
真实加固缺口，非协议级；协议级 0 FP）。**反证**：摘 POST /articles 的
auth.required（其余仍保护）→ ROUTE_MISSING_AUTH 触发 ✓。回归测试 +4
（27 green）；全框架 143 tests green。

## 结论

- **Express 维持「启发式 ⚠️」标签有据**：真实数据点 0/20 协议级 TP
- **转正工作清单明确（剩 4 项）**：路由级中间件识别（1）+ 路由提取修复
  （2）+ app 计数口径（3）+ 规则语义分离（4）——做完重测本语料，
  TP/FP 数据变化即转正依据
- 方法学确立：后续 7 个启发式探测器（tRPC/Fastify/Next.js/Koa/Hapi/
  Gin/Fiber）各补一个同类真实数据点（语料：真实开源应用 vendored
  benchmarks/ts-apps/ + benchmarks/go-apps/）
