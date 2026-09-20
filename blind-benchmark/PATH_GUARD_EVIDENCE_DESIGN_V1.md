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
