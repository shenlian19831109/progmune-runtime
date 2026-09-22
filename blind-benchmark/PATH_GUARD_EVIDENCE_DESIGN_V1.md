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
| **fr-016（Redocly）** | 2026-09-19 **重新启用**：3.7.38 补齐「文档解析产物」根 + sink 形参继承后实测 **pre 5 / post 0**（此前 pre 侧 0 条，仅可作无效控件，见 §三原文）；完整语料见 §六 |
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
| fr-016 Redocly | 3.7.38 起 **✅ pre 5 条 / post 0 条**（此前维持 0/0，根因见 §三被撤回的那行）。pre 命中：`handleSplit` / `iterateAsyncApiChannels` / `iteratePathItems` / `splitOASDefinition` / `writeToFileByExtension`（最后一跳是 `onMethodHit` 反向标记）；post 因新增 `assertWithinDir(dir, file, name)` 归零 |

### 6.1 fr-016 为什么到现在才有信号（两侧同时断）

口径放在这里是因为它差点被误判成「这条路走不通」——pre 侧连续三轮改动
（C4 塑形传播 / G2 调用点抑制 / 补文档解析产物根）都是 0 条，直到把 sink 侧
也补上才动。两侧缺一不可：

- **来源侧**：文档本体由上游 `parseYaml` 解析好后**作为形参**传入
  （`channels: Record<string, any>`），函数体内没有任何解析调用，唯一本地可见
  的入口是 `for (const channelName of Object.keys(channels))` 这次枚举。
  新增根 `runtime_key_enum`（内部注释已标明它是性质较弱的一类根：声明的是
  「名字不是字面量、而是运行时数据结构的产物」，与其他按传输面声明的根不同）。
- **sink 侧**：落盘经 `writeToFileByExtension → writeYaml → fs.writeFileSync`
  两层自有封装，而 `methodSinkParamMap` 原本只登记「形参 → 本函数体内 fs sink」
  的一跳，整层 wrapper 从未入表。

这条已固化为方法学规则 **R10**：补全常年 fail 的语料时，先写最小复现逐段确认
通断，不要只在真实语料上看总数（总数是唯一结果变量，任何一侧断着都等于 0，
没有定位能力）。

> 另一个诚实说明：G-C 的 `Within` 后缀当初是照着 fr-016 的 `assertWithinDir`
> 加的，所以 fr-016 的 post=0 对 **G-C** 而言是同义反复。真正结实的证据是另一条
> 定向用例：把守卫函数改名为不含任何 G-C 后缀的 `stamp`、只保留函数体内的
> `resolve + startsWith(base + sep)`，依然被压制 —— 说明压制依据是被调用方自身的
> 证据（G2 的 tier-0），而不是名字。
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

### 7.4 G2（3.7.37 已修，反向）：自定义校验函数的调用点不被抑制

`taintpath_B` 的 `dispatchToolGuarded` 调了 `assertTemplateName(name)`
（该函数体内是字符集白名单校验），**仍被标记**。原因：调用点侧只按
**函数名模式**判守卫，而 `Name` 后缀在修 `ensureDir()` 误判时被整体移出了
守卫后缀表。这是 G1 那次修复的已知代价——收紧了词表，同时失去了对
「名字不含路径语义的自定义校验函数」的识别。

#### 修法：按被调用方的**实际证据**定案，不按名字猜语义

把 `Name` 加回后缀表是最省事的修法，但那是 G-C 已经付过代价的路
（`ensureDir()` ⇒ fr-007 pre 侧召回归零）。故改为：

1. `pathGuardFunctionNames` 拆成两档：
   - **tier-0 `direct`** —— 函数体自身含校验证据（G1 原语义）；
   - **tier-1+ `all`** —— 再向调用方传播一跳后的集合（推断出来的守卫）。
2. `collectSanitizedExprs(text, direct)`：扫函数体里的调用，凡**被调用方属于
   tier-0**，就把调用实参里的简单取值表达式收进「已净化」集合，编译成判定正则。
3. 判定 sink 时，实参命中污点**但已被净化** ⇒ 不算污点。

#### 三处精度取舍（都比 G1 的函数级 `selfGuarded` 窄）

| 取舍 | 说明 |
|---|---|
| **表达式级，不是函数级** | G1 的 `selfGuarded` 是一个校验词汇压掉整个函数体的所有流；G2 只净化真正被传进守卫调用的那个表达式。同函数体里另一条未校验的流仍会标记（有定向用例锁住） |
| **只认 tier-0** | tier-1 是「推断出来的守卫」，拿推断结果做抑制会把推断误差直接放大成误报消除。代价记为缺口 **G2b**（经项目自有 helper 转手的校验证据不生效） |
| **前缀 `(?:^\|[^\w$.])`** | 净化 `name` 不能连坐 `other.name`。但 `args.name` 要能命中 `path.join(DIR, args.name)` |

#### 风险量测（设计稿当时要求「先在 taintpath + 全部 DETECTED 上量过再定」）

| 门 | 结果 |
|---|---|
| taintpath 闸门 | 24/24（`dispatchToolGuarded` 由 mark 转 suppressed，正对照 `dispatchToolBare` 仍 mark） |
| **fr-007 真实语料** | **pre 5 / post 0 维持** —— 没有压掉真阳性 |
| TS 盲测（102 项目） | **LOST 1 / ADDED 0** —— 唯一变化就是 `dispatchToolGuarded` 本条，其余 3086 条零漂移；`ADDED 0` 说明没有意外新增误报 |
| 覆盖力 | `__progmune_path_traversal__` 19 → 18（精度改进使然，非召回退化） |
| 反向验证 | 回退 v3.7.36 后 G2 的两条正例失败，其余 18 条（含正/负对照）仍绿 |

## 五、与 C1–C3 的关系

### 一个必须记下的能力边界

**fr-007 此前被记为 DETECTED，但按现行「post 侧须 0 误报」的标准，它在 G1 之前 post 侧是 5 条。**
G1 上线后才真正成立。这说明语料里的 DETECTED 结论**会随判别力变化而变**，
以后每次改判别逻辑都要把 DETECTED 条目重测一遍——不能当一次性结论存档。

## 五、与 C1–C3 的关系

- **C1/C2/C3 是「看得见」**：管线现在能看见顶层函数、裸调用、非 Express 污点根。
- **G1 是「看得懂」**：看见了之后，能区分有没有做校验。
- 顺序不能倒：先放宽召回（C 组）而不补判别力（G1），等于把误报直接放大 —— 试点 V1 已经把这个代价量过一次了（post 侧多报导致 DETECTED 不成立）。

## 八、2026-09-19 续：C4 放开后暴露的两处 G-A2 漏判

C4（污点经路径塑形表达式包装后仍传播）落地后，`taintpath_A` 的
`readGuardWithin`、C5 负对照 `readInlineGuarded` 两条**守卫用例**面临翻成误报
的风险。核查后发现：它们在 C4 之前的「不标记」**不是判别力对，而是污点根本没
走到 sink**——R7 的又一种形态。C4 一放开就必须把 G-A2 补上，否则就是真误报。

### G-A2 原形态的两处漏判

| # | 漏判形态 | 例子 | 原因 |
|---|---|---|---|
| ① | 基目录写成**单个标识符** `base` | `target.startsWith(base)` | 原正则 `[A-Za-z_$][\w$]*(?:[Bb]ase\|…)` 要求 base/root/dir 之外还至少有一个前导字符 |
| ② | 基目录写成**字符串字面量** | `target.startsWith("/srv/data")` | 原正则只捕获标识符，字面量形态整体落空 |

### 修订后的判定（先取实参，再定案）

1. 取出 `.startsWith(<arg>)` 的整个实参；
2. 实参里的标识符若「看起来像基目录」→ 守卫。判定 = 以 base/root/dir 结尾
   （大小写、camel、下划线均可），并显式排除 `database` / `codebase` / `base64`
   等**以 base 结尾但与目录无关**的名字；
3. 实参含**绝对路径字面量**（`/…`，长度 > 1）→ 守卫。长度限制是为了排除
   `startsWith("/")`：那只是判「是否绝对路径」，不构成包含性。

### 为什么改成「先取实参 + 代码定案」而不是继续堆正则

单条正则写不出既不全收（`database`）、又不漏 canonical 形态（`base`、字面量）
的判定。`PathGuardRule` 因此新增可选 `decide(text)`：存在时以它为准，`re` 只做
粗筛。这条同样适用于以后任何「按语义而非按词形」判定的守卫形态。

### 与 C4 的先后关系（顺序不能倒）

先补判别力（G-A2 两处）→ 再放召回（C4）。反过来做的话，C4 会把这两条守卫用例
直接打成误报，而误报会被记进语料、被当成真阳性继续放大。

## 九、2026-09-20：C4b 项目自有纯塑形 helper —— 白名单的边界在哪

### 缺口

fr-016 在 3.7.38（补根 + sink 形参继承）之后是 pre 5 / post 0，但
`iterateAsyncApiComponents` / `iterateComponents` 仍然看不见。断点是最后一跳：

```
const filename = getFileNamePath(componentDirPath, componentName, ext);
// getFileNamePath(a, b, c) { return path.join(a, b) + `.${c}`; }
writeToFileByExtension(componentData, filename);
```

`componentName` 已被 `Object.keys` 污染，但 `getFileNamePath` 不在 C4 的塑形词表里。

### 修法：不放宽词表，改为按函数体证明

C4 的 `TS_PATH_SHAPER_RE` 是 node:path 家族 + String 原型方法的**固定清单**，
覆盖不到每个项目自己的封装 —— 往里加名字是打地鼠。改为证明「这个函数只做塑形」：

| # | 判据 | 反例（不能认） |
|---|---|---|
| ① | 有形参、且有带表达式的 `return` | `void` 函数、只写文件的函数 |
| ② | 函数体内**没有**文件 sink | `getFileNamePathWithMkdir`（体内 `fs.mkdirSync`） |
| ③ | return 里所有调用都在塑形白名单，且所有自由标识符都是自己的形参 | `return FIXED_DIR + name`（`FIXED_DIR` 不是形参） |

有界两轮不动点：允许 helper 调已认定的 helper（`buildOutPath → withExt`），不追环。

### R11：helper 侧的证据集必须比内联侧更严

C4 的内联规则把 `.replace/.trim/...` 当塑形（不净化）。若把同一条规则照搬到
helper 上，`sanitizeName(p) { return p.replace(/[^a-z0-9]/gi, ""); }` 就会被判成
「确定不净化」—— 而它恰恰是净化函数的标准写法。

差别在于**可见性**：内联时实参窗口整个看得见；helper 形式看不见，推断的证据等级
天然更低。所以 C4b 的证据集只收 node:path 家族 + 值转换（`String/Number/Boolean`）
+ 已认定的纯塑形 helper，**字符过滤方法不计入**。代价是 `toSlug(p){p.trim().toLowerCase()}`
仍不传播 —— 已知缺口，可见，比不可见的误报便宜。

### 实现坑：正则前瞻会被回溯绕过

最初写的自由标识符检查是 `([A-Za-z_$][\w$]*)(?!\s*\()`，用来「排除调用名」。
对 `withExt(...)`，正则可以**退化**成匹配 `withEx` 让前瞻通过（后面是 `t` 不是
`(`），于是把调用名误判成自由标识符，`getFileNamePath` 永远认不出。
改为**单趟扫描**：逐个标识符看它紧邻的前后字符，`before === "."` 是成员名、
`after === "("` 是调用位（必须落在白名单）、其余必须都是形参。

### 验收

- fr-016：**pre 5 → 7**，新增的两条正是 C4b 目标，且均为真阳性
  （组件名带 `../` 逃出输出目录，即本 CVE 形态）
- post 侧仍 0：新增的 `assertWithinDir(asyncapiDir, filename, componentName)` 是
  tier-0 守卫，由 G2 按被调用方自身证据压制
- 新增盲测 `taintpath_D`（10 条）与定向用例 11 条；闸门 44/44

---

## 十、C4d：高阶枚举方法的回调形参（2026-09-20）

### 缺口：与 for-of 语义等价的另一种写法，整片漏

C4c 之后，`Object.keys(doc)` 的枚举绑定只认 `for (const k of|in …)`。
但同一种数据流还有一半写在**回调**里 —— 探针实测（2026-09-20，8 个最小复现）：

| 形态 | 3.7.39 实测 |
|---|---|
| `for (const k in doc)`（doc 已污） | 已标记 |
| `const ks = Object.keys(doc); for (const k in ks)` | 已标记 |
| `Object.keys(doc).forEach((k) => …)` | **未标记** |
| `Object.keys(doc).map((k) => …)` | **未标记** |
| `Object.entries(doc).forEach(([k, v]) => …)` | **未标记** |
| `const ks = Object.keys(doc); ks.forEach((k) => …)` | **未标记** |
| `["a","b"].forEach((k) => …)`（负对照） | 未标记（正确） |
| 被枚举的是干净变量（负对照） | 未标记（正确） |

**一条需要纠正的记录**：此前备忘写「`for...in` 也不绑定」，实测是错的 ——
`bindFromEnum` 的正则本就是 `(?:of|in)`，for-in 一直是通的。真缺口只有回调。
这条值得单独记：备忘里的「下一步」若未经复现就照着做，会白白改一个已经对的地方。

### 修法：把回调形参并入同一套枚举绑定

`collectTaintedNames` 里新增 `bindFromCallback(receiver)`，接收者两种形态：

- **根形态** `(?:${root})[^()]*\)` —— `Object.keys(doc)` 的实参列表与闭括号由
  `[^()]*\)` 吃掉（root 正则本身只吃到开括号）；
- **变量形态** `(?:^|[^\w$.])(?:${names})` —— 走不动点，与 C4c 同源。

形参取值规则：`[k, v]` 解构两个**都是**元素，都绑；`k, i` 只取第一个
（第二个是索引，绑了就是误报）。`async (k) =>` 前的 `async` 不能挡住匹配。

### 方法表的取舍（只收四个）

只收 `forEach / map / flatMap / filter` —— 形参 = 元素本身、且枚举全部元素。
刻意不收：

- `find / some / every` —— 谓词语义，且常与白名单校验同现，绑进去反而给
  守卫侧喂误报；
- `reduce` —— 第一个形参是累加器不是元素，语义错位。

### R7 第四次：门自身必须有覆盖

实测 generated 全量 .ts 里 `.forEach/.map/.flatMap/.filter` 回调形参 **0 处**
（A–D 族都没有），所以「LOST 0 / ADDED 0」在这项上照样是空过。新增
`taintpath_E`（10 条：6 mark / 1 suppressed / 3 no-taint）：

- `emitForEachGuarded` 用 `stamp`（不含 G-C 后缀）做守卫 —— 召回接通后守卫仍
  压得住，且依据只能是被调用方自身证据（G2 tier-0）；
- `emitForEachIndexOnly` 只把索引 `i` 写进路径 —— 钉死「只绑第一个形参」；
- `emitForEachCleanVar` 根在、回调在、但接收者干净 —— 钉死「看接收者，不是看函数里有没有污点」。

### C4d-b：同一天的第二次修正（三处遗漏 + 一处真实误报）

C4d 落地后立刻用新语料验剩余写法，初版正则有两件事没做对。初版以 `[,)]` 收尾：

| 形态 | 初版 | 现在 |
|---|---|---|
| `forEach(k => …)` 无括号单参 | 漏 | 标记 |
| `forEach(function (k) { … })` ES5 回调 | 漏 | 标记 |
| `doc.sections.forEach((s: any) => …)` | 漏 | 标记 |
| `forEach(handleOne)` 回调是**函数引用** | **误标** | 不标记 |

**误报那条是重点**：正则以 `[,)]` 收尾时，`forEach(handleOne)` 里的 `handleOne`
（别人函数的名字）会被当成形参绑进污点集合，于是同名局部变量随机被判成污点。
E 族用 `emitForEachNamedHandler` 把它钉住：函数体里故意放一个同名的
`const handleOne`（值是字面量路径），若误绑则会立刻产生一条 chargeable false positive。

修法是把**「回调必须内联」**写进正则前提：箭头分支形参后必须见到 `=>`，
ES5 分支必须见到 `function` 关键字，函数引用形态自然落空。

顺带发现形参字符集漏了 `:` —— `(s: any) =>` 这种带类型标注的写法在 TS 工程里是
常态，一个冒号就让整环不匹配。现放行 `: . | < >`（类型标注、联合类型与泛型形参），
`=>` 与 `{ }` 仍不在集合内，函数体不会被吃进来。

### 反向验证做了两次

光「摘掉整个 C4d」不够 —— 那样只能证明 9 条正例依赖它，证明不了那条**误报**负对照
不是空转。所以第二次把 arrow 分支单独退回初版形态（`[,)]` 收尾）：
闸门立刻报 `emitForEachNamedHandler ✗ 不应标记却标记了（no-taint）`，
并顺带复现了冒号问题导致的 `emitMemberChainForEach` 漏报。两条负对照都被验证过真的会红。

---

## 十一、C4e：helper 的现代写法（2026-09-20）

### 缺口：名录是用 `sf.getFunctions()` 扫的，只能拿到【函数声明】

C4b 判据本身没问题（有形参 / 有返回值 / 体内无 sink），问题在**候选的名字从哪来**。
现代 TS 工程里 helper 的主力写法是箭头常量，实测（2026-09-20，13 个最小复现）：

| 写法 | 之前 | 现在 |
|---|---|---|
| `function f(n) { return n + ".md"; }` | 传播 | 传播 |
| `const f = (n) => n + ".md";` 简洁体箭头 | **漏** | 传播 |
| `const f = (n) => { return n + ".md"; };` 块体箭头 | **漏** | 传播 |
| `const f = function (n) { return n + ".md"; };` | **漏** | 传播 |
| return 引用模块级字面量常量 | **漏** | 传播 |
| return 用 path 模块别名 `p.join` | **漏** | 传播 |
| 箭头 → 箭头两跳 | **漏** | 传播 |
| `Util.method(n)` 对象字面量方法 | **漏** | **仍漏**（刻意保留，见下） |

另外两处放宽的边界都是以「出处可确证」为限：

- **模块级字面量常量**：只收初值是 string / number / boolean 字面量的 top-level
  `const`。初值是任意表达式的（`const ROOT = path.resolve(...)`）一律不收 ——
  一旦放开，helper 就能把别处的污点藏在一个常量后面，等于跨函数常量摘要对任意
  数据流发通行证。这条顺便闭合了 D 族登记过的 known-gap `emitHelperFixed`。
- **path 模块别名**：`import * as p` / `import nodePath from "node:path"` /
  `import { join } from "path"` 都能认；只放行 path 模块本身，fs / os 不放
  —— 判据②只扫 sink 调用，覆盖不到「把 IO 藏进 return」这一类。

刻意保留的缺口：`Util.method(n)` 这种对象字面量方法。要支持就得把成员名并入
传播点的匹配集合，而同名的成员方法在别的对象上未必是塑形 —— 按 R11（helper 侧
证据必须比内联侧更严），先不收。

### 探针设计：别把 helper 调用写进 sink 实参

同一个套路第二版才写对。初版写成：

```ts
fs.writeFileSync(outDir + "/" + withExt(k), "x");   // ← 正负对照一次性全 MARK
```

因为 `hasTaintedSinkCall` 有一条兜底：**sink 实参窗口里出现污点名就标**。
`k` 写在实参里，helper 认不认得出都会被标 —— 于是 13 条用例全绿，什么都测不出来。
改成隔离写法才分得出胜负：

```ts
const rel = withExt(k);              // 污点只能经 helper 的返回值进来
fs.writeFileSync(outDir + "/" + rel, "x");
```

这条比 C4e 本身更值得记住：**写最小复现时要先问一句「这个标记还能通过哪条路产生」**，
只要存在旁路，正对照的价值就是零。

### 顺带查明的两件事（不是 bug）

1. 「helper 体内有 sink」的用例会被标记，来自 `methodSinkParamMap` 的跨函数传播：
   helper 的形参确实流进了 sink，判定正确，与它是否被认成纯塑形无关。
2. 备忘里记的 toSlug 缺口（`p.trim().toLowerCase()`）**早就穿透**；`reduce` 首参
   不绑也确认按设计生效 —— R12 再次生效（备忘的「已知」动手前先复现）。

### 遗留的精度边界（下一步）

传播是**名字级**的：`discard(k) { return "fixed.md"; }` 丢弃形参，结果照样被判污染。
要收窄就得做形参-实参位置对齐 + 返回值依赖分析：只有当污点实参落在「return 真的
依赖的那些形参」上时才传播。这是纯精度增量，但会动到传播主体 `taintedViaShaper`，
单独一轮做。

---

## 十二、C4f：名字级传播的精度收窄（2026-09-20）

### 前三轮都在补召回，这一轮反过来收精度

C4b/C4e 把「项目自有的纯塑形 helper」接进传播之后，传播是**名字级**的：
赋值右侧出现污点名、且右侧看起来像塑形 ⇒ 新变量判为污染。它不看
「这个 helper 的返回值到底依不依赖那个实参」。于是：

```ts
const dropParam = (n: string): string => "fixed.md";   // 形参被丢掉
const rel = dropParam(k);                                // k 流不出来，但仍被判污染
```

探针实测（11 个最小复现）确认 6 处误报：

| 形态 | 收窄前 | 语义 |
|---|---|---|
| `dropParam(k)`（return 常量） | 误标 | 依赖集为空 |
| `pickFirst("safe", k)`（只依赖第 1 形参） | 误标 | 位置不对齐 |
| `path.join("out", dropParam(k))` | 误标 | 整行一锅端，该按支路算 |
| `wrapDrop(k)`（= dropParam(n)） | 误标 | 依赖集跨函数传递后为空 |
| `wrapPick("safe", k)` | 误标 | 跨函数位置不对齐 |
| `swapPick(k, "safe")`（= pickFirst(y, x)） | 误标 | 换序后真正被依赖的是 y |

### 修法：形参-实参位置对齐 + 返回值依赖分析

给每个纯塑形 helper 多算一份 `deps` = **返回值真正依赖的形参集**：

1. 取该 helper 的全部 return 表达式；
2. 把其中「已知 helper 调用的不被依赖实参」抹掉（最内层优先，有界 3 轮向外）；
3. 剩下的形参名就是 deps。`wrap(n) { return dropParam(n); }` ⇒ 空集。

调用点同样抹：`dropParam(k)` ⇒ `""`，`pickFirst("safe", k)` ⇒ `("safe")`，
再用抹过的串当污点证据。`shaped`（右侧像不像塑形）仍看原式 —— helper 是不是
塑形，与它的返回值依不依赖实参是两件事，不能互相替代。

依赖分析有**次序依赖**：`wrap` 若在 `dropParam` 之前被接受，那一刻 info 里
还没有后者 ⇒ deps 偏宽。偏宽 = 继续传播 = 保守侧（不会误报），但收不紧。
所以名录定稿后按完整的 info 再算两轮，把次序依赖消掉。

### 换序那条最能说明价值

`swapPick(x, y) { return pickFirst(y, x); }` —— 真正被依赖的是 `y`。
`swapPick("safe", k)` 该标、`swapPick(k, "safe")` 不该标。
只看「实参里有没有污点名」两条都标；只看「形参有没有被用到」两条也都标。
必须按位置穿过一次换序才分得开。

### 门的方向也反过来了

前面四轮 R7 咬的都是「语料零覆盖 ⇒ 门空过」。这一轮最该防的是另外两件事：

- **收窄收过头**，把真阳性也收掉 ⇒ 看 LOST；
- **那批 no-taint 用例其实空转** —— 它们本来就不该标，旧代码也不会让它们红。

新增 `taintpath_G`（12 条：4 mark / 7 no-taint / 1 suppressed）。反向验证按 R14
多切一刀：把依赖分析退回「全部形参都算依赖」（等价于收窄前的老行为），
那 7 条 no-taint 必须立刻转红 —— 否则说明这批对照一条都没咬住。

---

## 十三、C4g：helper 换个载体（2026-09-20）

### 缺口：helper 不一定是函数，也可能是方法

C4e 补了箭头与函数表达式，但 helper 还有一种很常见的载体 —— 方法和类：

```ts
export const Util = { toPath(n: string): string { return n + ".md"; } };   // 对象字面量方法
export class Renderer { inst(n: string): string { return n + ".md"; } }    // 类实例方法
```

C4e 时刻意没做这一路，理由是 R11：按裸名放行，别的对象上的同名方法会被误认成
塑形。这一轮的解法是**限定名 + 唯一性**：

- 宿主名能确定时登记 `Owner.method`，调用点 `Util.toPath(k)` 直接对上；
- 实例方法的主要写法是 `r.inst(k)`（宿主是变量，限定名对不上），所以该方法名在
  **全项目唯一**时，额外允许 `.inst(` 这种成员调用位匹配。唯一性是 R11 的替代品：
  不存在同名方法，就不可能张冠李戴。同名方法出现两次时一律不登记，宁可漏报。

另外两处是顺手补的：解构形参（`function f({ name }) {…}` 的 `getName()` 给的是
整个绑定模式而不是 `name`，要从 BindingElement 里抽）和「三元返回 / 默认参 /
多 return」—— 后三条探针实测**本来就是通的**，备忘里的「依赖分析深层形态」清单
大部分是过期的（R12 第四次生效）。

### 语料里踩到的坑：helper 名字不能撞 sink 名单

H 族第一版把静态方法写成 `Renderer.stat(k)`，闸门全绿。但反向验证「摘掉方法收集」
之后它**仍然标** —— 一查：`stat` 就在 `TS_FILE_SINK_NAMES` 里，调用点被 sink 兜底
直接命中，跟 helper 传播毫无关系。实测 `Other.stat(k)`（接收者根本没定义）、
以及类里压根没有 `stat` 方法，照样标。

这就是 R13 说的旁路，第二次踩到：**写完用例要问「这个标记还能从哪条路产生」**，
这条尤其阴 —— 它让正例「标对了」，但标对的原因完全是另一回事。改名为 `toFile`
之后归因才干净（摘掉方法收集 ⇒ 3 条方法正例全部转漏报）。

### 反向验证四刀（归因）

| 刀 | 改动 | 转红的用例 |
|---|---|---|
| 1 | 摘掉方法候选收集 | emitObjMethod / emitClassInstance / emitClassStatic |
| 2 | 只摘掉成员调用位 `.method(` | emitClassInstance（宿主是变量那条） |
| 3 | 解构形参名提取退回整体文本 | emitDestructured |
| 4 | 关掉 C4f 收窄 | G 族 6 条 + H 族 emitObjMethodDrop |

刀 4 顺带证明了另一件事：C4f 的收窄对新载体同样生效 —— `Drop.fixed(k)`（对象字面量
方法丢弃形参）不是「本来就没人管」的空转对照。

### 刻意不做：常量实参代入

`viaTernaryDrop(n, flag) { return flag ? "fixed.md" : n + ".md"; }` 在
`viaTernaryDrop(k, true)` 下返回的是常量分支，形参不流出 —— 现在仍会被判污染。
要收这条得在调用点做常量传播（把实参字面量代入 return 再重算依赖），属于另一个
量级的改动，且代入出错的代价是漏报。登记为已知缺口。

## 十四、C4h：名录之外的三处收口（2026-09-20）

### 起点：备忘里的三个候选，先过探针（R12 第四次）

| 候选 | 探针实测 | 结论 |
|---|---|---|
| 调用点常量实参代入 | `viaFlag(k, true)` 误标 | 真误报 ⇒ 本轮修（精度侧） |
| 同名方法出现两次 | `u.toPath(k)` 不标 | 真漏报 ⇒ 本轮修（召回侧） |
| 属性承载的箭头 helper | `Util.toPath(k)` 不标 | 真漏报 ⇒ 本轮修（召回侧） |
| （非备忘项，探针顺手挖到） | 方法名唯一但判据不成立 ⇒ 成员调用位照样进名录 | **既有缺陷**，`r.lookup(k)` 误标 |

最后那条是这一轮最值钱的东西，因为它不是备忘里来的：探针顺手测了一句
`class Reg { lookup(n) { return registry[n]; } }`（registry 是模块级**非字面量**
对象 ⇒ 判据③不成立）+ 调用点 `r.lookup(k)`，结果照样 MARKED。根因是 C4g 的代码
在 `consider()` 之后**无条件**把裸名塞进 `memberNames` —— 确证失败了名字还在名录里，
于是「是不是塑形」这道闸门被绕过。

### ① 调用点常量代入：名录级结论 vs 个案形状

名录里的 `deps` 是**跨调用点**的并集 —— 对所有实参形状都成立的最宽结论。个案上
它可能宽得多：

```ts
const viaFlag = (n: string, flag: boolean): string => (flag ? "fixed.md" : n + ".md");
const rel = viaFlag(k, true);   // 本次调用的返回值就是字面量 —— n 位进了函数也出不来
```

按形参位把**字面量实参**代回 return 表达式，试着解掉 cond 可判定的三元，再看还有
哪些形参活着。`stripOuterParens` → `substituteParams` → `foldDecidableTernary`
→ 用现成的 `returnDeps` 重算，**解不出就一律退回名录结论**（实参不是常量、或 cond 代入后算不出真假）。保守侧的
方向在这儿是明确的：折叠出错的代价是**漏报**，所以不确定时就照旧传播。这与 C4b
「认不出就不传播」是同一张表上的两级 —— 收精度时不确定就放松标sipă；放宽召回时不
确定就不传播。

### ② 同名成员多处：把「唯一」换成「全组确证」

旧规则要求方法名全项目唯一才登记 `.method(`。唯一性只是「不可能认错」的**充分
条件**，不是必要条件：同名两处**都被确证**为纯塑形时，同样不可能认错。换成全组
确证后依赖集按形参位取并集（任一个实现在某位会流出，那位就算会流出）。

配套改动：候选登记从「名字」改成 `key / name / group` 三段 —— 同名多处各留一条，
`name` 是确证后才发布的名字。这同时也把上面那个缺陷封掉了：**确证之后**才进名录。

### ③ 属性承载的箭头

```ts
export const Util = { toPath: (n) => n + ".md" };   // 对象字面量属性
Util.toPath = (n) => n + ".md";                     // 后挂上去的属性
```

既不是 `getFunctions()` 也不是 `getVariableDeclarations()` 能扫到的东西，旧名录
一片收不到。现在和方法共用同一张表：限定名用 `ownerQualifier` 沿 owner 链拼
（`NS.path.toName` 能拼到 `NS.path.toName`），裸名同样交给全组确证来发布。

### R13 的变种：假通过也会出现在**定向用例**里

上一节已经记了 H 族的 `Renderer.stat`（blind 语料撞 sink 名单）。同一轮发现 C4g
的**定向用例**也有一个：`Renderer.stat(k)` 那条在 `extract-ir-taint-structural.test.ts`
里同样写着 —— `stat` 在 `TS_FILE_SINK_NAMES` 里，调用点被 sink 兜底直接标中，
于是那条用例从写下来那天起就是绿的，**删掉整段方法收集它照样绿**。改名 `toFile`
后才真的在测 helper 传播。

⇒ R16 原本只约束盲测语料命名，从本轮起同样适用于 fixture：**写用例前先 grep
`TS_FILE_SINK_NAMES`**。这条比 blind 那条更难发现，因为定向用例看起来是"小而干净"的。

### 实现坑两条

1. 整条表达式被括号包住时（`=> (flag ? a : b)`），在第一个顶层 `?` 处切开得到的前缀
   是 `((true)` —— 括号不配对 ⇒ `truthOf` 判不出 ⇒ **折叠静默失效，什么都不收**。
   先跑一遍 `stripOuterParens` 脱掉包住整串的括号。
2. 代入时**别给字面量加括号**。`(true)` 会让 `maskNonDependentArgsOnce` 把实参串误判
   成嵌套调用（它的判据是「实参里还有 `(`」），内层 helper 就永远轮不到被处理 ——
   两跳那条 `wrapFlag(k, true)` 卡在这儿。

### 反向验证四刀（归因）

| 刀 | 改动 | 转红 |
|---|---|---|
| 1 | 关掉调用点折叠 | emitFlagTrue / emitPickMiss / emitFlagNested / emitWrapFlagTrue |
| 2 | 同名合并退回「全项目唯一」 | emitSameNameA / emitSameNameB |
| 3 | 摘掉属性箭头收集 ((d)(e)) | emitPropArrow / emitNestedPropArrow / emitPatchedArrow |
| 4 | 成员名退回「确证之前就登记」 | emitNonShaperMember / emitSameNameRejected |

四刀互不相干，各自只动自己那一组 ⇒ 归因干净。刀 4 是把探针发现的缺陷复现出来的
那一刀，也是它能被钉进语料的理由。

### 验收

- taintpath 闸门 **112/112**（新增 I 族 20 条：11 mark / 8 no-taint / 1 suppressed）
- fr-007 pre 5 / post 0、fr-016 pre 7 / post 0 **均维持**
- 定向用例 **102 passed**（本这一族 21 条：12 正 9 负）
- TS 盲测 109 项目 / perFunction **3165 条**：**LOST 0 / ADDED 11**（全是新增 I 族那
  11 条本该标的），基线 3152 条零漂移
- tsc 零错误

### 仍未做

- getter / computed 属性承载的 helper（`get x() {…}` 无形参，本身也进不了名录；
  带形参的 computed 名 `["to" + "Path"](n)` 认不出宿主，一律不收）
- 同名 helper 的**形参表不一致**时不能按位合并 return 表达式，只保留依赖集并集
  （这是故意的 —— 把 A 的形参名代进 B 的 return 是错的）

---

## 十五、C4i：可判定分支的扩展 + helper 载体的扩展（2026-09-21）

### 起点：备忘只覆盖了一半

备忘挂着两条（getter/computed、常量代入扩展到短路与模板串）。按 R17 先写探针，19 个
形状跑完：真缺口六个，备忘里只有三条对得上，**柯里化与 rest 两条备忘里根本没有**；
而备忘列的 getter 实测**不是缺口**（无形参 ⇒ 判据①本就不成立）。

| 形状 | 实测 | 结论 |
|---|---|---|
| 短路 `\|\|` / `&&` / `??` | `viaOr(k, "fixed.md")` 误标 | 真误报 |
| 模板串内嵌三元 | `viaTpl(k, true)` 误标 | 真误报 |
| 柯里化 `withExt(".md")(k)` | 不标 | 真漏报（备忘未列） |
| namespace 内函数声明 | `P.toPath(k)` 不标 | 真漏报 |
| rest 形参 | `joinAll("out", k)` 不标 | 真漏报（备忘未列） |
| IIFE 定义 / 计算属性名 | 不标 | 真漏报 |
| getter | 不标 | **不是缺口** |

### 精度侧：可判定分支的扩展

短路运算符与三元同形，只是判据从 cond 换成**左操作数的真假**：

```
a || b   左为真  ⇒ 取左（右支根本不执行）
a && b   左为真  ⇒ 取右
a ?? b   左非空  ⇒ 取左
```

只认**最左边**的顶层运算符（JS 求值从左到右，且 `??` 与 `\|\|`/`&&` 混用必须加括号，
加了括号就不是顶层了）。`??` 的判据是「非空」不是「真」，两套语义分开实现
（`notNullish` vs `truthOf`）。

模板串的 `${...}` 是独立表达式：`` `${flag ? "fixed" : n}.md` `` 里的三元，折叠必须能
进去 —— 现代代码里这种写法比裸三元更常见。

### 召回侧：四个新载体

**柯里化。** `withExt(ext)(n)` 真正塑形的是被返回出来的**内层**函数。收集时识别
「return 箭头 / 函数表达式」，三条判据落在内层（形参集 = 两层并集）；调用点把
`NAME(a)(b)` 按两层实参代入后**原地摊开**：

```
withExt(".md")(k)   ⇒   k + ".md"
withExt(k)("name")  ⇒   "name" + k
dropExt(".md")(k)   ⇒   "fixed.md"      ← 丢形参的内层摊开后是常量 ⇒ 自然不传播
```

摊开后的串直接参与污点检测，C4f/C4h 的收窄机制不用改就能接上。外层名也照常发布
（闭包会捕获外层实参，`const g = withExt(k)` 同样是污的），`rets` 留空 ⇒ 调用点折叠
自动退回「全部依赖」。

**namespace。** `sf.getFunctions()` 取不到 namespace 里的函数 ⇒ 改遍历声明节点。只收
顶层 / namespace 链上的：函数体内嵌套声明的作用域与调用点不同，按同一裸名发布会
张冠李戴。限定名 `P.toPath` 与裸名同时登记是安全的 —— `takenNames` 先到先得，一个
名字只会落到一处定义上。

**rest 形参。** 它吃掉的是**一批**实参，不是一位。原先按位对齐会把第二位当成「越界」
抹掉：`joinAll("out", k)` 的 `k` 被当成多余的实参丢掉 ⇒ 漏报。现在 rest 位吃掉末尾
所有位，且常量代入时**跳过** rest 位（代单个实参进去是错的）。

**IIFE / 计算属性名。** `(() => (n) => …)()` 的初值是调用不是箭头，真正的 helper 在
返回值里（declText 仍取整条 IIFE ⇒ sink 检查照旧覆盖）。`{ [KEY]: (n) => … }` 的属性名
只有 KEY 是**模块级字面量常量**时才解 —— 解不出就不登记，与「看不见就不传播」同一条
政策。

### 又一条「用例自己写错了」

初版把「属性名算不出来」的 `DynBox` 和同名可解的 `Box` 放进同一个项目，期望 unmarked
却实测 mark。机制没错：成员调用位 `.name(` 的匹配**本就与宿主无关**（C4g 的保守策略），
`Box.toPath` 登记之后 `DynBox.toPath` 必然被顺带命中。

⇒ 写负对照前必须先确认「不标」到底是因为**哪一个机制**不成立，否则测的是别的机制。

### 实现坑三条

1. **`substituteParams` 把模板串整段跳过了** —— 折叠逻辑写对了也没用，`${flag ? …}` 里
   的 flag 根本没被代进去。模板串要按 `${}` 逐段递归代入，字面量部分照抄。
2. **ts-morph 的两层包装**：`namespace P {…}` 里函数的父节点是 **ModuleBlock**
   （ModuleDeclaration 在上一层）；`(() => (n) => …)()` 里被括号包住的不止内层箭头，
   连 callee 都是 `ParenthesizedExpression`。两处都得脱（`unparen`）。
3. 生成器里模板串内写 `${}` / 反引号要转义，否则 esbuild 的报错指向**文件末尾**，
   很容易误判成别处的语法错。

### 反向验证（五刀 + 两处单独退回）

| 刀 | 改动 | 转红 |
|---|---|---|
| 1 | `topLevelLogical` 恒返回 null | emitOrTakeLeft / emitAndTakeLeft / emitNullishTakeLeft |
| 2 | `foldTemplateSubsts` 恒返回原串 | emitTplConst |
| 3 | `currySpecOf` 恒返回 null | emitCurrySecond / emitCurryFirst / emitCurryFn |
| 4 | namespace 不发限定名 | emitNsPath |
| 5 | `paramIndexOf` 退回按位 | emitRestJoin |

IIFE 解包与计算属性名各自退回时只转自己那一条（`emitIifePath` / `emitComputed`）。
七处互不相干 ⇒ 归因干净。

### 验收

- taintpath 闸门 **138/138**（新增 J 族 26 条：13 mark / 12 no-taint / 1 suppressed）
- fr-007 pre 5 / post 0、fr-016 pre 7 / post 0 **均维持**
- 定向用例 **204 passed / 6 文件**（C4i 组 26 条：11 正 15 负）
- TS 盲测：见 CHANGELOG 3.7.45
- tsc 零错误

### 仍未做

- getter / computed 属性里**带形参**的 helper（`get f() { return (n) => … }`）—— 柯里化
  那套机制理论上能覆盖，但 getter 本身的收集路径还没开
- 短路折叠目前只认**字面量**左值：`a || b` 里 a 是 `x === 1` 这种可判定表达式时仍判
  不出（退回保守）
- 柯里化只做两跳；三跳 `f(a)(b)(c)` 与「返回对象再取方法」的形状尚未支持

## 十六、C4j：载体收口的最后一批 + 一处既有缺陷的回归门（2026-09-21）

### 起点：备忘四条 + R17 额外七条形状

C4i 遗留的备忘候选：① getter / computed 属性里**带形参**的 helper；② 短路折叠的左值是
**可判定表达式**（`x === 1 || b`）；③ 柯里化三跳与「返回对象再取方法」；④ 柯里化名被
别处同名占用时整条不展。按 R17，先写探针复现；同时塞进七条「没人提过但看着差不多」的
形状：默认参数、可选参数、`as` / `satisfies` 断言、泛型箭头、`switch` 分支、`if` 早返回、
`export default` 匿名箭头。

三轮探针：第一轮 24 条（覆盖面）→ 四个 DIFF；第二轮 17 条（**防修过头**的边界）→ 一个
DIFF；第三轮 6 条（默认导出补真 import）→ 一个 DIFF。

### 本轮真缺口六条

| 形状 | 旧行为 | 机制 |
|---|---|---|
| `typeof m === "string" \|\| n + ".md"` | 整条 helper 落选 | 旧代码把 `typeof` 当**未知自由标识符** ⇒ 判据不通过 |
| `((n) => …) as Fn` / `satisfies` / `<Fn>(…)` | 不收 | 初值不是箭头，是**断言表达式**；成员位同理 |
| `get mk() { return (n) => … }` | 不收 | getter 没有形参，`getFunctions()` 那条路取不到 |
| `lvl3("a")("b")(k)` 三/四跳 | 不展 | 旧机制只吃**两跳** |
| `factory(".md").toPath(k)` | 不展 | 真正塑形的是**返回对象里的成员方法** |
| `export default (n) => …` | 收不到 | 匿名默认导出**没有名字**可登记 |

### 六条的实现

**运算符关键字。** `typeof` / `void` / `in` / `instanceof` 是运算符不是自由标识符，出现在
return 表达式里不该让整条 helper 落选。**只放行运算符**，`this` / `super` 不放行 —— 它们
指向宿主状态，放行等于给「返回值依赖 this」的假塑形开口子。

**断言解包（`unwrapFns`）。** 一个位置解一层不够：`((n) => n + ".md") as any` 是
AsExpression，`satisfies` 与 `<T>` 类型断言是另两种节点。统一走一个解包函数，**变量声明位、
属性位、调用点 callee、返回位**都要用它 —— `get mk() { return ((n) => …) as Fn }` 就是
"返回位没解"漏出来的。

**getter 返回的箭头。** 按 `GetAccessor` 单独收：getter 自己的形参表是空的，但它**返回的
函数**有形参 —— 判据要落在返回出来的那一层，与柯里化同一条路。

**柯里化推广成「跳链」。** C4i 的 `CurrySpec` 是「外层 + 一层内层」，写死了两跳。现在改成

```
CurryHop = { kind: "call" | "member", name, params }
CurrySpec = { outerParams, hops: CurryHop[], allParams, rets }
```

- `lvl3 = (a) => (b) => (n) => n + a + b` ⇒ `outerParams=[a]`，`hops=[call[b], call[n]]`
- `factory = (ext) => ({ toPath: (n) => n + ext })` ⇒ `hops=[member toPath [n]]`

调用点 `expandCurried` 从「两层实参代入」改成**逐跳消费**：跳数不设死上限（爬取有界 4 层），
首跳实参落在外层形参上 —— 所以 `lvl3(k)("a")("b")` 与 `lvl3("a")("b")(k)` 都要对。第一跳
实参被闭包一路捕获，这一点由 `allParams`（所有层次形参的并集）参与判据来保证。

**工厂形态 = 一个名字多条链。** `factory` 返回对象字面量，每个成员方法一条链，按**成员名**
选链：`makeMixed(".md").mix(k)` 走 `mix` 那条、`.skip(k)` 走 `skip` 那条。脏链（返回常量、
体内有 sink）**单独剔掉**，不许污染同名的另一条 —— 这是「张冠李戴」在链层面的复现，
用例 ⑤ 的两条正负对照就是为它写的。

**匿名默认导出。** `export default (n) => …` 没名字，名字只能用**导入方**起的本地名
（`import toPath from "./helpers"` ⇒ 以 `toPath` 发布）。没有 import 就无从登记，界内。

### 一条既有缺陷的回归门：C4h-② 的洞

C4h 把「同名成员唯一才登记」换成「全组确证」。但当时只把**通过判据**的实现算进组：判据
不成立的实现（无形参、体内有 sink）**没进组** ⇒ 组看起来「全组确证」⇒ 成员调用位放行 ⇒
误标。探针 B4/B6 实测挖到：

```
同名三处：
  get mk() { return () => "fixed.md" }            ⇒ 判据①不成立（无形参）
  get mk() { return (n) => n + ".md" }            ⇒ 确证
  get mk() { return (n) => { fs.writeFileSync(n) } }  ⇒ 判据③不成立（体内有 sink）
后两处进组、第一处没进 ⇒ 组"干净"⇒ .mk( 放行 ⇒ ONoParam.mk(k) 被误标
```

修法：`noteUnaccepted` —— **失败的实现也记进组**（记 key + group，不记进候选）。组一脏，
整组不放行。

⇒ 教训：**「全组」的分母必须包含被判据拒掉的那些**，否则「全组确证」会退化成「通过者
全体确证」。用例 ⑦ 的两条（`ONoParam.mk` / `OWithSink.mk`）是它的回归门。

### 又一条「探针期望写错」（第二次）

- **F9a**：探针忘了写 import。匿名默认导出的名字只能来自导入它的文件，两个文件之间没有
  import 就无从登记 —— 期望本身不可达。第三轮补上真 import 后通过。
- **F9f**：期望 unmarked，实测 mark。查清后是**期望写错**，不是误报：`(0, (n) => n + ".md")(k)`
  里那个**内联匿名箭头自己就是塑形函数**，与默认导出无关 —— 把 `helpers.ts` 整个删掉照样标。
  它被标是保守侧的正常行为。

⇒ 两条都不是机制错，是**预测错**。写期望前先问：这条标/不标，到底由**哪一个机制**决定
（C4i 那次是"哪个机制不成立"，这次是"哪个机制成立了"）。

### 三条「看着像缺口、这轮**故意**不修」的边界

都退回保守侧，探针里留着（F5 / F7 / A6 / F12）：

- `switch` 分支 / `if` 早返回的返回值取**并集** ⇒ 常量分支与污点分支混在一起，判不出。
- `x != null` 这类**比较式**左值不折（只折可代入出常量的字面量/变量）。
- 标识符位「先声明后赋值」（`let f; f = (n) => …`）不收 —— 只收属性位的后挂赋值。

这三条不是漏，是「判不出就退回保守」换来的固有代价；真要收，得让调用点折叠长出手臂
（按分支路径分别代入），那是另一轮的量级。

### 反向验证七刀（归因）

每刀只把一个机制退回**旧行为**（R18：不许 `return null` 逼停，否则会连累无关用例）：

| 刀 | 改动 | 转红 |
|---|---|---|
| 1 | 关掉运算符关键字放行（`typeof` 又被当自由标识符） | emitKw |
| 2 | 摘掉 getter 收集 | emitGetterCls / emitGetterObj |
| 3 | 断言解包退回只脱括号 | emitAs / emitAsSat / emitAsMember |
| 4 | 柯里化退回两跳语义 | emitCurry3 / emitCurry4 / emitCurryFirst |
| 5 | 工厂形态不登记（只认返回函数） | emitFactory / emitFactoryMix |
| 6 | 摘掉匿名默认导出收集 | emitDefault |
| 7 | 成员组退回「判据失败不进组」 | 定向用例 回归·⑦ 两条 |

闸门 160/160、定向用例 C4j 组的其余 21 条全程不动 ⇒ 七处互不相干，归因干净。

### 载体收口完成

至此 helper 载体清单：函数声明 / 变量箭头 / 属性箭头 / 后挂属性 / 类方法 / 对象方法 /
namespace 函数 / IIFE / computed 属性名 / getter / 工厂形态 / 匿名默认导出 / 柯里化（任意跳）。

**再往下的收益不在这条轴上。** 剩下的是上面那三条边界，属精度取舍；下一轮该换轴，比如
「字面量实参代入」的对手形态（多分支返回值），或者回到真实语料找新形状。

## 十七、C4k 寻址轮：成员 / 容器承载轴 —— 结论是不修（2026-09-21）

这一轮**没有改判别逻辑**，只做寻址：从真实代码反查形状 → 探针复现 → 量化收益 → 判定。
结果是**否掉了整条轴**，把结论记在这里，免得以后重来一遍。

### 起点：真实代码里的路径大多是「上游算好的裸标识符」

`mine-path-shapes.py` 在 fr-016 pre / fr-007 pre / demo-realworld 上跑（219 个 .ts、48 处 sink）：

| 实参形态 | 次数 | 占比 |
|---|---|---|
| 裸标识符（局部变量 / 成员） | 34 | 71% |
| `dirname()` + helper | 5 | |
| helper 调用 | 3 | |
| `join()` + helper | 2 | |
| 下标取值 | 2 | |

而 C4a–C4j 十轮做的几乎全是「调用点就地折叠」。由此提出三个候选形状：构造函数里
`this.x = <shaping>`、`{ path: <shaping> }` 对象成员、跨函数返回值传播。

### 口径澄清（本轮最大的坑，写探针前必须先确认）

探针第一轮 16 条跑出 7 条 DIFF，其中 **4 条是我期望写错**——把「塑形」理解成了
「路径被规整过（加了 `.md` 后缀、走了 `join`）」。实际判据是：

> **no-taint 的判据是「helper 把形参丢了 / 返回值不依赖污点形参」，不是「路径看起来被规整了」。**

`const rel = k + ".md"` 里 k 照样流得出来（`../../../etc/passwd.md` 照样穿越），
**标才是正确的**。这是第三次在探针期望上栽同一类跟头（C4j 两次 + 本轮一次），
已升为方法学规则 **R21**。

### 真正确认的缺口：成员 / 容器位不传播

修正口径之后，剩下的 DIFF 指向同一个机制：

| 形状 | 实测 | 期望 |
|---|---|---|
| 对象字面量就地初始化 + 直接读属性 `f.path` | mark | mark ✓（**已传播**） |
| class 构造函数 `this.p = <污>` → `o.p` | no-taint | mark ✗ 漏报 |
| 后挂属性 `f.path = <污>` → `f.path` | no-taint | mark ✗ 漏报 |
| 解构 `const { path: p } = f` → `p` | no-taint | mark ✗ 漏报 |
| `arr.push(<污>)` → `arr[0]` | no-taint | mark ✗ 漏报 |
| `m.set("p", <污>)` → `m.get("p")` | no-taint | mark ✗ 漏报 |

即：**容器被「就地初始化」时污点会跟着走，被「属性写入 / push / set」时不会。**

### 第二轮：防修过头的负对照清单（12 条）

要把上面补上，就得让「属性写入 → 容器」变污。先列清实现后必须**仍为 no-taint**的形状：

常量写成员、写入后被常量覆盖（流敏感）、两个对象同名属性（对象身份）、读的是另一个属性、
跨函数写属性、数组 push 常量、Map.set 常量、成员经丢弃形参的 shaper、成员链 `o.a.b`、
写入发生在 sink 之后、`path.basename` 净化。

当前代码下 12 条里 11 条 no-taint（`arr[k]` 下标带污点直接标，属保守侧，正确）。
其中**「写入后被常量覆盖」与「两个对象同名属性」要求流敏感 + 对象身份**——这两条是不做
就必然误标，做了就是另一套量级的活。

### 量化：收益上限 0

`mine-member-carriers.py`（本轮新增）在同一批真实语料上回答「做出来能拿到多少」：

- 48 处 sink 里成员读取 8（17%）、下标 2（4%）
- 能追到对应属性写入的只有 **4 处**，且**全部是 redocly `oauth-client.ts` 的
  `this.credentialsFile*Path`，RHS 是常量** `path.join(homeDirPath, '.redocly')`
- **收益上限 = 0 处，风险为正**：真做出来，先标的就是这 4 处常量路径（纯 FP）

⇒ **判定：不修。** 收益 0、成本要流敏感/对象身份、且会让现有 4 处常量路径转 FP。

> 样本强度提示：以上基于 219 文件 / 48 sink。样本量有限，换更大的真实语料应重跑
> `mine-member-carriers.py` 再下结论。

### 本轮副产物

- `blind-benchmark/mine-member-carriers.py`：新增的可复用量化工具（姊妹脚本：
  `mine-path-shapes.py` 答「长什么样」，它答「做出来拿多少」）
- 方法学规则 **R21**：扩召回之前，先在真实语料上量化收益上限；上限为 0 就别动——
  这一条在本轮省下的是「实现 + 七刀反向验证 + 全量盲测」的一整轮。

## 十八、E1：类方法的真实调用必须进 IR —— 提取器主干（2026-09-21）

> **命名说明**：C4k 已被 §十七 占用（容器承载轴，实测收益上限 0 ⇒ 不修）。
> 本轮动的是**提取器主干**，另开 E（Extractor）系列，避免以后翻账混淆。
> 两条轴完全不同：C4k 问「污点能不能穿过容器」，E1 问「类方法的调用序列能不能被喂给状态机」。

### 问题：类方法分支从来没接上真实调用提取

主 IR 循环里，函数声明 / 箭头 / 包装箭头三个载体都是**两行齐全**：

```ts
const xCalls = extractDirectCalls(node, text);                 // 真实调用名
xCalls.push(...computeMarkerCalls(text, params, ...));         // __progmune_* 语义标记
```

类方法分支只有第二行。**`extractDirectCalls` 从未对类方法调用过** ⇒ 类方法的 `calls`
里永远只有标记、没有真实调用。

历史事实（Claude 补充）：修 A1 时类方法提取循环里写死的就是 `calls: []`，A1 只是在给方法
条目挂标记时动过这个数组，基础的调用提取从来没补。**自该功能诞生之日起就空转。**

**为什么不早暴露**：taintpath 十一族语料**全是函数载体**，没有一个类方法 —— 与 3.7.31 的
P0 同条教训（新增能力必须配能真正触发它的 fixture），这次缺的是**载体形态**。

### 影响：状态机在 OO 代码上没有输入

这是**双向**的，且打在主干上：

- **误报**：没有 calls 来证伪 ⇒ 规则退化成**靠函数名猜**。`createApp` 里 Fastify 的
  `register`（插件注册）被当成「用户注册」；`createDatabaseConnection` 的 `create` 被当成
  「内容创建」。池里 54 条违规中 28 条（52%）所在函数 calls 为空。
- **漏报**：真违规同样检不出。**协议状态机在 OO 代码上等于关闭** —— 它要的「调用序列」
  根本没被喂进去。真实语料 `protocol=0`、引擎自扫「0 误报」、NestJS 语料过分干净，
  三件悬案一并解释：**裁判一直没拿到证据**。

### 修复与边界

修复：类方法分支补 `extractDirectCalls(m, mText)`（形参加 `MethodDeclaration`，遍历逻辑
无需改动），顺序与既有三个载体一致。

探针 18 条（`probe-cls-calls.ts`）→ 修复后 12 条转 PASS。**三条不修**，明确登记避免重踩：

| 形态 | 性质 | 为什么不在本轮 |
|---|---|---|
| getter / setter / 构造函数体 / 对象字面量方法 / 类表达式 | **条目压根不在 IR**（载体未收集） | 另一类缺陷。新增条目 = 新增检测面，风险量级不同；与本轮混在一起**反向验证无法归因** |
| 嵌套箭头回调里的调用 | 既有设计（`traversal.skip()`） | 实测函数声明 / 箭头 / 类方法三者口径完全一致（都只提得到 `setTimeout`） |
| 计算属性名的名字解算（`C.[K]`） | 名字层问题 | 不影响 calls；名字解算是另一条轴 |

### FP 观测池：把「裁判拿到证据」量化出来

| 读数 | 修复前 | 修复后 |
|---|---|---|
| 空 calls 函数 | 140 / 197（71%） | 23 / 197（**12%**） |
| 其中类方法空转 | 126 | 9 |
| NestJS 切片 | 59 / 61 | 3 / 61 |
| Express 切片 | 76 / 113 | 15 / 113 |

**代价**：项目级 safeguard 19 → 21，但 **perFunction 新增 18 条** —— 类方法第一次有了
calls，规则第一次看见这些序列（Claude 预警的「规则侧第一次实战」应验了）。
逐条判定：**FP 15 / 弱真 3 / 真漏洞 0**。

### 留给下一轮的规则侧校准线索（4 条，全部来自真实调用）

1. **迁移 / 种子脚本应豁免**：`createTable` / `dropTable` / `createForeignKey` /
   `createEntityManager + save` —— 6 条 FP 全来自这一类。它们不处理用户输入。
2. **TypeORM query builder 链被 Input Validation 误判**：
   `createQueryBuilder / where / andWhere / getMany` —— 4 条 FP。查询构造不是「缺校验」的证据。
3. **内部工具方法不应被要求 Authorization**：`generateJWT`（只做 `jwt.sign`）被判
   Unauthenticated Access / Mutation —— 2 条 FP。
4. **`validate` 已存在却仍报 Input Validation**：`UserService.create` 的 calls 里**有**
   `validate`（class-validator）⇒ 不是缺校验，是**词表不认** class-validator 的 `validate`。
   这一条其实属于 C4 系列熟面孔（词表 vs 数据流语义），但第一次在真实调用上撞见。

> 这四条是**精度侧**的活。按 R21，动手前先量化收益上限：这 18 条里有多少条同类形态
> 能在更大的池上复现，再决定值不值得做。

### 验收

闸门 160/160；fr-007 pre 5→post 0、fr-016 pre 7→post 0 均维持；定向用例 241 passed / 6 文件
（新增 E1 组 14 条：10 正 + 2 正对照 + 2 负对照）；TS 盲测 111 项目 / 3201 条
**LOST 0 / ADDED 0**；反向验证三刀残留 0；tsc 零错误。

**盲测的 LOST 0 / ADDED 0 要正确解读**：不是「改动无影响所以安全」，而是
**闸门判据对该轴不敏感**。注意措辞要准（2026-09-21 Claude 核查后更正初版）：
generated 语料里**并非没有类**——`taintpath_B/src/store.ts` 1 个、
`taintpath_H/src/helpers.ts` 1 个、`taintpath_I/src/helpers.ts` 8 个、
`taintpath_K/src/helpers.ts` 1 个，共 11 个（就是 C4g/C4h 的 helper 载体夹具）。
真正的原因是：taintpath 闸门只比对 `calls` 里**是否出现 `__progmune_path_traversal__`
标记**，而类方法的标记在 E1 之前就由 `computeMarkerCalls` 正常产出了；E1 补的是
`calls` 里的**真实调用名**，这道门根本不看它。反向验证刀③（摘掉类方法标记后闸门仍
160/160）是空过的铁证。本轮真正的证据在 FP 池与定向用例。

---

## 十九、R21 量化：规则侧校准的收益上限（2026-09-21）

### 起因：线索清单是从**有偏样本**里归纳的

§十八 留下的四条「规则侧校准线索」全部来自 **18 条新增**违规。但全池共有 **72 条**
（56 个函数 / 4 个切片）——新增只占 25%，而且分布不一样：

| 规则 | 新增 18 条里 | 全池 72 条里 |
|---|---|---|
| Input Validation | 10（56%） | 25（**34.7%**） |
| Data Mutation Without Audit Trail | 4（22%） | 26（**36.1%**） |

⇒ 从「新增」归纳会**高估输入校验类、低估审计轨迹类**。四条线索漏项几乎是必然的。

### 方法：从全量违规里量，不靠印象

新建 `blind-benchmark/fp-pool-attrib.py`：读 `reports/fp-pool-results.json`，对每条
perFunction 违规按**可审计的启发式**打标，算出每条候选机制的**收益上限**。
口径声明：启发式**偏乐观**，给的是上限不是实际收益；每条线索的**反面风险**
（过度抑制 ⇒ 漏报）写在脚本的 `LEADS[*].risk` 里，不在数字里。

打标后，未归因违规从 27 条（37.5%）降到 **7 条（9.7%）**。

### 结果（全池 72 条）

| 线索 | 命中(含重叠) | 独占 | 上限占比 | 反面风险 | 处置建议 |
|---|---:|---:|---:|---|---|
| **L4 审计轨迹需前置条件** | 26 | 22 | **36.1%** | 中：审计设施可能叫 logger/history/event，探测不到就误抑制 | **最大项，先写探针再动** |
| **L7 工厂装配函数不是「内容创建」** | 14 | 14 | **19.4%** | 中：真创建（`UserService.create`）与工厂同名 | 暂缓（见下） |
| L1 迁移 / 种子脚本豁免（原①） | 9 | 5 | 12.5% | 低 | **先做** |
| L3 部署运维层降级为建议级 | 7 | 7 | 9.7% | 低：本就不是代码缺陷 | **先做** |
| **L8 `register` 词义歧义** | 6 | 6 | **8.3%** | 低：插件注册 vs 用户注册 | **先做** |
| L2 ORM 查询构造链（原②） | 4 | 3 | 5.6% | 中偏高：limit/offset 可能真来自用户输入 | 暂缓 |
| L6 内部 / 私有工具方法（原③） | 3 | 3 | 4.2% | 中：私有方法也可能真做鉴权 | 暂缓 |
| L5 校验器词表缺口（原④） | 1 | 0 | 1.4% | 低：补词表纯增益 | 顺手 |
| 无任何线索命中 | 7 | — | 9.7% | — | 逐条人工看 |

**原四条（L1/L2/L5/L6）合计命中 17 条 = 23.6%；新发现的四项（L4/L7/L8/L3）合计 53 条
= 73.6%。** 单是 L4 一项（36.1%）就比原四条加起来还多。

### 三条新增线索的具体内容

- **L4**：「改数据没写审计日志」应是【工程内已有审计设施】才报。全工程无审计设施 =
  **能力缺失**，不是代码缺陷（与 TLS / rate limit 同类，属建议级）。
  可行性证据：4 个切片里 `grep -i audit` **零命中** ⇒ 加这个前置条件，26 条全抑制。
- **L7**：`create*` / `make*` / `build*` / `*Loader` 是**工厂与装配函数**（`createApp`、
  `createS3`、`createDatabaseConnection`、`expressLoader`…），被 Input Validation 当成
  「创建了内容却没校验输入」。
- **L8**：`register` 在 Fastify/Express 里是「注册插件 / 路由」，被当成「用户注册」，
  触发 Password Hashing（×2）+ Registration Without Email Verification。
  一个词造成 `createApp` / `turboRemoteCache` 两个函数各 3 条 FP。

### 为什么 L7 暂缓（R21 的反面一问）

L7 与 L2 的**正确判据其实不是名字**，是「这个函数是否真的接收外部输入」——
真创建（`UserService.create`）和工厂（`createS3`）同名，光看名字分不开。要分开就得有
**入口可达性 / 污点根可达性**，那是另一个量级的成本；按 R21「收益要按成本打折」，
L7 的 19.4% 不能按面值算。

同一条判据也能解 L2（读查询的分页参数）。⇒ **L7 + L2 应该合成一件事做**，不要分两次打补丁。

### 建议顺序（低风险先做，大的先探针）

1. **L8 → L1 → L3 → L5**（合计约 23 条 / 32%，全是低风险，且互不重叠）
2. **L4 单列一轮**：先写「审计设施探测器」探针，验证 26 条是否真能靠它区分
3. **L7 + L2 合成一轮**（需要外部输入可达性，量级更大）
4. L6 视前几轮的语料表现再定

### 本轮工具与事故

- 新增 `blind-benchmark/fp-pool-fetch.py`：codeload → 切片（砍 >400KB 文件、
  排除测试与 `.d.ts`、支持 `--prefix` 切 monorepo 子包、自动补根 `tsconfig.json`）。
- 新增 `blind-benchmark/fp-pool-attrib.py`：R21 的量尺（上面那张表就是它出的）。
- **事故**：单切片扫描失败（`docmost` 缺根 `tsconfig.json`）→ `fp-pool-scan.ts` 仍照常
  `writeFileSync`，把整份 `fp-pool-results.json` **覆盖成空**，此前的人工判定全丢。
  已修两道保险：① 写盘前备份 `.prev.json`；② 只扫一片时**并入**既有结果而非覆盖。
  已重扫恢复（4 切片 / 197 文件 / safeguard 21，读数与事故前一致）。

### 扩池后的复核：线索上限**不稳定**，池还没饱和（重要）

加进第 5 个切片 `verdaccio`（Express 中间件风格，函数式 + 回调，与既有 4 片的
NestJS/TypeORM/类形态完全不同）后，全池从 **72 条 → 198 条**（139 个函数），
上面那张表的**每一项占比都大幅缩水**：

| 线索 | 4 切片（72 条） | 5 切片（198 条） | 漂移 |
|---|---:|---:|---|
| L4 审计轨迹 | 36.1% | **20.2%** | −15.9 |
| L7 工厂装配 | 19.4% | **10.1%** | −9.3 |
| L1 迁移 / 种子 | 12.5% | **4.5%** | −8.0 |
| L8 `register` | 8.3% | 6.1% | −2.2 |
| L2 ORM 链 | 5.6% | 2.0% | −3.6 |
| L5 validate | 1.4% | 0.5% | −0.9 |
| **未归因** | 9.7% | **37.4%** | **+27.7** |

新增的两条线索（都由 verdaccio 带出来）：

- **L9 Express 中间件不是业务端点**（24 条 / 12.1%）：`(req,res,next)` 中间件被当成
  认证 / 会话主体，报 Session No Timeout、Input Validation。
- **L10 框架 ACL 词表缺口**（8 条 / 4.0%）：verdaccio 的 `allow` / `can` / `deny`
  **就是**它的 ACL，规则不认 ⇒ **有鉴权却报「未鉴权 / 缺归属检查」**（词表缺口的又一例）。

**结论：现在还不能开始规则侧校准。** 一张切片就让最大项从 36% 掉到 20%、未归因从 10%
涨到 37%，说明池远未饱和——此时排出来的优先级，换一批语料就会重排（这正是 R24 的失败
模式，只是发生在更高一层）。⇒ 升 **R25：先扩到饱和，再排序**。

饱和判据（可执行）：连续加 2 个切片后，① 各线索占比变化 **< 5 个百分点**，且
② **未归因比例不再上升**（说明新语料带来的都是已见过的形态）。当前未归因仍在涨，
远未达标。

verdaccio 这片的另一个信号：空 calls 42 / 249（17%），其中「类方法」24 —— 比 E1 修复后的
NestJS 片（3/61）高，需要回头看是不是**类方法之外**的载体又漏了（例如 `Auth.authenticate`
这类对象方法）。这是 E1 之后的新疑点，列进下一轮。

#### 第 6 片（docmost，NestJS + 文件上传）并入后再复核：仍未饱和

全池 **367 条违规 / 229 个函数 / 6 切片**。三次读数的漂移：

| 线索 | 4 片(72) | 5 片(198) | 6 片(367) | 5→6 漂移 | <5pp? |
|---|---:|---:|---:|---:|---|
| L4 审计轨迹 | 36.1% | 20.2% | **21.5%** | +1.3 | ✓ |
| L9 Express 中间件 | — | 12.1% | 6.5% | −5.6 | ✗ |
| L6 内部 / 私有工具 | 4.2% | 4.0% | **10.4%** | **+6.4** | ✗ |
| L7 工厂装配 | 19.4% | 10.1% | 7.6% | −2.5 | ✓ |
| L3 部署运维层 | 9.7% | 6.6% | 4.4% | −2.2 | ✓ |
| L8 `register` | 8.3% | 6.1% | 3.3% | −2.8 | ✓ |
| L1 迁移 / 种子 | 12.5% | 4.5% | 2.5% | −2.0 | ✓ |
| L10 框架 ACL | — | 4.0% | 2.2% | −1.8 | ✓ |
| L2 ORM 链 | 5.6% | 2.0% | 1.1% | −0.9 | ✓ |
| L5 validate | 1.4% | 0.5% | 0.3% | −0.2 | ✓ |
| **未归因** | 9.7% | 37.4% | **44.4%** | **+7.0** | ✗（仍在涨） |

R25 的两条饱和判据（各线索漂移 <5pp + 未归因不再上升）**三条不达标**（L6 +6.4、
L9 −5.6、未归因 +7.0）⇒ 继续扩池。**L6 从 4% 反弹到 10.4%** 尤其说明：前几轮把它判成
「收益小、暂缓」是**基于不足样本的结论**。

附带信号：docmost 这片是池里**第一个 protocol ≠ 0、resource ≠ 0** 的切片
（project 级 protocol=2、resource=3）——不过项目级口径是把全片 calls 串起来判的，
顺序无意义，这两条只能当线索不能当结论，要落到 perFunction 上再看。

本轮未提交，等你验收。

### 上一轮疑点已关闭：verdaccio 的空 calls 不是 E1 的遗留缺口

§十九 末尾记的疑点「verdaccio 空 calls 42/249，其中点名 24，比 NestJS 片高一个量级」
——查清了，**全部有解释，不需要为它单开一轮**：

| 类别 | 数量 | 证据 |
|---|---|---|
| 体内**零 `CallExpression`** | 23 | 用 ts-morph AST 逐条确认（不是正则）：全是 setter / accessor / `return this` 形态，例如 `ConfigBuilder.addLogger(log) { this.config.log = log; return this; }`、`Auth.isLegacyAuthCacheEnabled() { return this.config.server?.legacyAuthCache?.enabled === true; }` |
| 体内有调用，但**全在嵌套箭头回调里** | 1 | `AuthStorageCommand.promptPassword`（`readline.createInterface` / `rl.question` 都在 `new Promise((resolve,reject) => {…})` 里）⇒ §十八 已登记的「不修」项，三种载体口径一致 |

对照：体内**有**调用的方法（`Auth.authenticate`、`Auth.changePassword`、`Auth.init`…）IR 里
calls 都正常。⇒ **E1 的类方法修复在真实语料上生效，没有第二处漏。**

探针：`/tmp/probe-verdaccio-empty2.ts`（AST 级判定，避免正则误判）。

### 采样器自身也会偏：outline 那次把 110 个名额全给了 `routes/api/*`

`fp-pool-fetch.py` 原来按「优先分」排序后直接取前 N，而路径含 `api/` 得分最高 ⇒
outline 切片 110 个文件几乎全是 `routes/api/*`，结果只提取到 **37 个函数 / 4 条违规**
（别的片是 60–260 个函数）。一个几乎不出数的切片混进池里，会把 R25 的漂移判据**骗过去**。

- 修法：`round_robin()` —— 按目录轮转取样，保证切片铺开（已加，自检通过）。
- 教训与 R24/R25 同族：不只是「从哪批违规归纳」会偏，**取语料这一步本身也会偏**。

### R25 判据补了空过防线

`fp-pool-attrib.py --snapshot / --check-saturation`：每次扩池存一份读数，比较最近两次。
**新增：若新切片贡献 < 5% 的总违规，判定直接报「这次比较无效」** —— 贡献量不足时的
「各线索没漂移」是空过（R23 家族），不是饱和。

现状（写入 `reports/fp-pool-attrib-history.json`）：

| 读数 | 切片 | 违规 | 未归因 | 判定 |
|---|---:|---:|---:|---|
| 1 | 4 | 72 | 9.7% | — |
| 2 | 5（+verdaccio） | 198 | 37.4% | 未饱和（3 项不达标） |
| 3 | 6（+docmost） | 367 | 44.4% | 未饱和（3 项不达标） |
| 4 | 7（+outline，有偏） | 371 | 43.9% | **比较无效**（新片只贡献 4 条 = 1.1%） |

⇒ outline 需用轮转取样重切后重扫，再判。hoppscotch（backend 子包）抓取中。

---

## 二十、E2：装饰器里的鉴权对规则不可见（2026-09-22）

### 起因：从 44% 未归因里挖形态，挖出一件比「线索清单」更根本的事

§十九 收尾时池的未归因是 **43.9%**。本轮不开新切片，改从**现有 163 条未归因**里挖形态：

| 未归因违规的分布 | 条数 |
|---|---:|
| Input Validation | 76 |
| No Input Sanitization | 24 |
| Authorization（三类合计） | 21 |
| 其余（外键 / 会话 / 上传 / 令牌轮换 / 上下文管理 …） | 42 |

逐条回源码看，撞见 `docmost` 的 `GroupController.createGroup`：

```ts
@UseGuards(JwtAuthGuard)          // ← 类级鉴权
@Controller('groups')
export class GroupController {
  @Post('create')
  createGroup(@Body() createGroupDto: CreateGroupDto) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, ...)) throw new ForbiddenException();
    return this.groupService.createGroup(...);
  }
}
```

而 IR 里这条函数只有 `calls: ["create"]`，`params: [{name:"dto", type:"CreateGroupDto"}]`。
**`@UseGuards(JwtAuthGuard)` 不在 calls 里，装饰器不在 IR 的任何字段里。**

### 决定性探针（先证明「看不见」，再谈修）

`/tmp/e2-probe`（10 行 NestJS 控制器）→ 跑提取器 + `detectSafeguardViolations`：

| | 结果 |
|---|---|
| IR calls | `["create"]` —— 守卫不存在 |
| 修复前违规 | `Authorization (Unauthenticated Mutation)` + `Input Validation` |
| 手工注入 `__progmune_auth_machinery__` 后 | 只剩 `Input Validation` |

⇒ ① 装饰器确实不可见；② 标记通道确实能消掉那条；③ **Input Validation 不受影响**
（它的 safeguard 不接受任何标记，见下）。三条一次坐实。

### 更底层的发现：语义标记层的跨语言不对称

规则侧（`src/protocol-detector.ts`）定义了 **23 个** `__progmune_*` 语义标记。产出侧：

| 提取器 | 产出标记数 |
|---|---:|
| `tools/extract_ir.py`（Python） | **23 / 23** |
| `src/extract-ir.ts`（TS/JS） | **4 / 23**（path_traversal、ssrf_user_url、token_issued、ownership_checked） |
| `extract-ir-c` / `-go` / `-java` | **0 / 23** |

而 **FP 观测池 100% 是 TS/JS**。⇒ 规则在 TS 上跑的时候，**19 条证据通道是断的**。
这不是「规则不准」，是**规则饿着**——在饿着的规则上做词表校准，只会把阈值越调越怪。

其中真正能用来**抑制误报**（safeguard 性质）的只有 5 个，本轮补的是唯一一个
「**规则侧已经等着认、只是没人产**」的：`__progmune_auth_machinery__`
（`protocol-detector.ts:398` / `:430` 两条 Authorization 规则的 `auth_check`）。

### 判据抄录（R22：写 expect 前先抄，不靠想象）

| 规则 | safeguard 接受的标记 | 装饰器能否救 |
|---|---|---|
| Authorization (Unauthenticated Access / Mutation) | `auth_checked`、`credential_check`、`drf_permissions`、**`auth_machinery`** | ✅ 能 |
| Token Security (Weak Generation) | `framework_auth`、`auth_machinery` | ✅ 能 |
| **Input Validation / No Input Sanitization** | **不接受任何 `__progmune_*`**（纯词形匹配） | ❌ **不能** |
| Data Mutation Without Audit Trail | （本轮未查） | — |

**这条表直接推翻了我自己的一个乐观估计**：初测「装饰器/DTO 覆盖 15.3% 全池」里，
很大一部分落在 Input Validation 上，而那条规则**根本没有标记通道**。
修正后按规则重算（分母 367）：

| 路径 | 上限 | 说明 |
|---|---:|---|
| E2 装饰器 → `auth_machinery` | Authorization 77 条中 37 条（48%）= **10.1% 全池** | 规则侧零改动 |
| 规则侧 CASL 词表（`cannot`/`can`，**已在 calls 里**） | 77 条中 39 条 = 10.6% | 属校准，按 R25 等池饱和 |
| E3 DTO 入参 → 校验 | 输入校验 139 条中 19 条 = 5.2% | **双侧都要动**：新标记 + 给规则加通道 |

### 实现（`src/extract-ir.ts`，类方法分支追加）

镜像 Python 的「类级框架守卫」（`tools/extract_ir.py:1134`：类名含 `authenticator`
或 DRF `permission_classes` ⇒ 注入 `auth_machinery`）。TS 侧等价物是装饰器：

- 收集**类级 + 方法级**装饰器（类级守卫对全控制器生效）
- `@Public()` / `@SkipAuth()` / `@AllowAnonymous()` … ⇒ **不注入**（显式免鉴权）
- `@Api*` ⇒ 跳过（Swagger 文档装饰器，只描述不实施）
- `@UseGuards(X)` 的实参须像鉴权守卫（`auth|jwt|session|login|permission|role|admin|bearer|credential`）
  ⇒ 排除 `@UseGuards(ThrottlerGuard)` 这类同名不同义
- 顶层函数装饰器**不在本轮范围**（边界写死在代码注释与负对照里）

### 实测效果（FP 观测池 6 切片 / 367 条，E2 前后逐条比对）

| 指标 | 结果 |
|---|---:|
| Authorization 违规 | **−24**（Unauthenticated Access −11 / Mutation −13） |
| 新增（ADDED） | **0** |
| 非 Authorization 规则的变动 | **0**（与判据完全一致） |
| 涉及切片 | 全在 docmost（池里唯一用装饰器的片；另 5 片是 Express 函数式 / 无守卫） |
| 命中函数 | 94 → 87（7 个函数的**唯一**违规被消掉，整条从列表消失） |

抽查确认真 FP：`AttachmentController.uploadFile` 第 89 行就是 `@UseGuards(JwtAuthGuard)`。
**上限 37 条 vs 实际 24 条的差额**：初测的 D1/D2 启发式把 `@Post`/`@Get`/`@Controller`
也算成「装饰器」（它们不是鉴权装饰器），按设计本就是偏乐观的上限。

### 四门验收

| 门 | 结果 |
|---|---|
| build | ✓ tsc 零错误 |
| taintpath 闸门 | ✓ 160 / 160，失败 0 |
| fr-007 / fr-016 | ✓ pre 5 / post 0、pre 7 / post 0 维持 |
| 定向测试 | ✓ 176 全绿（165 → +11 = E2 组） |
| 反向验证 | ✓ 四刀各落自己那组、残留 0 |
| **TS 盲测** | LOST 0 / ADDED 0 —— **但这是空过（R23 家族第三次）** |

**为什么盲测是空过**：generated 语料里 `@UseGuards|@Controller|@Roles|@Authorize|@Injectable`
的命中数是 **0** —— 基线压根没有装饰器，测不到本轮。真证据是上表 FP 池的 −24/0。
（与 E1 那次同型，只是那次是「判据不看该轴」，这次是「语料缺形状」。）

### 三条不修 / 待办

1. **E3（DTO 校验）**：IR 的 `params` **带着类型**（`type: "CreateGroupDto"`），
   但要判定「校验在 DTO 类里」得解析那个类的 class-validator 装饰器，
   并且**规则侧要先给 Input Validation 开一条标记通道** ⇒ 双侧改动，单列一轮。
2. **CASL 词表**（`cannot` / `can` / `createForUser` 已在 calls 里、规则不认）：
   属规则侧校准，按 **R25 等池饱和**再动。
3. **其余 18 条缺的标记**：按 R21 逐条量化后再排优先级，不要一次全补。
