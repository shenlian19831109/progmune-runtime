# Progmune Coverage Matrix

> Protocol × Language × Framework — 真实覆盖状态  
> 最后更新：2026-07-24  
> 目的：回答企业唯一的关心问题——"Progmune 能不能检查我的项目？"

---

## 1. 图例

| 标志 | 含义 |
|------|------|
| ✅ | 有专用规则 + 有测试/基准数据 + Precision/Recall 可测量 |
| ⚠️ | 有通用正则规则，但基准数据弱、未校准、或已知高误报/漏报 |
| ❌ | 无覆盖 |
| — | 不存在该组合（如 TLS 对 HTTP 框架无意义） |

---

## 2. Protocol × Language 矩阵

```
Protocol           TS/JS        C            Go        Python      Java
──────────────────────────────────────────────────────────────────────────
Auth               ✅           ⚠️           ❌         ❌          ❌
TLS/SSL            ⚠️           ✅           ❌         ❌          ❌
SSH                ⚠️           ✅           ❌         ❌          ❌
HTTP/2             ⚠️           ✅           ❌         ❌          ❌
HTTP Request       ⚠️           ✅           ❌         ❌          ❌
Connection         ⚠️           ✅           ❌         ❌          ❌
QUIC               ❌           ⚠️           ❌         ❌          ❌
Resource Lifecycle ⚠️           ⚠️           ❌         ❌          ❌
Payment            ✅           ❌           ❌         ❌          ❌
Data Integrity     ✅           ❌           ❌         ❌          ❌
Ledger             ✅           ❌           ❌         ❌          ❌
──────────────────────────────────────────────────────────────────────────
有效覆盖           TS (✅×4)    C (✅×4)     ❌          ❌          ❌
                   TS (⚠️×5)    C (⚠️×3)
```

### 有效性判定依据

| 语言 | 可用性 | 证据 |
|------|--------|------|
| TypeScript | ✅ 可用 | Blind Benchmark: P=86.8%, R=83.6% |
| C | ⚠️ 不可用于生产 | Gold Benchmark (curl/libssh/nginx/openssl): P=15.2%, R=50.0%, F1=23.3% |
| Go | ❌ | 无规则、无基准、无测试 |
| Python | ❌ | 仅有 IR 提取器 (`extract-ir-python.ts`)，无安全检测规则 |
| Java | ❌ | 无任何支持 |

---

## 3. Protocol 详细说明

### 3.1 Auth（认证）

| 属性 | 值 |
|------|-----|
| 检测方式 | 正则匹配认证初始化 + 清理配对 |
| TS 覆盖 | ✅ 完整 |
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
| 未覆盖 | SQL 注入（需 schema 感知）、XSS、命令注入 |

### 3.11 Ledger

| 属性 | 值 |
|------|-----|
| 检测方式 | SSG 账本一致性检查：before-consistency, delta-consistency, delta-legality |
| TS 覆盖 | ✅ |
| 基准数据 | `.progmune_corpus/` 内 2,558 条轨迹 |

---

## 4. Framework 覆盖

```
Framework         Language     Auth   TLS   HTTP   Resource   Payment   状态
─────────────────────────────────────────────────────────────────────────────
Express           TS/JS        ❌     ❌    ❌     ❌         ❌        无适配
NestJS            TS/JS        ❌     ❌    ❌     ❌         ❌        无适配
Next.js           TS/JS        ❌     ❌    ❌     ❌         ❌        无适配
Fastify           TS/JS        ❌     ❌    ❌     ❌         ❌        无适配
Gin               Go           ❌     ❌    ❌     ❌         ❌        无 Go 支持
Fiber             Go           ❌     ❌    ❌     ❌         ❌        无 Go 支持
Django            Python       ❌     ❌    ❌     ❌         ❌        无 Python 支持
FastAPI           Python       ❌     ❌    ❌     ❌         ❌        无 Python 支持
Spring Boot       Java         ❌     ❌    ❌     ❌         ❌        无 Java 支持
curl              C            ⚠️     ✅    ✅     ⚠️         —        有基准
nginx             C            ⚠️     ✅    ✅     ⚠️         —        有基准
libssh            C            —      —     ❌     ⚠️         —        有基准
OpenSSL           C            —      ✅    —      ⚠️         —        有基准
─────────────────────────────────────────────────────────────────────────────
已适配框架        0 / 13
有基准数据的项目   4 (curl, nginx, libssh, OpenSSL) — 全部为 C 语言
```

> 当前所有规则使用 `\w*` 通用前缀模式（如 `\b(\w*ssl\w*init)\b`）进行匹配，未针对任何具体框架的 API 进行适配。

---

## 5. CVE/CWE 覆盖

| 指标 | 数值 |
|------|------|
| 标注样本 | ~100 条 CVE（`benchmarks/cve-100.json`） |
| 关联的 CWE 类别 | 未系统分类 |
| 已测检出率 | 未测量 |
| 目标 | 覆盖 OWASP Top 10 + CWE Top 25 中与 AI 生成代码相关的类别 |

---

## 6. 已知覆盖空白（优先级排序）

### P0 — 使 C 可用（当前 F1=23.3% → 目标 60%+）

| 空白 | 影响 |
|------|------|
| C 语言的 Identifier Parser | 无法识别 C 的宏、typedef、函数指针 |
| C 内存管理模式 | malloc/free 规则过于基础，无法覆盖池分配、引用计数、arena |
| C 错误处理模式 | `goto fail`、`errno`、返回值检查模式未覆盖 |
| C 资源获取模式 | 无法识别 `goto cleanup` 模式的资源释放 |

### P1 — 扩展语言支持

| 语言 | 优先级 | 原因 |
|------|--------|------|
| Python | 最高 | AI 生成代码占比最高（GitHub Copilot 数据），FastAPI/Django 企业采用率极高 |
| Go | 高 | 云原生基础设施项目主流语言 |
| Java | 中 | 企业遗留系统 + Spring Boot 生态 |

### P2 — Framework 适配

| Framework | 语言 | 关键检测点 |
|-----------|------|-----------|
| Express | TS | middleware chain, auth guard, error handler |
| Next.js | TS | API routes, middleware.ts, server actions |
| FastAPI | Python | dependency injection, auth middleware, pydantic validation |
| Django | Python | DRF permission classes, ORM query safety |

### P3 — 协议扩展

| 协议 | 为什么重要 |
|------|-----------|
| OAuth2.0 / OIDC | 几乎所有 SaaS 应用都在用 |
| gRPC | 微服务间通信主流协议 |
| GraphQL | 查询注入、深度限制、权限边界 |
| WebSocket | 实时应用，认证/授权模式特殊 |
| DB Transaction | 事务边界、隔离级别、回滚处理 |

---

## 7. 版本目标

```
                v1 (当前)         v2 (目标)           v3 (目标)
───────────────────────────────────────────────────────────────
Protocols        9                12                  16+
Languages        2 (TS✅, C⚠️)    3 (TS✅, C⚠️, Py⚠️)   4+
Frameworks       0                3 (Express, curl,    8+
                                    FastAPI)
C F1             23.3%            40%+                 60%+
TS P/R           86.8%/83.6%      90%+/88%+            稳定
CVE coverage     100 (未校准)      100 (已校准检出率)    200+
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
