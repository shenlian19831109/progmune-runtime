# Phase 1: Trajectory→Coverage 实验方案

> **状态**：Draft  
> **日期**：2026-08-01  
> **依赖**：Phase 0 标准已确认  
> **产出**：Trajectory→Coverage 数学关系 + Trust Report Confidence 升级

---

## 0. 前置发现（2026-08-01 数据分析）

在进入实验设计之前，已有三个关键发现改变了 Phase 1 的路线：

### 发现 1：实际状态空间只有 81 个有效转换（不是 169,386）

```
协议规则: 109 rules × 74 states × 21 namespaces
朴素上界: 169,386
实际有效转换: 81 (稀疏度 0.05%)
```

protocols.json 中的规则高度结构化——每条规则只连接特定的 pre_states 到 post_states，且绑定在单个 namespace 上。81 个有效转换意味着覆盖度问题是**可解的**，不需要天文数字的轨迹。

### 发现 2：覆盖率在 ~180 条轨迹后饱和（不是 2,558 条）

```
覆盖率累积曲线（100 次随机排序）：
  N=1:    2.5%  [80%CI: 1-5]
  N=14:  19.8%  [80%CI: 12-20]
  N=36:  29.6%  [80%CI: 21-27]
  N=72:  34.6%  [80%CI: 26-30]
  N=180: 38.3%  [80%CI: 30-32]
  N=723: 39.5%  [80%CI: 32-32]  ← 饱和
```

对数拟合：C(N) = 3.28 × log(N) + 11.98 → 即使 N=10,000，预测覆盖率也仅 52.1%。**加更多同类轨迹不能解决覆盖度问题。**

### 发现 3：瓶颈是规则词汇，不是轨迹数量

```
当前规则词汇可达的转换: 25/81 (30.9%)
实际已覆盖的转换:       32/81 (39.5%)  ← 7 个来自无规则匹配的"未知"调用
永久无法覆盖的转换:     56/81 (69.1%)  ← 11 个 namespace 完全没有规则词汇
```

**这就解释了 C benchmark F1=23.3% 的根因**：不是"验证不够好"，而是 69.1% 的协议转换根本没有对应的检测规则出现在轨迹中。增加轨迹数量不会改变这个数字——需要的是**扩展规则词汇**。

---

## 1. 修正后的核心问题

原问题："2,558 条轨迹覆盖了 71×109×17 状态空间的多少？"

**修正后的问题**：

| 层次 | 问题 | 答案 |
|------|------|------|
| L1 | 有效协议转换空间有多大？ | **81 个转换** |
| L2 | 当前轨迹覆盖了多少？ | **32/81 (39.5%)**，但饱和于 ~180 条轨迹 |
| L3 | 真正的覆盖瓶颈是什么？ | **规则词汇不足**——56/81 转换需要新规则才能被触发 |
| L4 | 如何给用户一个可信的覆盖度数字？ | 按 namespace × 目标代码库的协议使用特征，加权计算 |

---

## 2. 两因子覆盖度模型

### 2.1 模型定义

```
Coverage(project) = Σ_{ns ∈ namespaces} w_ns × C_ns
```

其中：
- **C_ns** = namespace ns 的协议转换覆盖率 = |covered_transitions(ns)| / |total_transitions(ns)|
- **w_ns** = namespace ns 的权重 = project 中使用 ns 的函数比例

### 2.2 两因子分解

```
C_ns = f(rule_vocabulary(ns), trajectory_density(ns))
```

- **rule_vocabulary(ns)**：二进制——这个 namespace 的规则是否出现在任何轨迹中？
  - 若为 0 → C_ns = 0（无论多少轨迹都无济于事）
  - 若为 1 → C_ns 由 trajectory_density 决定
- **trajectory_density(ns)**：对于已有规则词汇的 namespace，轨迹是否覆盖了所有 pre_state→post_state 路径？

### 2.3 当前各 namespace 状态

| Namespace | 规则词汇 | 转换总数 | 已覆盖 | C_ns | 状态 |
|-----------|---------|---------|--------|------|------|
| conditional | ✅ | 8 | 8 | 100% | 饱和 |
| cross | ✅ | 6 | 6 | 100% | 饱和 |
| loop | ✅ | 8 | 8 | 100% | 饱和 |
| transaction | ✅ | 5 | 5 | 100% | 饱和 |
| auth | ✅ | 9 | 5 | 56% | 有词汇，密度不足 |
| **api_gateway** | ❌ | 1 | 0 | 0% | **缺规则词汇** |
| **data_integrity** | ❌ | 2 | 0 | 0% | **缺规则词汇** |
| **dev_pipeline** | ❌ | 4 | 0 | 0% | **缺规则词汇** |
| **file_upload** | ❌ | 4 | 0 | 0% | **缺规则词汇** |
| **notification** | ❌ | 2 | 0 | 0% | **缺规则词汇** |
| **payment** | ❌ | 5 | 0 | 0% | **缺规则词汇** |
| **printlab_order** | ❌ | 8 | 0 | 0% | **缺规则词汇** |
| **printlab_print** | ❌ | 2 | 0 | 0% | **缺规则词汇** |
| **registration** | ❌ | 4 | 0 | 0% | **缺规则词汇** |
| **resource** | ❌ | 2 | 0 | 0% | **缺规则词汇** |
| **session_mgmt** | ❌ | 7 | 0 | 0% | **缺规则词汇** |
| **supplier** | ❌ | 3 | 0 | 0% | **缺规则词汇** |
| **tls** | ❌ | 1 | 0 | 0% | **缺规则词汇** |

**结论**：11/18 namespaces 缺规则词汇。这是 Phase 1 最核心的输出——不是"我们还缺规则"，而是"具体缺哪 11 个 namespace 的哪 56 个转换"。

---

## 3. Trust Report Confidence 升级方案

### 3.1 当前（v1）

```
Confidence: HIGH | MEDIUM | LOW | UNCERTAIN
```

这四个标签是硬编码的，与轨迹数据无关。

### 3.2 目标（v1.1）

```
Confidence: 62% ± 12%
  Coverage breakdown:
    ✅ conditional    100% ( 8/ 8 transitions)
    ✅ cross          100% ( 6/ 6)
    ✅ loop           100% ( 8/ 8)
    ✅ transaction    100% ( 5/ 5)
    ⚠️  auth           56% ( 5/ 9)  ← 4 transitions uncovered
    ❌ payment          0% ( 0/ 5)  ← no rule vocabulary
    ❌ session_mgmt     0% ( 0/ 7)  ← no rule vocabulary
    ❌ tls              0% ( 0/ 1)  ← no rule vocabulary
    ... (+8 more)
  
  This project uses: auth, payment, tls
  → Weighted coverage: 56% × 0.4 + 0% × 0.35 + 0% × 0.25 = 22.4%
  → Adjusted Confidence: LOW (22% ± 8%)
  → Top gap: add 5 payment rules → estimated +28% coverage
```

### 3.3 实现路径

1. **引擎层**：在 `score-calculator.ts` 中新增 `computeCoverageConfidence(projectProtocolUsage, trajectoryCorpus)` 函数
2. **类型层**：在 `types.ts` 中新增 `CoverageConfidence` 类型替代 `ConfidenceLevel`
3. **存储层**：Trajectory Corpus 每次新增轨迹后自动更新 coverage matrix
4. **展示层**：Trust Report 展示上述 breakdown

---

## 4. 实验设计

### 实验 1：覆盖率饱和曲线验证（已完成）

**目的**：确认轨迹数量 vs 覆盖率的饱和关系  
**方法**：100 次蒙特卡洛随机排序，计算覆盖率累积的 p50/p10/p90  
**结论**：覆盖率在 ~180 条轨迹后饱和，当前 723 条轨迹已达平台期

### 实验 2：规则词汇注入实验（本周）

**目的**：验证"增加规则词汇 → 提高覆盖率"的假设  
**方法**：
1. 从 56 个未覆盖转换中选择 3 个 namespace（建议：payment 5 条 + tls 1 条 + session_mgmt 7 条 = 13 条新转换）
2. 为每个转换编写 3-5 条合成轨迹（不需要真实代码，只需要正确的函数调用序列）
3. 测量覆盖率变化：32/81 → 45/81 (+16%)

**假设**：13 条合成轨迹（注入新规则词汇）对覆盖率的提升，远超 10,000 条同类轨迹（不注入新词汇）

### 实验 3：项目加权覆盖率验证（本周）

**目的**：验证加权公式在产品场景中的可用性  
**方法**：
1. 对 curl、libssh、nginx 三个 benchmark repo 分别计算协议使用特征向量（各使用了哪些 namespace）
2. 计算加权覆盖率
3. 与已知 F1 做相关性分析（预期：覆盖率越高的 repo，F1 越高）

**假设**：curl 的加权覆盖率 < libssh 的加权覆盖率（因为 curl 使用更多未覆盖的 namespace），这直接解释 curl F1 < libssh F1

---

## 5. 交付物

| 交付物 | 形式 | 依赖 |
|--------|------|------|
| D1. Coverage Model 文档 | `docs/coverage-model-v1.md` | E1 完成 |
| D2. Namespace 缺口地图 | JSON + 可视化 | E2 完成 |
| D3. `computeCoverageConfidence()` | TypeScript 实现 | E2 + E3 |
| D4. Trust Report 新 Confidence 格式 | 示例输出 | D3 |
| D5. C benchmark 根因解释 | 一段落（写进 Phase 2 白皮书） | E1 + E2 |

---

## 6. 时间线

| 天 | 任务 |
|----|------|
| Day 1 | 实验 2（规则词汇注入）— 编写合成轨迹，测量增量 |
| Day 2 | 实验 3（项目加权验证）— 计算 curl/libssh/nginx 加权覆盖率 |
| Day 3-4 | D3 实现（`computeCoverageConfidence`） |
| Day 5 | D4 Trust Report 集成 + 示例输出 |
| Day 6-7 | D1+D2 文档 + D5 C benchmark 解释 |
| Day 8-10 | Review, 迭代, 与 Phase 2 白皮书衔接 |

---

## 7. 风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| 规则词汇注入需要理解 11 个未知 namespace 的语义 | 中 | 优先选语义清晰的（payment, tls） |
| 加权覆盖率与 F1 相关性弱 | 低 | 即使弱相关，缺口地图本身已提供 actionable insight |
| 56 个未覆盖转换中有部分本身不可达 | 中 | 在 E2 时标注"理论可达但无测试场景"vs"协议定义错误" |
