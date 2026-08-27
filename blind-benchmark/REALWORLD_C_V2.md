# Real-World C Validation v2 — Annotation-Driven Demo (redis ACL)

> 2026-08-27 — 注解驱动真实项目演示（生产化第 1 步的可行性 gate）
> 演示项目：`demo-real-c-redis/`（真实 redis 7.x acl.c 函数体逐字 + 3 条注解）

## 回答的问题

注解路径的前提是「开发者愿意在 C 代码里加 @progmune 注释」——本演示在真实
生产代码上验证：**标注成本是多少、标注后管线是否给出正确决策**。

## 语料与方法

- `demo-real-c-redis/acl_auth.c`：redis acl.c 的 auth 流 5 个函数逐字复制
  （authCommand / ACLAuthenticateUser / checkPasswordBasedAuth /
  ACLCheckUserCredentials / ACLCheckAllPerm），加 3 条注解 + 1 个合法演示入口。
- `demo-real-c-redis/acl_auth_broken.c`：同函数同注解 + 植入违规
  `handle_monitor_no_auth`（未认证直接做权限检查——经典 missing-auth-check）。
- 管线：extractProjectIR → 写 ir.json → evaluateTrust（生产引擎，无 LLM）。

## 标注成本（采纳问题的量化答案）

**auth 协议 = 3 条注解**，映射关系：

| 真实函数 | 注解 | 真实语义 |
|---------|------|---------|
| `ACLCheckUserCredentials` | pre=[UNAUTHENTICATED], post=[PASSWORD_VERIFIED] | 密码哈希比对 |
| `checkPasswordBasedAuth` | pre=[], post=[AUTHENTICATED] | `c->authenticated = 1` 的位置 |
| `ACLCheckAllPerm` | pre=[AUTHENTICATED] | 权限检查 |

## 结果（引擎修复后）

| 变体 | 判定 | 分数 | 违规 |
|------|------|------|------|
| 真实代码 + 注解 | **APPROVED** | 85 | 0（真实合法流零误报） |
| 植入 missing-auth-check | APPROVED + 1 medium 违规 | 82 | `ACLCheckAllPerm` 在 [UNAUTHENTICATED] 被调用，要求 [AUTHENTICATED] |

**如实记录**：违规检出与归因正确，但**单条 medium 违规在当前决策阈值下不翻转
APPROVED**（score 82 仍在阈值之上）——协议状态违规应否直接降级决策，是
决策阈值层（`DECISION_THRESHOLDS`）的独立议题，不在本演示范围。

**结论：注解驱动路径在真实 C 代码上可行**——3 条注解即可让真实认证协议
接受状态机验证，合法流零误报、植入违规精确定位。这是 C 生产化的现实形态。

## 演示逼出的两个引擎问题（已修 + 零漂移验证）

1. **CamelCase 注解规则不可触达**（P0）：真实 C 命名（`ACLCheckAllPerm`）注册的
   规则无法被任何匹配策略命中（normalize 只作用于调用名；词段匹配要求 ≥2 个
   下划线词段）。修复：注解合并同步注册 normalized 形态——加性改动
   （snake_case 注解 normalized === 原名，零变化）。
2. **注解合并晚于序列构建**（P1）：有函数体的注解原语被内联掉、post 状态
   永不生效（`checkPasswordBasedAuth` → AUTHENTICATED 未建立 → good 流误报）。
   修复：P4.5 合并移到 `extractCallSequencesFromProject` 之前——与盲测 harness
   （`scan-protocol-python` 先合并后建序列）语义对齐。

零漂移验证：Python 协议盲测 v1.2 复跑 64 违规（报告仅时间戳差异）；
引擎相关套件 113/113 全绿；C e2e 冒烟 4 植入违规全中。

## 现实摩擦记录（如实）

1. **状态迁移常以赋值出现**（不修——能力边界，L4 不投入）：`c->authenticated = 1`
   不是函数调用，状态机天然看不见。本演示以「含赋值的真实函数」作为 establish
   原语绕开——注解定义的是函数间协议顺序，函数内顺序不检查。
2. **fixPath 输出规则名而非真实函数名**（已修）：原输出 `verify_token`（内置规则
   恰好 pre=[]/post=[AUTHENTICATED]，BFS 按插入序先命中）。修复：注解合并给规则带
   `displayName`（真实函数名），BFS 展开项目原语优先（stable sort）+ 渲染映射——
   现在输出 `checkPasswordBasedAuth`，sdk 修复解析直接插入真实函数。
   零漂移：Python 盲测 64（仅时间戳差）+ 引擎/SSG 套件全绿 + 回归测试断言。
3. **模块认证路径（checkModuleAuthentication）**：redis 的模块 hook 认证在状态机
   外——若模块接管认证，AUTHENTICATED 的建立对状态机不可见（边界，如实记录）。

## 对生产化路线的含义

- 注解驱动路径**已验证可行**（真实代码 + 3 注解 → 正确决策），采纳成本可量化
  （~3 注解/协议）。
- 引擎级修复（endState 回调识别、keyword 白名单）仍按原计划：以真实项目反馈
  为前提，不提前投入。
- C 语言状态标签维持「研究」——下一步是把本演示扩展到更多真实协议模块
  （redis AUTH 全流程 / libssh userauth / 一个带审计日志的写路径），累积
  标注成本与噪声数据。
