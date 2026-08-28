# demo-real-c-libssh-cb — 回调分发认证演示（金标 4/5）

真实 libssh `examples/samplesshd-cb.c`（359 行）逐字 + 2 条注解 + 演示层。
libssh 现代服务端回调分发 API（`ssh_server_callbacks_struct` 的
`auth_password_function` / `channel_open_request_session_function`）——
生产级路径决策记录指定的「libssh userauth 回调分发」金标模块。

## 注解设计（2 条/认证协议）

| 真实函数 | 注解 | 语义 |
|---------|------|------|
| `auth_password` | pre=[UNAUTHENTICATED], post=[PASSWORD_VERIFIED] | 密码比对回调（verify 原语） |
| `new_session_channel` | pre=[AUTHENTICATED], post=[CHANNEL_OPEN] | 通道开启回调（会话守卫——认证后才可开通道） |

演示层 wrapper（`authenticate` = establish 原语）：真实代码中认证完成跃迁
发生在 libssh 内部 + main 循环条件 `while (!(authenticated && chan != NULL))`
——函数指针分发 L3 边界下由同形 wrapper 表达（REALWORLD_C_V5.md wrapper 模式）。

## 结果

- 决策 APPROVED 82；真实示例函数 SSG 层零误报
- `cb_session_good`（verify → establish → 通道守卫）零违规
- `cb_session_no_auth`（未认证开通道）→ SSG_AUTH_STATE_VIOLATION 精确定位
  （`new_session_channel` 需 AUTHENTICATED）

## 复现

```bash
npm run build
node -e "
const { evaluateTrust } = require('./dist/trust/engine.js');
evaluateTrust({ projectPath: './demo-real-c-libssh-cb', projectName: 'samplesshd-cb', commit: 'a', language: 'c' })
  .then(r => console.log(r.overall.decision, r.overall.score,
    r.violations.map(v => v.rule_id + '@' + v.function)));
"
```

详见 `blind-benchmark/REALWORLD_C_V6.md`。
