# Progmune 开发计划

> 基于 Coverage Matrix 的量化差距，对齐企业产品方向  
> 2026-07-24

---

## 总览

```
Phase 1 (当前 → 2 个月)     Phase 2 (2 → 4 个月)      Phase 3 (4 → 8 个月)
Trust Foundation              Language Expansion          Platform Scale
───────────────────────────   ───────────────────────   ──────────────────────
Trust Report        ✅        Python 支持                多 Framework 适配
Explainability      ✅        C Coverage 修复             Trust API SaaS
Policy Engine       ✅        Express 适配               Protocol 扩展
Trust API           ✅        FastAPI 适配                Public Benchmark
Coverage Matrix     ✅        Evolution Tracking         行业基线
```

---

## Phase 1：Trust Foundation（进行中 → 2026-09）

**目标**：从"检测器"变成"决策引擎"。Phase 1 编码部分已完成（`src/trust/`），剩余工作是验证和迭代。

### 已完成

| 模块 | 状态 | 产出 |
|------|------|------|
| Trust Score Model | ✅ | `docs/ai-trust-decision-model-v1.md` |
| Trust Engine | ✅ | `src/trust/engine.ts` — 收集→评分→决策流水线 |
| Explainability Gate | ✅ | `src/trust/explainability.ts` — 7 字段完整性检查 |
| Score Calculator | ✅ | `src/trust/score-calculator.ts` — 4 维度加权评分 |
| Trust API | ✅ | `src/trust-api.ts` — `POST /trust/check` |
| MCP Tool | ✅ | `progmune_trust_check` |
| Enterprise Policy | ✅ | `src/policy/engine.ts` — 企业自定义策略加载 |
| Coverage Matrix | ✅ | `docs/coverage-matrix.md` |
| Tests | ✅ | 71 个测试全部通过 |

### 待完成

| 任务 | 优先级 | 说明 |
|------|--------|------|
| Trust Report JSON → PDF | P1 | 合规审计需要 PDF 格式的 Trust Report |
| Trust Score 校准 | P1 | 在已知 risk level 的项目上验证 Score 与实际风险的相关性 |
| Policy Engine CLI 完善 | P2 | `progmune policy create` 交互式创建企业策略 |
| HTML Trust Report | P2 | 给 CTO/合规团队看的网页版报告 |
| Phase 1 验收 | P1 | 在 1 个真实项目上跑通完整的 Trust Check 流程 |

---

## Phase 2：Language Expansion（2026-09 → 2026-11）

**目标**：使 Progmune 对第二个语言（Python）可用，同时修复 C 语言的 F1。

### 2.1 Python 支持 ★★★★★

**为什么是 Python 第一优先**：
- GitHub Copilot 数据显示 Python 是 AI 辅助编程使用率最高的语言
- FastAPI / Django 企业采用率极高
- 已有 IR 提取器 (`src/extract-ir-python.ts`)，有基础

| 任务 | 工作量 | 产出 |
|------|--------|------|
| Python AST 解析 | 2 周 | 基于 `ast` 模块的函数调用序列提取 |
| Python SSG 验证器 | 3 周 | Python 版的状态机验证（复用 SSG 核心逻辑） |
| Python Protocol 规则 | 2 周 | Auth、Resource、Data Integrity 的 Python 专用规则 |
| FastAPI 适配 | 2 周 | 中间件链、依赖注入、OAuth2 方案的识别 |
| Django 适配 | 2 周 | DRF permission、ORM query safety、middleware |
| Python Blind Benchmark | 2 周 | 10-20 个开源 FastAPI/Django 项目的标注基准 |

**Phase 2 结束时的 Python 目标**：

| 指标 | 目标值 |
|------|--------|
| Precision | ≥ 80% |
| Recall | ≥ 70% |
| 覆盖协议 | Auth, Resource, Data Integrity, Ledger |
| 覆盖框架 | FastAPI, Django |

### 2.2 C Coverage 修复 ★★★★☆

**当前问题**：Gold Benchmark F1=23.3%（P=15.2%, R=50.0%）。  
**根因**（已有研究结论）：Rule Coverage 不足——C 的 Identifier Parser 缺失导致无法正确识别 C 特有的函数命名和调用模式。

| 任务 | 工作量 | 产出 |
|------|--------|------|
| C Identifier Parser | 2 周 | 解析 C 的宏、typedef、函数指针、`goto cleanup` 模式 |
| C 内存管理规则扩展 | 1 周 | 池分配、引用计数、arena allocator 模式 |
| C 错误处理规则 | 1 周 | `goto fail`、errno 检查、返回值检查 |
| 重新标注 Gold Benchmark | 1 周 | 使用新 parser 重新标注 curl/libssh/nginx/openssl |
| 回归测试 | 1 周 | 确保 TS 基准不退化 |

**Phase 2 结束时的 C 目标**：

| 指标 | 当前 | 目标 |
|------|------|------|
| Precision | 15.2% | ≥ 50% |
| Recall | 50.0% | ≥ 65% |
| F1 | 23.3% | ≥ 55% |

### 2.3 Evolution Tracking ★★★★☆

| 任务 | 工作量 | 产出 |
|------|--------|------|
| 激活 Evolution Stability 维度 | 1 周 | Trust Score 中加入迭代漂移监测 |
| Trust History API | 1 周 | `GET /trust/history?project=X` — 查看 Trust Score 趋势 |
| Drift Report | 1 周 | AI 每次修改后的 Trust Score 变化报告 |

### 2.4 Express 适配 ★★★☆☆

| 任务 | 工作量 | 产出 |
|------|--------|------|
| Express middleware 链检测 | 1 周 | 识别 auth middleware、error handler、validation |
| Express route handler 分析 | 1 周 | 路由级别的 auth/validation 覆盖检查 |

---

## Phase 3：Platform Scale（2026-11 → 2027-03）

**目标**：从"能检查少数项目"到"能覆盖大多数企业项目"。

### 3.1 更多语言支持

| 语言 | 优先级 | 原因 | 目标 |
|------|--------|------|------|
| Go | 高 | 云原生基础设施主流 | 覆盖 Auth, Resource, TLS, HTTP 协议 |
| Java | 中 | 企业遗留系统 | 覆盖 Spring Boot Auth, Resource |

### 3.2 协议扩展

| 协议 | 优先级 | 原因 |
|------|--------|------|
| OAuth2.0 / OIDC | ★★★★★ | 几乎所有 SaaS 的认证标准 |
| gRPC | ★★★★☆ | 微服务通信主流 |
| GraphQL | ★★★☆☆ | 查询注入是独特的风险类别 |
| DB Transaction | ★★★☆☆ | 事务边界和隔离级别 |
| WebSocket | ★★★☆☆ | 实时应用认证模式不同 |

### 3.3 产品化

| 任务 | 说明 |
|------|------|
| Trust API SaaS | Dashboard → Web → 多租户 |
| Public Benchmark | 开源基准数据 + 方法论（Trust Foundation 完成后再公开） |
| Protocol Templates | 从 PoC 客户真实 Policy 中提炼的可复用策略模板 |
| 行业基线 | 同行业项目的 Trust Score 分布对比 |
| CI/CD 集成插件 | GitHub App、GitLab CI template、Jenkins plugin |

---

## 关键里程碑

```
2026-07  ✅ Trust Foundation 编码完成
2026-08  🎯 Trust Score 校准 + 首个 PoC 项目验收
2026-09  🎯 Python 支持 Alpha（FastAPI）
2026-10  🎯 C F1 ≥ 55% + Evolution Tracking 激活
2026-11  🎯 Python 基准达到 P≥80% R≥70%
2026-12  🎯 Express 适配 + Phase 2 验收
2027-01  🎯 Go 支持 Alpha
2027-02  🎯 OAuth2.0 / gRPC 协议扩展
2027-03  🎯 Phase 3 验收 + Public Benchmark
```

---

## 不做的方向（明确排除）

| 方向 | 原因 |
|------|------|
| 扩更多 Rule（TS 从 68→200） | TS 基准已经 P=86.8%，继续加规则边际收益递减 |
| 自建 Dashboard SaaS（Phase 1 就做） | 没有 PoC 验证前做 SaaS 是给 CLI 套皮 |
| C 规则盲目翻倍 | 根因是 Identifier Parser 缺失，不是规则数量 |
| 每个协议都做一个 Framework 适配 | 先做 Express + FastAPI，验证模式后再扩展 |
| Runtime 行为监控 | 不在 Progmune 的核心定位内（这是 APM/RASP 的领域） |

---

## 资源评估

Phase 2 的 3 个月工作量估算：

| 模块 | 人-周 |
|------|-------|
| Python AST + SSG | 5 |
| Python Protocol 规则 | 2 |
| FastAPI + Django 适配 | 4 |
| Python Blind Benchmark | 2 |
| C Identifier Parser | 2 |
| C 规则修复 + 重新标注 | 3 |
| Evolution Tracking | 3 |
| Express 适配 | 2 |
| 测试 + 集成 + 文档 | 3 |
| **总计** | **~26 人-周** |

---

## 一句话

> Phase 1 把 Progmune 从"检测器"变成了"决策引擎"。  
> Phase 2 把 Progmune 从"只能查 TS 项目"变成"能查 Python + C 项目"。  
> Phase 3 把 Progmune 从"能查"变成"能覆盖大多数企业项目"。  
> 每一步的衡量标准不是功能数量，而是**新增了多少个 Protocol × Language × Framework 的有效覆盖组合**。
