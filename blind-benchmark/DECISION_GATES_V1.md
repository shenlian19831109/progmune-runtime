# §53 决策门禁：为什么 83 分不该等于「通过」

日期：2026-10-04　｜　改动：`src/trust/{types,score-calculator,engine,confidence-calculator}.ts`
（**本轮首次改动 `src` 判定逻辑**——此前 §49–§52 只动探针与基准工具）
产物：`blind-benchmark/reports/s53/`，规则 R101 / R102

---

## 一、起因：一个比误报严重得多的问题

§52 把 immich 的 153 条 `NESTJS_NO_VALIDATION` 误报消掉之后，主路径的**分数和决策一分没动**：

| | immich §51 | immich §52 | nocodb §52 |
|---|---|---|---|
| violations | 174 | **21** | 586 |
| authentication 子协议分 | 0 | **0** | **0** |
| overall score | 83 | **83** | **83** |
| decision | APPROVED | **APPROVED** | **APPROVED** |
| confidence | HIGH | **HIGH** | **HIGH** |
| coverageConfidence | 0% LOW | 0% LOW | 0% LOW |

153 条误报消失，分数不动——这不是误报问题。拆开算式就清楚了：

```
100×0.35 (policyCompliance) + 75×0.30 (protocolSafety) + 73×0.20 (coverage) + 70×0.15 (governance)
= 35 + 22.5 + 14.6 + 10.5 = 82.6 → 83
```

而 `protocolSafety = 75` 是怎么来的？五个协议族里 **authentication = 0 分**（21 条违规），
其余四个（authorization / payment / data_integrity / ledger）**0 条违规 ⇒ 直接给 100 分**：

```
(0×0.25 + 100×0.20 + 100×0.20 + 100×0.20 + 100×0.15) / 1.0 = 75
```

**四个协议族一分没扣，还各拿满分。**

---

## 二、三个结构性缺陷

### 缺陷 A：0 条违规 = 100 分（ABSENCE 被当成「查过且干净」）

immich 上 authorization / payment / ledger 根本没有任何检测能力（R94：48 条 `SAFEGUARD_RULES`
里 15 条是 python-only，在 TS 上 never fires）。**0 条违规不是「检查过且通过」，是「没看」。**
给 100 分等于把盲区计成满分。这是本项目母题在聚合层的教科书案例。

### 缺陷 B：聚合层没有下限

`determineDecision` 只有一条路径：`分数 ≥ 80 ⇒ APPROVED`。authentication 塌到 0 分、
586 条违规，对决策没有任何影响——因为另外三个维度把它稀释掉了。

### 缺陷 C：声明与实现分离（R102）

两处，且都是「系统自己知道，但没人用」：

1. `engine.ts` 给 coverageConfidence 写的分支注释是
   「本次扫描是废票，**不得据此得出『干净』结论**」——**没有任何一行代码读它**。
2. `scoreProtocolSafety` 算 confidence 的分子是 `d.score <= 100`，
   这是**字面恒真**的条件 ⇒ 5/5 协议永远算「已检查」⇒ confidence 永远 HIGH。

---

## 三、第一版门禁被自己的数据否决（R101）

我最初的修法是加两条封顶：

- coverageConfidence = LOW ⇒ 不许 APPROVED
- mappingCoverage < 30% ⇒ 不许 APPROVED

加上「已观察的安全协议 < 50 分 ⇒ 不许 APPROVED」，在 9 个真实项目上一跑：

| 项目 | 违规 | auth | coverage | mapping | 结果 |
|---|---:|---:|---:|---:|---|
| express-realworld | **0** | 100 | 0% | 21% | NEEDS_REVIEW ❌ |
| koa-realworld | **0** | 100 | 0% | 9% | NEEDS_REVIEW ❌ |
| netflx-web | **0** | 100 | 0% | 14% | NEEDS_REVIEW ❌ |
| docmost | 6 | 52 | 0% | 12% | NEEDS_REVIEW ❌ |
| … | | | | | |
| **合计** | | | | | **6/6 全封顶** |

**0 违规、auth=100 的项目也被封顶** —— 这不是门禁，是「一律不许通过」。查原因：

- **coverage 9/9 = 0%**：数据来自项目根的 `protocols.json`，**9 个项目全都没有这个文件**
  ⇒ 转换空间为空 ⇒ score 恒 0 ⇒ 恒 LOW。**这是「没得测」，不是「测得低」。**
- **mapping 分布 1%~21%**（中位 ~9%），门槛 30% **没有任何项目够得到**。

两条都是常数。⇒ 按 R98 把 coverage 改成「**仅在可测时生效**」；
mapping 率**撤出门禁、只做汇报**（阈值不能从分布里挑，R86）。

---

## 四、最终形态：只封顶，不降级；只作用于「看过的」维度

```
evaluateDecisionGates()
 ├── ① 安全维度下限：已观察的 authentication/authorization/data_integrity
 │     任一 < 50 ⇒ decision 上限 NEEDS_REVIEW
 └── ② 覆盖率门槛：coverage LOW **且 applicable=true** ⇒ 上限 NEEDS_REVIEW
                   coverage 不可测 ⇒ 记「不适用」，不门禁（R98）

determineConfidence(..., observationIncomplete) ⇒ 观察度不足时置信度封顶 MEDIUM
```

三条纪律：

1. **只封顶不降级**：门禁只阻止「说通过」，不会把 BLOCKED 抬上来（critical 硬门优先级不变），
   也不会把 NEEDS_REVIEW 打成 BLOCKED。修「虚高」不许过冲成「虚低」。
2. **不动分数**：没有观察就没有扣分依据。ABSENCE 影响的是 **confidence 与 decision 上限**，
   不是分数——扣分同样是臆造。
3. **盲区不参与下限判定**：只对「确实产出过观察」的协议生效，否则又是在没数据的地方下结论。

### 九项目实测（收窄后）

| 项目 | 分 | decision | conf | 违规 | auth | floor | obs |
|---|---:|---|---:|---:|---:|:---:|:---:|
| docmost | 87 | APPROVED | LOW | 6 | 52 | – | – |
| express-realworld | 90 | APPROVED | LOW | 0 | 100 | – | – |
| fastify-realworld | 90 | APPROVED | LOW | 1 | 92 | – | – |
| hapi-realworld | 90 | APPROVED | LOW | 1 | 92 | – | – |
| koa-realworld | 90 | APPROVED | LOW | 0 | 100 | – | – |
| netflx-web | 90 | APPROVED | LOW | 0 | 100 | – | – |
| **immich** | 83 | **NEEDS_REVIEW** | LOW | 21 | **0** | ✅ | – |
| **nestjs-realworld** | 83 | **NEEDS_REVIEW** | LOW | 16 | **0** | ✅ | – |
| **nocodb** | 83 | **NEEDS_REVIEW** | LOW | 586 | **0** | ✅ | – |

floor 触发 **3/9**，6 个未触发 ⇒ **有真实反例**（R101 的准入条件成立）。
只有 auth = 0 的三个项目被封顶，且它们的违规数是 16 / 21 / 586。

### 覆盖率门禁的对照实验

九个项目都没有 `protocols.json`，所以②**一次都没触发**——留着一条从不触发的门禁是不行的
（R66）。补了一个单变量对照实验：把 netflx-web 复制一份，只加一个 `protocols.json`
（规则已定义、`trajectories` 为空 ⇒ 真的测得低）：

| | coverage | applicable | decision |
|---|---|---:|---|
| netflx-web（无协议定义） | 0% LOW | false | APPROVED |
| `_covfix`（同一项目 + 协议定义） | 0% LOW | **true** | **NEEDS_REVIEW** |

唯一变量是「能不能测」，结果从 APPROVED 变成 NEEDS_REVIEW ⇒ ②被端到端验证一次。

### confidence 现在 9/9 是 LOW——这不是「变差了」

`protocolSafety.confidence` 原来恒为 HIGH（分子是恒真的 `d.score <= 100`）。
改成按「真实产出过观察的协议数 / 全部协议数」计算后，9/9 都是 LOW。

⚠ 读这个数要小心：所有违规都被 `extractProtocol` 的**默认桶**塞进了 authentication
（`NESTJS_*` / `SSRF` / `PATH_TRAVERSAL` / `SSG_*` 的前缀都不在映射表里），
所以 observed 的上限就是 1/5 = 0.2。**LOW 是真的，但 0.2 这个数值被默认桶缺陷夸大了**——
修默认桶之前，只能读成「LOW」，不能读成「0.2」。

---

## 五、闸门

| 门 | 结果 |
|---|---|
| `check-taintpath.ts`（160 条） | 失败 **0** ✅ |
| `check-webshape.ts`（72 条） | 失败 **0** ✅ |
| `check-fr-corpus.ts fr-007` | pre 5 / post **0** ✅ |
| `check-fr-corpus.ts fr-016` | pre 7 / post **0** ✅ |
| `batch-scan.ts` 盲测逐条比对 | 119 项目 / 1627 函数，**逐条零差异** ✅ |
| `vitest src/trust/score-calculator.test.ts` | **11 passed**（含 2 条过冲防线、1 条向后兼容）✅ |
| `vitest src/frameworks/nestjs-detector.test.ts` | 26 passed ✅ |

⚠ 盲测零漂移要诚实读：batch-scan 走的是 `detectSafeguardViolations`，**不经过本次改动的
score-calculator / engine**。本次改动的触发语料是 **9 个真实项目 + `_covfix` 对照实验**，
不是 batch-scan（R56：零漂移 ≠ 通过）。

⚠ `learning-ranker.test.ts` / `logistic-reward.test.ts` 在 5 文件并发时报 8 条失败
（worker `onTaskUpdate` timeout，单条耗时 36~146s）。已做同条件对照：
**stash 到 HEAD 单跑通过（12.9s），恢复改动后单跑也通过（14.2s）**，
且这两个文件只 import `logistic-reward / planner-telemetry / repair-ranker`，
与本次改动无模块依赖 ⇒ **并发争抢导致的假失败，非回归**。

---

## 六、入库规则

100 → **102**：

- **R101**：门禁必须有反例——先测分布再定阈值，否则它是常数不是判据。
  （分布的用途是**否决**阈值，不是产生阈值。）
- **R102**：代码里写下的结论必须有消费者——「不得/不可信/废票」这类断言
  没有消费点就是装饰；恒真/恒零的条件一律视为未接线的测量。

---

## 七、下一步

1. **修 `extractProtocol` 的默认桶**（不是本轮的事，但它污染了 confidence 的数值口径）：
   `NESTJS_*` 不该落进 authentication；`SSG_*` 该有独立族。修完 confidence 才算真的可读。
2. **协议族能力表**：把「authorization / payment / ledger 在 TS 上到底有没有接线」变成
   可查询的事实（R94 的延伸）。现在它们空着拿 100 分，唯一的遮羞布是 confidence 变 LOW。
3. **要不要让「盲区」影响分数**：本轮明确选择不影响（没有观察就没有扣分依据）。
   若产品上决定「盲区应当扣分」，那是另一笔账，需要独立论证与独立验证。
4. 已发现未修：`policyCompliance` 因为 §50 的双计过滤，在这三个项目上**恒为 100**
   （所有违规的 `policy_ref` 都以 `protocol-safety` 开头 ⇒ 全被过滤）。
   0.35 的权重被一个常数维度占着，会稀释一切——需要单独评估。

## 八、复现

```bash
# 单测（11 条，含过冲防线）
NODE_OPTIONS="--max-old-space-size=1024" npx vitest run src/trust/score-calculator.test.ts

# 九项目主路径
for r in immich:benchmarks/ts-apps/immich/server docmost:benchmarks/ts-apps/docmost/apps/server \
         nocodb:benchmarks/ts-apps/nocodb/packages/nocodb ; do
  n=${r%%:*}; d=${r##*:}
  NODE_OPTIONS="--max-old-space-size=1536" PROGMUNE_HUB=off PROGMUNE_MAX_LLM_CALLS=0 \
    node dist/trust/cli.js "$d" --language typescript --json > blind-benchmark/reports/s53/v2-$n.json
done

# 覆盖率门禁对照实验（唯一变量：有没有 protocols.json）
cp -R benchmarks/ts-apps/netflx-web benchmarks/ts-apps/_covfix
#   ↓ 写入 protocols.json（rules 有定义、trajectories 为空）
NODE_OPTIONS="--max-old-space-size=1536" node dist/trust/cli.js benchmarks/ts-apps/_covfix \
  --language typescript --json > blind-benchmark/reports/s53/covfix.json
```
