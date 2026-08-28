# Real-World C Validation v3 — Library-Boundary Annotation Demo (libssh)

> 2026-08-27 — 库边界注解演示（定位拍板后的第一个交付物）
> 演示项目：`demo-real-c-libssh/`（真实 libssh examples/authentication.c 逐字 + 两层机制）

## 背景与机制（两层）

C 定位已拍板为「注解驱动」。机制分两层，迁移性不同：

| 层 | 载体 | 示例 | 迁移性 |
|----|------|------|--------|
| **库边界别名** | `.progmune_aliases.json` | `ssh_userauth_password → verify_password` | **跨项目迁移**（孵化器燃料——任何 libssh 用户项目获得该桥接） |
| 项目原语注解 | `/* @progmune(...) */` | `start_channel_session`（establish 原语） | 项目内（应用层语义） |

库 API 是外部调用、没有定义——注解块挂不上去，别名文件是库边界层的家（Strategy 0b 精确别名匹配不限门控，生产机制 `loadProjectAliases` 已存在）。

## 语料与结果

- `authentication.c`：真实 libssh 示例逐字（240 行：authenticate_console / authenticate_kbdint / auth_keyfile）+ 演示层 3 函数（标注明确分隔）
- 成本：**1 条别名 + 1 条注解 = 2 项/协议**（auth）
- 生产管线（extractProjectIR → ir.json → evaluateTrust，确定性无 LLM）：

| 流 | 结果 |
|----|------|
| 真实示例函数（authenticate_console 等） | SSG 层零误报（ssh_userauth_password 经别名命中 verify_password：初始 UNAUTHENTICATED ✓ → PASSWORD_VERIFIED ✓） |
| connect_flow_good（先认证再开通道） | 零违规 ✓ |
| connect_flow_no_auth（未认证开通道） | **精确定位**：`start_channel_session` in `[UNAUTHENTICATED]`, required `[PASSWORD_VERIFIED]` |

**正则防护层（引擎并行运行的旧 C 检测，非注解路径）也触发了两条**：
- `SSH_NO_HOST_KEY_CHECK` @ authenticate_console —— **真发现**：示例代码确实不验证
  SSH 主机密钥（文件头自述「非客户端最佳实践参考」）——旧 P0-P3 规则层在
  真实代码上抓到了真实缺陷；
- `PLAINTEXT_AUTH_WITHOUT_TLS` @ authenticate_console —— **FP**：Web 语义的
  TLS 规则误映射到 SSH（SSH 传输层本身加密，无需 TLS）——旧规则层的已知
  误映射类，如实记录。

## 发现（如实）

1. **多机制认证重试循环的状态机语义缺口**：真实示例的 authenticate_console 在
   `while (rc != SSH_AUTH_SUCCESS)` 里依次尝试 gssapi/publickey/kbdint/password——
   若把每个机制都别名到 verify_password（pre=[UNAUTHENTICATED]），第二次尝试
   就会在 PASSWORD_VERIFIED 状态下误报。**状态机缺「尝试-重试」语义**（pre 可重入/
   幂等尝试），本轮只映射终端机制并如实记录——这是别名层语义约束的实质发现，
   候选方向：给 verify 类规则加「可重试」标记或重试循环模式识别。
2. **fixPath 反向映射**：修复建议输出规则名 `verify_password`，而非库调用名
   `ssh_userauth_password`——别名层（call→rule）需要反向查询（rule→首选 call）
   用于修复渲染（低优先级候选，displayName 机制同族）。

## 结论

库边界注解路径在真实 libssh 代码上成立：2 项标注/协议、0 误报、植入违规精确定位。
别名迁移性的验证方式 = 共享 C 别名表（回写机制）落地后，用**未使用该项目的
第二个 libssh 项目**复测同一别名生效——这是孵化器机制的下一个验证里程碑。
