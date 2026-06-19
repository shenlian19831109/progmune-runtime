# Progmune Runtime 综合测试报告

**测试时间**: 2026-05-23 14:15:09
**运行时长**: 3171ms
**测试版本**: 2.0.5
**LLM 后端**: DeepSeek Chat (deepseek-chat)
**Node 版本**: v20.11.1

---

## 测试结果摘要

| 指标 | 数值 |
|------|------|
| 总用例 | 29 |
| 通过 | 29 |
| 失败 | 0 |
| 通过率 | 100.0% |

## 逐项测试详情

| # | 测试项 | 状态 | 说明 |
|---|--------|------|------|
| 1 | MCP tools/list 返回工具列表 | ✅ PASS | 返回 2 个工具 |
| 2 | MCP 暴露 progmune_generate 工具 | ✅ PASS | 工具名: progmune_generate |
| 3 | 工具包含 intent 参数 | ✅ PASS |  |
| 4 | 工具包含 projectPath 参数 | ✅ PASS |  |
| 5 | SVL-1: 调用存在的函数通过 | ✅ PASS |  |
| 6 | SVL-1: 拦截不存在的函数 | ✅ PASS | 错误: 函数 'nonexistent_func' 不存在 |
| 7 | SVL-1: 错误消息包含"不存在" | ✅ PASS | 函数 'nonexistent_func' 不存在 |
| 8 | SVL-2: 参数数量匹配通过 | ✅ PASS |  |
| 9 | SVL-2: 拦截参数数量不匹配 | ✅ PASS | 错误: 参数数量不匹配: 期望 2, 实际 1 |
| 10 | SVL-2: 错误消息包含"参数数量" | ✅ PASS | 参数数量不匹配: 期望 2, 实际 1 |
| 11 | SVL-3: 变量先声明后使用通过 | ✅ PASS |  |
| 12 | SVL-3: 拦截未声明变量 | ✅ PASS | 错误: 变量 'undeclaredVar' 在赋值前未声明 |
| 13 | SVL-3: 拦截条件中未声明变量 | ✅ PASS | 错误: 条件中引用了未声明的变量 'undefinedVar' |
| 14 | SVL-3: 复杂嵌套变量流通过 | ✅ PASS |  |
| 15 | SVL-4: 认证动作合法 | ✅ PASS | 状态: UNAUTHENTICATED -> AUTHENTICATED |
| 16 | SVL-4: 认证后签发令牌合法 | ✅ PASS | 状态: AUTHENTICATED -> TOKEN_ISSUED |
| 17 | SVL-4: 拦截未认证直接签发令牌 | ✅ PASS | 错误: [PROGMUNE] L4 协议违规：issue_token
  当前状态：UNAUTHENTICATED
  期望前置状态：AUTHENTICATED
  缺失步骤：authenticate → AUTHENTICATED |
| 18 | Failure Corpus: 记录失败案例 | ✅ PASS | 共 17 条 |
| 19 | Failure Corpus: 按 SVL-1 过滤 | ✅ PASS | 找到 2 条 |
| 20 | Failure Corpus: 生成失败模式统计 | ✅ PASS | [{"pattern":"SVL-4:protocol","count":11},{"pattern":"SVL-1:symbol_existence","count":2},{"pattern":"SVL-2:type_mismatch","count":2}] |
| 21 | 记忆系统: 记录情景记忆 | ✅ PASS | 共 5 条 |
| 22 | 记忆系统: 过滤成功情景 | ✅ PASS | 共 5 条 |
| 23 | 记忆系统: 语义模板巩固与匹配 | ✅ PASS | 模板: tmpl_1779545707638, 成功率: 1 |
| 24 | 边界: 空动作序列通过 | ✅ PASS |  |
| 25 | 边界: 拦截未知动作类型 | ✅ PASS | 无效动作类型: 'invalid_kind' |
| 26 | 边界: 多层嵌套通过 | ✅ PASS |  |
| 27 | 白名单: 内置函数通过校验 | ✅ PASS | console.log, JSON.stringify |
| 28 | 端到端: 生成动作序列 | ✅ PASS | 共 2 个动作 |
| 29 | 端到端: 生成 Python 代码 | ✅ PASS | 代码长度: 144 字符 |

---

## SVL 层级覆盖矩阵

| SVL 级别 | 名称 | 测试覆盖 | 状态 |
|:---------:|:----|:---------|:----:|
| SVL-1 | 符号存在性 | 调用存在/不存在函数校验 | ✅ |
| SVL-2 | 类型有效性 | 参数数量匹配校验 | ✅ |
| SVL-3 | 数据流正确性 | 变量声明/使用、嵌套作用域 | ✅ |
| SVL-4 | 协议合法性 | SSG 状态机、非法跃迁拦截 | ✅ |

## 系统组件覆盖

| 组件 | 测试覆盖 | 状态 |
|:-----|:---------|:----:|
| MCP 协议层 | tools/list、tools/call | ✅ |
| 校验引擎 (Validator) | SVL-1~3 校验 | ✅ |
| SSG 状态机 | 协议跃迁校验 | ✅ |
| Failure Corpus | 记录/查询/模式统计 | ✅ |
| 三层记忆系统 | 情景记忆/语义模板 | ✅ |
| 代码生成器 | 动作序列 → Python | ✅ |
| 内置白名单 | console.log / fetch 等 | ✅ |
| 边界情况 | 空序列/嵌套/非法类型 | ✅ |

## 结论

**全部测试通过。** Progmune Runtime 各核心组件运行正常，约束引擎、SSG 协议校验、记忆系统和 Failure Corpus 均按预期工作。

---

*报告由 Progmune Runtime 综合测试套件自动生成*
