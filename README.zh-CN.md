# Progmune

## AI 生成代码的信任决策引擎

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![TS Benchmark](https://img.shields.io/badge/TS%20R98.5%25%20P100%25-22c55e)]()
[![Python Benchmark](https://img.shields.io/badge/Python%20R100%25%20P100%25-22c55e)]()

> [English Version](https://github.com/shenlian19831109/progmune-runtime/blob/main/README.md) · 中文版

**在 AI 生成的代码进入生产前验证它。** Progmune 检查你的 AI 生成代码是否遵循正确的协议生命周期——TLS 握手、认证流程、支付完整性、资源管理——这些违规横跨**函数调用序列**而非单条语句，SAST 和 SCA 工具都看不见。

Progmune 不信任模型说的话，它验证程序实际做的事。

---

## 一条命令

```bash
npm run sdk src/server.ts --explain
```

输出：`APPROVED` / `NEEDS_REVIEW` / `BLOCKED`——附信任评分、证据与修复建议。

---

## 两条路径：生成时拦截 vs 事后检查

Progmune 用两种互补机制覆盖两类代码来源：

| | **生成路径**（Agent 时刻拦截） | **验证路径**（事后检查） |
|---|---|---|
| **覆盖** | 通过 Progmune 生成的代码（`progmune_generate` / `progmune_execute`） | 任何来源的代码——Copilot、Cursor、人工（`progmune_trust_check` / SDK / CI） |
| **机制** | 生成循环内 8 道验证关卡：JSON 解析 → schema → SVL-1 符号 → SVL-2 类型 → SVL-3 数据流 → SVL-4 协议状态机 → BFS 确定性修复 → 语义合约。违规代码**从不写入磁盘**——在发射前被纠正或重试 | 信任引擎：四维加权评分（策略 35% / 协议 30% / 覆盖 20% / 治理 15%）→ 决策 + 证据链 |
| **错误处理时机** | 创建时刻——错误从未存在 | 事后——文件已存在 |
| **成本曲线** | 零——违规没有落地 | 发现越晚越贵 |

核心产品论：**在生成时刻验证，而非事后补救。** LLM 的输出只是提议，状态机才是裁判——LLM 可以被劝服，状态机不会。

---

## Progmune 检测什么

AI 代码生成器产出语法合法的代码，却常常违反**协议生命周期**——正确的操作顺序，如 open→read→close 或 auth→validate→respond。这些违规对传统静态分析不可见。

| 类别 | 检测到的违规示例 |
|------|----------------|
| **TLS / SSL** | 握手未校验证书、缺少主机名校验 |
| **认证** | 令牌无过期时间、会话无超时、缺少限流 |
| **支付** | 订单未验证、退款未授权、Webhook 无签名校验 |
| **资源** | 文件打开未关闭、连接未清理、malloc 未 free |
| **数据完整性** | 变更无审计轨迹、缺少输入校验 |
| **注入类（Python，源码级）** | 用 f-string/`%`/`.format`/拼接构造 SQL、动态 subprocess 参数导致命令注入、用户可控 URL 抓取导致 SSRF、模板字符串 sink 导致 SSTI、外部实体解析器配置导致 XXE、对用户输入 eval/exec |
| **Web 类（Python，源码级）** | `{{ var\|safe }}`/autoescape off 模板导致 XSS、用户可控文件路径导致路径穿越、`@csrf_exempt` 或 GET 状态变更导致 CSRF、客户端 cookie 授权、硬编码 JWT 密钥（含跨模块常量） |

源码级检测采用**提取器标记架构**：IR 提取器执行污点追踪、import 解析、跨文件分析（模板、模块常量），发射合成标记供规则消费——零管道改动、完全可审计。

---

## 快速开始

```bash
npm install progmune-runtime

# 验证一个文件——获得信任决策
npm run sdk src/server.ts

# 完整解释（证据 + 修复建议）
npm run sdk src/server.ts --explain

# 信任检查（CI 友好 JSON 输出）
npm run trust -- --project . --json

# 运行基准套件
npm run precision:all
```

---

## 信任决策

Progmune 的输出是**有证据支撑的决策**，不是原始发现列表：

| 输出 | 含义 |
|------|------|
| **信任评分**（0–100） | 四维度的量化信任水平 |
| **决策** | `APPROVED` / `NEEDS_REVIEW` / `BLOCKED` |
| **置信度** | `HIGH` / `MEDIUM` / `LOW` / `UNCERTAIN` |
| **证据** | 每条违规追溯到代码位置 + RFC 引用 + 修复建议 |

**严重违规 → 无论评分多少一律硬 BLOCK。** 企业关心的是"能不能上线"，不是"我的评分是 58 还是 61"。

→ [信任决策模型](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/ai-trust-decision-model-v1.md)

---

## 覆盖范围

Progmune 对能验证什么、不能验证什么保持诚实。

| 语言 | 状态 | 证据 |
|------|------|------|
| **TypeScript / JavaScript** | ✅ 生产 | 盲测基准：**召回 98.5% / 精确率 100%**（795 条 gold finding，100 个项目） |
| **Python** | ✅ 生产 | 盲测基准：**召回 100% / 精确率 100%**（729 条 gold finding，90 个项目）；真实应用验证：PyGoat（OWASP 故意脆弱 Django 应用）**67 TP / 0 FP，标记精确率 100%**；三个良构应用（django/fastapi realworld、django-unicorn）0 误报真阳性 |
| **C** | ✅ 注解驱动（Beta） | IR 提取接入注册表 + SSG 状态机；**每协议标注 ~2-3 个原语即获得可信验证**（真实模块金标 5/5：redis ACL / libssh 客户端 / libssh 服务端 / libssh 回调分发 / uftpd 传送授权——全部 0 误报 + 违规精确定位；应用级金标 v2：**P=91.7% / R=100% / F1=95.7%**）。未注解自动检测不在范围（真实语料 0 TP——定位决议见 C 语言状态文档）；TLS 级覆盖仍无。见 [C 语言状态](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/c-language-status.md)。 |
| **Go** | ✅ 注解驱动（Beta） | IR 提取接入注册表 + SSG 状态机；合成金标 v1：**P=100% / R=100%**（3 干净 × 3 植入违规）；零外部工具链（纯 TS 词法提取，npm 安装态可用） |
| **Java** | ❌ 无 | 规划中 |

**多语言 IR（注册表式）。** TypeScript（ts-morph）与 Python（AST）提取器是同一注册表（`src/extract-project-ir.ts`）中的注册项；`extractProjectIR` 把检测到的所有语言合并为一份函数 IR，由 agent loop、`execute()` 与 MCP server 共享——agent 可在两种语言上编排函数协议链。新增语言（Go、Java……）= 注册一条提取器，调用方零改动。

**框架适配器：12 专用检测器（4 结构级 + 8 启发式）。** Express ✅、tRPC ✅、FastAPI ✅、Django ✅（结构级路由认证分析——逐条检查写操作入口的认证）、Flask ✅（路由/before_request 认证守卫分析）、Fastify ✅（路由 preHandler/钩子认证分析）与 Next.js ✅（App Router 路由处理器认证分析）、NestJS ✅（装饰器路由解析 + 全局 APP_GUARD 守卫识别 + @Public 豁免）、Koa ✅、Hapi ✅（路由配置认证策略分析）、Gin ✅ 与 Fiber ✅（Go 路由/认证中间件分析）有专用检测器；Next.js 另有版本感知治理。结构级 = AST 解析（NestJS/FastAPI/Django/Flask——合成金标 P=R=100%）；启发式 = 代码串模式（Express/tRPC/Fastify/Next.js/Koa/Hapi/Gin/Fiber——单测覆盖，真实项目 FP 数据待补）。Spring Boot 待适配——框架适配是 #1 产品缺口。

### Progmune 不覆盖什么（诚实边界）

- **TS 侧的污点注入类缺陷**——源码级 SQLi/XSS/SSRF 检测已在 Python 上线；TypeScript 提取器基于名称/调用，TS 注入类暂未覆盖（如实记录，不隐藏）。
- **SCA / 依赖漏洞**——幻觉包名、供应链问题。已有独立工具。
- **运行时行为**——Progmune 仅做静态分析；无 DAST/沙箱执行。
- **框架内部件**——知名框架的分发/缓存机制（如 django-unicorn 内部件）可能产生少量边界误报；各语料基准 gold 文件中已逐条记录。
- **已知失败边界一律记录**而非隐藏：如果 Progmune 无法验证某语言（如 Go），置信度会降低而不是假装 100%。
- **刻意规避不在防护目标内**——注解驱动模型拦截的是 AI 的「意外」协议错误（漏写前置步骤、顺序颠倒）；对故意改名/混淆的对抗性规避不设防（任何静态工具同理）。
- **BLOCK 的强制力由集成方承担**——Progmune 输出判定与证据，不运行时拦截。OS 级强制执行点：`trust --ci` 退出码（CI 门禁）、`policy CLI` 退出码、以及 opt-in 的写盘策略门（项目配置 `.progmune-policy.json` 后，execute 写盘即时验证，BLOCK 自动回滚）。

**分资产分级接入**（[TIERED_POLICY](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/TIERED_POLICY.md)）：不要给所有代码同一套门禁——按「出错代价 × AI 参与度」选档，一条命令落地：

```bash
npx progmune-init-policy --tier 1   # 强制：鉴权/支付/资源生命周期——写盘策略门激活
npx progmune-init-policy --tier 2   # 标准：业务逻辑——violations 阻断，其余 WARN
npx progmune-init-policy --tier 3   # 观察：工具/demo——只报告不拦截
```

→ [完整覆盖矩阵](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/coverage-matrix.md)

---

## 基准

公开、可复现的精确率数据。所有数字均对 gold 标注基准测量。

### TypeScript（盲测基准 v6——100 个项目）

| 指标 | 值 |
|------|-----|
| 精确率 | **100%**（0 条事实性误报） |
| 召回率 | **98.5%**（有效口径 100%——12 条未检出按方法论排除） |
| Gold findings | 795 条，覆盖 100 个项目（90 风格变体 + 10 模型变体） |

### Python（盲测基准 v1——90 个项目）

| 指标 | 值 |
|------|-----|
| 精确率 | **100%** |
| 召回率 | **100%** |
| Gold findings | 729 条，覆盖 90 个风格变体项目 |

### 真实应用验证（PyGoat，OWASP 故意脆弱 Django 应用）

| 指标 | 值 |
|------|-----|
| 标记精确率 | **100%**（67 真阳性 / 0 误报，逐条人工核实） |
| 覆盖类别 | 14 个漏洞类别，含 SQLi、SSRF、路径穿越、XSS、SSTI、XXE、命令注入、反序列化、CSRF（双形态）、cookie 授权、硬编码密钥 |
| 良构应用 | django-realworld、fastapi-realworld、django-unicorn——0 误报真阳性 |

→ [真实验证报告](https://github.com/shenlian19831109/progmune-runtime/blob/main/blind-benchmark/REALWORLD_APP_V1.md) · [基准基线](https://github.com/shenlian19831109/progmune-runtime/blob/main/blind-benchmark/BASELINE_v6.md)

### C（IR 提取 + 注解驱动协议验证——Beta）

3.7.4 起 C 拥有多语言注册表中的 IR 提取器：C 项目进入 IR-first 序列验证 + SSG 状态机。应用级协议生命周期（认证/数据库/文件/支付）在 C 上可验证——应用级金标 v2：**11/11 违规全检出（召回 100%）、1 误报、F1=95.7%**。注解驱动是 C 的生产形态（3.7.6 起 Beta）：真实模块金标 5/5（redis ACL、libssh 客户端/服务端/回调分发、uftpd 传送授权）+ 1 个独立采纳案例（uftpd）——全部 0 误报 + 违规精确定位，标注成本稳定在每协议 ~2-3 条。未注解自动检测不在范围（真实语料 0 TP）。提取覆盖大型真实仓库（openssl 15.5k / redis 5.7k / curl 4.2k 函数，秒级，黄金函数恢复率 97–100%）。两条边界不变：旧正则口径黄金基准 F1=16.5% 测的是 **TLS 级误用**（SSG 无 TLS 状态机，该口径不变）；L3/L4 结论维持（函数指针分发静态不可见；无指针/CFG 分析计划）。详见 [C 语言状态](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/c-language-status.md)。

### P0-P3 规则注入（2026-08）

- 注入 **+31 条规则 / +86 条轨迹 / +13 个检测器 / +11 条防护**；10 个 TS 项目 **+19 条新检测**，6 个 C 仓库 + PostgreSQL **0 误报**
- 打破引导死锁：全部 21 个协议命名空间获得规则词汇（今天：27 个命名空间、148 条规则）
- `excludePatterns` + `languages` 架构管理误报

→ [P0-P3 终报](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/p0-p3-final-report.md)

---

## 架构

```
SDK (src/sdk.ts)           verify() → APPROVED / NEEDS_REVIEW / BLOCKED
  └─ 信任引擎                四维评分 → 决策
       ├─ 策略引擎           企业策略执行（ALLOW/WARN/BLOCK）
       ├─ SSG 校验器         协议状态机验证
       ├─ 调用序列           P4.6 跨函数：入口展开（深度 ≤4）+
       │                     helper 片段抑制
       ├─ 协议检测器         无 IR 语言（C）的正则回退，22 个检测器
       ├─ IR 提取            注册表式：TS（ts-morph）+ Python（ast 模块）
       │                     合并为每项目一份函数 IR；
       │                     源码级标记：污点追踪、import 解析、限定调用链、跨文件模板分析
       ├─ 修复执行器         detect → plan → fix → validate → commit/rollback
       └─ 知识库             31 个域、148 条规则、证据链
```

### 接口

| 接口 | 用途 |
|------|------|
| **SDK**（`verify()`） | 开发者一次性调用 API |
| **CLI**（`npm run trust`） | 命令行信任检查 |
| **MCP 服务器** | Claude Code 集成（`progmune_check`、`progmune_trust_check`） |
| **GitHub Action** | CI/CD 门禁——在 PR 拦截未验证的 AI 代码 |
| **Trust API** | `POST /trust/check`——机器间接口 |

---

## 社区与反馈

<p align="center">
  <img src="https://github.com/shenlian19831109/progmune-runtime/blob/main/assets/wechat-group.png?raw=true" width="200" alt="微信群二维码" />
  &nbsp;&nbsp;&nbsp;
  <img src="https://github.com/shenlian19831109/progmune-runtime/blob/main/assets/whatsapp-group.jpg?raw=true" width="200" alt="WhatsApp 群二维码" />
</p>

你的意见塑造 Progmune。扫码加入用户讨论群（微信 / WhatsApp），或通过 [GitHub Issue](https://github.com/shenlian19831109/progmune-runtime/issues) 提交缺陷报告、功能需求与建议。

**双渠道自动回复已上线**：微信公众号与 WhatsApp Business 均已接入关键词自动回复机器人（[`wechat-bot/`](wechat-bot/README.md) 与 [`whatsapp-bot/`](whatsapp-bot/README.md)）——关注公众号 / 向官方号码发送「帮助」即可查看全部指令，即时互动。

---

## 科学基础

Progmune 建立在"**LLM 输出是统计表演而非推理**"这一前提上——该观点源自 Subbarao Kambhampati 等人的立场论文 ["Stop Anthropomorphizing Intermediate Tokens as Reasoning/Thinking Traces!"](https://arxiv.org/abs/2504.09762)（arXiv:2504.09762，2025），并在其 ICML 2026 演讲 "On the Role of Verifiers and Thinking Traces in Reasoning Models" 中展开。Progmune 不信任模型对代码的说法，而是用协议状态机、IR 提取与证据链验证程序实际行为。

→ [投资人白皮书](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/Progmune_投资人白皮书_v2.0.html) · [信任决策模型](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/ai-trust-decision-model-v1.md)

---

## 贡献

架构与代码规范见 [CLAUDE.md](https://github.com/shenlian19831109/progmune-runtime/blob/main/CLAUDE.md)，开发流程见 [CONTRIBUTING.md](https://github.com/shenlian19831109/progmune-runtime/blob/main/CONTRIBUTING.md)。

高价值贡献方向：
- **框架适配器**（Express、Next.js、FastAPI）——#1 产品缺口
- **Python 验证规则**——向 TypeScript 之外扩展
- 现有检测器与防护规则的**缺陷修复**

---

## 状态

- **运行时管线：** 检测 → 解释 → 修复 → 验证（L1–L4）
- **信任引擎：** 四维评分 + 二元可解释性门
- **MCP 工具：** 19 个——`progmune_trust_check`、`progmune_score`、`progmune_policy_check`、`progmune_certify` 等
- **框架适配器：** 12 专用检测器——4 结构级（NestJS/FastAPI/Django/Flask）+ 8 启发式（Express/tRPC/Fastify/Next.js/Koa/Hapi/Gin/Fiber）
- **知识库：** 31 个域、148 条协议规则、22 个检测器、26 条防护规则、PLSB 13/13 类别——另加 15 条源码级检测规则（Python）
- **语料：** 6+ 仓库 2,500+ 轨迹；盲测基准 100（TS）+ 90（Python）个项目；4 个应用仓库真实验证
- **当前重点：** 企业 PoC 验证 + 剩余框架内部边界误报

---

## License

MIT — [LICENSE](https://github.com/shenlian19831109/progmune-runtime/blob/main/LICENSE)
