# demo-patrol — 免疫巡逻演示夹具 (P4)

故意违规的演示项目，用于验证巡逻报告的"报告 + 建议补丁，不自动合并"机制。

## 内容

- `auth.ts` — 认证域函数（带 @protocol 注解），复制自 demo-project
- `bad_flow.ts` — **故意违规**：`@protocol pre_states=["PASSWORD_VERIFIED"]` 但文件内无前置步骤
- `protocols.json` — 协议规则副本（trust 引擎按项目本地解析）

## 运行

```bash
npm run patrol -- --project demo-patrol           # 单次扫描
npm run patrol -- --project demo-patrol --watch   # 持续监听
```

## 已知边界（P4.5 校准项）

trust 引擎的 SSG 桥验证的是**文件内函数声明序列**（per-file function-declaration sequence），
不是函数体内的跨函数调用链。因此：

1. `bad_flow` 函数体内的 `generate_jwt()` 调用（无前置验证）不会被标记——
   调用级 taint 在 TS 侧是已知未覆盖区（README 诚实边界）。
2. `auth.ts` 的函数声明序列被当作执行链验证，产生 medium 级 SSG_AUTH_STATE_VIOLATION
   （create_session 使 TOKEN_ISSUED 失效后 revoke_token 缺前置）——这是引擎对
   "文件即流程"的既有语义，巡逻如实报告、不掩盖。
