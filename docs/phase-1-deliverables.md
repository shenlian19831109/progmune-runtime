# Phase 1 交付物：Trajectory→Coverage 数学关系 + Confidence 升级

> 日期：2026-08-01  
> 状态：Complete  
> 实验：E2（规则词汇注入）✅ | E3（项目加权验证）✅

---

## D1: Coverage Model v1

### 两因子模型（定律 1）

```
Coverage(ns) = has_vocabulary(ns) × density(ns)
```

| 因子 | 定义 | 饱和特性 |
|------|------|---------|
| `has_vocabulary(ns)` | namespace ns 的规则是否出现在任何轨迹中（binary） | 不饱和——需要显式注入 |
| `density(ns)` | 给定词汇后，轨迹是否覆盖所有 pre_state→post_state | 在 ~5 条轨迹/转换后饱和 |

### 关键实证

| 实验 | 轨迹数 | 覆盖转换 | 覆盖率 | 边际增益 |
|------|--------|---------|--------|---------|
| 生产 Corpus | 2,567 | 32/81 | 39.5% | — |
| +E2 合成轨迹 | +18 | +23 | 67.9% | **+28.4%** |
| 轨迹饱和度 | 723 → 2,567 | 32 → 32 | 39.5% → 39.5% | **0%** |

> 18 条新词汇轨迹做到的，2,567 条同类轨迹做不到。

### 级联效应

注入一个 namespace 的轨迹会激活相邻 namespace 的规则：
- E2 注入 auth + payment + session_mgmt
- 级联激活 registration（4 转换）+ printlab_order（2 转换）
- 级联增益：+6 转换（35% 超出目标）

---

## D2: Namespace 缺口地图

```
覆盖率热力图（当前 vs 可达）:

conditional    ████████████ 100%  ( 8/ 8)
cross          ████████████ 100%  ( 6/ 6)
loop           ████████████ 100%  ( 8/ 8)
transaction    ████████████ 100%  ( 5/ 5)
auth           ████████████ 100%  ( 9/ 9) ← E2 补全
payment        ████████████ 100%  ( 5/ 5) ← E2 注入
session_mgmt   ████████████ 100%  ( 7/ 7) ← E2 注入
registration   ████████████ 100%  ( 4/ 4) ← E2 级联
tls            ████████████ 100%  ( 1/ 1) ← E2 注入
printlab_order ██░░░░░░░░░░  25%  ( 2/ 8) ← E2 级联
───────────────────────────────────────
api_gateway    ░░░░░░░░░░░░   0%  ( 0/ 1)
data_integrity ░░░░░░░░░░░░   0%  ( 0/ 2)
dev_pipeline   ░░░░░░░░░░░░   0%  ( 0/ 4)
file_upload    ░░░░░░░░░░░░   0%  ( 0/ 4)
notification   ░░░░░░░░░░░░   0%  ( 0/ 2)
printlab_print ░░░░░░░░░░░░   0%  ( 0/ 2)
resource       ░░░░░░░░░░░░   0%  ( 0/ 2)
supplier       ░░░░░░░░░░░░   0%  ( 0/ 3)
```

**剩余缺口：8 个 namespace，26 个转换。** 预估需要 ~20 条合成轨迹可达到 100% 覆盖。

---

## D3/D4: Confidence 计算公式 + Trust Report 升级

### 新 Confidence 类型定义

```typescript
// 替代 ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNCERTAIN"
interface CoverageConfidence {
  score: number;           // 0-100 加权覆盖率
  margin: number;          // ±margin (基于轨迹密度的 CI)
  level: "HIGH" | "MEDIUM" | "LOW";  // score > 70 → HIGH, > 40 → MEDIUM
  breakdown: NamespaceCoverage[];     // 可追溯的明细
}

interface NamespaceCoverage {
  namespace: string;
  coverage: number;        // 0-1
  transitionsCovered: number;
  transitionsTotal: number;
  trajectoryDensity: number;  // 轨迹数/转换数
  status: "saturated" | "partial" | "no_vocabulary";
}
```

### 计算公式

```
Confidence(ns) = has_vocabulary(ns) × density_factor(ns)

其中:
  has_vocabulary(ns) = 1 if any trajectory exercises rules in ns, else 0
  density_factor(ns) = min(1, trajectory_count(ns) / saturation_threshold(ns))
  saturation_threshold(ns) = 5 × transitions_in_ns  (from E2 empirical data)

ProjectConfidence = Σ_{ns} weight(ns) × Confidence(ns)

其中:
  weight(ns) = |functions_using_ns| / |total_functions|  (from codebase analysis)
```

### Trust Report 输出示例

```
Confidence: 64% ± 12% (MEDIUM)
┌──────────────────────────────────────────────────┐
│ Namespace          Cov    Traj   Status           │
│ conditional        100%   247    ✅ saturated      │
│ cross              100%    89    ✅ saturated      │
│ loop               100%   312    ✅ saturated      │
│ auth                56%    47    ⚠️  partial       │
│ tls                  0%     0    ❌ no vocabulary  │
│ file_upload          0%     0    ❌ no vocabulary  │
├──────────────────────────────────────────────────┤
│ Weighted: 64% (2/6 namespaces uncovered)          │
│ Top action: add tls trajectory → +9% confidence   │
└──────────────────────────────────────────────────┘
```

---

## D5: C Benchmark 根因解释

### 问题
C benchmark F1 = 23.3% (v6)，P = 15.2%，R = 50.0%。

### 根因（两因子模型解释）

1. **召回率 R=50% 的原因：词汇覆盖不足**
   - C benchmark 的 232 条 sequences 涉及 TLS、SSH、HTTP 协议
   - 当前规则词汇仅覆盖 39.5% 的协议转换空间
   - 未被词汇覆盖的 56 个转换中包含 **tls (1), auth (4), dev_pipeline (4), file_upload (4)**
   - → 50% 的 violations 无法被检测 = 50% recall 天花板

2. **精确率 P=15.2% 的原因：规则爆炸（Rule Explosion）**
   - curl benchmark 中 61 条 clean sequences 产生了 452 条 SSG 规则
   - 规则过于宽泛（RULE_TOO_BROAD）和上下文误匹配（CONTEXT_MISMATCH）
   - VI 可减少 43% FPs，但仍有 57% FPs 残留

3. **为什么 v6→v7 几乎无变化（F1 23.3% → 23.0%）**
   - v6→v7 的改动是优化规则匹配精度（precision tuning）
   - 但瓶颈是词汇覆盖（vocabulary），不是精度（precision）
   - → 在词汇覆盖不变的前提下，调参无法提升召回率

### 预测

若将 E2 的词汇注入推广到 C benchmark 相关的 namespace（tls, dev_pipeline, file_upload, auth），预期：
- Recall: 50% → ~75-85%（解锁 ~26 个新转换的检测能力）
- Precision: 15.2% → ~20%（VI 继续优化）
- F1: 23.3% → ~32-38%

验证方式：Phase 2 白皮书中的可证伪预测 → 实际测量。
