# demo-real-c-libssh — 库边界注解演示

真实 libssh `examples/authentication.c` 逐字 + 两层机制演示（详见
`blind-benchmark/REALWORLD_C_V3.md`）。

## 文件

- `authentication.c` — 真实 libssh 示例（authenticate_console / authenticate_kbdint /
  auth_keyfile / error）逐字 + 演示层（以分隔注释标注）：`start_channel_session`
  （establish 原语注解）、`connect_flow_good`（合法流）、`connect_flow_no_auth`
  （植入 missing-auth 违规）
- `.progmune_aliases.json` — 库边界别名：`ssh_userauth_password → verify_password`
  （跨项目迁移——任何 libssh 用户项目获得该桥接）

## 复现

```bash
npm run build
node -e "
const { evaluateTrust } = require('./dist/trust/engine.js');
// 直接调 evaluateTrust（语言 c）——引擎自动提取 IR 并合并注解，
// 无需手动 extractProjectIR/写 ir.json（此前是文档陷阱，已修复）
"
# 期望：真实示例函数 SSG 层零误报；connect_flow_good 零违规；
#       connect_flow_no_auth → SSG_AUTH_STATE_VIOLATION（required PASSWORD_VERIFIED）
# 正则防护层同跑：SSH_NO_HOST_KEY_CHECK 真阳性 + PLAINTEXT_AUTH_WITHOUT_TLS FP（已知）
```

## 已知边界

- 多机制认证重试循环未全映射（verify_password 的 pre 不可重入——状态机
  「尝试-重试」语义缺口，见 REALWORLD_C_V3.md 发现 1）
- 修复建议输出规则名（verify_password）而非库调用名（ssh_userauth_password）
  ——别名反向映射候选（发现 2）
