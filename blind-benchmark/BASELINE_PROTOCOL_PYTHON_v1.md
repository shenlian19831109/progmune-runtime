# Python 协议盲测基线 v1（BASELINE_PROTOCOL_PYTHON_v1）

> 测量对象：Python 的 SSG 协议状态机路径（覆盖矩阵 Protocol × Language 的 Python 列）  
> 生成日期：2026-08-23（v1.2：P4.6 跨函数传播 + S5 任意命名复测）  
> 结论：**Recall 97% / Precision 100% / 0 FP（66 处可测金标）**；2 处漏检为注解依赖前置约束（T2×S5 无注解改名），如实单列

---

## 1. 概要

本基线给 Python 协议层（Auth / Resource Lifecycle）提供可测量的 P/R 数据——覆盖矩阵 Python 列据此从 ⚠️ 升级 ✅。

与 Python 缺陷检测盲测（v1：90 项目 / 729 gold，测源码级检测规则）不同，本基准隔离测量 **SSG 协议状态机**：入口函数展开序列（P4.6 跨函数传播）经生产校验器（`src/trust/ssg-bridge.ts` 的 `validateSequenceWithSSG`）做 pre-state / invalidate / **endState（资源未释放）** 校验。风格变体沿用盲测方法论：结构变体（线性 / helper / 类方法 / 噪声穿插）+ 命名变体（S5 改名无注解）。

## 2. 语料

网格：T0–T5 × S1–S5（30）+ T6/T7 × S1–S4（8）= **38 个项目**（`blind-benchmark/generated-protocol-py/`，gitignored，脚本生成）。每 broken 项目植入 2 处同型违规（不同函数）。

| 类型 | 违规类 | 检测路径 | 金标 | detectionExpected |
|------|--------|---------|------|-------------------|
| T0 | clean 对照 | —（含分离式清洁链：verify 在 flow、issue 在 helper） | 0 | — |
| T1 | missing_precondition_builtin | 内置规则（`create_session` pre=[TOKEN_ISSUED]） | 10 | ✅ |
| T2 | missing_precondition_annotation | 项目 `@progmune` 注解 + P4.5 合并（`generate_jwt` pre=[PASSWORD_VERIFIED]） | 10 | ✅（S5 无注解 ×2 如实漏检） |
| T3 | use_after_revoke | invalidate 后重入（`revoke_token` → `create_session`） | 10 | ✅ |
| T4 | use_after_close | invalidate 后重入（`close_file` → `read_file`） | 10 | ✅ |
| T5 | missing_cleanup | endState（序列末尾资源未释放） | 10 | ✅ |
| T6 | cross_function_precondition | P4.6 展开（helper 内 generate_jwt 无 verify，归因到入口 flow） | 8 | ✅ |
| T7 | cross_function_cleanup | P4.6 展开（open 在 flow、read 在 helper，endState 归因入口） | 8 | ✅ |

风格变体（协议函数名保持规范 snake_case，结构变化测试检测稳健性）：

| 风格 | 结构 | 说明 |
|------|------|------|
| S1 linear | 模块级流函数 | 基线 |
| S2 helpers | 模块级 helper（app.py 调用） | 间接层 |
| S3 class | `FlowService` 类方法 | IR 名含类前缀（`FlowService.svc_x`） |
| S4 noisy | 协议调用间穿插噪声调用 | 噪声函数无规则（`compute_hash`/`log_event`） |

## 3. 结果

```
可测金标: 66   检出: 64   漏检: 2
RECALL = 97%    PRECISION = 100%   FP = 0
```

| 类型 × 风格 | 植入 | 检出 |
|-------------|------|------|
| T1–T5 × S1–S4（结构变体） | 40 | 40 ✅ |
| T6/T7 × S1–S4（跨函数） | 16 | 16 ✅ |
| T1–T5 × S5（改名无注解） | 10 | 8 ✅（2 漏检单列） |
| T0（clean，含分离式清洁链） | 0 | 0 ✅ 零误报 |

S5 漏检 2 处（T2×S5）：`generate_jwt` 的 `PASSWORD_VERIFIED` 前置只存在于项目 `@progmune` 注解——无注解改名代码无法恢复该约束（内置规则 pre=[] 为入口点设计）。**命名匹配本身工作正常**（其余 8 处改名全部词段匹配检出），缺口在注解依赖，不在命名。

金标：`blind-benchmark/gold/annotations-protocol-python-v1.json`（生成器植入配置 + 扫描严格定位匹配，file+function 级）。

## 4. 已知缺口（如实记录）

1. **注解依赖前置约束**：T2×S5 的 2 处漏检——项目级前置（`generate_jwt` 需 `PASSWORD_VERIFIED`）只能来自 `@progmune` 注解或 LLM 语义层；无注解项目不可恢复。恢复手段：补注解（推荐，精确）或 LLM 桥接（通用，非确定）。
2. **LLM 语义桥接层不在测量范围**：基准用规范名/词段可匹配名直构 steps，任意 API 名 → 协议名的 LLM 桥接（`api-semantic-mapper`）需要独立基准（含 LLM，非确定性）。
3. **P4.6 展开语义边界**：跨函数传播是语法内联（调用链扁平化，深度 ≤4、环安全），不做数据流/指针/分支分析（与 C 的 L3 同类边界）；规则名函数与叶子原语不内联（协议原语只在调用链内验证）。
4. **endState 检查语义边界**：仅资源生命周期命名空间（`RESOURCE_NAMESPACE_RE`）且仅本序列新获取的状态；auth/session 命名空间合法地以活跃会话结束，不做检查（与 planner 语义一致）。

## 5. 对覆盖矩阵的判定

覆盖矩阵 Python 列升级条件（Auth / Resource Lifecycle 的 ⚠️ → ✅）：

- [x] 有基准数据 + 可测 P/R（本基线：66 gold，97%/100%，0 FP）
- [x] endState 检查实现（T5 类违规 10/10 检出）
- [x] 跨函数传播实现（T6/T7 类违规 16/16 检出，入口归因 + 片段抑制）
- [x] 任意命名验证（S5 词段匹配改名 8/10；剩余 2 处为注解依赖缺口，非命名匹配问题）

**判定：Python 协议行（Auth / Resource Lifecycle）由 ⚠️ 升级 ✅**，证据引用本基线；注解依赖与 LLM 桥接层缺口如实记录于 §4。

## 6. 复现

```bash
npx ts-node blind-benchmark/generate-projects-protocol-python.ts   # 生成 38 项目 + _plants.json
npx ts-node blind-benchmark/scan-protocol-python.ts                # 提取 IR → SSG 桥接校验 → 报告
npx ts-node blind-benchmark/expand-gold-protocol-python.ts         # 金标匹配 + P/R 汇总
npx vitest run tests/python-protocol-benchmark.test.ts             # harness 回归（broken/clean/endState/cross-function/renamed 锁定）
```
