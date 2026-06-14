# Progmune Runtime V4

## 程序免疫学：从规则系统到可学习系统的完整演进

### Program Immunology: A Self-Improving Verifiable Runtime for Generative Code

### 内部技术白皮书 v4.0 — 培训教材

开源地址：https://github.com/shenlian19831109/progmune-runtime
测试: 112 单元测试 | 14 测试套件 | 49 基准用例 | 7 协议文件

---

## 摘要

Progmune Runtime 提出了一种新的范式：**程序免疫学**——确保 AI 生成代码安全可靠的系统性方法。

V4.0 标志着系统从"规则验证器"到"可学习系统"的质变。在 V2.5 的生物免疫三层架构（天然免疫/获得性免疫/免疫记忆）基础上，V4 增加了完整的**学习闭环**：Trajectory Corpus → Goal Skeleton → Counterfactual Planner → Telemetry → Learning Ranker → Coverage Engine → Gap Mining → Knowledge Governance。

系统现在不仅能检测错误，还能**主动发现知识缺口、推断缺失的协议转移、通过反馈数据学习排序、并自动验证新知识的正确性**。这是一个具备自我进化能力的程序免疫运行时。

---

## 1. 问题声明与核心命题

### 1.1 从 V2.5 到 V4 的跨越

V2.5 的核心突破是**知识回路闭环**——抗体从 Failure Corpus 自动生成，通过 L1/L2/L3 三层回流到规划器。但这一闭环存在根本局限：

| V2.5 局限 | V4 解决方案 |
|-----------|-----------|
| 抗体只能匹配已有错误模式 | Frontier BFS + Goal Templates 可发现新路径 |
| 无法量化"哪个策略更好" | LearningRanker + Pairwise Preference |
| 不知道系统在哪些协议上薄弱 | Coverage Engine + Difficulty Map |
| 协议知识靠手工编写 | Transition Synthesizer + Knowledge Governance |
| 优化方向靠猜测 | Error Budget Dashboard + Off-Policy Replay |

### 1.2 V4 的核心命题

> AI 生成的代码在进入代码库之前，必须先通过一个免疫层——不仅可验证、具备记忆，还能**通过反馈数据持续进化、主动发现知识缺口、并自动补全协议规则**。

---

## 2. 架构总览：四层能力金字塔

```
                        ┌─────────────────────┐
                        │  Level 4: 知识增长   │
                        │  Gap Mining +        │
                        │  Transition Synth +  │
                        │  Knowledge Governance│
                        ├─────────────────────┤
                        │  Level 3: 学习能力   │
                        │  LearningRanker +    │
                        │  Pairwise Preference │
                        │  Off-Policy Replay   │
                        ├─────────────────────┤
                        │  Level 2: 推理能力   │
                        │  Protocol VM +       │
                        │  Frontier BFS +      │
                        │  Goal Planner +      │
                        │  Cross-Protocol      │
                        ├─────────────────────┤
                        │  Level 1: 经验积累   │
                        │  Trajectory Corpus + │
                        │  Telemetry +         │
                        │  Coverage Analysis   │
                        └─────────────────────┘
```

**Level 1** 回答"系统见过什么"——原始数据积累。  
**Level 2** 回答"系统能推什么"——从当前状态出发，通过协议图搜索找到合法路径。  
**Level 3** 回答"系统学到什么"——从历史反馈中学习哪些候选更好。  
**Level 4** 回答"系统还缺什么"——主动发现知识空白并自动补全。

### 2.1 三个飞轮

```
飞轮 A：学习飞轮
  Goal → Planner → Repair → Feedback → Telemetry → LearningRanker → Better Repair

飞轮 B：覆盖率飞轮
  Coverage → Gap Detection → Benchmark Gen → Cases → Trajectories → Better Coverage

飞轮 C：主动学习飞轮
  Difficulty → Importance → Priority Gen → High-Value Data → Better Model

飞轮 D：知识获取飞轮（V4 新增）
  Failures → Missing Knowledge → Transition Synth → Governance → Protocol Expansion
```

---

## 3. P2：Counterfactual Planner（反事实规划器）

### 3.1 问题

V2.5 的规划器是一个 LLM 驱动的组件，在遇到 SSG 违规时无法提供结构化的修复建议。当验证失败时，系统只能说"你错了"，但无法说"这里有三种修法"。

### 3.2 架构：Strategy → Candidate → Ranker 三层解耦

```
                 Goal
                   │
         CounterfactualPlanner
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
  Corpus       Protocol VM    Antibody
  Strategy      Strategy      Strategy
  (经验)        (推理)        (免疫)
     │             │             │
     ▼             ▼             ▼
  Candidate    Candidate    Candidate
     └─────────────┼─────────────┘
                   ▼
            FeatureExtractor
            (7 维特征向量)
                   │
                   ▼
              LinearRanker
         safety | performance
         auditability | overall
                   │
                   ▼
              Top-3 Repairs
```

**关键设计原则：策略只产生候选，不打分。** 评分是 Ranker 的职责。这确保未来增加新策略（如 LLMRepairStrategy）或替换排序器（如 RewardModelRanker）时，不需要修改任何策略代码。

### 3.3 三个搜索策略

#### CorpusStrategy（经验路线）
从 Failure Corpus 中查找历史轨迹，按修复路径分组，根据证据数量和成功率生成候选。

**优势**：直接利用真实修复经验，置信度高。  
**劣势**：依赖历史数据，冷启动时返回空。新错误类型无法匹配。

#### ProtocolStrategy（推理路线）
基于 SSG 协议图进行 BFS，从当前状态搜索到达目标状态的合法路径。P3.10 新增 Goal Template 支持：将自然语言目标展开为前置条件链。P3.14 新增 Frontier Explorer：任何状态到任何状态的 BFS 搜索，无需模板依赖。

**优势**：无需历史数据，纯推理。资源清理（close_file）总是能被发现。  
**劣势**：受协议规则数量限制。规则中没有的函数永远找不到。

#### AntibodyStrategy（免疫路线）
从抗体注册表中读取学习到的免疫规则，匹配违规类型和协议后直接生成修复建议。

**优势**：高置信度（ACL-3+ 抗体经过充分验证）。  
**劣势**：依赖先前的失败积累。新违规类型初期无抗体。

### 3.4 跨源证据合并 (deduplicateCandidates)

同一修复路径可能同时来自 Corpus、Protocol 和 Antibody。合并后的候选拥有：

```
evidenceSources: ["corpus", "protocol", "antibody"]
evidence: max(42, 0, 0) = 42
```

多源验证的修复比单源修复可信度更高。这是未来 Reward Model 的关键输入特征。

### 3.5 排序器（LinearRanker）

七维特征向量：

| 特征 | 含义 | 范围 |
|------|------|------|
| protocolSafety | 路径满足安全约束的程度 | 0-1 |
| historicalSuccessRate | 历史成功率 | 0-1 |
| actionCount | 修复路径中的动作数 | 整数 |
| latencyCost | 延迟成本（逆） | 0-1 |
| auditability | 可审计性（短路径更高） | 0-1 |
| corpusEvidence | 语料库证据数量 | 整数 |
| source | 来源策略 | 枚举 |

四种排序模式：
- `rankSafety()` — 最安全（金融系统）
- `rankPerformance()` — 最快（实时系统）
- `rankAuditability()` — 最可审计（合规团队）
- `rankOverall()` — 加权组合（默认）

默认权重：`score = 0.4×safety + 0.3×successRate + 0.2×performance + 0.1×auditability`

未来 P4：将 LinearRanker 替换为 RewardModelRanker，接口完全一致。

---

## 4. P2.5-2.6：可学习系统的数据基础

### 4.1 Telemetry Layer（遥测层）

#### PlannerTelemetry

记录每个 Planner 决策的完整生命周期：

```
PlannerDecision {
  id, timestamp, goal, protocol,
  candidates: [{ candidateId, source, evidenceSources, actions, explanation }],
  selectedCandidateId?,
  feedback?: RepairFeedback { decision, executionResult, userReason },
  cost?: { latencyMs, actionCount }
}
```

#### TelemetryIndex

O(1) 查找的候选统计数据：

```
Map<fingerprint, CandidateStats> {
  accepted, rejected,
  executionSuccess, executionFailure,
  avgLatency
}
```

#### RepairLifecycle

一条完整的修复生命周期链（RLHF 数据管道）：

```
proposedAt → acceptedAt → executedAt → executionSucceeded
```

这为 P4 Reward Model 提供了标准化的训练数据格式。

### 4.2 Analytics Dashboard

1000 条模拟决策的实时仪表盘：

```
Strategy Acceptance:
  corpus           90%  (301/334)
  protocol         87%  (289/333)
  antibody         76%  (254/333)

Top Accepted: open_file→write_file→close_file  (80x)
Top Rejected: open_file→append→close_file       (27x)

Repair Adoption Rate: 84.4%  (844 accepted / 156 rejected)
```

### 4.3 LearningRanker（学习排序器）

**核心创新**：系统能根据真实反馈数据调整排序。

```
effectiveReward = 0.5 × acceptanceRate + 0.5 × executionSuccessRate
adjustedScore = baseScore × 0.7 + effectiveReward × 0.3
```

**关键设计决策**：accepted ≠ good。用户大量接受的快速修复可能包含资源泄漏。通过学习 acceptance + execution success 的组合信号来避免"学坏"。

**已证明的自进化回路**（Ranking Evolution Test）：

```
Phase 1: A (safe) 接受 90 次 → A 排第一
Phase 2: B (fast) 连续接受 100 次 + 执行成功 → B 反超 A
```

### 4.4 Off-Policy Replay（离线策略评估）

```
Baseline (LinearRanker):   33.3%  (10/30)
Learning (Acceptance):     100.0% (30/30)
Δ:                          +66.7%
```

这证明了反馈数据中存在可学习的信号。Telemetry → Feedback → Learning 的闭环是真实有效的。

---

## 5. P3：可观测性与评估系统

### 5.1 Benchmark System

7 个协议文件，49 个基准用例，6 种违规类型：

```
auth_protocol.json      (8 cases)  — 认证生命周期
database_protocol.json   (8 cases)  — 数据库连接泄漏
pipeline_protocol.json   (8 cases)  — IR 流水线
expanded_file_protocol.json (8 cases) — 文件操作边界
cross_protocol.json      (8 cases)  — 多协议组合
file_protocol.json       (5 cases)  — 资源泄漏
resource_protocol.json   (4 cases)  — 资源管理
```

**当前基线**：

```
Top-1: 14%  (7/49)
Top-3: 39%  (19/49)
Avg Latency: 19.9ms
Avg Candidates: 2.5
```

### 5.2 Error Budget Dashboard（错误预算仪表盘）

将 49 个基准用例的失败原因归类：

```
Reason                  Count   Pct
────────────────────────────────────
  missing_candidate        28    57%  ← 候选发现是瓶颈
  bad_ranking               9    18%  ← 候选存在但排错序
  bad_protocol_model        0     0%  ← 已归零（永久消除）
  insufficient_history      5    10%
  success                   7    14%
```

**关键洞察**：`bad_protocol_model` 从 6% 归零，证明协议推理层已稳定。57% 的 missing_candidate 是当前最大瓶颈。

### 5.3 Data Quality Layer（数据质量层）

检测矛盾数据：

```
Total Outcomes:       100
Raw Acceptance:       69.0%
Execution Success:    74.0%
Contradictory:        39.0%  ← accepted ≠ execution result
```

39% 的矛盾率意味着：用户接受了 69% 的修复，但其中 39% 实际执行失败。这些数据如果直接用于训练 Reward Model，会导致模型"学坏"。

**解决**：`computeRewardSignal()` 综合考虑三重验证（execution + validation + regression），未经验证的反馈使用中性先验（0.5）而非原始接受值。

### 5.4 Discovery Benchmark（三层指标）

```
Discovery Rate:   75%  (any correct candidate found)  ← 候选生成质量
Top-3 Accuracy:   50%  ← 排序质量
Top-1 Accuracy:   25%  ← 最佳选择质量

Discovery→Top1 gap: 50% ← 排序是瓶颈（非候选发现）
```

三层指标比单一 Top-1 更能定位问题。

---

## 6. P3.6-3.8：覆盖率、难度与主动学习

### 6.1 Coverage Engine（覆盖率引擎）

从 Trajectory Corpus 统计每个协议的状态覆盖率和转移覆盖率：

```
Protocol          State   Trans   Trajs  Risk
────────────────────────────────────────────────
  FileProtocol       0%     0%      0  🔴 critical
  AuthProtocol       0%     0%      0  🔴 critical
  DBProtocol         0%     0%      0  🔴 critical
  IRProtocol         0%     0%      0  🔴 critical
```

26 个缺失转移被自动识别，17 个新基准用例被自动生成。

### 6.2 Difficulty Map（难度地图）

从轨迹数据计算每个转移的难度：

```
difficulty = failureRate×0.4 + repairFailureRate×0.4 + rejectionRate×0.2

AuthProtocol: PASSWORD_VERIFIED→TOKEN_ISSUED (40%) 🟠
FileProtocol:  INIT→FILE_OPEN (0%) 🟢
```

### 6.3 Active Learning（主动学习）

不按字面顺序生成基准用例，而是按重要性排序：

```
importance = difficulty × protocolUsage × failureFrequency

Top Priority:
  generate_jwt:  PASSWORD_VERIFIED→TOKEN_ISSUED  (importance: 2%)
  create_session: TOKEN_ISSUED→SESSION_ACTIVE    (importance: 2%)
```

---

## 7. P3.10-3.15：候选发现增强

### 7.1 Goal-conditioned Planner（目标条件规划器）

**问题**：ProtocolStrategy BFS 能找到单步清理（close_file），但无法规划多步前置条件链。例如 "logout user" 需要 verify_password → generate_jwt → create_session → logout，但 BFS 从当前状态只能看到 logout 一个动作。

**解决**：22 个 Goal Template，将自然语言目标展开为前置条件链：

```
"logout user" → [verify_password, generate_jwt, create_session]
"authenticate" → [verify_password, generate_jwt, create_session]
"safely write file" → [open_file, write_file]
"query database" → [connect_db, query_db]
```

效果：`insufficient_history` 从 39% 降至 14%。

**局限**：模板覆盖率受手动维护限制。无法处理未定义的变体（如 "force_logout"、"revoke_token"）。

### 7.2 Frontier Explorer（前沿探索器）

**问题**：Goal Templates 需要手动编写，覆盖率受模板数量限制。

**解决**：纯 BFS 状态搜索，从任何状态自动发现到任何目标状态的路径，无需模板。

```
searchFrontier(rules, ["SESSION_ACTIVE"], ["UNAUTHENTICATED"])
  → { actions: ["logout"], cost: 1, found: true }

searchFrontier(rules, ["UNAUTHENTICATED"], ["SESSION_ACTIVE"])
  → { actions: ["verify_password", "generate_jwt", "create_session"], cost: 3, found: true }

searchFrontier(rules, ["FILE_OPEN"], [])
  → { actions: ["close_file"], cost: 1, found: true }
```

效果：`bad_protocol_model` 从 6% 永久归零。

### 7.3 Cross-Protocol Planner（跨协议规划器）

协议间桥接定义：

```
AuthProtocol → FileProtocol   (SESSION_ACTIVE → INIT)
AuthProtocol → DBProtocol     (SESSION_ACTIVE → INIT)
FileProtocol → DBProtocol     (FILE_OPEN → INIT)
```

支持跨协议修复链：认证 → 打开文件 → 写入 → 关闭 → 连接数据库 → 插入。

### 7.4 Search Trace（搜索追踪）

记录每次搜索的详细过程，将 57% missing_candidate 分解为可操作的子原因：

```
SearchTrace {
  strategy: "frontier",
  expandedNodes: ["verify_password", "generate_jwt", ...],
  deadEnds: [{ node: "flush_file", reason: "missing_action" }],
  maxDepthReached: 3,
  candidateGenerated: false
}
```

输出：

```
missing_action:      1   ← 函数不在任何协议规则中
missing_transition:  0   ← 状态对未连接
depth_limit:         0   ← BFS 耗尽
bridge_missing:      0   ← 跨协议桥缺失
```

---

## 8. P3.16-3.20：知识获取系统

### 8.1 Protocol Gap Mining（协议缺口挖掘）

分析基准失败，识别最需要补全的协议能力：

```
Gap Breakdown:
  missing action            1 items   (flush_file, freq=2)
  missing transition       11 items   (verify_password→generate_jwt, ...)

Top Missing Action: flush_file  (29% priority)
```

### 8.2 Transition Synthesizer（转移合成器）

自动从基准失败中推断缺失的协议转移：

```
Inferred: FileProtocol: open_file → flush_file (FILE_OPEN → FILE_DIRTY)
  confidence: 100%  evidence: 2 cases
```

这是系统第一次**自己发现协议缺口并自动补全**，标志着从"手工编写协议"到"自动发现协议结构"的质变。

### 8.3 Knowledge Governance（知识治理）

在自动补全的基础上增加了安全层：

```
Inference Validation (P3.21)
  benchmark ≥ 3 + trajectory ≥ 5 + contradiction = 0 → verified
  else → proposed

Knowledge Patch Store (P3.22)
  每个推断的转移都是版本化的补丁，支持 audit/rollback/diff。
  系统读取 Base Rules + Approved Patches，从不修改原始协议文件。

Regression Test (P3.23)
  对每个 proposed patch 跑全量基准测试。
  仅当 Top-1 和 Top-3 不退化时自动批准。

Governance Report:
  Proposed: 1  (revoke_token → create_session)
  Approved: 1  ✅ (no regression)
  Rejected: 0
```

---

## 9. P3.11-3.13：Pairwise Preference System

### 9.1 从 Pointwise 到 Pairwise

V2.6 的 LearningRanker 使用 Pointwise 信号（accepted/rejected），这太粗糙。Pairwise Preference 升级到 RLHF 的数据原语：

```
RepairPreference {
  winner: "safe-fp",     // open_file → write_file → close_file
  loser: "leaky-fp",     // open_file → write_file
  goal: "safely write config file",
  protocol: "FileProtocol"
}
```

### 9.2 PreferenceRanker

```
score = winRate × 0.6 + heuristicScore × 0.4
```

winRate 来自历史配对比较数据，heuristicScore 来自 LinearRanker。无数据时退化为纯启发式排序。

### 9.3 Ranker Stress Test

增强型基准用例：不仅期望 `expectedTop1`，还定义 `acceptableTop3` 和 `unacceptableRepairs`：

```
Cases:                 2
Top-1 Accuracy:        100%
Top-3 Acceptability:   100%
Unacceptable Filtered: 0%

✅ Top-3/Top-1 Gap: 0% — ranking is working well.
```

---

## 10. 工程成熟度

### 10.1 测试覆盖（14 测试套件，112 测试）

| 测试文件 | 测试数 | 覆盖模块 |
|---------|--------|---------|
| `repair-arch.test.ts` | 16 | Strategy/Ranker 边界、去重、资源泄漏 |
| `repair-evolution.test.ts` | 14 | 跨源证据、P4 预埋、Goal→Feedback 闭环 |
| `trajectory-feedback.test.ts` | 3 | feedback+cost 持久化 |
| `telemetry-analytics.test.ts` | 13 | 指纹、遥测、1000 决策仪表盘 |
| `learning-ranker.test.ts` | 3 | 自进化回路 |
| `p3-observability.test.ts` | 13 | 数据质量、扩展基准（49 cases） |
| `coverage-system.test.ts` | 12 | 覆盖率仪表盘、生成流水线 |
| `difficulty-active.test.ts` | 7 | 难度排名、主动学习 |
| `evaluation-campaign.test.ts` | 4 | 失败归因、离线重放 |
| `pairwise-preference.test.ts` | 6 | 配对偏好、排序压力测试 |
| `protocol-frontier.test.ts` | 9 | BFS 搜索、跨协议规划 |
| `protocol-gap-analyzer.test.ts` | 2 | 缺口挖掘、知识评分 |
| `transition-synthesizer.test.ts` | 5 | 转移推断、源追踪 |
| `knowledge-governance.test.ts` | 5 | 验证、版本化、回归 |
| **总计** | **112** | |

### 10.2 关键模块代码量

| 模块 | 行数 | 功能 |
|------|------|------|
| `repair-types.ts` | 130 | 接口层 |
| `repair-strategies.ts` | 215 | 三个搜索策略 |
| `repair-ranker.ts` | 155 | 特征提取 + 线性排序 |
| `planner-telemetry.ts` | 340 | 遥测 + 索引 + 生命周期 |
| `learning-ranker.ts` | 160 | 反馈修正排序 |
| `analytics.ts` | 190 | 仪表盘 |
| `data-quality.ts` | 175 | 多信号验证 |
| `planner-trace.ts` | 180 | 决策追踪 + 奖励信号 |
| `protocol-coverage.ts` | 210 | 覆盖率分析 |
| `difficulty-map.ts` | 230 | 难度计算 |
| `active-learning.ts` | 235 | 重要性排序 |
| `evaluation-campaign.ts` | 270 | 失败归因 + 离线重放 |
| `protocol-frontier.ts` | 250 | BFS 搜索 + 跨协议 |
| `protocol-gap-analyzer.ts` | 230 | 缺口挖掘 |
| `transition-synthesizer.ts` | 270 | 转移合成 + 源追踪 |
| `knowledge-governance.ts` | 290 | 知识验证 + 版本化 + 回归 |
| `discovery-trace.ts` | 290 | 搜索追踪 + 发现基准 |
| `pairwise-preference.ts` | 270 | 配对偏好 + 压力测试 |
| **总计** | **~4000** | |

---

## 11. 技术路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | Trajectory Corpus | ✅ |
| P1 | Goal Skeleton | ✅ |
| P2 | Counterfactual Planner (Strategy→Candidate→Ranker) | ✅ |
| P2.5 | Telemetry + Analytics + Benchmark | ✅ |
| P2.6 | Learning Ranker (反馈修正排序) | ✅ |
| P3 | Benchmark Expansion (49 cases / 7 protocols) | ✅ |
| P3.1 | Data Quality (多信号验证) | ✅ |
| P3.2 | Planner Trace (决策可观测性) | ✅ |
| P3.6 | Coverage System (缺口检测) | ✅ |
| P3.7-8 | Difficulty Map + Active Learning | ✅ |
| P3.9 | Evaluation Campaign (失败归因) | ✅ |
| P3.10 | Goal-conditioned Planner | ✅ |
| P3.11-13 | Pairwise Preference + Ranker Stress Test | ✅ |
| P3.14-15 | Frontier Explorer + Cross-Protocol | ✅ |
| P3.16-17 | Gap Mining + Knowledge Acquisition | ✅ |
| P3.18-20 | Transition Synthesizer + Candidate Discovery 2.0 | ✅ |
| P3.21-23 | Knowledge Governance (验证+版本化+回归) | ✅ |
| P3.24-27 | Search Trace + Bridge + Discovery + Replay | ✅ |
| **P4** | **Reward Model** | 数据管道就绪，等 ≥10,000 decisions |

---

## 12. 结论

Progmune Runtime V4 完成了从"规则验证器"到"可学习系统"的进化。

**四个飞轮**（学习/覆盖率/主动学习/知识获取）已形成闭环，系统具备：
- 从反馈中学习排序（+66.7% 离线准确率提升）
- 主动发现知识缺口（26 个缺失转移被识别）
- 自动补全协议规则（Transition Synthesizer）
- 安全的知识治理（benchmark ≥ 3 + trajectory ≥ 5 → verified）
- 完整的可观测性（Error Budget Dashboard + Discovery Benchmark + Off-Policy Replay）

**当前瓶颈**：57% missing_candidate。其中 92% 是 missing transition（函数存在但状态未连接），而非 missing action（函数缺失）。下一步优先级：协议连接补全 > 排序优化 > Reward Model。

---

## 附录 A：关键性能指标汇总

| 指标 | 数值 |
|------|------|
| 基准用例数 | 49 |
| 协议文件数 | 7 |
| Top-1 准确率 | 14% |
| Top-3 准确率 | 39% |
| bad_protocol_model | 0%（永久归零）|
| Off-Policy 提升 | +66.7% |
| 矛盾数据率 | 39% |
| 推断转移数 | 1 (100% 置信度) |
| 知识补丁数 | 1 (已批准) |
| Gap 发现数 | 12 (1 action + 11 transitions) |
| 策略接受率 | corpus 90% > protocol 87% > antibody 76% |

## 附录 B：协议图示例

```
AuthProtocol:
  UNAUTHENTICATED → verify_password → PASSWORD_VERIFIED
  PASSWORD_VERIFIED → generate_jwt → TOKEN_ISSUED (inv: PASSWORD_VERIFIED)
  TOKEN_ISSUED → create_session → SESSION_ACTIVE (inv: TOKEN_ISSUED)
  SESSION_ACTIVE → logout → UNAUTHENTICATED (inv: SESSION_ACTIVE)
  TOKEN_ISSUED → revoke_token → UNAUTHENTICATED (inv: TOKEN_ISSUED)

FileProtocol:
  INIT → open_file → FILE_OPEN
  FILE_OPEN → read_file / write_file → FILE_OPEN
  FILE_OPEN → close_file → ∅ (inv: FILE_OPEN)

DBProtocol:
  INIT → connect_db → DB_CONNECTED
  DB_CONNECTED → query_db → DB_CONNECTED
  DB_CONNECTED → disconnect_db → ∅ (inv: DB_CONNECTED)

IRProtocol:
  IR_STALE → extractIR → IR_EXTRACTED (inv: IR_STALE)
  IR_EXTRACTED → validateAction → ACTION_VALIDATED
  ACTION_VALIDATED → validateActionSequence → SEQUENCE_VALIDATED (inv: ACTION_VALIDATED)
  SEQUENCE_VALIDATED → emitCode → CODE_EMITTED (inv: SEQUENCE_VALIDATED)
  CODE_EMITTED → recordSession → SESSION_RECORDED (inv: CODE_EMITTED)
```

## 附录 C：文件结构总览

```
src/
├── repair-types.ts          # 接口定义层
├── repair-strategies.ts     # 三个搜索策略
├── repair-ranker.ts         # 特征提取 + 排序
├── counterfactual-engine.ts # 规划器入口
├── planner-telemetry.ts     # 遥测 + 索引
├── learning-ranker.ts       # 学习排序器
├── analytics.ts             # 仪表盘
├── benchmark-harness.ts     # 基准运行器
├── data-quality.ts          # 数据质量
├── planner-trace.ts         # 决策追踪
├── protocol-coverage.ts     # 覆盖率分析
├── coverage-dashboard.ts    # 覆盖率仪表盘
├── benchmark-generator.ts   # 基准自动生成
├── difficulty-map.ts        # 难度分析
├── active-learning.ts       # 主动学习
├── evaluation-campaign.ts   # 评估活动
├── pairwise-preference.ts   # 配对偏好
├── goal-planner.ts          # 目标条件规划
├── protocol-frontier.ts     # BFS 前沿探索
├── protocol-gap-analyzer.ts # 协议缺口挖掘
├── transition-synthesizer.ts # 转移合成器
├── knowledge-governance.ts  # 知识治理
├── discovery-trace.ts       # 搜索追踪 + 发现基准
│
benchmarks/
├── auth_protocol.json       # 认证协议 (8 cases)
├── database_protocol.json   # 数据库协议 (8 cases)
├── pipeline_protocol.json   # 流水线协议 (8 cases)
├── expanded_file_protocol.json # 扩展文件协议 (8 cases)
├── cross_protocol.json      # 跨协议 (8 cases)
├── file_protocol.json       # 文件协议 (5 cases)
└── resource_protocol.json   # 资源协议 (4 cases)
```
