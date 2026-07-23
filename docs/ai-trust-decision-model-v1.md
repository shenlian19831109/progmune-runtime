# AI Trust Decision Model v1

> **Progmune Trust Runtime — 核心数据模型**
>
> Status: Draft  
> Version: 1.0  
> Date: 2026-07-23  
> Replaces: _none (new model)_

---

## 1. 产品定位

Progmune 的产品不再是"检测违规"，而是输出一个**企业可以据此做决策的 AI 可信度判断**。

### 核心输出（四个字段）

| 字段 | 类型 | 含义 |
|------|------|------|
| **Trust Score** | 0–100 | 量化信任度 |
| **Decision** | `APPROVED` / `NEEDS_REVIEW` / `BLOCKED` | 是否允许进入下一阶段 |
| **Confidence** | `HIGH` / `MEDIUM` / `LOW` / `UNCERTAIN` | Trust Score 的可信程度 |
| **Evidence** | `Violation[]` | 支撑 Score 和 Decision 的具体证据 |

### 企业实际关心的是

> 能不能上线？不是 58 还是 61。

因此 **Decision 是最终产品，Score 是中间变量**。

---

## 2. 设计原则

| 原则 | 含义 |
|------|------|
| **可解释 (Explainable)** | 每一分的来源、每一次扣分都能追溯到具体证据；不可解释则整体标记 `UNCERTAIN` |
| **可审计 (Auditable)** | 同一代码、同一 Policy、同一版本，结果可严格复现 |
| **可比较 (Comparable)** | 同一个项目不同时间、不同项目、不同分支之间可比较 |
| **可演化 (Evolvable)** | v1 先简单覆盖核心维度，后续迭代逐步加入更多维度 |
| **诚实 (Honest)** | 能力覆盖不到的地方，通过 Confidence 标明，不假装 100% |

---

## 3. 维度结构

### 3.1 v1 活跃维度（4 个）

| 维度 | 权重 | 含义 |
|------|------|------|
| **Policy Compliance** | 35% | 是否违反企业安全/合规策略 |
| **Protocol Safety** | 30% | 认证、授权、支付、数据完整性等关键协议 |
| **Verification Coverage** | 20% | 类型检查、SSG、Ledger、测试等验证手段的覆盖情况 |
| **Governance Integrity** | 15% | Hash、Ledger、生成链是否完整，篡改检测 |

### 3.2 Binary Gate（1 个，不参与评分）

| Gate | 状态 | 效果 |
|------|------|------|
| **Explainability** | ✅ Explainable / ❌ Uncertain | 若为 `Uncertain`，Overall 标记 Confidence=`UNCERTAIN`，Score 不下调但不可单独作为决策依据 |

### 3.3 暂挂维度（v1 = N/A）

| 维度 | 原因 | 预计激活 |
|------|------|----------|
| **Evolution Stability** | v1 无历史基线数据 | v2（PoC 运行 3+ 迭代后） |

---

## 4. 各维度计算规则

### 4.1 Policy Compliance（35%）

**目标**：量化代码是否遵守企业定义的治理策略。

**公式**：

```
Policy Compliance = max(0, 100 - Σ(违规扣分))
```

**扣分规则**：

| 等级 | 扣分 | 典型场景 |
|------|------|------|
| `critical` | -40 | 直接违反支付安全策略、绕过认证、删除数据保护 |
| `high` | -20 | 缺少 rate limit、日志泄露敏感信息、不安全的加密算法 |
| `medium` | -8 | 缺少输入校验、错误处理不完整、依赖版本过期 |
| `low` | -2 | 命名不规范、注释缺失、代码风格问题 |

**Hard Gate（不可逾越）**：

> 若存在任何 `critical` 违规，Overall Trust Score 上限锁定为 **59**，且 Decision 必须为 `BLOCKED`。

这不只是"分数低"——而是**不允许上线**。

### 4.2 Protocol Safety（30%）

**目标**：按问题严重程度评分（不是二值通过/不通过）。

**公式**：

```
Protocol Safety = Σ(协议分数 × 协议权重) / Σ(协议权重)
```

**v1 协议类别与权重**：

| 协议 | 权重 | 检查项 |
|------|------|------|
| `authentication` | 25% | Token 校验、Session 管理、JWT 验证、凭证存储 |
| `authorization` | 20% | RBAC、权限边界、越权检查 |
| `payment` | 20% | 支付流程完整性、金额校验、交易日志 |
| `data_integrity` | 20% | 数据读写保护、输入输出校验、SQL 注入防护 |
| `ledger` | 15% | 审计日志完整性、不可篡改性、溯源链 |

**每个协议内部也按 Policy Compliance 扣分逻辑打分**（Critical -40, High -20, Medium -8, Low -2），然后归一化到 0-100。

**示例**：

```json
{
  "authentication": { "score": 95, "violations": [{"severity": "low", "rule": "AUTH_TOKEN_EXPIRY"}] },
  "authorization": { "score": 60, "violations": [{"severity": "critical", "rule": "AUTHZ_JWT_NO_VERIFY"}] },
  "payment": { "score": 100, "violations": [] },
  "data_integrity": { "score": 88, "violations": [{"severity": "medium", "rule": "DATA_NO_INPUT_VALIDATION"}] },
  "ledger": { "score": 100, "violations": [] }
}
```

### 4.3 Verification Coverage（20%）

**目标**：衡量验证手段的覆盖程度。

**公式**：

```
Verification Coverage = Σ(各项得分)  （满分 100）
```

**v1 检查项**：

| 检查项 | 分值 | 说明 |
|------|------|------|
| TypeScript type check | 25 | `tsc --noEmit` 通过 |
| SSG rules | 30 | 静态安全规则覆盖 |
| Ledger invariant | 20 | Ledger 不变量验证 |
| Coverage | 15 | 测试 / 验证覆盖率 |
| Failure genome | 10 | 已知失败模式匹配 |

**Confidence 调整**：如果项目语言不在当前最完整支持范围内（目前 TS/JS 覆盖率最高），该维度 Confidence 下降。

### 4.4 Governance Integrity（15%）

**目标**：验证生成链和审计记录的完整性。

**公式**：

```
Governance Integrity = 100 - Σ(缺陷扣分)
```

**扣分项**：

| 缺陷 | 扣分 |
|------|------|
| Hash 不匹配 | -50 |
| Ledger 缺失 | -30 |
| 生成链断裂 | -20 |
| 审计日志不完整 | -10 |

### 4.5 Explainability Gate（Binary，不计入 Score）

**检查项**：每个 violation 必须包含完整的 6 元组：

| 必填字段 | 说明 |
|------|------|
| `rule_id` | 触发的规则 ID |
| `file` | 违规所在文件路径 |
| `function` | 违规所在函数 |
| `evidence` | 代码证据片段 |
| `why` | 为什么这是违规 |
| `fix` | 修复建议 |
| `policy_ref` | 关联的企业策略引用 |

**Gate 逻辑**：

```
若 所有 violation 的 6 元组完整 → Explainable
若 任意 violation 缺少任一字段 → Uncertain
```

**若为 `Uncertain`**：Overall Confidence 设为 `UNCERTAIN`，Trust Score 保持但不可独立作为决策依据——需要人工审查。

---

## 5. Overall Trust Score 计算

### 5.1 基础公式

```
Overall = Σ(活跃维度得分 × 权重)
        × (Explainability Gate 通过 ? 1.0 : N/A)
        × (是否存在 critical ? max(59, Overall) : 无上限)
```

### 5.2 Decision 判定规则

| 条件 | Decision |
|------|------|
| Critical violation 存在 | **BLOCKED**（不受 Score 影响） |
| Overall < 60 | **BLOCKED** |
| 60 ≤ Overall < 80 | **NEEDS_REVIEW** |
| Overall ≥ 80 | **APPROVED** |
| Explainability = Uncertain | 原 Decision 降一级（APPROVED→NEEDS_REVIEW, NEEDS_REVIEW→BLOCKED） |

### 5.3 Confidence 判定规则

| 条件 | Confidence |
|------|------|
| Explainability Gate = Uncertain | **UNCERTAIN** |
| 任一活跃维度支持度 < 60%（如 Python 项目 Verification Coverage 不足） | **LOW** |
| 2+ 维度支持度 60-80% | **MEDIUM** |
| 所有维度支持度 ≥ 80% | **HIGH** |
| 维度 N/A（跳过） | 不影响 Confidence，但 Overall 按剩余维度计算 |

---

## 6. Trust API

### 6.1 端点

```
POST /trust/check
```

### 6.2 输入

```json
{
  "project": "crm-system",
  "commit": "abc123...",
  "branch": "feat/ai-payment-module",
  "policy": "enterprise-default",
  "context": {
    "language": "typescript",
    "previous_commit": "def456...",
    "base_branch": "main"
  }
}
```

### 6.3 输出

```json
{
  "project": "crm-system",
  "commit": "abc123...",
  "timestamp": "2026-07-23T10:30:00Z",
  "engine_version": "trust-runtime-v1.0.0",

  "overall": {
    "score": 87,
    "decision": "APPROVED",
    "confidence": "HIGH"
  },

  "dimensions": {
    "policyCompliance": {
      "score": 95,
      "weight": 0.35,
      "confidence": "HIGH"
    },
    "protocolSafety": {
      "score": 88,
      "weight": 0.30,
      "confidence": "HIGH",
      "details": {
        "authentication": { "score": 95, "violations": 1 },
        "authorization": { "score": 100, "violations": 0 },
        "payment": { "score": 80, "violations": 1 },
        "data_integrity": { "score": 88, "violations": 1 },
        "ledger": { "score": 100, "violations": 0 }
      }
    },
    "verificationCoverage": {
      "score": 92,
      "weight": 0.20,
      "confidence": "HIGH",
      "details": {
        "typescriptTypeCheck": { "score": 25, "max": 25 },
        "ssgRules": { "score": 28, "max": 30 },
        "ledgerInvariant": { "score": 20, "max": 20 },
        "coverage": { "score": 12, "max": 15 },
        "failureGenome": { "score": 7, "max": 10 }
      }
    },
    "governanceIntegrity": {
      "score": 100,
      "weight": 0.15,
      "confidence": "HIGH"
    },
    "explainability": {
      "status": "EXPLAINABLE",
      "violationsChecked": 4,
      "violationsComplete": 4
    },
    "evolutionStability": {
      "score": null,
      "weight": 0.00,
      "status": "UNAVAILABLE",
      "reason": "Insufficient history — requires ≥ 3 iterations of AI-generated changes"
    }
  },

  "violations": [
    {
      "severity": "high",
      "rule_id": "AUTH_001",
      "file": "src/auth/login.ts",
      "function": "doLogin",
      "message": "Missing rate limit check on authentication endpoint",
      "evidence": "src/auth/login.ts:42 — no rate limiter middleware applied before calling authenticate()",
      "why": "Without rate limiting, the login endpoint is vulnerable to brute-force attacks",
      "fix": "Add rate limiter middleware before authentication logic, e.g. express-rate-limit with max 5 attempts per minute per IP",
      "policy_ref": "enterprise-default.auth.rate-limit"
    }
  ],

  "summary": {
    "critical": 0,
    "high": 1,
    "medium": 1,
    "low": 2,
    "total": 4
  },

  "audit_trail": {
    "commit": "abc123...",
    "policy": "enterprise-default",
    "policy_version": "v1.2.0",
    "engine_version": "trust-runtime-v1.0.0",
    "generated_at": "2026-07-23T10:30:00Z",
    "reproducible": true,
    "check_id": "check_8f3a2b1c"
  }
}
```

---

## 7. Trust Report（人可读）

对外给 CTO / 合规团队看的报告。

```
═══════════════════════════════════════════════════
  Progmune Trust Report
═══════════════════════════════════════════════════

  Overall Trust Score  87 / 100           HEALTHY
  Decision             ✅ APPROVED
  Confidence            HIGH

───────────────────────────────────────────────────
  Key Findings
───────────────────────────────────────────────────
  ✅  0 Critical policy violations
  ✅  Authentication protocol verified
  ✅  Ledger invariants intact
  ✅  Governance chain complete
  ⚠️   1 High severity issue — see below

───────────────────────────────────────────────────
  Evidence
───────────────────────────────────────────────────
  AUTH_001  HIGH
  Missing rate limit check in doLogin()

  Evidence:  src/auth/login.ts:42
  Why:       No rate limiter before authenticate()
  Fix:       Add rate limiter (max 5 req/min/IP)
  Policy:    enterprise-default.auth.rate-limit

───────────────────────────────────────────────────
  Audit Trail
───────────────────────────────────────────────────
  Commit          abc123...
  Policy Version   v1.2.0
  Engine Version   trust-runtime-v1.0.0
  Generated At     2026-07-23 10:30 UTC
  Reproducible     Yes
═══════════════════════════════════════════════════
```

---

## 8. Pipeline 集成（CI 用法）

```bash
# 企业 CI Pipeline 中的典型调用
RESULT=$(curl -s -X POST https://trust.progmune.dev/trust/check \
  -H "Content-Type: application/json" \
  -d '{
    "project": "crm-system",
    "commit": "'"$CI_COMMIT_SHA"'",
    "policy": "enterprise-default"
  }')

DECISION=$(echo "$RESULT" | jq -r '.overall.decision')
SCORE=$(echo "$RESULT" | jq -r '.overall.score')

if [ "$DECISION" = "BLOCKED" ]; then
  echo "❌ BLOCKED — Trust Score: $SCORE"
  exit 1
elif [ "$DECISION" = "NEEDS_REVIEW" ]; then
  echo "⚠️  NEEDS_REVIEW — Trust Score: $SCORE"
  echo "Please review violations before merge."
  # 可选：exit 0（允许但需人工审查）或 exit 1（阻止）
fi

echo "✅ APPROVED — Trust Score: $SCORE"
```

---

## 9. v1 明确边界

以下内容**不在 v1 范围内**，防止范围蔓延：

| 不在 v1 | 说明 | 计划 |
|------|------|------|
| 行业基线对比 | 与同类项目/行业平均水平比较 | v3+ |
| L3 / L4 能力评分 | 高层级治理能力（如架构合规、流程合规） | v4+ |
| 跨项目聚合排名 | 多个项目的 Trust Score 排行 | 不做，不是核心需求 |
| 动态权重调整 | 根据项目类型自动改变权重 | v3+ |
| Evolution Stability | AI 迭代漂移监控 | v2（PoC 3+ 迭代后激活） |
| Protocol Template Marketplace | 客户贡献和共享协议模板 | v3+ |
| Multi-language full coverage | Go/Java/Python/Rust 全覆盖 | v2-v4 逐步扩展 |

---

## 10. 版本演进路径

```
v1（当前）          v2（+2-4 月）         v3（+4-8 月）
─────────────────────────────────────────────────────
Policy Compliance   + Evolution Stability  + Industry Baseline
Protocol Safety     + Go/Java 支持          + Dynamic Weights
Verification Cover. + 更多协议类别          + Protocol Templates
Governance Integ.   + Confidence 细化       + Multi-project
Explainability Gate + Trust History API     + L3/L4 Capabilities
```

---

## 11. 设计决策记录

| # | 决策 | 理由 |
|---|------|------|
| 1 | Explainability 作为 Binary Gate，不参与评分 | 一个"解释不出来的分数"本身就不可信 |
| 2 | Critical violation 锁死 Overall ≤ 59 + BLOCKED | Trust Runtime 输出的是决策，不是数学分数 |
| 3 | Evolution Stability 在 v1 挂起 | 首批 PoC 无历史基线，等 3+ 迭代后激活 |
| 4 | Protocol Safety 内部按严重程度评分 | 二值"通过/不通过"会掩盖 Critical 和 Low 的差异 |
| 5 | Confidence 作为独立维度标记 | 诚实告知语言/能力覆盖不足的情况 |
| 6 | Decision 优先于 Score | 企业关心"能不能上线"，不是"58 还是 61" |
| 7 | 产品名称从"检测器"升级为"决策引擎" | 这是从工具到企业级产品的定位升级 |
