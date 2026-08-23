# Python 协议盲测基线 v1（BASELINE_PROTOCOL_PYTHON_v1）

> 测量对象：Python 的 SSG 协议状态机路径（覆盖矩阵 Protocol × Language 的 Python 列）  
> 生成日期：2026-08-23  
> 结论：**Recall 100% / Precision 100% / 0 FP（32 处可测金标）**；endState（资源未释放）检查未实现——已知缺口 8 处金标单列

---

## 1. 概要

本基线首次给 Python 协议层（Auth / Resource Lifecycle）提供了可测量的 P/R 数据——此前覆盖矩阵标注"无独立协议盲测基准"（⚠️ 行的判定依据之一）。

与 Python 缺陷检测盲测（v1：90 项目 / 729 gold，测源码级检测规则）不同，本基准隔离测量 **SSG 协议状态机**：per-function 调用序列经生产校验器（`src/trust/ssg-bridge.ts` 的 `validateSequenceWithSSG`）做 pre-state / invalidate 校验。风格变体沿用盲测方法论：同一违规分类学 × 结构变体（线性 / helper / 类方法 / 噪声穿插）。

## 2. 语料

网格：6 违规类型 × 4 风格 = 24 个项目（`blind-benchmark/generated-protocol-py/`，gitignored，脚本生成）。每 broken 项目植入 2 处同型违规（不同函数）。

| 类型 | 违规类 | 检测路径 | 金标 | detectionExpected |
|------|--------|---------|------|-------------------|
| T0 | clean 对照 | — | 0 | — |
| T1 | missing_precondition_builtin | 内置规则（`create_session` pre=[TOKEN_ISSUED]） | 8 | ✅ |
| T2 | missing_precondition_annotation | 项目 `@progmune` 注解 + P4.5 合并（`generate_jwt` pre=[PASSWORD_VERIFIED]） | 8 | ✅ |
| T3 | use_after_revoke | invalidate 后重入（`revoke_token` → `create_session`） | 8 | ✅ |
| T4 | use_after_close | invalidate 后重入（`close_file` → `read_file`） | 8 | ✅ |
| T5 | missing_cleanup | endState（资源未释放）检查——**未实现** | 8 | ❌ 单列 known-gap |

风格变体（协议函数名保持规范 snake_case，结构变化测试检测稳健性）：

| 风格 | 结构 | 说明 |
|------|------|------|
| S1 linear | 模块级流函数 | 基线 |
| S2 helpers | 模块级 helper（app.py 调用） | 间接层 |
| S3 class | `FlowService` 类方法 | IR 名含类前缀（`FlowService.svc_x`） |
| S4 noisy | 协议调用间穿插噪声调用 | 噪声函数无规则（`compute_hash`/`log_event`） |

## 3. 结果

```
可测金标: 32   检出: 32   漏检: 0
RECALL = 100%   PRECISION = 100%   FP = 0

已知缺口金标(T5): 8 | 意外命中: 0
```

| 类型 × 风格 | 植入 | 检出 |
|-------------|------|------|
| T1（内置前置） | 8 | 8 ✅ |
| T2（注解+P4.5 合并） | 8 | 8 ✅ |
| T3（use_after_revoke） | 8 | 8 ✅ |
| T4（use_after_close） | 8 | 8 ✅ |
| T0（clean） | 0 | 0 ✅ 零误报 |
| T5（endState 缺口） | 8 | 0（预期） |

金标：`blind-benchmark/gold/annotations-protocol-python-v1.json`（生成器植入配置 + 扫描严格定位匹配，file+function 级）。

## 4. 已知缺口（如实记录）

1. **endState 检查未实现（T5）**：`SSGRejection.endState` 类型存在（`src/ssg-validator.ts`），但生产桥接校验循环未做序列末尾资源释放检查——`open_file` 后无 `close_file` 不会被报告。实现它需同步：桥接循环末尾检查 held states → 修复执行器追加 release 函数（区别于插入前置函数）。
2. **跨函数状态传播未实现**：per-function 序列验证不展开跨函数调用链——违规链必须落在单个函数体内才能检出（与 C 的 L3 同类边界）。本基准的植入全部为函数体内自包含，如实反映当前能力面。
3. **LLM 语义桥接层不在测量范围**：基准用规范协议名直构 steps（等价于生产路径 LLM 映射对规范名的输出），任意 API 名 → 协议名的桥接（`api-semantic-mapper`）需要独立基准（含 LLM，非确定性）。

## 5. 对覆盖矩阵的判定

覆盖矩阵 Python 列升级条件（Auth / Resource Lifecycle 的 ⚠️ → ✅）：

- [x] 有基准数据 + 可测 P/R（本基线：32 gold，100%/100%）
- [ ] endState 检查实现（T5 类违规可检出）
- [ ] 跨函数传播实现（或明确文档化为永久边界）
- [ ] 任意命名项目验证（规范名之外的 snake_case 变体 / 别名匹配覆盖）

当前判定保持 **⚠️**，证据已更新为本基线（不再写"无独立协议盲测基准"）。

## 6. 复现

```bash
npx ts-node blind-benchmark/generate-projects-protocol-python.ts   # 生成 24 项目 + _plants.json
npx ts-node blind-benchmark/scan-protocol-python.ts                # 提取 IR → SSG 桥接校验 → 报告
npx ts-node blind-benchmark/expand-gold-protocol-python.ts         # 金标匹配 + P/R 汇总
npx vitest run tests/python-protocol-benchmark.test.ts             # harness 回归（broken/clean/gap 锁定）
```
