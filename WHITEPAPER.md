# Progmune Runtime

## 程序免疫学：面向生成式代码的可验证运行时

### Program Immunology: A Verifiable Runtime for Generative Code

### 技术白皮书 v2.5.x

开源地址：https://github.com/shenlian19831109/progmune-runtime
npm install progmune-runtime
测试: 66 单元测试 | CI/CD: GitHub Actions | 覆盖率门禁: 8%

---

## 摘要

Progmune Runtime 提出了一种新的范式：**程序免疫学**——确保 AI 生成代码安全可靠的系统性方法。

受生物免疫系统分层防御机制的启发，Progmune 构建了一个约束导向的程序合成运行时，在多个层级上强制执行语义有效性。系统将大语言模型从不受约束的代码生成器，降级为在程序中间表示（IR）所定义的封闭世界中运行的**受限启发式提议器**。

v2.5.x 引入了三个关键突破：(1) **知识回流闭环**——抗体从 Failure Corpus 自动生成后，通过 L1/L2/L3 三层机制回流到规划器；(2) **能力图自动派生**——元数据覆盖率从 30% 提升至 62%（produces）和 46%（requires）;(3) **拓扑持久化缓存**——2000 节点冷启动从 19 秒降至后续运行的 <50ms。

---

## 1. 问题声明

### 1.1 AI 代码生成中的开放世界谬误

大语言模型在生成代码时，隐含地基于开放世界假设运行。这导致四类典型错误：

| 级别 | 错误类型 | 示例 |
|------|---------|------|
| SVL-1 | 符号幻觉 | 调用项目中不存在的函数 |
| SVL-2 | 类型漂移 | 参数数量或类型不匹配 |
| SVL-3 | 数据流污染 | 使用未初始化变量，创建循环引用 |
| SVL-4 | 协议违规 | 在认证用户前签发 JWT 令牌 |

### 1.2 现有缓解策略的局限性

- **事后校验**：在错误生成后检测，无法从源头预防
- **RAG**：降低但不消除幻觉，模型仍是正确性的唯一仲裁者
- **迭代提示工程**：无法提供合规性的形式化保证

这三种策略都将 LLM 置于系统中心，试图从外部修正其输出。它们缺乏第一性原理的约束机制。

### 1.3 核心命题

AI 生成的代码在进入代码库之前，必须先通过一个免疫层——可验证、具备记忆能力、能识别并防御反复出现的错误模式。这一免疫层包含三种能力：

- **天然免疫**：基于模式快速拒绝符号、类型和数据流违规（SVL-1/2/3）
- **获得性免疫**：从 Failure Corpus 学习，生成特异性抗体，主动预防未来同类错误
- **免疫记忆**：将成功和失败模式沉淀为持久知识，系统随使用持续进化

---

## 2. 生物学基础与类比

### 2.1 三层架构

| 生物免疫系统 | 程序免疫 (Progmune) |
|-------------|-------------------|
| **物理屏障** | 沙箱、CI/CD 门禁 |
| **天然免疫** | 约束引擎（IR + SVL-1 至 SVL-3）|
| **抗原呈递** | Failure Corpus 记录 |
| **获得性免疫** | SSG 协议引擎 + 抗体注册表 |
| **免疫记忆** | 三层记忆架构（工作/情景/语义）|

### 2.2 类比的价值与边界

程序免疫系统处理的是形式化的、确定性的程序状态，而非生物化学信号。其学习是基于规则挖掘和模式匹配，而非神经元突触可塑性。

---

## 3. 技术架构

Progmune Runtime 的架构由六个核心层组成。v2.5.x 在每一层都进行了关键增强。

### 3.1 IR（程序真相层）——自我模型

中间表示从源文件静态提取，是系统的**唯一真相来源**：

- **符号表**：所有已定义的函数、类、变量及其位置
- **类型图**：参数类型、返回类型和类型别名
- **调用图**：函数间的调用关系
- **能力元数据**：`@requires` / `@produces` / `@purpose` / `@tags` / `@useWhen`
- **协议注解**：前置状态、后置状态和失效规则

**v2.5.x 数据**：519 个函数 | purpose 100% | produces 62% | requires 46% | tags 100%

**v2.5.x 增强：自动元数据派生**

五层自动派生策略：

| 策略 | 方法 | 效果 |
|------|------|------|
| S1 | `@protocol pre_states` → `@requires` | 直接映射 |
| S2 | 函数名 → `@purpose`（驼峰拆分）| 100% 覆盖 |
| S3 | 文件路径 → `@tags` | 100% 覆盖 |
| S4 | 函数名前缀 → `@requires`/`@produces`（如 `load*` → DATA）| +20% |
| S5 | 调用图传递继承（仅显式注解）| +5% |

### 3.2 Action Runtime——确定性合成边界

LLM 不生成原始代码，而是调用一组确定性 API：

```
call(func, ...args)
callAssign(func, assignTo, ...)
ifElse(condition, thenFn, elseFn)
assign(target, value)
output(value)
```

这些调用在沙箱化上下文中执行，运行时捕获为结构化的动作树，从源头消除注入漏洞和格式错误。

### 3.3 Constraint Engine——天然免疫层

基于 IR 对动作树执行快速、基于规则的验证：

| 级别 | 保证内容 | 验证方式 | 性能 |
|------|---------|---------|------|
| **SVL-1** | 无幻觉 API 调用 | IR 符号表查证 | 毫秒级 |
| **SVL-2** | 无类型/参数数量不匹配 | 签名比对 | 毫秒级 |
| **SVL-3** | 无未初始化变量/循环引用 | 数据流分析 | 毫秒级 |

### 3.4 Semantic State Graph（SSG）——获得性免疫层

SSG 建模系统资源的有效状态及其允许的转移：

```
UNAUTHENTICATED → AUTHENTICATED → TOKEN_ISSUED → SESSION_ACTIVE
```

每个函数声明 `pre_states`、`post_states` 和可选的 `invalidate` 规则。SSG 验证器在处理动作树时模拟状态转移，拒绝任何前置状态与当前活跃状态无交集的调用。

**v2.5.x 增强：Invariant-2（Delta 合法性验证）**

`checkLedgerConsistency` 新增第三层验证——不仅检查快照一致性（Invariant-0）和 Delta 一致性（Invariant-1），还验证 Delta 本身是否合法：

- 每个 `acquired` 状态必须在函数的 `post_states` 中
- 每个 `invalidated` 状态必须在函数的 `invalidate` 中
- 拒绝重复 acquire 已存在状态（防止审计绕过）

**性能数据**：增量验证 0.05ms/步 | 全量审计 3ms

**v2.5.x 增强：快速验证模式**

`PROGMUNE_FAST_VALIDATE=true` 可跳过 validateTransition 中冗余的 Invariant-1 检查（由 checkLedgerConsistency 覆盖），适用于极高性能场景。

### 3.5 Immune Memory & Failure Corpus——免疫记忆层

**三层记忆架构**

| 层 | 范围 | 持久化 | 衰减机制 |
|----|------|--------|---------|
| 工作记忆 | 每会话变量绑定 | 否 | 会话清除 |
| 情景记忆 | 最近 N 次执行序列 | JSON 文件 | TTL 30 天，分数 GC |
| 语义记忆 | 从频繁模式提炼的模板 | JSON 文件 | 关键词聚类合并 |

**v2.5.x 关键修复：SVL-1/2/3 抗体生成**

之前困扰系统最严重的问题：`getLearnedPatterns()` 只处理 SVL-4 违规（`if (v.svl !== 4) continue`），导致 SVL-1/2/3 的修复路径被完全忽略——**数据在增长，但没有在学习**。

**修复**：删除 SVL-4 过滤条件，所有 SVL 级别均生成抗体。

**修复前**：3 条抗体（全部 SVL-4）| 无法匹配非 SVL-4 意图  
**修复后**：SVL-1:symbol_existence 抗体（20 次）稳定匹配

**抗体注册表 + 知识回流三层**

| 层级 | 机制 | 触发条件 | 效果 |
|------|------|---------|------|
| **L1** | 抗体注入 Planner Prompt | ACL-3+ 匹配 | LLM 收到历史错误警告 + 避错指南 |
| **L2** | 免疫快速通道 | ACL-4 匹配 | 0 LLM 调用，直接构建已验证动作序列 |
| **L3** | 信用加权评分 | 所有函数 | Laplace 平滑 + SVL 惩罚 + 时间衰减 |

**L1 效果**：前 3 条 ACL-3+ 抗体注入，含违规签名、发生次数、具体避错指南。如：
```
⚠️ 免疫系统警告：
1. [ACL-3] SVL-1:symbol_existence（累计 36 次）→ 只使用可用函数列表中的函数名，禁止编造
2. [ACL-3] F07（累计 22 次）→ 确保在调用 .map/.filter 前检查对象是否为数组
```

**L2 效果**：ACL-4 抗体可直接绕过 LLM。当前 1 条 ACL-4 抗体（SVL-4:protocol，16 次，13 个不同意图），在匹配意图中 90% 可触发快速通道。

**Laplace 平滑（L3）**

解决小样本偏差问题：

$$
\text{credit} = \frac{\text{weightedSuccess} + 1}{\text{totalWeight} + 2}
$$

| 场景 | 原始值 | Laplace 后 |
|------|--------|-----------|
| 冷启动 | 1.0 | 0.5（中性先验）|
| 1/1 成功 | 1.0 | 0.67（不再虚高）|
| 99/100 | 0.99 | 0.98（几乎不变）|
| 0/1 失败 | 0.0 | 0.33（允许翻盘）|

SVL 严重性惩罚系数：SVL-1 = 1.0x，SVL-2 = 1.5x，SVL-3 = 2.0x，SVL-4 = 3.0x。时间衰减半衰期 = 1 天。

**v2.5.x 增强：语义记忆加固**

将脆弱的 20 字符前缀合并键替换为：
1. 关键词提取（前 3 个有效词）作为分组键
2. Jaccard 相似度聚类合并（阈值 0.5）
3. 停用词过滤

### 3.6 Code Emitter——程序落地层

将验证通过的动作树确定性地翻译为可执行代码。

| 特性 | TypeScript | Python |
|------|-----------|--------|
| 变量流分析 | ✅ | ✅ |
| 自动 return 注入 | ✅ | ✅ |
| 参数膨胀守卫 | ✅ MAX_PARAMS=10 | ✅ |
| 字符串枚举默认值 | ✅ | ✅ |
| for/assign 支持 | ✅ | ✅ |
| Generation marker | ✅ | ✅ v2.5.0 |
| 类型冲突重命名 | ✅ | — |
| 复杂类型默认值 | ✅ | — |

**功能测试**：5/5 业务场景通过，TypeScript 编译 0 错误。

---

## 4. Capability Graph（能力图）

### 4.1 概念

能力图是 Progmune 的**策略规划层**——纯图搜索，零 LLM 调用。它回答："给定一个意图，项目中哪些函数能组合成一条可执行的调用链？"

### 4.2 架构

```
Intent → Keywords → Score Nodes → Build Graph → Beam Search → Chains
                                                              ↓
                                              Format Chain → Planner Prompt
```

### 4.3 元数据覆盖率演变

| 指标 | v2.1.4 | v2.5.x | 提升 |
|------|--------|--------|------|
| purpose | ~30% | **100%** | +233% |
| tags | ~94% | **100%** | +6% |
| produces | ~26% | **62%** | +138% |
| requires | ~26% | **46%** | +77% |
| 总函数数 | ~415 | **519** | — |

### 4.4 Beam Search（v2.5.0 起）

v2.5.0 将贪婪 while 循环替换为 Beam Search：

| 参数 | 小图 (<500) | 中图 (500-1000) | 大图 (1000+) |
|------|-----------|---------------|-------------|
| BEAM_WIDTH | 5 | 5 | 3 |
| MAX_CHAIN_LEN | 5 (可配置) | 5 | 5 |
| 种子数 | 15 | 20 | 10 |
| SCORE_FLOOR | 0 | 0 | 0.2 |

语义跳跃衰减：每次 ×0.7（30% 衰减），相似度阈值 >0.25，top 3 候选。

### 4.5 Semantic Topology（语义拓扑）

构建函数相似图（文件共现 + 标签重叠 + 目的词重叠 + 链邻接），支持：

- `similarity(funcA, funcB)`：两函数相似度（0-1）
- `findSimilar(funcName, topN)`：找最相似的 N 个函数
- `capabilityMatch(produce, require)`：两能力标签是否语义关联

**v2.5.x 增强：持久化磁盘缓存**

```
首次运行: O(n²) 构建 → ~19s (2000 节点)
后续运行: MD5 哈希匹配 → <50ms (缓存命中)
```

缓存失效条件：`name + file + protocol + purpose + requires + produces` 任一变更。

### 4.6 能力图效果：Knowledge ROI 实验

**实验设计**：20 个真实业务任务，对比 Graph OFF（纯关键词评分）vs Graph ON（完整能力图 + 拓扑）

| 指标 | Graph OFF | Graph ON | Δ |
|------|----------|----------|-----|
| 平均分数 | 2.3 | **3.9** | +68% |
| 平均链长 | 1.0 | **5.4** | +440% |
| 数据流连接 | 0% | **95%** | — |

**功能测试**（5 个真实业务场景）：

| 场景 | 链长 | 预期函数 | 验证 | 编译 |
|------|------|---------|------|------|
| 基准管道 | 6 | ✅ 全部找到 | ✅ | 0 错误 |
| IR 提取+验证 | 5 | ⚠️ | ✅ | 0 错误 |
| 会话分析 | 6 | ✅ | ✅ | 0 错误 |
| 修复工作流 | 5 | ⚠️ | ✅ | 0 错误 |
| 健康报告 | 5 | ✅ | ✅ | 0 错误 |

示例链：`loadBenchmarks → benchmarkCount → benchmarkPassRate → benchmarkReport`

---

## 5. 知识基础设施

### 5.1 Rule Miner（规则挖掘引擎）

从失败模式自动生成可操作的约束规则。

**输入**：Failure Corpus 中的违规模式  
**输出**：结构化的 `MinedRule`（Function + pre_states + post_states + 置信度 + 原因）

**当前挖掘结果**（7 条规则）：

| 模式 | 置信度 | 规则 |
|------|--------|------|
| symbol_existence | 81 | 只使用 IR 中已导出的函数，禁止编造函数名 |
| protocol | 32 | 严格遵循 SSG 协议状态顺序调用函数 |
| schema | 19 | 通用约束 |
| type_mismatch | 2 | 检查参数类型与 IR 签名一致后再调用 |
| dataflow | 2 | 变量必须先声明再使用，避免循环引用 |

`applyMinedRules(apply=true)` 可自动合并至 `protocols.json`（带备份）。

### 5.2 Immune Receiver（免疫网络接收端）

补全了此前"只发不收"的全局免疫网络。

- `importFingerprints(fingerprints)`：SHA256 去重 + 写入本地语料库
- `importFromFile(filePath)`：离线文件导入
- `getReceiverStats()`：导入统计（已接收总数、最后更新时间）

### 5.3 Immune Metrics（免疫指标看板）

实时追踪免疫系统效能：

```
═══════ Immune System Metrics ═══════
── Efficacy ──
  Total antibody hits:       90
  ACL-4 fast paths (0 LLM):  0
  ACL-3 injected hints:      90
  LLM calls saved:           0
  Est. tokens saved:         18,000
  Immune repair rate:        70%
── Knowledge ROI ──
  Avg credit score:          0.50
  Functions with history:    0
  Learned patterns:          2
── Failure Landscape ──
  Total failures:            85
  Avg retries to success:    0.9
```

---

## 6. 治理层（Runtime/Governance）

### 6.1 执行治理资产

| 模块 | 行数 | 功能 |
|------|------|------|
| `branch-ledger.ts` | 484 | 分支账本：fork/merge 执行树 |
| `deterministic-replay.ts` | 341 | 确定性重放 + 指纹验证 |
| `ledger-registry.ts` | — | 指纹注册表 |
| `runtime-invariants.ts` | — | Invariant-0/1/2 检查 |
| `repair-proposal.ts` | — | 自动修复建议引擎 |
| `ssg-validator.ts` | 820+ | SSG 协议验证引擎 |

### 6.2 验证效率

| 操作 | 性能 |
|------|------|
| SVL-1/2/3 约束检查 | 毫秒级 |
| SSG 增量验证 | 0.05ms/步 |
| 全量账本审计（Invariant-0/1/2）| 3ms |
| 策略层搜索（2000 节点冷启动）| ~19s（首次）/ <50ms（缓存） |

---

## 7. 工程成熟度

### 7.1 CI/CD Pipeline

GitHub Actions 三阶段流水线：

| Job | 触发条件 | 内容 |
|-----|---------|------|
| Type Check | push/PR to main | `tsc --noEmit` |
| Unit Tests | push/PR to main | `vitest run` (66 tests) |
| Build | push/PR to main | 双构建 (CJS + ESM MCP) + 产物验证 |

### 7.2 测试覆盖

| 测试文件 | 测试数 | 覆盖模块 |
|---------|--------|---------|
| `strategy-planner.test.ts` | 10 | 能力链选择、null 防护、formatChainHint |
| `feedback.test.ts` | 7 | Laplace 平滑、冷启动信用、SVL 惩罚 |
| `terminal-format.test.ts` | 19 | 颜色、填充、图表、标签 |
| `utils.test.ts` | 6 | Jaccard 相似度、关键词提取 |
| `result.test.ts` | 4 | Result 类型、类型判别 |
| `logger.test.ts` | 4 | 结构化日志、模块隔离 |
| `ir-utils.test.ts` | 7 | countExported、mergeResults、loadIR |
| `knowledge-loop.test.ts` | 9 | L1/L2/L3 端到端 + 真实数据 |
| **总计** | **66** | 覆盖率门禁 8% |

### 7.3 系统测试

| 测试 | 验证内容 | 结果 |
|------|---------|------|
| `test_l1_feedback.ts` | 制造 10 次相同错误，验证抗体生成 + L1 提示注入 | ✅ 抗体生成，稳定匹配 |
| `test_acl4_fastpath.ts` | ACL-4 快速路径是否绕过 LLM | ✅ 90% 绕过率 |
| `test_capability_graph.ts` | 能力图是否驱动链推导 vs LLM 猜测 | ✅ 数据流驱动 |
| `test_knowledge_roi.ts` | 20 任务 Graph ON/OFF 对比实验 | ✅ +68% 分数, +440% 链长 |
| `test_functional.ts` | 5 业务场景端到端（无 LLM）| ✅ 5/5 通过，0 编译错误 |

### 7.4 代码质量基础设施

| 特性 | 说明 |
|------|------|
| `Result<T,E>` 类型 | 替代 `{success, error}` 模式 |
| 结构化日志 (`logger.ts`) | 级别过滤 + JSON 模式 + 模块标签 |
| `skipLibCheck` | 兼容 vitest/vite 类型声明 |
| 40 空 `catch{}` 已注释 | 所有异常吞没点有说明 |
| 20 个 dist 孤立文件已清理 | — |
| LLM 断路器 | `PROGMUNE_MAX_LLM_CALLS` + `PROGMUNE_RATE_LIMIT_MS` |

---

## 8. 语义有效性级别（SVL）

| 级别 | 名称 | 保证内容 | v2.5.x 状态 |
|------|------|---------|-----------|
| **SVL-1** | 符号存在性 | 无幻觉 API 调用 | ✅ 完全保证 |
| **SVL-2** | 类型有效性 | 无类型/参数数量不匹配错误 | ✅ 完全保证 |
| **SVL-3** | 数据流正确性 | 无 NameError / UnboundLocalError | ✅ 完全保证 |
| **SVL-4** | 协议合法性 | 无非法状态跳转 | ✅ 可选协议约束系统 + Delta 合法性验证 |
| **SVL-5** | 语义意图正确性 | 生成代码忠实实现预期业务逻辑 | 🔬 远期研究目标 |

---

## 9. 环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROGMUNE_MAX_LLM_CALLS` | 50 | LLM 调用上限 |
| `PROGMUNE_RATE_LIMIT_MS` | 0 | LLM 调用间隔（毫秒）|
| `PROGMUNE_MAX_CHAIN_LEN` | 5 | 能力链最大深度 |
| `PROGMUNE_FAST_VALIDATE` | false | 跳过冗余 Invariant-1 |
| `PROGMUNE_LOG_LEVEL` | info | 日志级别（debug/info/warn/error）|
| `PROGMUNE_LOG_JSON` | false | JSON 格式日志输出 |
| `PROGMUNE_STRICT` | true | 严格模式：Invariant 违规抛异常 |
| `PROGMUNE_ACL4_COUNT` | 10 | ACL-4 所需最小发生次数 |
| `PROGMUNE_ACL4_INTENTS` | 5 | ACL-4 所需最小不同意图数 |
| `PROGMUNE_ACL3_COUNT` | 4 | ACL-3 所需最小发生次数 |
| `PROGMUNE_ACL3_INTENTS` | 3 | ACL-3 所需最小不同意图数 |
| `PROGMUNE_ACL2_COUNT` | 2 | ACL-2 所需最小发生次数 |

---

## 10. 版本演进

| 版本 | 关键特性 |
|------|---------|
| v2.1.4 | BFS 协议修复、抗体注册表、信用循环 |
| v2.2.0 | CI/CD、结构化日志、Result\<T,E\>、覆盖率、Python 发射器对齐 |
| v2.2.1 | Laplace 平滑、协议绕过加固（Invariant-2）、Beam Search、null 防护 |
| v2.3.0 | L1/L2 知识回流闭环——抗体注入 Planner Prompt |
| v2.4.0 | Rule Miner、Immune Receiver、语义记忆加固、66 测试 |
| v2.5.0 | SVL-1/2/3 抗体修复、元数据自动派生（30%→62%）、4 系统测试 |
| v2.5.1 | 数据流传递收紧、功能性测试、ROI 实验 |
| v2.5.2 | 拓扑磁盘缓存（<50ms 热启动）、搜索剪枝、免疫指标 |

---

## 11. 技术路线图

### 近期（v2.6.x）

- **元数据覆盖率 80%+**：继续补齐 requires/produces 标注
- **Rule → Planner 自动注入**：MinedRule 直接影响搜索空间
- **Capability Graph 可视化**：将能力网络作为最核心的工程资产展示

### 中期（v3.0.x）

- **全局免疫网络**：`immune-receiver.ts` 的 Hub 消费端，联邦语料库
- **真实业务任务基准**：50+ 外部真实任务，取代内部 benchmark
- **MCP 治理集成**：CI/CD pre-merge 门禁（企业语义防火墙）

### 远期

- **SVL-5**：语义意图正确性的形式化验证
- **多语言 IR**：Python 项目的一等公民支持
- **神经符号编译器基础设施**：从运行时进化为编译器

---

## 12. 结论

Progmune Runtime v2.5.x 证明了：通过颠倒 LLM 与程序真相之间的关系——将 IR 确立为第一性原理，并使 LLM 成为受约束的启发式提议器——我们可以实现具有强语义保证的可验证代码合成。

v2.5.x 的核心突破在于**知识回路闭环**：系统不再只是记录失败和聚合统计，而是通过 L1/L2/L3 三层机制将抗体和信用评分回流到规划器中，真正改变行为。分层的 SVL 分类法、SSG 协议引擎、能力图推导、Beam Search 搜索、持久化磁盘缓存、以及持续积累的 Failure Corpus，共同形成了一种全新的编程基础设施：一个**会学习、会记忆、会防御**的程序免疫运行时。

我们将此称为程序免疫学（Program Immunology）。

该系统以开源形式提供：https://github.com/shenlian19831109/progmune-runtime，也可通过 `npm install progmune-runtime` 安装使用。

---

## 附录 A：关键测试结果汇总

| 测试 | 验证内容 | 数据 | 结论 |
|------|---------|------|------|
| L1 反馈 | 重复错误是否被阻止？ | SVL-1:symbol_existence → ACL-3 抗体, 20x, 稳定匹配 | ✅ |
| L2 快速通道 | ACL-4 是否绕过 LLM？ | 1 ACL-4 抗体, 90% 绕过率 | ✅ |
| L3 信用 | 小样本偏差是否消除？ | 1/1 → 0.67, 0/1 → 0.33 | ✅ |
| 规则挖掘 | 是否产生可操作规则？ | 7 条规则：symbol_existence/protocol/type_mismatch/dataflow | ✅ |
| 能力图 | 是否驱动链推导？ | Graph ON vs OFF: +68% 分数, +440% 链长, 95% 数据流 | ✅ |
| 功能测试 | 端到端是否工作？ | 5/5 场景通过, TypeScript 0 编译错误 | ✅ |
| 性能 | 大图是否可用？ | 2000 节点: 首次 19s, 缓存 <50ms | ✅ |

## 附录 B：Capability Graph 链示例

```
"generate benchmark report":
  loadBenchmarks → benchmarkCount → benchmarkPassRate → benchmarkReport

"validate actions and extract IR":
  loadIR → validateActionResult → validateProposal → getAllSessions

"list all sessions and find failure patterns":
  getFailureGenome → getAllFailures → getTopFailurePatterns → getLearnedPatterns

"suggest repairs for a failed session":
  suggestProtocolRepair → suggestInvariantRepair → countResolved → getAllSessions

"compute system health score":
  formatHealthLevel → computeHealthScore → getFailureGenome → loadIR
```
