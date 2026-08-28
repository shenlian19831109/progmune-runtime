# adoption-uftpd — 采纳案例（真实小型开源 C 项目）+ 金标 5/5

来源：troglobit/uftpd（小型 FTP/TFTP daemon，3,176 行）——独立真实项目，非本仓库
基准、非演示。src/*.c 逐字复制 + 4 条 @progmune 注解 + 演示层（demo_layer.c）。

## 注解设计（认证协议 2 条 + 传送授权 2 条）

| 真实函数 | 注解 | 语义 |
|---------|------|------|
| `check_user_pass` | pre=[UNAUTHENTICATED], post=[PASSWORD_VERIFIED] | 凭证检查（匿名访客/密码阶段） |
| `handle_PASS` | pre=[], post=[AUTHENTICATED] | 登录完成（230 回复） |
| `do_RETR` | pre=[AUTHENTICATED], post=[AUTHORIZED] | 下载传送守卫（金标 5/5） |
| `do_STOR` | pre=[AUTHENTICATED], post=[AUTHORIZED] | 上传传送守卫（金标 5/5） |

命名空间为 auth（SSG 状态机 per-namespace——data_integrity 内置规则
`check_resource_ownership` 的跨命名空间 pre 不可满足，见 REALWORLD_C_V6.md
发现 G5）。

演示层 wrapper（ftp_session_good / ftp_session_no_login / ftp_transfer_good /
ftp_transfer_no_login）演示守卫语义——uftpd 真实入口经函数指针表分发
（L3 边界），wrapper 是函数指针架构下的现实注解形态。

## 复现

```bash
npm run build
node -e "
const { evaluateTrust } = require('./dist/trust/engine.js');
evaluateTrust({ projectPath: './adoption-uftpd', projectName: 'uftpd', commit: 'a', language: 'c' })
  .then(r => console.log(r.overall.decision, r.overall.score,
    r.violations.filter(v => v.rule_id.startsWith('SSG_')).map(v => v.function)));
"
# 期望：真实代码 SSG 层 0 违规；ftp_transfer_good 零违规；
#       ftp_transfer_no_login → SSG_AUTH_STATE_VIOLATION（do_RETR 需 AUTHENTICATED，
#       fixPath 指向 establish_login）
```

详见 `blind-benchmark/REALWORLD_C_V5.md`（采纳案例）+ `REALWORLD_C_V6.md`（金标 5/5）。
