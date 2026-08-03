# Two-Hump 诊断：C 基准 Rule Coverage 缺口分析

> **日期**：2026-08-02
> **方法**：基于 Sergei Gukov "Two-Hump Problem" 框架
> **数据来源**：Gold Benchmark v5/v6/v7、Batch C Layer Analysis、Coverage Dashboard v2、C Rule Coverage Taxonomy、Phase 1 Coverage Experiment
> **诊断对象**：Progmune C 基准（curl 85 + libssh 47 + nginx 50 + redis 50 = 232 序列）

---

## 0. 诊断摘要

Progmune 在 C 代码上的检测能力呈现**经典的双峰分布**（Two-Hump Distribution），与 Gukov 在 Andrews–Curtis 猜想中观察到的现象结构同构：

```
                    Trivial Hump                    Near-Impossible Hump
                    ╭──╮
                    │  │  82.7% L1
                    │  │  (lexical)
                    │  │
                    │  │
                    │  │                              ╭──╮  0% L4
                    │  │                              │  │  (semantic)
           ─────────╯  ╰──────────────────────────────╯  ╰─────────
                                              Missing Middle
                                              L2(4.9%) + L3(12.4%)
                                              检测率 ~0%
```

**核心发现**：

| 维度 | Trivial Hump | Missing Middle | Near-Impossible Hump |
|------|-------------|----------------|---------------------|
| 占比 (7,740 findings) | 82.7% (L1) | 17.3% (L2+L3) | 0% (L4) |
| TS 检测率 | **>95%** | ~60-70% | ~10-20% |
| C 检测率 | **~100%** regex-friendly | **~0%** (除部分 crypto) | **0%** |
| 根因 | 规则词汇完备 | **规则词汇缺失** | 需要语义/CFG/数据流 |
| 解法 | 扩展 trigger 模式 | **编写 namespace 规则** | 架构升级 |

---

## 1. 数据全景

### 1.1 TS vs C 基准对比

```
                    Precision   Recall   F1
TypeScript (Blind):   86.8%     83.6%   85.2%   ← Trivial Hump 全覆盖
C (Gold, v6):         15.2%     50.0%   23.3%   ← 双峰夹击
C (Gold, v7):         17.4%     71.1%   28.0%
```

### 1.2 分仓库精度

| Repo | 序列 | 含违规 | v7 P | v7 R | v7 F1 | 违规检出率 |
|------|------|--------|------|------|-------|-----------|
| curl | 85 | 24 | 32.2% | 79.2% | **45.8%** | ⚠️ |
| libssh | 47 | 14 | 34.8% | 57.1% | **43.2%** | ⚠️ |
| nginx | 50 | 0 | — | — | — | 全 clean，FPR 44% |
| redis | 50 | 0 | — | — | — | 全 clean，FPR 90% |

### 1.3 跨 7 仓库能力层级分布

```
27,668 个 C 函数 → 7,740 个检测发现 → 层级分类：

L1 (词法/正则):    6,398  (82.7%)   ████████████████████████████████
L2 (控制流顺序):     382  ( 4.9%)   ██
L3 (跨过程):         960  (12.4%)   █████
L4 (语义/状态机):      0  ( 0.0%)
────────────────────────────────────────────────────
```

**关键洞见**：L4 检测能力为 **绝对的零**。不是"检测到了但不对"，而是**根本没有能力产生 L4 级别的发现**。这是因为当前的所有检测机制（regex 调用对、AST 模式、频率矩阵）都不具备语义理解能力。

---

## 2. 双峰结构的精确刻画

### 2.1 Trivial Hump：Regex-Friendly 域（当前全覆盖）

**特征**：函数调用序列可以通过精确/模糊正则匹配来捕获。

```
覆盖面：
  ✅ conditional          100% (8/8 转换)
  ✅ cross                100% (6/6)
  ✅ loop                 100% (8/8)
  ✅ transaction          100% (5/5)
  ✅ crypto_key_exchange  ~75% (通过 Exp-018 恢复)
  ✅ certificate_pinning  100% (1/1)
  ✅ safeguard_logic      100% (2/2)
```

**19 个 C FN 中，regex-friendly 部分**：7/19 已恢复，剩余 5/19 已饱和（regex 无法进一步提升）。

**这个 hump 的瓶颈不是方法，而是 trigger 模式的覆盖面**——每添加一个新的命名约定（如 snake_case、crypto taxonomy、auth taxonomy），就能恢复一批 FN。

### 2.2 Missing Middle：规则词汇缺口（当前最大投资回报区）

**这是 Progmune 的"缺失中部"**——这些转换**在理论上可以被当前机制检测**，但因为**规则词汇不存在**而完全漏掉。

#### 2.2.1 Namespace 级别缺口

```
11/21 namespaces 完全没有规则词汇：

  namespace          转换数    状态
  ─────────────────────────────────
  payment              5       ❌ 0% — 无任何规则
  session_mgmt         7       ❌ 0%
  printlab_order       8       ❌ 0%
  registration         4       ❌ 0%
  file_upload          4       ❌ 0%
  dev_pipeline         4       ❌ 0%
  supplier             3       ❌ 0%
  notification         2       ❌ 0%
  data_integrity       2       ❌ 0%
  printlab_print       2       ❌ 0%
  resource             2       ❌ 0%
  api_gateway          1       ❌ 0%
  tls                  1       ❌ 0%
  ─────────────────────────────────
  合计                43       → 这 43 个转换永远无法被触发
```

覆盖度模型：**69.1%（56/81）的协议转换永久无法被触发**，因为对应 namespace 没有规则词汇。

#### 2.2.2 能力层级缺口

L2（控制流顺序，382 个发现）和 L3（跨过程，960 个发现）代表了"本可检测但实际未检测"的区域：

```
L2 缺口（需要控制流感知的规则）：
  - auth_message_lifecycle   0/5 recovered  ← regex 已饱和
  - tls_config              1/2 recovered  ← mbed_configure_ssl 仍缺失
  
L3 缺口（需要跨函数分析）：
  - 跨文件资源追踪（如 derive_hybrid_secret 的 buffer 生命周期）
  - 宏展开后的回调识别（SSH_PACKET_CALLBACK）
```

**每个仓库的 Missing Middle 体量**：

| Repo | 函数数 | L2 (可加规则) | L3 (可加跨过程规则) | 机会 |
|------|--------|-------------|-------------------|------|
| curl | 2,826 | 27 | 139 | 166 个潜在可恢复发现 |
| libssh | 1,320 | 16 | 16 | 32 |
| nginx | 2,548 | 5 | 57 | 62 |
| redis | 5,651 | 248 | 490 | **738** ← 最大机会 |
| openssl | 9,872 | 33 | 58 | 91 |
| apache | 5,030 | 52 | 198 | 250 |
| nghttp2 | 421 | 1 | 2 | 3 |

### 2.3 Near-Impossible Hump：语义/CFG/宏域（当前不可达）

```
L4 发现：0 / 7,740 (0%)

需要的能力：
  - 控制流图 (CFG) 分析         → state_machine (1 FN)
  - 数据流分析                   → 跨函数资源追踪
  - 宏展开                       → SSH_PACKET_CALLBACK (1 FN)
  - 语义理解（"这个函数在做什么"） → 当前完全缺失
```

**这不是"规则不够"的问题**——这是**检测机制的维度缺失**。regex 和调用对频率矩阵永远无法解决 state_machine、宏回调、跨文件数据流这类问题。

#### 19 个 C FN 的完整归宿

```
状态                    数量    说明
─────────────────────────────────────────
✅ 已恢复 (regex)         7      Exp-017/018/019 恢复
⬡ Regex 已饱和            5      Auth Message Lifecycle — regex 到天花板
~ Gold 语义不匹配         3      标注问题，非 Progmune bug
⊘ 规则逻辑缺陷            2      safeguard 误匹配
❌ 需要 L2-L4 能力         2      state_machine + packet_macro
─────────────────────────────────────────
                         19
```

---

## 3. 根因链分析

### 3.1 为什么 TS 是 Trivial Hump 全覆盖？

```
TS 代码特征                  →  Progmune 能力匹配
─────────────────────────────────────────────────
驼峰命名 (camelCase)         →  identifier-parser.ts 可分解动词
JSDoc 注解                   →  extract-ir.ts 可提取 @purpose/@tags
显式 import/export            →  调用图完整
结构化错误处理 (try/catch)    →  资源生命周期可见
AST 完整（TypeScript 编译器）  →  IR 提取精准
```

TS 代码的**结构性规律**恰好与 Progmune 的 regex+AST 机制对齐。这是 Trivial Hump 全覆盖的结构性原因。

### 3.2 为什么 C 掉入 Near-Impossible Hump？

```
C 代码特征                    →  Progmune 能力缺口
─────────────────────────────────────────────────
下划线命名 (snake_case)        →  ✅ 已修复 (Exp-017)
宏定义回调 (SSH_PACKET_CB)     →  ❌ 无宏展开，IR 中不可见
goto cleanup 模式              →  ❌ 无 CFG，检测不到资源释放路径
函数指针                      →  ❌ 调用图不完整
条件编译 (#ifdef)              →  ❌ 多路代码路径不可见
手动内存管理 (malloc/free)      →  ❌ 配对检测需要数据流
```

### 3.3 为什么 Missing Middle 是空的？

这是**最关键的诊断发现**：

```
规则词汇的生成路径：

  protocols.json (手写)  ──→  21 namespaces, 109 rules
       │
       ▼
  protocol-extractor.ts (自动挖掘)  ──→  仅从调用对频率中推断
       │
       ▼
  trajectory-corpus.ts (语料合成)  ──→  仅覆盖已定义规则的 namespace
       │
       ▼
  ❌ 闭环：没有规则 → 没有轨迹 → 没有覆盖率 → 没有新规则
```

这是一个**自举死锁 (bootstrap deadlock)**：
1. 自动规则挖掘依赖调用对频率
2. 但 C 代码中缺失的规则对应的调用模式（如 `ecdh_build_k`）本身就很少出现
3. 频率阈值过滤掉了这些低频模式
4. 没有规则 → 没有检测 → 没有反馈 → 规则永远不会被创建

**打破死锁的方法**就是 Gukov 方法的直接应用：手动注入规则词汇（就像 Exp-018 注入 crypto taxonomy 那样），而不是等待频率自然积累。

---

## 4. Two-Hump 框架下的行动路线

### 4.1 P0（本周）：填充 Missing Middle — 规则词汇注入

**目标**：将 11 个零覆盖 namespace 减少到 6 个。

| 优先序 | Namespace | 转换数 | 注入方式 | 预计覆盖率增量 |
|--------|-----------|--------|---------|--------------|
| 1 | **payment** | 5 | 手写规则 + 合成轨迹 | +5 转换 |
| 2 | **session_mgmt** | 7 | 手写规则 + 合成轨迹 | +7 |
| 3 | **registration** | 4 | 手写规则 | +4 |
| 4 | **file_upload** | 4 | 手写规则 | +4 |
| 5 | **resource** | 2 | 手写规则 | +2 |

**方法论**（借鉴 Exp-018 crypto taxonomy 的成功模式）：
1. 为每个 namespace 定义核心协议链（如 payment: `initiate → receive_callback → confirm/fail`）
2. 编写 trigger 正则模式（词法层，L1）
3. 编写 3-5 条合成轨迹注入 corpus
4. 测量覆盖率变化 → 验证规则词汇注入假设

**预期效果**：覆盖率 39.5% → ~60%，C benchmark Recall 有望从 50% 提升到 65-70%。

### 4.2 P1（两周）：扩展 Regex-Friendly Hump — trigger 覆盖

**目标**：将 regex-friendly 域的 5 个未恢复 FN 清零。

```
当前状态：
  ✅ crypto_key_exchange     75% (3/6)  → 目标 100%
  ❌ auth_message_lifecycle    0% (0/5)  → 需要跨函数上下文（L3）
  ⚠️ tls_config              50% (1/2)  → mbed_configure_ssl
  ✅ certificate_pinning     100% (1/1)
  ✅ safeguard_logic         100% (2/2)
```

Auth Message Lifecycle 的 0% 是特殊案例——它已经被判定为 "regex_saturated"，意味着**regex 方法在此类别已到天花板**。要进一步恢复需要 L3（跨过程分析），这已超出当前架构。

### 4.3 P2（一月）：桥接 L2-L3 缺口 — 控制流感知规则

**目标**：建立基本的控制流感知能力，解锁 L2/L3 检测。

```
技术路线（由易到难）：

1. 函数内配对检测（L2）
   - 在同一函数体内，检测 open→close 配对
   - 处理 if/else/for/while 分支中的资源管理
   - curl/libssh 中共 ~43 个 L2 发现机会

2. 跨函数资源追踪（L3）
   - 同一文件内：追踪 alloc 函数的返回值是否传递到 free 函数
   - 需要简单的 def-use 链分析
   - 7 仓库中共 ~960 个 L3 发现机会

3. 宏回调识别（L3/L4 边界）
   - 对 C 预处理宏做基本展开
   - 如 SSH_PACKET_CALLBACK → 识别为回调注册模式
```

### 4.4 P3（季度）：攻克 Near-Impossible Hump — 语义能力

**目标**：建立最小可行的 L4 检测能力。

```
需要的能力栈（按优先级）：

1. CFG 构建          →  state machine 检测
2. 基本数据流分析     →  跨函数资源追踪
3. 宏展开             →  回调识别
4. 函数指针解析       →  间接调用图补全
```

这层需要显著的架构投资。当前的建议是**先让 Missing Middle 产生价值**，再决定是否投资 L4。

---

## 5. 双峰收敛预测

基于两因子覆盖度模型和对数饱和曲线：

```
场景                             覆盖率     C Recall (预测)    C F1 (预测)
─────────────────────────────────────────────────────────────────────────
当前 (v7)                         39.5%     50.0%              23.3%
+ P0 规则词汇注入 (5 namespaces)   ~60%     65-70%             ~30-35%
+ P1 Trigger 扩展                  ~65%     70-75%             ~35-40%
+ P2 L2 控制流                     ~72%     75-80%             ~40-45%
+ P2 L3 跨过程分析                 ~80%     82-88%             ~50-55%
+ P3 L4 语义 (CFG+数据流)          ~90%     90-95%             ~65-75%
─────────────────────────────────────────────────────────────────────────
TS 当前                           100%     83.6%              85.2%
```

**关键假设**：
- Precision 随 Recall 提升而下降（更多规则 = 更多 FP），需要 FP 抑制机制同步跟进
- L4 语义分析的收益递减严重（每增加 1 个 FN 恢复需要更高的架构投资）
- nginx/redis 的 0 违规标签意味着当前 benchmark 对全 clean repo 的检测不敏感

---

## 6. 与 Gukov 框架的映射总结

| Gukov 概念 | Progmune 对应 | 诊断价值 |
|-----------|--------------|---------|
| **Trivial Hump** | Regex-Friendly 域（L1, 82.7% findings） | TS 全覆盖的原因 |
| **Impossible Hump** | L4 语义域（0% 检测能力） | C F1=23.3% 的深层原因 |
| **Missing Middle** | 11 个零覆盖 namespace（43 转换） | P0 行动的直接目标 |
| **双峰桥接** | 规则词汇注入 + L2/L3 规则 | 打破自举死锁的方法 |
| **层级化选项** | L1/L2/L3/L4 检测层级 | 架构升级的路线图 |
| **稀疏奖励** | 部署反馈的稀疏性 | Trust Decision 需要从稀疏信号中学习 |

---

## 7. 附录：诊断数据索引

| 数据文件 | 内容 | 日期 |
|---------|------|------|
| `blind-benchmark/reports/gold-benchmark-v5-v6-v7.json` | TS/C 精度/召回/迁移矩阵 | 2026-08-01 |
| `blind-benchmark/reports/batch-c-layer-analysis.json` | 7 仓库 L1-L4 分布 | 2026-07-17 |
| `blind-benchmark/reports/coverage-dashboard.md` | Regex-Friendly vs Hostile 分类 | 2026-07-16 |
| `blind-benchmark/taxonomy/c-categories.json` | 19 FN 逐条分类 | 2026-07-17 |
| `docs/experiments/c-rule-coverage-taxonomy.md` | FN 按类别/优先级/恢复状态 | 2026-07-16 |
| `docs/phase-1-coverage-experiment.md` | 覆盖度模型 + 饱和曲线 | 2026-08-01 |
| `benchmarks/reports/cross-repo-precision-latest.json` | 分仓库精度/FP 类别 | 2026-07-02 |
| `docs/coverage-matrix.md` | Protocol × Language 覆盖矩阵 | 2026-07-24 |
