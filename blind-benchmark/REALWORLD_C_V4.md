# Real-World C Validation v4 — 金标积累 ×2 + 别名迁移实证 + 规则面缺口

> 2026-08-28 — 生产级路径第 1 步（金标积累）的输出
> 演示：`demo-real-c-libssh-server/`、`demo-real-c-libssh-x11/`（真实代码逐字）

## 金标积累表（累计）

| # | 模块 | 载体 | 标注成本 | 结果 |
|---|------|------|---------|------|
| 1 | redis ACL 认证 | demo-real-c-redis | 3 注解 | APPROVED 85 / 0 FP；植入违规精确定位 |
| 2 | libssh 客户端认证 | demo-real-c-libssh | 1 别名 + 1 注解 | SSG 层 0 FP；植入违规精确定位 |
| 3 | **libssh 服务端认证**（新） | demo-real-c-libssh-server | 2 注解（verify + establish + 会话守卫 3 处） | APPROVED 82；`serve_session_no_auth` 精确定位（accept_channel_session 需 AUTHENTICATED）；合法流零误报 |

服务端注解映射：`auth_password`（真实密码比对）= verify 原语；`authenticate`（服务端
认证循环）= establish 原语（函数内顺序不检查——redis 演示同款边界）；`accept_channel_session`
= 会话守卫原语（认证后才可接受通道——服务端 missing-auth 违规类）。

## 别名迁移实证（孵化器第一个里程碑）

- **机制级**：共享表第一条别名 `ssh_userauth_password → verify_password` 已确认
  （人工确认门通过）；无本地别名的第二个 libssh 项目中 `loadProtocolRules` 加载 ✓。
- **行为级**：`matchedCalls = 2/2`（`ssh_userauth_password` 经共享别名命中
  verify_password，与内置规则 `verify_token` 同序列均匹配）——**跨项目迁移生效**。
- 边界（如实）：verify_password 的 pre（UNAUTHENTICATED）永不被 invalidate →
  别名驱动的 verify 永远满足 pre、**无法单独驱动违规**——迁移实证在匹配层成立，
  违规驱动需要 pre 会被 invalidate 的规则（如 create_session 类）的别名。

## V3 发现修正

V3「多机制认证重试循环的状态机语义缺口」**判断有误**：实测双 verify（重试）
0 违规、2 匹配——auth 初始态 UNAUTHENTICATED 永不被 invalidate，verify 可重入。
多机制别名映射不会在正常重试流上误报。真正的问题移入下方 G4。

## 规则面缺口发现（本轮积累的核心输出——下一规划周期的输入）

| # | 缺口 | 证据 | 影响 |
|---|------|------|------|
| G1 | **数字签名验证词汇缺失**：`EVP_DigestVerify*` 链（openssl dgst.c 真实验证路径）无可映射规则——`verify_checksum` 无前后置、构不成状态机 | apps/dgst.c 351-569 | 密码学验证类协议（C 最普遍的应用之一）无法注解 |
| G2 | **libc 原语生命周期不可桥接**：redis AOF 用裸 POSIX（`open`/`fopen`/`fclose`/`fsync`），单词名过不了词段（需 ≥2 词），裸名全局别名（`open → open_file`）会污染所有项目 | aof.c 270-824 | 资源生命周期验证在真实 C 的覆盖面被 libc 命名卡住 |
| G3 | **长生命周期资源与函数窗口模型不匹配**：nginx 日志文件进程级打开、永不关闭（有意设计） | ngx_http_log_module.c | 注解原语选择需避开进程级资源——模型边界 |
| G4 | **状态累积语义**：auth 初始态永不 invalidate → verify 类规则永远可重入、永远无法驱动违规——「验证通过」的检测能力需要 establish 原语显式 invalidate 初始态，或接受 verify 为纯标记规则 | 双 verify 实测 0 违规 | 规则设计层语义决策（引擎不改动即可用注解表达：establish 原语加 invalidate=["UNAUTHENTICATED"]） |

## 生产级路径进度

1. ✅ 金标积累 3/5（redis ACL、libssh 客户端、libssh 服务端；缺口发现 G1-G4 已入册）
2. ✅ 孵化器第一个里程碑（第一条别名 confirmed + 迁移实证匹配层生效）
3. ⏳ 采纳案例——待用户提供真实 C 项目（路径第 3 步）
4. ⏳ 升级评估——金标 5/5 + 采纳案例后按判据评审
