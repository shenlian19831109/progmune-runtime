# Phase 4: 飞轮定性建模

> 日期：2026-08-01  
> 范围：v1 — 四飞轮依赖关系图 + 关键度量定义 + 瓶颈依赖识别  
> 定量动力学建模留待 v2（需 3+ 轮 Evolution Stability 数据）

---

## 1. 四飞轮定义

| 飞轮 | 代码入口 | 循环描述 |
|------|---------|---------|
| **A. 学习飞轮** | `learning-ranker.ts` | Goal → Planner → Repair → Feedback → Telemetry → LearningRanker → Better Repair |
| **B. 覆盖率飞轮** | `protocol-coverage.ts` | Coverage → Gap Detection → Benchmark Gen → Cases → Trajectories → Better Coverage |
| **C. 主动学习飞轮** | `active-learning.ts` | Difficulty → Importance → Priority Gen → High-Value Data → Better Model |
| **D. 知识获取飞轮** | `knowledge-flywheel.ts` | Failures → Missing Knowledge → Transition Synth → Governance → Protocol Expansion |

---

## 2. 依赖关系图（DAG）

```
                    ┌──────────────────────────────────────────┐
                    │            D. 知识获取飞轮                │
                    │   Failure → Gap → Synth → Governance     │
                    │   knowledge-flywheel.ts                   │
                    └──────┬──────────────┬────────────────────┘
                           │ 提供缺口地图   │ 提供新协议规则
                           ▼               ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                    B. 覆盖率飞轮                              │
  │   Coverage → Gap → Benchmark → Trajectories                  │
  │   protocol-coverage.ts                                       │
  └────┬──────────────────────────────┬──────────────────────────┘
       │ 提供覆盖率数据                │ 提供 Trajectory Corpus
       ▼                              ▼
  ┌──────────────────────────┐  ┌──────────────────────────────┐
  │  C. 主动学习飞轮          │  │  A. 学习飞轮                  │
  │  Difficulty → Priority   │  │  Feedback → Ranker → Repair  │
  │  active-learning.ts      │  │  learning-ranker.ts           │
  └──────┬───────────────────┘  └────────┬─────────────────────┘
         │ 提供优先级排序               │ 提供 Repair 质量反馈
         └──────────┬───────────────────┘
                    ▼
              ┌──────────────────────────┐
              │   更高精度的 Repair       │
              │   → 更可靠的 Benchmark   │
              │   → 反馈回 B 和 D         │
              └──────────────────────────┘
```

### 边标注（耦合机制）

| 边 | 方向 | 耦合机制 | 当前状态 |
|----|------|---------|---------|
| D→B | 知识获取 → 覆盖率 | Gap Analyzer 输出的缺口被 Coverage Engine 消费，生成 Benchmark 序列 | ✅ 已连接（`protocol-gap-analyzer.ts` → `protocol-coverage.ts`） |
| B→A | 覆盖率 → 学习 | Trajectory Corpus 的数据量/多样性直接影响 LearningRanker 的 Pairwise Preference 训练质量 | 🟡 隐式依赖（共享 trajectory 数据，但未显式传递质量信号） |
| B→C | 覆盖率 → 主动学习 | Coverage Dashboard 的 Difficulty Map 驱动 Active Learning 的 Priority Gen | 🟡 代码独立，无显式接口 |
| C→A | 主动学习 → 学习 | Priority Gen 排序的高价值数据优先进入 LearningRanker 训练 | ❌ 未连接（两个模块独立运行） |
| A→D | 学习 → 知识获取 | Repair 成功率反馈给 Knowledge Governance，触发规则版本迭代 | 🟡 间接——通过 `feedback.ts` 路径，但不直接驱动 Governance |
| C+B→B | 覆盖率 ↺ | 主动学习产生的 Priority 驱动高价值 Benchmark 生成 → 更高效的 Trajectory → 更快的覆盖率提升 | ❌ 未连接 |

---

## 3. 各飞轮关键度量

### 3.1 飞轮 A：学习飞轮

| 度量 | 定义 | 当前基线 | 数据来源 |
|------|------|---------|---------|
| **Pairwise Preference Accuracy** | LearningRanker 排序与真实 Repair 成功率之间的一致性 | 未测量 | `learning-ranker.ts` 内部 |
| **Repair Acceptance Rate** | 生成的 repair 被 planner 接受的比例 | ~85%（估计，来自 `repair-proposal.ts` 成功率统计） | `feedback.ts` + `rewards/` |
| **Feedback Loop Latency** | 从 Repair 生成到 Feedback 回流的平均时间 | 未测量 | `planner-telemetry.ts` |

### 3.2 飞轮 B：覆盖率飞轮

| 度量 | 定义 | 当前基线 | 数据来源 |
|------|------|---------|---------|
| **Protocol Coverage** | 已覆盖协议转换 / 总协议转换 | **39.5% (32/81)** | Phase 1 E2 数据 |
| **Gap Discovery Rate** | 每周新发现的协议缺口数 | 未测量 | `protocol-gap-analyzer.ts` |
| **Benchmark Growth Rate** | 每周新增 Benchmark 序列数 | 未测量 | `coverage-dashboard.ts` |

### 3.3 飞轮 C：主动学习飞轮

| 度量 | 定义 | 当前基线 | 数据来源 |
|------|------|---------|---------|
| **Difficulty Map Coverage** | Difficulty Score 已分配的协议域比例 | ~30%（仅 auth/TLS 有评分） | `active-learning.ts` |
| **Priority Alignment** | 高优先级生成的数据在 LearningRanker 中的实际利用比例 | 0%（未连接） | N/A |
| **Data Efficiency Ratio** | (主动学习生成的轨迹数) / (达到相同覆盖率所需随机轨迹数) | 未测量 | Phase 1 E2 可推算 |

### 3.4 飞轮 D：知识获取飞轮

| 度量 | 定义 | 当前基线 | 数据来源 |
|------|------|---------|---------|
| **Transition Synthesis Rate** | 每周自动合成的协议转换数 | ~0（手动为主） | `knowledge-flywheel.ts` |
| **Governance Approval Rate** | 合成的转换通过 Knowledge Governance 审核的比例 | 未测量（无合成→无审核） | `knowledge-governance.ts` |
| **Knowledge Version Velocity** | Knowledge Unit 版本迭代频率 | TLS v1.0.0（180 天稳定） | `knowledge-evolution.ts` |

---

## 4. 瓶颈依赖识别

### 瓶颈 #1：B→C 和 C→A 未连接（严重程度：高）

**现状**：覆盖率飞轮产生的 Coverage Dashboard 数据没有被主动学习飞轮消费。主动学习无法对"优先提升哪个协议域"做出数据驱动的决策。

**影响**：Trajectory 收集策略是盲目的——我们在已饱和的 namespace（loop, conditional）上浪费轨迹，而缺口 namespace（session_mgmt, payment）得不到优先关注。

**证据**：Phase 1 E2 实验 — 2,567 条轨迹在已覆盖 namespace 上完全饱和（0% 边际增益），证明当前轨迹收集策略已将飞轮 B 的"密度提升"路径耗尽。

**修复路径**：在 `active-learning.ts` 中消费 `protocol-coverage.ts` 的 GapMap，按"缺口大小 × 业务重要性"生成 Priority Queue。

### 瓶颈 #2：D 飞轮的合成管道闲置（严重程度：中）

**现状**：`knowledge-flywheel.ts`、`protocol-gap-analyzer.ts`、`knowledge-governance.ts` 三个模块的代码完整，但管道未端到端运行。Transition Synth（自动合成缺失的协议转换）停留在设计阶段。

**影响**：知识增长完全依赖手动编写规则（68→109 条规则的扩展全部是手动的）。Phase 1 发现 26 个转换缺口——这些本可以由 Transition Synth 自动填充。

**修复路径**：端到端激活 D 飞轮：Gap Analyzer 输出缺口 → Transition Synth 生成候选 → Governance 审核 → 自动注入 trajectory。

### 瓶颈 #3：反馈回路 A→D 单向且低带宽（严重程度：低）

**现状**：Repair 成功/失败的反馈信号通过 `feedback.ts` 回流到 corpus，但 Knowledge Governance 不消费这个信号。规则的质量好坏不由 Repair 的实际表现来评判。

**影响**：FP 率高的规则（如 curl 的 452→59 规则爆炸）不会被自动降权或标记为待修订。

**修复路径**：将 `feedback.ts` 中的 Repair 成功率关联到 `knowledge-governance.ts` 的 Knowledge Unit 置信度计算。FP 率超过阈值的规则自动触发 Governance Review。

---

## 5. 飞轮健康度总览

| 飞轮 | 代码完成度 | 数据流状态 | 自循环闭合 | 跨飞轮连接 |
|------|----------|----------|----------|----------|
| A. 学习 | 🟢 80% | 🟢 运行中 | 🟢 闭合 | 🟡 B→A 隐式 |
| B. 覆盖率 | 🟢 85% | 🟢 运行中 | 🟢 闭合（density 已饱和） | 🟡 D→B 连接 |
| C. 主动学习 | 🟡 60% | 🟡 部分运行 | ❌ 未闭合 | ❌ 未连接 |
| D. 知识获取 | 🟡 70% | 🔴 管道闲置 | ❌ 未闭合 | 🟡 D→B 连接 |

---

## 6. 下一步（v2 定量建模）

v1（本文）完成了 S4.1-S4.3：

- ✅ S4.1：四飞轮 DAG，6 条边均标注耦合机制
- ✅ S4.2：12 个关键度量，各含当前基线值
- ✅ S4.3：3 个瓶颈依赖，含修复路径

v2 定量建模需要的数据（留待后续）：

1. **3+ 轮 Evolution Stability 数据**：需要飞轮 D 至少 3 次端到端运行，记录每次的 Transition Synth → Governance → Protocol Expansion 循环时间
2. **LearningRanker 的 Pairwise Preference Accuracy**：需要至少 100 对 repair candidates 的人工标注
3. **跨飞轮回归分析**：将 12 个度量作为时间序列，分析飞轮间的 Granger 因果关系（覆盖率提升是否 Granger-cause 学习飞轮精度提升？）
