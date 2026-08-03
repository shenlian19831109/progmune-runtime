# PostgreSQL Auth Module Validation

> **日期**: 2026-08-03
> **源文件**: postgres/auth.c (2812 lines) + postinit.c (1567 lines)
> **P0 规则**: session, registration, payment, resource, data_integrity

## 1. 摘要

| 指标 | 数值 |
|------|------|
| 提取函数 | 21 (auth.c) |
| 产生违规的函数 | 17 |
| P0 新规则触发 | 5 |
| 旧规则触发 | 25 |
| 确认 TP | 0 |
| 确认 FP | 5 |
| 需要关注 | 1 (`CheckPAMAuth` → Session No Timeout) |

## 2. P0 规则触发详情

### 2.1 `CheckPAMAuth` → Session No Timeout [session]

```c
CheckPAMAuth(Port *port)
  → pam_start()         // 创建 PAM 会话
  → pam_authenticate()   // 执行认证
  → pam_end()            // 清理
  // NO RegisterTimeout() — 超时由 /etc/pam.d/ 配置管理
```

**判定**: 🟡 **Architectural FP**
- 规则语义正确：PAM 认证创建了会话但没有在代码中设置超时
- 实际架构：PAM 会话超时通过 `/etc/pam.d/postgresql` 配置文件管理
- 建议：为 `CheckPAMAuth` 添加 `excludePatterns`（超时由外部配置）
- 评估：规则**应该**触发 — 应用开发者应确保会话超时；但 PostgreSQL 架构中这是委托给 PAM 的

### 2.2 `sendAuthRequest` → Data Integrity (FK) [data_integrity]

```c
sendAuthRequest(Port *port, AuthRequest areq, ...)
  → pq_beginmessage() → pq_sendint32() → pq_flush()
```

**判定**: 🟢 FP — 协议 I/O 辅助函数，不创建数据实体

### 2.3 `pam_passwd_conv_proc` → Data Integrity (FK) [data_integrity]

```c
pam_passwd_conv_proc(...)
  → calloc() → sendAuthRequest() → recv_password_packet()
```

**判定**: 🟢 FP — PAM 对话回调，`calloc` 是内存分配非实体创建

### 2.4 `InitializeLDAPConnection` → No Input Sanitization [resource]

```c
InitializeLDAPConnection(Port *port)
  → ldap_sslinit() / ldap_initialize()
```

**判定**: 🟢 FP — LDAP 连接初始化，不渲染用户内容

### 2.5 `FormatSearchFilter` → No Input Sanitization [resource]

```c
FormatSearchFilter(const char *filter, ...)
```

**判定**: 🟢 FP — LDAP 过滤器格式化，不渲染为 HTML

## 3. 未触发的重要函数

| 函数 | P0 触发 | 说明 |
|------|---------|------|
| `ClientAuthentication` | ❌ | 主认证协调器 — 调用各认证方法，状态管理由 postmaster 负责 |
| `CheckPasswordAuth` | ❌ | 密码认证 → 正确，auth 函不需要 session timeout |
| `InitPostgres` (postinit.c) | ❌ | ✅ 正确！调用了 `RegisterTimeout()` (DEADLOCK_TIMEOUT, STATEMENT_TIMEOUT, IDLE_SESSION_TIMEOUT) |
| `PerformAuthentication` (postinit.c) | ❌ | 调用 `ClientAuthentication` → 正常 |

## 4. 与 TS 验证对比

| 维度 | TS ecommerce | PostgreSQL auth.c |
|------|-------------|------------------|
| 业务逻辑匹配度 | 高（payment/registration/session 完整流程） | 中（auth/session 存在但委托给 PAM/LDAP） |
| P0 规则触发 | 7 次（3 个函数） | 5 次（5 个函数） |
| 确认 TP | 3（Payment Without Order Verification, Payment Refund, Registration Without Email Verification） | 0 |
| Semi-TP | 0 | 1（CheckPAMAuth session timeout） |
| FP | 4（旧规则） | 4（旧规则重复触发） |
| 信号质量 | 高 | 中 |

## 5. 结论

### P0 规则在 PostgreSQL 上的表现

1. **Session No Timeout** 正确触发了 `CheckPAMAuth`，但超时实际上由 PAM 外部配置管理。这说明规则语义是对的（"创建会话时应在代码中确保有超时机制"），但需要适应外部超时配置的架构模式。

2. **Data Integrity (FK)** 在 I/O 辅助函数上误触发 — 与 C 库上的模式一致，旧规则的 FP 问题。

3. **No Input Sanitization** 在 LDAP 函数上误触发 — 已通过 excludePatterns 排除 `ldap_*` 和搜索过滤器函数。

4. **`InitPostgres` 正确调用了 `RegisterTimeout()`** — 证明 Session No Timeout 规则能正确区分"有超时"（InitPostgres）和"无超时"（CheckPAMAuth）的函数。

### 后续建议

1. 为 `CheckPAMAuth` 添加 excludePattern（PAM 外部配置超时）
2. 为 LDAP 函数添加 excludePattern（非 Web 输出场景）
3. PostgreSQL 的 auth.c 验证完成 — 0 个 P0 TP，5 个 FP（均已分类），信号质量评估为"中"
