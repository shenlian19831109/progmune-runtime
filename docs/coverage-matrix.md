# Progmune Coverage Matrix

> Protocol × Language × Framework — 真实覆盖状态  
> 最后更新：2026-08-24  
> 目的：回答企业唯一的关心问题——"Progmune 能不能检查我的项目？"

---

## 1. 图例

| 标志 | 含义 |
|------|------|
| ✅ | 有专用规则 + 有测试/基准数据 + Precision/Recall 可测量 |
| ⚠️ | 有通用正则规则或部分适配，但基准数据弱、未校准、或已知高误报/漏报 |
| ❌ | 无覆盖 |
| — | 不存在该组合（如 TLS 对 HTTP 框架无意义） |

---

## 2. Protocol × Language 矩阵

```
Protocol           TS/JS        C            Go        Python      Java
──────────────────────────────────────────────────────────────────────────
Auth               ✅           ⚠️           ❌         ✅          ❌
TLS/SSL            ⚠️           ✅           ❌         ❌          ❌
SSH                ⚠️           ✅           ❌         ❌          ❌
HTTP/2             ⚠️           ✅           ❌         ❌          ❌
HTTP Request       ⚠️           ✅           ❌         ❌          ❌
Connection         ⚠️           ⚠️           ❌         ❌          ❌
QUIC               ❌           ⚠️           ❌         ❌          ❌
Resource Lifecycle ⚠️           ⚠️           ❌         ✅          ❌
Payment            ✅           ❌           ❌         ❌          ❌
Data Integrity     ✅           ❌           ❌         ❌          ❌
Ledger             ✅           ❌           ❌         ❌          ❌
──────────────────────────────────────────────────────────────────────────
有效覆盖           TS (✅×4)    C (✅×4)     ❌         Python (✅×2) ❌
                   TS (⚠️×5)    C (⚠️×4)              + 源码级检测
                                                      （2.1 节，生产级）
```

> Python 的协议行 ✅（Auth / Resource Lifecycle）依据协议盲测 v1.2（BASELINE_PROTOCOL_PYTHON_v1：66 gold，Recall 97% / Precision 100% / 0 FP）；源码级缺陷检测见 2.1。

### 2.1 源码级缺陷检测（Python 生产级）

| 类别 | 覆盖 | 证据 |
|------|------|------|
| 注入类 | ✅ | SQLi（f-string/%/.format/拼接）、命令注入（动态 subprocess 参数）、SSRF（用户可控 URL）、SSTI（模板字符串 sink）、XXE（外部实体解析配置）、eval/exec、不安全反序列化 |
| Web 类 | ✅ | XSS（`{{var\|safe}}`/autoescape off）、路径穿越（用户可控文件路径）、CSRF（@csrf_exempt / GET 状态变更）、cookie 授权、硬编码 JWT 密钥（含跨模块常量） |
| 检测架构 | — | 提取器标记架构：污点追踪、import 解析、限定调用链、跨文件模板分析——合成标记供规则消费，零管道改动 |

### 有效性判定依据

| 语言 | 可用性 | 证据 |
|------|--------|------|
| TypeScript | ✅ 可用 | Blind Benchmark v6（100 项目 / 795 gold）：P=100%（0 FP）、R=98.5%（有效 100%） |
| Python | ✅ 可用 | Blind Benchmark v1（90 项目 / 729 gold）：P=100%、R=100%；PyGoat 真实应用 67 TP / 0 FP；3 个良构应用 0 误报真阳性（3 条框架内部件边界 FP 已文档化） |
| C | ⚠️ 不可用于生产 | Gold Benchmark（curl/libssh/nginx/openssl）：F1=16.5%。L3 跨函数实验已终止；L4（指针/CFG）无计划 |
| Go | ❌ | 无规则、无基准、无测试——规划中 |
| Java | ❌ | 无任何支持——规划中 |

### IR 层（v3.5.0 起）

注册表式多语言合并提取（`src/extract-project-ir.ts`）：TypeScript（ts-morph）+ Python（AST）检测/提取器合并为同一份函数 IR，由 agent loop、`execute()`、MCP server 共享——agent 可在两种语言上编排函数协议链。新增语言 = 注册一条提取器，调用方零改动。

> 3.7.1 起：合并形态 ir.json（`{ typeMap, functions }`）恢复 IR-first 序列验证（修复 3.5.0 起静默走正则回退的回归），并加词段匹配门控——词段匹配仅对项目函数适用，外部库调用（如 Node 的 `readFileSync`）不再误撞协议规则。

---

## 3. Protocol 详细说明

### 3.1 Auth（认证）

| 属性 | 值 |
|------|-----|
| 检测方式 | 正则匹配认证初始化 + 清理配对（TS）；`@progmune` 注解协议状态机（Python） |
| TS 覆盖 | ✅ 完整（含 Ownership Check：ownerId/authorId 比较 + 权限门） |
| Python 覆盖 | ✅ 注解式协议提取 + SSG 校验（pre/invalidate/endState + P4.6 跨函数传播）；**协议盲测 v1.2（2026-08-23）：66 gold，Recall 97% / Precision 100% / 0 FP**（BASELINE_PROTOCOL_PYTHON_v1，含 S5 任意命名变体；2 处漏检为注解依赖前置约束，如实单列） |
| C 覆盖 | ⚠️ 仅识别 `auth_*` 函数，未覆盖 OAuth2.0/OIDC 流程 |
| 未覆盖 | OAuth2.0 授权码流程、OIDC、SAML、JWT 签名验证、API Key 管理、Session 固定攻击 |

### 3.2 TLS/SSL

| 属性 | 值 |
|------|-----|
| 检测方式 | 正则匹配 init → handshake → free 三步状态机 |
| C 覆盖 | ✅ 支持 curl/nginx/OpenSSL 的 SSL 函数族 |
| TS 覆盖 | ⚠️ 仅正则匹配，TS 的 TLS 通常由 Node.js 内置处理 |
| 未覆盖 | 证书验证链、主机名验证、TLS 版本协商、密码套件强度 |

### 3.3 SSH

| 属性 | 值 |
|------|-----|
| 检测方式 | 正则匹配 init → auth → close 三步 |
| 基准数据 | libssh (C) |
| 未覆盖 | 密钥类型验证、已知主机检查、通道管理 |

### 3.4 HTTP Request

| 属性 | 值 |
|------|-----|
| 检测方式 | init → send → cleanup 三步 |
| 覆盖 | curl, nginx, Apache 风格命名 |
| 未覆盖 | 任何 TS Web 框架 (Express/Fastify/NestJS 等) |

### 3.5 HTTP/2

| 属性 | 值 |
|------|-----|
| 检测方式 | init → send → close 三步，nghttp2 库支持 |
| 基准数据 | nghttp2 (C) |
| 未覆盖 | 流优先级、HPACK 压缩、Server Push |

### 3.6 Connection Lifecycle

| 属性 | 值 |
|------|-----|
| 检测方式 | connect → transfer → disconnect 通用模式 |
| 覆盖 | 通用，任何语言的 `connect/send/recv/close` 函数 |
| 风险 | 极高的误报率 — `\b(\w*connect\b)` 匹配任何包含 "connect" 的函数名 |

### 3.7 QUIC

| 属性 | 值 |
|------|-----|
| 检测方式 | init → transfer 两步 |
| 覆盖 | quiche 库 (C) |
| 未覆盖 | TS/Go QUIC 实现 |

### 3.8 Resource Lifecycle

| 属性 | 值 |
|------|-----|
| 检测方式 | 8 对 alloc/free 模式匹配 |
| C 覆盖 | ⚠️ malloc/free, fopen/fclose, SSL alloc/free, socket/bind/close |
| TS 覆盖 | ⚠️ 仅正则匹配，TS 的 GC 管理下资源泄漏模式完全不同 |
| Python 覆盖 | ✅ 注解式 file 命名空间（open/read/close 协议）；协议盲测 v1.2 中 use_after_close、missing_cleanup（endState）、cross_function_cleanup（P4.6）全检出（见 3.1 引用基线） |
| 未覆盖 | 数据库连接池、文件句柄泄漏、Promise 未处理、事件监听器未移除 |

### 3.9 Payment

| 属性 | 值 |
|------|-----|
| 检测方式 | 支付流程状态机 |
| TS 覆盖 | ✅ 规则存在 |
| 基准数据 | 无独立基准 |
| 未覆盖 | Stripe/PayPal/Adyen SDK 适配、退款流程、幂等性检查 |

### 3.10 Data Integrity

| 属性 | 值 |
|------|-----|
| 检测方式 | 数据读写保护、输入校验 |
| TS 覆盖 | ✅ |
| Python 覆盖 | ⚠️ 硬编码密钥（含跨模块常量）等源码级检测属于 2.1 节，协议命名空间无覆盖 |
| 未覆盖 | SQL 注入（需 schema 感知）、XSS、命令注入 |

### 3.11 Ledger

| 属性 | 值 |
|------|-----|
| 检测方式 | SSG 账本一致性检查：before-consistency, delta-consistency, delta-legality |
| TS 覆盖 | ✅ |
| 基准数据 | `.progmune_corpus/` 内 2,500+ 条轨迹；`npm run check` 1,315/1,315 Ledger 全过 |

---

## 4. Framework 覆盖

| Framework | 语言 | 适配状态 | 说明 |
|-----------|------|---------|------|
| Express | TS/JS | ✅ 专用检测器 | 路由提取 + 中间件分类 + 安全检查 |
| tRPC | TS/JS | ✅ 专用检测器 | API 合约规则（3 条），与 Express detector 交叉纠正 |
| NestJS | TS/JS | ⚠️ 部分 | @Controller/@UseGuards/@UsePipes 装饰器路由解析 |
| Next.js | TS/JS | ⚠️ 版本感知 | 版本感知治理 |
| Fastify 等其余 TS 框架 | TS/JS | ⚠️ 基础别名 | 库别名覆盖，无结构分析 |
| Django | Python | ⚠️ 基础别名 | 框架委托 allowlist（DRF permission_classes、create_user 等白名单） |
| FastAPI | Python | ⚠️ 基础别名 | 框架委托 allowlist（DI authorizer、create_access_token 等） |
| Gin / Fiber | Go | ❌ | 无 Go 支持 |
| Spring Boot | Java | ❌ | 无 Java 支持 |
| curl / nginx / libssh / OpenSSL | C | ✅ 有基准 | C 黄金基准 4 仓库（研究状态，F1=16.5%） |

```
已适配框架        2 / 13（Express ✅、tRPC ✅ 专用检测器）
部分支持          2（NestJS 部分、Next.js 版本感知）
基础别名覆盖      5 / 13（无结构分析）
```

> 框架适配是 #1 产品缺口：Django、FastAPI 及另外 8 个待适配。当前所有规则使用 `\w*` 通用前缀模式（如 `\b(\w*ssl\w*init)\b`）进行匹配，未针对具体框架 API 做全量适配。

---

## 5. CVE/CWE 覆盖

| 指标 | 数值 |
|------|------|
| 标注样本 | 34 条 CVE（`benchmarks/cve-100.json` 语料子集，基准 harness：`npm run test:cve`） |
| 检出率 | **88%**（30/34） |
| 类别匹配 | 63%（19/34） |
| 按严重度 | critical 13/13（100%）、high 13/15（87%）、medium 4/6（67%） |
| 目标 | 覆盖 OWASP Top 10 + CWE Top 25 中与 AI 生成代码相关的类别 |

---

## 6. 已知覆盖空白（优先级排序）

### P0 — Framework 适配（#1 产品缺口）

| 空白 | 影响 |
|------|------|
| Django / FastAPI 结构分析 | Python 已生产级，但框架 API 语义（DI、ORM 查询安全、DRF 权限类）仅有别名覆盖 |
| Express 之外的 TS 框架结构分析 | 企业 TS 项目大量使用 Next.js/Fastify/NestJS，当前仅部分覆盖 |

### P1 — 语言扩展

| 语言 | 优先级 | 原因 |
|------|--------|------|
| Go | 高 | 云原生基础设施主流语言（商业化研讨结论：Go 先于 Java） |
| Java | 中 | 企业遗留系统 + Spring Boot 生态 |

### P2 — TS 侧源码级注入检测

Python 已有 SQLi/XSS/SSRF 等源码级检测（2.1 节），TypeScript 提取器基于名称/调用——TS 侧同类缺陷暂未覆盖（文档化边界）。

### P3 — 协议扩展

| 协议 | 为什么重要 |
|------|-----------|
| OAuth2.0 / OIDC | 几乎所有 SaaS 应用都在用 |
| gRPC | 微服务间通信主流协议 |
| GraphQL | 查询注入、深度限制、权限边界 |
| WebSocket | 实时应用，认证/授权模式特殊 |
| DB Transaction | 事务边界、隔离级别、回滚处理 |

### 不投入

C 语言 L4（指针/CFG/数据流）——L3 实验已带数据终止，多年研究问题，无计划（研究状态归档于 `docs/c-language-status.md`）。

---

## 7. 版本目标

```
                v1 (当前, 2026-08)      v2 (目标)
───────────────────────────────────────────────────────────
Protocols        21 命名空间全有词汇      + OAuth2.0/OIDC、gRPC、
                                         GraphQL、WebSocket
Languages        2 ✅ (TS, Python)        + Go ✅
                 C ⚠️ 仅研究             Java（更远期）
Frameworks       2/13 专用检测器         Django/FastAPI 结构适配
TS P/R           100%/98.5%              稳定
Python P/R       100%/100%               稳定
CVE              34 (88% 检出)           100 (校准检出率)
```

---

## 8. 不做什么

以下内容明确不在覆盖范围内：

- ❌ 不检查代码版权/许可证合规
- ❌ 不检查第三方依赖漏洞（这是 Snyk/Dependabot 的领域）
- ❌ 不检查基础设施配置安全（Terraform/K8s — 除非是 AI 生成的）
- ❌ 不做运行时行为监控（这是 APM/RASP 的领域）
- ❌ 不替代人工 code review（Trust Score 是辅助决策，不是替代）

---

## 9. 维护说明

此文档应在以下情况时更新：

- 新增 Protocol 支持
- 新增 Language 支持（有基准数据支撑）
- 新增 Framework 适配
- 基准测试结果显著变化（P/R 变动 > 5%）
- CVE 标注样本数量变化

**不要**因为规则数量变化而更新此文档——规则数量不是产品指标。
