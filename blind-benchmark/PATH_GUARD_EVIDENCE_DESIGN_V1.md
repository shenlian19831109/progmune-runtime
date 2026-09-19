# PATH_GUARD_EVIDENCE 设计 V1 —— 给路径穿越补「校验识别」

> 日期：2026-09-19 ｜ 状态：**已实现（v3.7.34），已过验收门**
> 接续：`TAINT_DATAFLOW_PILOT_V1.md`（试点把这个问题定为真正门槛）、§七 评审拆分后的条目 **G1**
> 一句话：SSRF 侧有守卫豁免、路径穿越侧裸奔 —— 本文件只解决「怎么算已校验」。
>
> **实现结果摘要（详见 §六）**：真实语料判别力首次成立——fr-007 openhop
> **pre 报出 5 条 / post 归 0**。实现期踩到两个反例，都已修并写进词表注释：
> ① `ensureDir()` / `isDirectory()` 被 G-C 误判为守卫（后缀 `Dir` 已移除并加反例名单）；
> ② 「不得标记」类用例会**假通过**（污点经 `path.join()` 包装后根本到不了 sink）——
> 由此定下 R6：负向断言必须配同形状正对照。

## 一、要修的语义缺陷

当前路径穿越标记的逻辑（提取器侧）本质是：

```
taint → file sink  ⇒  标记 __progmune_path_traversal__
```

它**不看中间有没有校验**。SSRF 侧不是这样的：

```
taint → fetch sink 且函数体内无 SSRF_GUARD_EVIDENCE  ⇒  标记 __progmune_ssrf_user_url__
```

所以两者的数据流形状完全同构，但判别力差一个数量级 —— 这正是 **root 集合不敢放宽**的真正原因（也是 fr-012/fr-015 MISS 升级为「机制缺口」而非「词表缺口」的依据）。

G1 的目标：**把路径穿越的判定从「有流就标记」改成「有流且无校验证据才标记」**，语义与 SSRF 对齐。

## 二、守卫词表：种子来自语料的真实修复，不是拍脑袋

评审意见原话：*"不需要凭空设计词表，语料里就有种子"*。以下每条种子都有对应的语料条目作为出处，
实现前对着 fix commit 的完整 diff 复核一次（标记为 ☐ 的尚未逐字核对）。

### 2.1 守卫（出现任一 → 该函数视为已做路径校验）

| # | 形态 | 典型写法 | 语料出处 |
|---|---|---|---|
| G-A | **目录包含性校验**（canonical 形态） | `resolve(p).startsWith(resolve(root) + sep)`、`!resolved.startsWith(baseDir)` throw | fr-016 Redocly（assert-within-dir） ☐ |
| G-B | **绝对路径拒绝 + 上跳拒绝** | `path.isAbsolute(p)`、`p.startsWith('..')` / `includes('..')` | fr-012 gitlab-mcp 真修复（下载侧 `localPath`） ☐ |
| G-C | **独立校验函数**被调用 | `assertSafeXxx(p)` / `validateXxxPath(p)`（项目自有命名） | fr-007 openhop（`flow-id.ts` 抽出独立校验函数） ☐ |
| G-D | 白名单 / 枚举映射 | `ALLOWED[name]`、`MAP[p] ?? throw`、`switch(p) default: throw` | 评审建议形态，暂无语料实证 ☐ |
| G-E | 规范化后重判 | `normalize(p)` 与 `resolve(p)` 参与比较（G-A 的前置） | fr-016 + G-B 的组合形态 |

判定作用域：**含被调用者**——守卫在被调用的项目函数里也算（对齐 fr-007 的形态：校验被抽到 `flow-id.ts`，
调用点没有任何校验词汇）。这一条决定、**G-C 必须与一跳传播能力同时上线**，否则等于没做。

### 2.2 明确不算守卫（反例清单）

| # | 形态 | 为什么不算 | 实证 |
|---|---|---|---|
| N-A | `path.basename(p)` | 只去目录、不去 `..`，且常被当成「已经 sanitize 过」 | **fr-012 pre 实测反例**：前置切片里就有 `path.basename`，漏洞依然成立 |
| N-B | `path.join(root, p)` / `path.resolve` 单独出现 | 拼接本身不阻止 `p = '../../etc/passwd'` | 与 G-A 的区别：必须参与比较/包含判断 |
| N-C | 长度 / 字符集过滤（`length < 100`、正则过滤 `[/\\]`） | 无法阻止上跳 | 待补实证 ☐ |
| N-D | `if (!p) throw` | 空值检查 ≠ 路径包含性检查 | 语义显然 |

> N-A 是这张表里最重要的一行：`basename` 是「看起来像 sanitize」的头号陷阱，一旦把它算作守卫，
> fr-012 的真值会被自己压掉。**这条要用单测锁死。**

### 2.3 待定（需要语料再给证据）

- `extname` 白名单（只允许 `.png`）：与 G-D 同型，倾向算守卫，但暂无实证 → 暂不定。
- try/catch 包裹 sink：与 Category 正交，**不算守卫**。

## 三、落地位置

在 `src/extract-ir.ts` 的路线标记处，与 `SSRF_GUARD_EVIDENCE` 平级新增 `PATH_GUARD_EVIDENCE`，
**并在引擎 `trust/engine.ts:1458-1476`（`__progmune_path_traversal__` 消费点）不动的前提下只改上游**——
动上游是必要的：标记一旦发出，引擎没有第二道判别。

实现顺序（依赖）：

1. G-B/G-A 词法种子（最快见判别力，直接作用于 fr-012 pre/post）
2. N-A 反例单测（**必须与第一步同时提交**，否则 basename 会把真值压掉）
3. G-C 一跳传播（依赖 C1/C2 的 `methodSinkParamMap` 修复：校验函数多为顶层函数、多为裸调用）
4. G-D/G-E 视语料补种情况再说

## 四、验收门（比 C1–C3 严一档）

G1 改变的是判别逻辑，因此不能只过「零漂移」：

| 门 | 标准 |
|---|---|
| TS 795 盲测 | 3086 flags LOST 0 / ADDED 0（⚠️ 对标记类改动同样是**空过**，真正起作用的是下面几条） |
| ~~fr-012~~ | **撤回**——`corpus_mismatch`（部署模式闸门），不能用于判定判别力（见下节） |
| ~~fr-016（Redocly）~~ | **也撤回**——实测 pre 侧 **0 条**：污点根是 OpenAPI 文档解析产物，不在根表里，pre 根本没有信号。要让它可用须先补「文档/配置解析产物」根，那是 C 组召回的事，不能拿来当判别力的门。 |
| **fr-007（openhop）** | **G1 的主验收对**：pre 报出（实测 5 条）**且 post 归 0**（实测 0 条）✅ |
| 真实世界负样本 | gitlab-mcp 下载侧 `localPath` 守卫块（pre/post 都有）**必须不被标记** |
| 反例单测 | `basename` 不压制、`resolve+startsWith(root)` 压制 —— 两条都要有 |
| 正对照（R6） | 每条「不得标记」必须配一条**去掉守卫后重新标记**的同形状用例，否则视为无效断言 |

## 四·补 2026-09-19 复核：fr-012 从验收条目里撤下

对着 fix commit 的完整 `index.ts` 做逐行 diff，结论与评审给的种子**不一致**，必须记录：

1. **fr-012 的真修复不是路径校验，而是部署模式闸门**：
   ```ts
   if (IS_REMOTE && filePath) throw new Error("file_path cannot be used in remote mode. …");
   ```
   本地模式的 `readFileSync(filePath)` 在修复后**原样保留**（本来也不是漏洞，漏洞只在远程/网络模式成立）。
   ⇒ **pre 与 post 在污点流层面本来就应该同数**。用 fr-012 判 G1 判别力是无效实验——
   不是分析器不行，是这条语料没有提供「修复后流消失」的信号。已把该条 `result_reason` 改为 `corpus_mismatch`。
2. **评审提到的 `isAbsolute + startsWith('..')` 不是 fr-012 的修复**：该守卫块在下载侧 `localPath`，
   **pre（7968–7977）与 post（8719–8728）完全一致**，属既有代码。
   ⇒ 它不能当「修复形态种子」，但可以、也应该当**真实世界的「已校验」负样本**：G1 上线后这段代码必须不被标记。
3. **顺带纠正试点 V1 §3 的说法**：post 切片其实是**忠实的**（它就是 fix commit 的完整 `index.ts`，
   454 697 字节，与快照一致）；错的不是切片，是「用判别力去量一个部署模式闸门」这个判据本身。

### 由此确立的能力边界（写死，避免以后反复）

> **G1 不追求识别「部署模式闸门 / 鉴权策略」类修复。** 它只回答「这条路径有没有被校验过」。
> 修复靠 `if (IS_REMOTE && …) throw`、`if (!user.isAdmin) throw` 这类**上下文开关**完成的，
> 不在污点流的语义里——这类条目应在语料层标记为 `corpus_mismatch`，而不是记成分析器 MISS。都要有 |

**没过这些门之前，G1 不提交、不入库、不发版。**

## 四·补 2 实现期实测（2026-09-19）—— 两个必须记下来的反例

### 反例一：`ensureDir()` 被当成守卫，召回归零

第一版 G-C 后缀含 `Dir`，上线后 **fr-007 的 pre 侧 5 条全部被压成 0**——因为
`store.ts` 里到处是 `await this.ensureDir()`（建目录）和 `s.isDirectory()`（类型判断）。
两者都长得像「校验」，但**跟路径包含性毫无关系**。

处置：从后缀表移除 `Dir` / `Name`，并新增**显式反例名单**
`PATH_GUARD_FN_DENY = { ensureDir, isDirectory, isDir, assertDir, makeDir, mkdir, checkExists, isValid, isRoot, ensureId, getId }`。
fr-016 的 `assertWithinDir` 靠 `Within` 后缀仍命中，fr-007 的 `assertValidFlowId` 靠 `Id` 仍命中——两个种子都没丢。

> 教训：按函数名猜语义是**会付代价**的。词表每加一个后缀，都要先问「有没有同形的非校验函数」。

### 反例二：「不得标记」类用例会假通过（已升为方法学规则 R6）

写用例时发现：污点经 `path.normalize(x)` / `path.join(x)` / `path.basename(x)`
包装后**不再传播**（`collectTaintedNames` 的单跳只认 `= <name>` 直赋）。
于是「守卫存在 ⇒ 不被标记」这类断言里，如果污点被包装过，它会**因为污点压根没到
sink 而通过**——跟守卫生效与否无关。本轮最初有 3 条（G-A / G-D / fr-016 形态）就是这样假通过的。

处置：所有负向断言一律配**同形状正对照**（去掉守卫后必须重新标记）。
缺正对照的 `not.toContain` 视为无效断言。

## 六、验收结果（2026-09-19）

| 门 | 结果 |
|---|---|
| fr-007 openhop 真实语料 | ✅ **pre 5 条 / post 0 条**（修复前 `flowRoutes` + `FlowStore.save/get/delete/updateFlow`；修复后全部归零） |
| fr-012 gitlab-mcp | 维持 2/2（本条已改判 `corpus_mismatch`，不参与判别力判定） |
| fr-016 Redocly | 维持 0/0 —— **pre 侧无信号**（污点根是 OpenAPI 文档解析产物，不在根表里），本条不构成 G1 的失败项，但也**不能**当验收对 |
| TS 795 盲测 | 3086 flags LOST 0 / ADDED 0 —— ⚠️ **仍是空过**：盲测语料里 `__progmune_path_traversal__` 出现 **0 次**（前 0 后 0），根本没有覆盖。真正的门是 fr-007 与定向用例 |
| 定向用例 | `src/extract-ir-taint-guard.test.ts` **14 passed**；反向验证：回退 v3.7.33 后 **5 条失败**（G-B/G-C×2/G-A/G-D 的负向断言），9 条正对照与反例仍绿 |
| 构建 | `tsc -p tsconfig.json` 零错误 |

> **上表 TS 795 那一行已于 3.7.35 被修掉**——见下 §七。当时它确实是空过，
> 而这个缺陷连续误导了三次验收（3.7.32/33/34）。

## 七、后续（3.7.35）：TS 795 空过的终结 + 新语料立刻挖出的两个缺口

### 7.1 为什么必须先修补覆盖而不是继续加能力

盲测语料里 `__progmune_path_traversal__` 出现 **0 次**，意味着任何关于
路径穿越的改动在 TS 795 上都「零漂移」——它既不能证明安全，也不能暴露回归。
3.7.35 新增语料族把它补上了：

- `generated/taintpath_A`：HTTP 请求面 16 条（4 类守卫形态 + 4 类反例 + 常量负对照 + 4 条 known-gap）
- `generated/taintpath_B`：MCP 工具实参面 + 跨文件/跨函数传播 8 条（同时把 C1/C2 纳入盲测覆盖）
- 闸门：`check-taintpath.ts` + `taintpath-expectations.json`，逐函数断言，退出码非 0 即失败
- 覆盖力 **0 → 15 次**；24/24 符合期望；已有 100 个项目 LOST 0 / ADDED 0（总 3086 → 3109）
- 方法学规则 **R7-no-vacuous-gate**：发布前必须确认被测路径真的被走到

### 7.2 C5（已修）：不可信根可以直连 sink

新语料第一条就挖出：`fs.readFileSync("/data/" + req.params.name)` —— 真实 Express
工程最常见的写法 —— **不标记**。根因是 `computeMarkerCalls` 外层要求
`collectTaintedNames` 非空，等于要求污点先落成局部变量。SSRF 侧从不这样。
这是与 G1 同类的「同一条数据流、两套口径」，已修，fr-007 维持 pre 5 / post 0。

### 7.3 C4（未修）：污点经表达式包装后断链

`const p = path.join(ROOT, tainted)` / `path.resolve` / `path.normalize` /
`path.basename` 之后，`p` 不再被算作污点。语料里 4 条记为 known-gap：
`readJoinWrapped` / `readNormalizeWrapped` / `readBasename` / `readResolveOnly`。

代价要记清楚：**N-A「basename 不算守卫」这条结论在盲测语料里演示不了**
（因为包装本身就把流掐断了），它由 `src/extract-ir-taint-guard.test.ts`
里那条「有影传播」的正对照锁住。修 C4 时要重新审视 `basename` 的语义：
它究竟是「包装」还是「净化」——目前当作包装（不免除标记）。

### 7.4 G2（未修，反向）：自定义校验函数的调用点不被抑制

`taintpath_B` 的 `dispatchToolGuarded` 调了 `assertTemplateName(name)`
（该函数体内是字符集白名单校验），**仍被标记**。原因：调用点侧只按
**函数名模式**判守卫，而 `Name` 后缀在修 `ensureDir()` 误判时被整体移出了
守卫后缀表。这是 G1 那次修复的已知代价——收紧了词表，同时失去了对
「名字不含路径语义的自定义校验函数」的识别。

可选修法（未做）：把「被调用方函数体内含校验证据」也作为调用点的守卫证据
（与 G-C 的传播方向相反的一侧）。**风险是会连带压掉真阳性**，须先在
taintpath + 全部 DETECTED 语料上量过再定。

## 五、与 C1–C3 的关系

### 一个必须记下的能力边界

**fr-007 此前被记为 DETECTED，但按现行「post 侧须 0 误报」的标准，它在 G1 之前 post 侧是 5 条。**
G1 上线后才真正成立。这说明语料里的 DETECTED 结论**会随判别力变化而变**，
以后每次改判别逻辑都要把 DETECTED 条目重测一遍——不能当一次性结论存档。

## 五、与 C1–C3 的关系

- **C1/C2/C3 是「看得见」**：管线现在能看见顶层函数、裸调用、非 Express 污点根。
- **G1 是「看得懂」**：看见了之后，能区分有没有做校验。
- 顺序不能倒：先放宽召回（C 组）而不补判别力（G1），等于把误报直接放大 —— 试点 V1 已经把这个代价量过一次了（post 侧多报导致 DETECTED 不成立）。
