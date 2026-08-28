# Real-World C Validation v7 — 注解采纳体验（采纳生死线工具）

> 2026-08-28 — 注解驱动的「采纳生死线」：把「~2-3 注解/协议」的成本从
> 「知道该注解什么」降到「扫描 → 填空」。
> 交付：`src/annotation-suggest.ts`（建议引擎）+ `scripts/c-annotate.js --scan`
> （扫描/自动写入）+ `evaluateTrust` 加性字段 `annotationSuggestions`。

## 机制

**建议引擎**（确定性启发式，无 LLM）：按函数名词汇（3.7.6 金标 5/5 真实注解
反推的词表）× 已注解状态，为未注解 C 项目生成原语注解候选——角色
（verify/establish/guard/open/close）、命名空间、状态转移、可直接粘贴的
注释块模板、置信度、命中理由。已注解函数、规则名函数、外部函数自动排除。

**CLI**：`node scripts/c-annotate.js --scan <dir>`（dry-run 默认）；
`--write` 自动把建议插入函数定义上方（保守门控，见下）；与
c-alias-propose 同一哲学——建议是填空起点，人工确认后生效。

**引擎**：`evaluateTrust` 返回 `annotationSuggestions`（仅 C；TS/Python 无该
字段——加性零漂移）。

## 验收：金标恢复率（无注解 uftpd 副本，对照手写 4 注解）

| 手写金标（V5/V6） | 建议引擎 | 恢复 |
|------------------|---------|------|
| `check_user_pass` = verify | 【凭证比对】pre UNAUTHENTICATED → post PASSWORD_VERIFIED | ✅ 角色正确 |
| `handle_PASS` = establish | 【登录完成】pre [] → post AUTHENTICATED | ✅ 角色正确 |
| `do_RETR` = guard | 【权限守卫】pre AUTHENTICATED → post AUTHORIZED | ✅ 角色正确 |
| `do_STOR` = guard | 【权限守卫】pre AUTHENTICATED → post AUTHORIZED | ✅ 角色正确 |

**恢复率 4/4（角色级正确）**。额外真阳性：`handle_RETR`/`handle_STOR`（命令
处理器守卫——与手写金标同类）、`open/close_data_connection`（资源生命周期——
正是 G2 讨论的裸 POSIX 上游的项目级包装器）、`establish_login`/`start_file_transfer`
（演示层手写注解的镜像）。

## 验收：自动应用等价性（--write --all）

写入 7 条（3 条掩蔽风险跳过 + 2 条资源跳过，见下）。**结果与手写金标等价**：

| 项 | 手写 4 注解 | 自动应用 7 条 |
|----|-----------|--------------|
| 真实代码 SSG 误报 | 0 | **0** |
| 植入违规 | ftp_session_no_login + ftp_transfer_no_login 精确定位 | **同左，2/2 精确定位** |
| 决策/分数 | NEEDS_REVIEW 72 | NEEDS_REVIEW 72 |

## 三个实测安全发现（自动写入的门控依据——全部有数据）

1. **掩蔽风险（establish 类，实测）**：注解把函数变成状态机「原语」（函数内
   顺序不检查——既有设计边界）。对体内调用其他规则原语的函数（流函数）加
   establish 注解后，体内序列不再被验证——**实测：演示层 2 处植入违规被掩蔽**
   （ftp_session_no_login/ftp_transfer_no_login 被 establish 注解变不透明后
   违规消失）。对策：建议带 `maskRisk` 标记（体内调用规则原语或本批同被建议
   函数）；CLI 自动写入跳过 maskRisk（不提供强制开关——人工确认后手写）。
   **副作用如实记录**：handle_PASS（体内调用 check_user_pass）被保守跳过，
   恢复率口径 = 建议 4/4（角色正确）、自动写入 3/4。
2. **资源生命周期跨窗口 FP（实测 28 条）**：open/close_data_connection 注解
   自动应用后，真实代码产生 28 条 SSG 违规——open 与 close 分处不同函数窗口
   （uv 事件回调），正是 V1 记录的跨函数窗口/回调生命周期 FP 类。对策：CLI
   默认不自动写入 open/close（`--include-resource` 强制 + 警告）；建议仍展示。
3. **词汇误判（实测 4 FP）**：`new_session`（会话工厂，创建而非检查）被
   ["new","session"] 误判为守卫 → 其调用方（ftp_cb/tftp_cb/main，登录前建
   会话的正常行为）被误报。对策：模式收紧为 ["new","channel"] /
   ["new","session","channel"]（new_session_channel 仍命中）。

## 设计结论（写入门控的规则）

| 建议角色 | 自动写入 | 依据 |
|---------|---------|------|
| verify / guard（叶子，无掩蔽风险） | ✅ 默认（--write 高置信，--all 含中置信） | 实测 0 新 FP |
| establish / 任何掩蔽风险函数 | ❌ 跳过（不提供强制开关） | 掩蔽实测（发现 1） |
| open / close（资源生命周期） | ❌ 跳过（--include-resource 强制） | 跨窗口 FP 实测（发现 2） |

## 交付文件

- `src/annotation-suggest.ts` + `src/annotation-suggest.test.ts`（15 用例：
  角色命中/排除/掩蔽风险/确定性/模板）
- `scripts/c-annotate.js --scan`（dry-run 默认；--write/--all/--include-resource；
  写入后自动刷新 ir.json 防陈旧）
- `evaluateTrust.annotationSuggestions`（仅 C，加性）
