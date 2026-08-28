# Real-World C Validation v6 — 金标 5/5 完成 + 正则层噪声治理

> 2026-08-28 — 生产级路径第 4 步（升级评估）的输入
> 金标 4/5：`demo-real-c-libssh-cb/`（samplesshd-cb 回调分发）
> 金标 5/5：`adoption-uftpd/` 扩展（数据传送授权，第二个协议）

## 金标 4/5 — libssh 回调分发认证（决策记录指定的最优模块）

真实 libssh `examples/samplesshd-cb.c`（359 行）逐字 + 2 注解 + 演示层。
现代回调分发 API：`ssh_server_callbacks_struct` 的 `auth_password_function`
/ `channel_open_request_session_function`——认证函数经 libssh 内部函数指针
分发调用（真实入口路径 L3 不可见）。

| 项 | 值 |
|----|----|
| 标注成本 | 2 注解（`auth_password`=verify：pre UNAUTHENTICATED → post PASSWORD_VERIFIED；`new_session_channel`=通道守卫：pre AUTHENTICATED → post CHANNEL_OPEN）+ 演示层 establish wrapper |
| 真实代码 SSG 误报 | **0**（359 行全量扫描） |
| 决策 | APPROVED 82 |
| 植入违规 | `cb_session_no_auth`（未认证开通道）→ SSG_AUTH_STATE_VIOLATION 精确定位（`new_session_channel` 需 AUTHENTICATED） |
| 合法流 | `cb_session_good`（verify → establish → 守卫）零违规 |
| 边界（如实） | 认证完成跃迁在真实代码中发生在 libssh 内部 + main 循环条件（`while (!(authenticated && chan != NULL))`）——establish 原语由演示层 wrapper 表达（V5 wrapper 模式） |

## 金标 5/5 — uftpd 数据传送授权（第二个协议，新规则家族）

采纳案例项目扩展：真实 `ftpcmd.c` 的传送原语 `do_RETR`/`do_STOR`
（经 `uev_io_init(..., do_RETR, ...)` 事件回调注册——函数指针分发，
真实入口路径同样不可见）+ 2 注解。

| 项 | 值 |
|----|----|
| 标注成本 | 2 注解（`do_RETR`/`do_STOR`：pre AUTHENTICATED → post AUTHORIZED） |
| 真实代码 SSG 误报 | **0**（4 注解后全量扫描；do_RETR/do_STOR 无按名调用方，零误归因风险） |
| 植入违规 | `ftp_transfer_no_login`（未登录下载）→ SSG_AUTH_STATE_VIOLATION 精确定位（`do_RETR` 需 AUTHENTICATED，fixPath → `establish_login`） |
| 合法流 | `ftp_transfer_good`（登录 → 传送）SSG 层零违规 |
| 规则家族 | 传送守卫（镜像 check_resource_ownership 语义）——金标首次覆盖 auth 之外的第二类守卫 |

## 发现 G5 — 跨命名空间 pre 状态不可满足（规则面设计缺口）

初版传送注解用 `namespace="data_integrity"`（镜像内置 `check_resource_ownership`
的 pre=[AUTHENTICATED]）→ **合法流也报违规**。根因：SSG 状态机 per-namespace
（`validateTransition` 只查 `currentState[rule.namespace]`）——data_integrity
命名空间的初始态是 IDLE，auth 命名空间建立的 AUTHENTICATED 对它不可见。
**内置 `check_resource_ownership` 因此从不可满足**（src/tests 全仓库零引用，
无 TS/Python 金标覆盖该规则）。

- 处理：传送守卫改 `namespace="auth"`（与 V5 `start_file_transfer` 同款——
  会话授权域本就属 auth 状态容器），演示成立。
- 影响：`check_resource_ownership` 是死规则——规则面设计缺口，非引擎缺陷
  （per-namespace 是设计如此）。候选修复（不排期）：规则级跨命名空间 pre
  声明语法，或把该类规则整体迁入 auth 命名空间。

## 正则层噪声治理 — PLAINTEXT_AUTH_WITHOUT_TLS 语言门控

**证据积累完成**：libssh 演示 1 FP（SSH 明文协议被 Web/TLS 语义误映射，
V3 记录）+ uftpd 采纳案例 2 FP（handle_USER/main）——**3 FP / 0 TP**。
FTP/SSH 应用层本就明文，传输加密在协议自身/进程外，Web 语义规则对 C 无意义。

**实现**（`src/trust/protocol-domain-validator.ts`）：`SpecificViolationCheck`
加 `languages` 字段（undefined = 全语言，向后兼容）；PLAINTEXT 规则
`languages: ["typescript", "javascript", "python"]`；`checkSpecificViolations`
加 `language` 参数；engine 传入 `ctx.language`。**SSH 主机密钥规则保持全语言**
（libssh 演示 1 TP：SSH_NO_HOST_KEY_CHECK 真发现保留）。

**验证**：
| 门 | 结果 |
|----|------|
| 新增回归测试（语言门控 5 例） | 5/5 ✓ |
| 引擎相关套件（engine/ssg-bridge/call-sequence/extract-ir-c/validator） | 83/83 ✓ |
| uftpd 重扫 | PLAINTEXT ×2 **消失**；SSG 2 违规（正确）+ 2 演示层 cross-domain artifact |
| libssh 演示重扫 | PLAINTEXT FP **消失**；SSH_NO_HOST_KEY_CHECK TP **保留** |
| Python 盲测 v1.2 | **零漂移**（64 违规，仅时间戳差） |
| C 应用级金标 | **P=91.7% / R=100% / F1=95.7% 不变** |

## 金标累计表（5/5 完成）

| # | 模块 | 载体 | 标注成本 | 结果 |
|---|------|------|---------|------|
| 1 | redis ACL 认证 | demo-real-c-redis | 3 注解 | APPROVED 85 / 0 FP；植入违规精确定位 |
| 2 | libssh 客户端认证 | demo-real-c-libssh | 1 别名 + 1 注解 | SSG 层 0 FP；植入违规精确定位 |
| 3 | libssh 服务端认证 | demo-real-c-libssh-server | 2 注解 + 守卫 | APPROVED 82；`serve_session_no_auth` 精确定位 |
| 4 | **libssh 回调分发认证**（新） | demo-real-c-libssh-cb | 2 注解 | APPROVED 82；`cb_session_no_auth` 精确定位；真实代码 0 FP |
| 5 | **uftpd 数据传送授权**（新） | adoption-uftpd | 2 注解 | 真实代码 0 FP；`ftp_transfer_no_login` 精确定位（fixPath → establish_login） |

## 采纳数据点补充（延续 V5）

- **标注成本收敛**：5/5 金标 + 1 采纳案例全部落在 **~2-3 注解/协议**。
- **第二协议实测**：同一真实项目（uftpd）上认证 + 传送授权两协议共存，
  互不干扰、零误报——多协议项目可行性证据。
- **正则层噪声清零**：C 项目采纳体验的最大残留（V5 发现 4）已治理——
  真实代码扫描不再出现语义错误的 Web 规则 FP。

## 生产级路径进度（最终）

1. ✅ 金标积累 5/5（redis ACL、libssh 客户端/服务端/回调分发、uftpd 传送授权；G1-G5 入册）
2. ✅ 孵化器里程碑 1（第一条别名 confirmed + 迁移实证匹配层生效）
3. ✅ 采纳案例 1/1（uftpd：登录 + 传送授权两协议）
4. ✅ 正则层噪声治理（PLAINTEXT 语言门控，双零漂移验证）
5. ✅ **升级评估——2026-08-28 已拍板：C 标签「研究」→「注解驱动协议验证（Beta）」**

## 升级评估（已拍板）

C 从「⚠️ 研究」升级的判据输入：

| 判据（来自生产级路径约定） | 证据 |
|---------------------------|------|
| 金标 5/5 | 5 个真实模块（3 项目家族 × 2 协议类型）全部 0 FP + 违规精确定位 |
| 采纳案例 ≥1 | uftpd（独立真实项目，非基准非演示；两协议实测） |
| 标注成本可接受 | 稳定 ~2-3 注解/协议（6 次独立测量收敛） |
| 真实项目噪声 | 注解层 0 FP；正则层已按证据治理（3 FP → 0） |
| 孵化机制 | 第一条别名 confirmed + 跨项目迁移实证（matchedCalls 2/2） |

**结论（2026-08-28 已拍板）**：文档标签从「研究」升级为「注解驱动协议验证
（Beta）」——README 双语、覆盖矩阵双语、c-language-status、CLAUDE.md 同步翻新；
「未注解代码不检测」的能力边界如实保留。
