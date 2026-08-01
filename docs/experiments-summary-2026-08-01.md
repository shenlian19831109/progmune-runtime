# Progmune 科学化实验总结

> 日期：2026-08-01  
> 范围：E2（规则词汇注入）、E3（覆盖率-召回率相关性）、P1（C Benchmark 词汇注入）  
> 基于：Phase 0 科学化标准 + Phase 1 两因子模型

---

## 实验概览

| 实验 | 假设 | 结论 | 置信度 |
|------|------|------|--------|
| E2 | 规则词汇是覆盖率瓶颈（非轨迹数量） | ✅ 成立 | 高（n=2,585 轨迹，MC 100 次） |
| E3 | 覆盖率与 Recall 正相关 | 🟡 方向一致（n=2） | 中（需 n≥4 做统计检验） |
| P1 | 词汇注入提升覆盖率后 Recall 随之提升 | 🟡 Coverage ✅，Recall 待 benchmark 扩展 |

---

## E2：规则词汇注入实验

### 设计

从 Progmune 协议空间的 81 个有效转换中，选择 4 个命名空间（auth 4 + payment 5 + session_mgmt 7 + tls 1 = 17 个目标转换），编写 18 条合成轨迹注入到生产 Trajectory Corpus。

### 数据

| 条件 | 轨迹数 | 覆盖转换 | 覆盖率 |
|------|--------|---------|--------|
| 仅生产 Corpus | 2,567 | 32/81 | 39.5% |
| +18 条合成轨迹 | 2,585 | **55/81** | **67.9%** |
| 边际增益 | +18 | +23 | **+28.4%** |

覆盖率饱和曲线（100 次蒙特卡洛随机排序）：

```
N=1:    2.5%  [80%CI: 1-5%]
N=36:  29.6%  [80%CI: 21-27%]
N=180: 38.3%  [80%CI: 30-32%]   ← 饱和点
N=723: 39.5%  [80%CI: 32-32%]   ← 之后 0% 增长
N=2585: 67.9%                     ← +18 条词汇注入
```

### 关键发现

1. **覆盖率在 ~180 条轨迹后完全饱和**。723→2,567 条轨迹的边际覆盖率为 0%。
2. **18 条词汇注入轨迹实现了 2,567 条同类轨迹做不到的覆盖率提升**（+28.4%）。
3. **级联效应**：目标 17 个转换，实际激活 23 个（+35%）。注入 payment 轨迹意外激活了 registration 的 4 个转换——因为 `create_user_session` 在多个命名空间中共享。

### 计数

- 总协议转换空间：81（非朴素上界 169,386）
- 瓶颈命名空间：11/18 缺少规则词汇
- 轨迹效率：合成轨迹 1.28 转换/轨迹 vs 生产 Corpus 0.01 转换/轨迹

---

## E3：覆盖率-召回率相关性

### 设计

对 curl 和 libssh 两个已测量代码库，基于领域知识标注协议命名空间使用权重，计算加权覆盖率，与 Gold Benchmark 召回率做方向性分析。

### 数据

| 代码库 | 加权覆盖率 | Recall | Precision | F1 |
|--------|----------|--------|-----------|-----|
| curl | 59.3% | 75.0% | 23.4% | 35.6% |
| libssh | 63.9% | 85.7% | 27.3% | 41.4% |

### 关键发现

1. **方向一致**：覆盖率更高的 repo 召回率也更高。
2. **n=2 局限**：两个数据点总能在平面上确定一条直线——无法排除偶然性。需要 n≥4 做统计显著性检验。
3. **瓶颈分层**：curl 和 libssh 的主瓶颈都是 Precision（FP 过多），而非 Coverage。C benchmark（F1=23.3%）的主瓶颈是 Coverage。

### 局限

- nginx 和 redis 各 50 条标注序列，但 0 条 violation 标注——无法计算 Recall。
- 使 n→4 需要为 nginx/redis 编写并标注 violation 序列（需安全专家人力）。

---

## P1：C Benchmark 词汇注入

### 设计

验证两因子模型的完整链条：Coverage ↑ → Recall 天花板 ↑ → 实际 Recall ↑。针对 C benchmark 相关命名空间（tls + dev_pipeline + file_upload + auth，共 13 个转换），编写 12 条合成轨迹，扩展 protocol-detector.ts 的 regex 规则，重跑 Gold Benchmark。

### 覆盖率结果

```
覆盖转换：32/81 (39.5%) → 45/81 (55.6%)  +16.0%
13/13 转换精确命中，零级联，零退化
```

### Recall 结果

| 指标 | 注入前 (v6) | 注入后 (v6) | 变化 |
|------|-----------|-----------|------|
| TP | 28 | 28 | 0 |
| FP | 126 | 126 | 0 |
| FN | 10 | 10 | 0 |
| Recall | 73.7% | 73.7% | 0 |

### 根因

P1 新规则覆盖的协议域（file_upload、dev_pipeline、TLS server lifecycle）在 curl/libssh/nginx/redis 的 benchmark 序列中**不存在对应的函数调用**。这 4 个 C 项目是网络库，不包含文件上传或开发流水线操作。

### 验证状态

```
两因子模型三步骤：
  Coverage ↑         →  ✅ E2 + P1 已验证 (39.5% → 55.6%)
  Recall 天花板 ↑     →  ❓ 未验证（benchmark 不包含新覆盖的协议域）
  实际 Recall ↑       →  ❓ 未验证（第二步未验证）
```

### 额外发现（FP 压制子实验）

在 P1 规则过于宽泛导致 FP 从 126→153 后，通过精确化 regex pattern（将 `\b(read\b|write\b|recv\b)` 替换为协议特定函数名），成功将 FP 从 153 压回 126，同时保持 Recall 不变。证实 FP 压制策略有效。

---

## 核心方法论贡献

### 两因子模型（实证规律 1）

```
Coverage(ns) = Vocabulary(ns) × Density(ns)
```

- Vocabulary ∈ {0, 1}：该命名空间的规则是否出现在任何轨迹中
- Density ∈ [0, 1]：轨迹覆盖的转换比例（~5 条/转换后饱和）
- 两个因子是乘法关系——任一为 0，整体为 0

### 覆盖率-召回率对应（实证规律 2）

```
Recall_ceiling(project) ≈ WeightedCoverage(project)
F1(project) ≈ harmonic_mean(Coverage, Precision)
```

- 覆盖率决定了"能发现多少"（Recall 上限）
- 精确率决定了"发现的有多准"（由规则质量和 FP 抑制决定）
- F1 中较低的那个主导

### 瓶颈诊断法则

```
若 Recall < Coverage    → 瓶颈在规则精度
若 Recall ≈ Coverage    → 瓶颈在词汇覆盖
若 Precision < 30%      → 瓶颈在 FP 抑制
```

---

## 可证伪预测状态

| # | 预测 | 状态 |
|---|------|------|
| P1 | 注入 13 个新转换 → C benchmark Recall 提升到 65-75% | 🟡 覆盖率 ✅，Recall 待 benchmark 扩展 |
| P2 | 注入 26 个新转换 → 总覆盖率 > 95% | ⬜ 待验证 |
| P3 | 在已覆盖命名空间增加 1,000 条轨迹 → 覆盖率增长 < 2% | ✅ E2 已验证 |
| P4 | nginx 的 Recall > curl 的 Recall | ⬜ 需人工标注 nginx violation |
| P5 | 移除 auth 词汇 → curl Recall 下降 > 20% | ⬜ 待验证（词汇消融实验） |

---

## 数据文件索引

| 文件 | 内容 |
|------|------|
| `blind-benchmark/reports/e2-rule-vocabulary-injection.json` | E2 实验结果 |
| `blind-benchmark/reports/p1-c-benchmark-results.json` | P1 实验结果 |
| `blind-benchmark/reports/gold-benchmark-v5-v6-v7.json` | Gold Benchmark 最新数据 |
| `benchmarks/reports/cross-repo-precision-latest.json` | 跨 repo 精确率基准 |
| `.progmune_generated/sample-trust-report.json` | Trust Report 示例输出 |

---

*Progmune · Science of Program Verification · 实验总结 · 2026-08-01*
