# Real-World Framework FP v4 — tRPC：标准 .input 链失明（37% 可见率）

> 2026-09-02 — 启发式探测器第四个真实数据点（v1 FP 侧 / v2 全盲 recall 侧 /
> v3 分类器串扰侧 / **v4 提取器嵌套括号失明侧——首个 0 FP 语料但覆盖率
> 结构性受限**）。
> 语料：sadmann7/netflx-web（vendored benchmarks/ts-apps/netflx-web，
> 真实开源 766★，Netflix 克隆：Next.js App Router + tRPC v10 + Prisma +
> NextAuth，真实全栈应用非模板）。

## 扫描结果（与金标对照）

| 项 | 检测器所见 | 金标（人工核实） |
|----|-----------|------------------|
| 扫描文件 | 109（src 下 .ts/.tsx） | 同左 |
| tRPC 文件 | 5（4 个 router + trpc.ts 基建） | 4 个 router（my-list/profile/user/icon） |
| 过程提取 | **7/19（37%）**——全是无 `.input` 链的 query | **19**（12 带 `.input` schema / 7 无 schema 查询） |
| mutation 可见 | **0/8** | 8（my-list 3 + profile 4 + user 1，**全部带 `.input` schema**） |
| issues | **0** | 0（金标合规：所有 mutation 有 schema——理想输出也是 0） |

**0 issues 与金标一致，但依据空洞：8 个 mutation 一个都没被检查过。**

## 核心缺陷：链匹配正则不跨嵌套括号

过程提取正则 `name: XxxProcedure((?:\.\w+\s*\([^()]*\))*)\.(query|mutation)\(`：
中间链段的每个原子 `\.\w+\([^()]*\)` **不允许嵌套括号**——而标准惯用法
`.input(z.object({...}))` / `.input(z.string())` 必然含嵌套括号（zod
schema）→ 链段匹配失败 → **带 input schema 的过程整体不可见**（含
多行 `.input(z.object({...}))` 的常见排版）。只有裸链过程
（`XxxProcedure.query/mutation(` 之间无任何调用）能被提取。

## 反证实验（my-list.ts create mutation）

| 输入 | 可见过程 | issues |
|------|---------|--------|
| 原文（`.input(z.object({...}))` 完整） | 0 | 0 |
| 摘掉 `create` 的 `.input(...)` 块 | `create[mutation, dbWrite=true]` | **TRPC_MUTATION_WITHOUT_INPUT_SCHEMA** |

→ **对目标缺陷有真敏感性**（裸链无 schema mutation 会被抓）——区别于
Fastify（全盲）与 Koa（单点无感）。失效方向是**选择性失明**：标准安全
惯用法（带 schema 的过程）全部看不见，检测器无法确认任何 mutation
的 schema 存在性——「0 issues」无法作为安全信号。

## 附带缺陷：全局正则 /g lastIndex 泄漏（多文件扫描不稳定）

`PROCEDURE_TYPE_PATTERN` 带 `/g`，`detectTRPCApp` 用 `test()` 逐文件
调用 → lastIndex 跨文件残留 → 同一语料扫描结果随运行顺序漂移
（实测 4/19 与 7/19 两版）。检测器被 trust engine 逐文件循环调用时
会受影响。

## ✅ tRPC v11 t.procedure 支持（V4 遗留缺口，2026-09-02 修复）

`extractProcedures` 过程起点正则补 `t.procedure`（v11 内联基础构造器，
无命名包装——默认公开语义；命名包装 XxxProcedure 不受影响）。回归 +3
（8 green）。**netflx-web 复查：19/19 / 0 issues 保持**；裸
`t.procedure.mutation`（无 input）敏感性与命名包装一致。

## 结论

- **tRPC 维持「启发式 ⚠️」有据（覆盖率受限侧）**：首个 0 FP 语料
  （有积极意义：规则触发面窄 → 真项目里不易误报），但 19 过程只见
  7（37%）、mutation 0/8 可见——FP 率问题在其规则触发面上无法实测
- 语料方法论第 4 次产出真缺陷：**嵌套括号链失明** + **/g lastIndex
  泄漏**。修复方向：链段改为括号感知扫描（自 procedure 类型向后扫到
  `.query/.mutation(`，容忍 `.input(...)` 内平衡括号）；detect 用
  非全局正则或显式重置 lastIndex；v11 `t.procedure` 形态未覆盖（另记）
- 四语料谱系：Express=有 flags 全 FP；Fastify=连路由都看不见；
  Koa=分类器串扰单点无感；tRPC=标准过程看不见、裸链有真敏感性

## ✅ 修复记录（2026-09-02 修复轮）

**括号感知链解析 + lastIndex 泄漏 两项已修**（`trpc-detector.ts`）：
1. `extractProcedures` 重写为位置扫描：自 `name: XxxProcedure` 起逐个
   解析 `.method(balancedArgs)`（深度感知 + 字符串感知，容忍嵌套括号
   与多行）直至 `.query(/.mutation(`——标准 `.input(z.object({...}))`
   链不再失明
2. `PROCEDURE_TYPE_PATTERN` 移除 `/g`（detect 用 test() 不再跨文件
   泄漏 lastIndex，逐文件扫描稳定）

新测试文件 +5（`trpc-detector.test.ts`，此前无单测）：多行 input 链
提取、单行 z.string 链、裸链触发、合规 0 issues、lastIndex 交替调用
稳定。**修复后重测 netflx-web**：**19/19 过程全提取**（原 7/19），
8 mutation 全部可见且带 input schema，0 issues——与金标一致，且
「0 issues」不再是空洞（每个过程都被真正检查过）；摘 input 敏感性
回归由单测锁定。跨文件扫描漂移（4/19 vs 7/19）消除
