# Real-World C Validation v5 — 采纳案例：uftpd（生产级路径第 3 步）

> 2026-08-28 — 第一个独立采纳数据点
> 项目：uftpd（troglobit/uftpd，小型 FTP/TFTP daemon，3,176 行 / 6 文件，真实开源、非基准非演示）
> 副本：`adoption-uftpd/`（src/*.c 逐字 + 2 注解 + 演示层）

## 采纳第一天（基线，未注解）

| 观测 | 值 |
|------|----|
| 决策 | NEEDS_REVIEW 75 |
| flags | 3 条，全部正则层 `PLAINTEXT_AUTH_WITHOUT_TLS`（FTP 明文协议被 Web/TLS 语义规则误映射——已知 FP 类；FTP 本身明文设计） |
| SSG 层 | 0 flags（静默——未注解） |

## 注解后

| 项 | 值 |
|----|----|
| 标注成本 | **2 注解**（`check_user_pass`=verify：pre UNAUTHENTICATED → post PASSWORD_VERIFIED；`handle_PASS`=establish：pre [] → post AUTHENTICATED）+ 演示层 2 wrapper |
| 真实代码 SSG 误报 | **0** |
| 植入违规 | `ftp_session_no_login`（未登录传输）精确定位：`start_file_transfer` 需 AUTHENTICATED |
| 合法流 | `ftp_session_good` SSG 层零违规 |
| 正则层残留 | 3 条 FP：PLAINTEXT ×2（真实代码，已知类）+ PROTOCOL_CROSS_DOMAIN ×1（演示层 artifact） |

## 采纳数据点（生产级路径判据的输入）

1. **成本确认**：独立真实项目 2 注解/协议——与演示数据一致（~2-3/协议）。
2. **零 SSG 误报确认**：真实 6 文件全量扫描，注解层不产生任何误报。
3. **真实摩擦发现**：uftpd 的登录原语经**函数指针表分发**（`supported[]` 命令表）——
   真实入口路径对序列构建不可见（L3 边界），注解价值集中在原语层而非调用链层；
   演示层以同形 wrapper 表达守卫语义——**wrapper 模式是函数指针架构下的现实注解形态**。
4. **正则层噪声是采纳体验的最大残留**：FTP 项目收到 2 条语义错误的 PLAINTEXT FP——
   Web 语义规则面向 C 项目的误映射类需要清理（候选：按语言限定正则规则面）。

## 生产级路径进度更新

1. ✅ 金标积累 3/5
2. ✅ 孵化器里程碑 1（别名 confirmed + 迁移实证匹配层生效）
3. ✅ **采纳案例 1/1（uftpd）**
4. ⏳ 升级评估：金标 5/5 后 + 正则层噪声清理决策，按判据评审
