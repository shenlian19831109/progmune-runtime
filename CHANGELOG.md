# Changelog

## [3.7.42] — 2026-09-20

### C4f：名字级传播的精度收窄（形参-实参位置对齐 + 返回值依赖分析）

前三轮（C4c/C4d/C4e）都在补召回，这一轮反过来**收精度**。

传播此前是**名字级**的：赋值右侧出现污点名、且右侧看起来像塑形 ⇒ 新变量判为
污染。它不看「这个 helper 的返回值到底依不依赖那个实参」：

```ts
const dropParam = (n: string): string => "fixed.md";   // 形参被丢掉
const rel = dropParam(k);                                // k 流不出来，仍被判污染
```

现在给每个纯塑形 helper 多算一份 `deps` = **返回值真正依赖的形参集**，调用点按
形参-实参位置对齐后才认证据：`dropParam(k)` ⇒ 无证据；`pickFirst("safe", k)`
（只依赖第一个形参）⇒ 只留 `"safe"`。

| 形态 | 收窄前 | 语义 |
|---|---|---|
| `dropParam(k)`（return 常量） | 误标 → 不标 | 依赖集为空 |
| `pickFirst("safe", k)` | 误标 → 不标 | 位置不对齐 |
| `path.join("out", dropParam(k))` | 误标 → 不标 | 该按支路算，不该整行一锅端 |
| `wrapDrop(k)`（= dropParam(n)） | 误标 → 不标 | 依赖集跨函数传递后为空 |
| `wrapPick("safe", k)` | 误标 → 不标 | 跨函数位置不对齐 |
| `swapPick(k, "safe")`（= pickFirst(y, x)） | 误标 → 不标 | 换序后真正被依赖的是 y |

换序那条最能说明价值：`swapPick("safe", k)` 该标、`swapPick(k, "safe")` 不该标 ——
只看「实参里有没有污点名」两条都标，只看「形参有没有被用到」两条也都标，
必须按位置穿过一次换序才分得开。

`shaped`（右侧像不像塑形）仍看原式：helper 是不是塑形，与它的返回值依不依赖
实参是两件事，不能互相替代。依赖分析有次序依赖（helper 若在它依赖的 helper 之前
被接受，那一刻 deps 会偏宽），名录定稿后按完整的 info 再算两轮消掉 —— 偏宽是
保守侧（继续传播），不会造成漏报。

### 验收

| 门 | 结果 |
|---|---|
| taintpath 闸门 | **81/81**（新增 G 族 12 条：4 mark / 7 no-taint / 1 suppressed） |
| fr-007 真实语料 | pre 5 / post 0 **维持** |
| fr-016 真实语料 | pre 7 / post 0 **维持** —— 收窄没有丢正例 |
| 定向用例 | **164 passed / 7 个测试文件**（新增 C4f 组 11 条：4 正 7 负；taint-guard、structural、ssrf-loop、project-ir、C/Go/Java 提取组全绿） |
| TS 盲测 | 107 项目，path_traversal **LOST 0 / ADDED 20**（G 4 + E 9 + F 6 + D 1），基线那 104 个项目**零漂移零丢失** |
| tsc | 零错误 |

### 门的方向也反过来了（R14 的一次镜像使用）

前四轮 R7 咬的都是「语料零覆盖 ⇒ 门空过」。收窄轮最该防的是另外两件事：
收窄过头把真阳性收掉（看 LOST）；以及那批 no-taint 用例其实空转（它们本来就不该
标，旧代码也不会让它们红）。反向验证切了三刀：

- **刀 A**：调用点退回「不按依赖抹实参」（等价收窄前）⇒ G 族 6 条 no-taint 全部
  转红 —— 证明这批对照真的咬得住；
- **刀 B**：只关掉跨函数传递（deps 只算直接依赖）⇒ 只有两跳相关的 3 条转红，
  直接依赖那 3 条不动 —— 归因清晰；
- **刀 C**：把收窄做得更激进（一律抹空）⇒ 3 条位置对齐正例转漏报，而
  `emitPlainShaper`（常规塑形）不受影响 —— 正说明收窄没波及常规路径。

## [3.7.41] — 2026-09-20

### C4e：helper 的现代写法（箭头 / 函数表达式 / 模块常量）

C4b 的「纯塑形 helper」名录是用 `sf.getFunctions()` 扫出来的 —— 那只能拿到
**函数声明**。而真实 TS 工程里 helper 的主力写法是箭头常量：

```ts
export const withExt = (name: string): string => name + ".md";   // ← 此前整片漏
export const withExtBlock = (name: string): string => { return name + ".md"; };
export const withExtExpr = function (name: string): string { return name + ".md"; };
```

现在收集阶段并入变量声明上的箭头与函数表达式，判据（有形参 / 有返回值 /
体内无 sink）原样不变 —— 只是不再漏掉一大半候选。

另外两处放宽：

- **模块级字面量常量**：`const EXT = ".doc"; f(n) { return n + EXT; }` 以前因自由
  标识符被判据③拦死（这是 D 族登记过的 known-gap）。现在放行【初值是字符串 /
  数字 / 布尔字面量】的模块级常量 —— 出处可确证。初值是**任意表达式**的常量仍拦
  （`const ROOT = path.resolve(process.cwd(), "runs")`），否则 helper 能把别处的
  污点藏在一个常量后面，等于给任意数据流发通行证。
- **path 模块的局部别名**：白名单里写死 `path` 一个名字不够用，
  `import * as p from "path"` / `import nodePath from "node:path"` /
  `import { join } from "path"` 现在都能认。只放行 path 模块本身 —— fs / os 不放，
  那会被 helper 用来把 IO 藏进 return（判据②只扫 sink 调用，覆盖不到这一类）。

### 探针设计的坑（值得记）

第一版探针把 helper 调用直接写在 sink 实参里：`fs.writeFileSync(outDir + "/" + withExt(k))`。
结果**正负对照一次性全 MARK** —— 因为判定有一条兜底规则：sink 实参窗口里出现
污点名就标。那样测的根本不是 helper 传播。改成隔离写法后才分得出胜负：

```ts
const rel = withExt(k);                  // 污点只能经 helper 的返回值进来
fs.writeFileSync(outDir + "/" + rel, "x");
```

同一批复现还纠正了两条备忘：`toSlug`（`p.trim().toLowerCase()`）实测早就穿透，
不是备忘里记的缺口；`reduce` 首参不绑确认按设计生效。

### 验收

| 门 | 结果 |
|---|---|
| taintpath 闸门 | **69/69**（新增 F 族 10 条：6 mark / 1 suppressed / 3 no-taint） |
| 既有 D 族 known-gap | `emitHelperFixed` 因本轮闭合，已由 known-gap 转 **mark** |
| 定向用例 | **63 passed**（structural 单文件）／**153 passed**（含 taint-guard、ssrf-loop、project-ir、C/Go/Java 提取组共 7 个文件）—— 新增 C4e 组 9 条：6 正 3 负；另因同一闭合把一条旧负对照转正，并补「非字面量模块常量」锁边界 |
| fr-007 真实语料 | pre 5 / post 0 **维持** |
| fr-016 真实语料 | pre 7 / post 0 **维持** —— 放宽收集后守卫侧仍无新增误报 |
| TS 盲测 | 106 项目，按 path_traversal 口径：**LOST 0 / ADDED 16** —— E 族 9（C4d）+ F 族 6（C4e）+ D 族 `emitHelperFixed` 1（本轮闭合），**基线那 104 个项目零漂移** |
| tsc | 零错误 |

### R7 第五次：generated 语料又是零覆盖

实测全量 .ts 里 `export const X = (…) =>` **0 处**，A–E 族对本能力照样空过。
新增 `taintpath_F`（10 条）之后这道门才重新咬得住。

### 反向验证做了三刀（不只摘整体）

| 摘掉什么 | 结果 |
|---|---|
| 箭头 / 函数表达式的候选收集 | F 族 6 条正例**全部**转漏报（模块常量与 path 别名两条也在内 —— 那两个 helper 本身就是箭头写的） |
| 模块常量 + path 别名（extraIdents 置空） | 只有 `emitModuleConstHelper` / `emitPathAliasHelper` 两条转漏报，其余箭头正例不受影响 |
| 反过来把模块常量**放宽**到任意初值 | 「非字面量模块常量」那条负对照立刻变红 —— 证明这条边界用例不是空转 |

只摘整体只能证明正例依赖新代码，证明不了**边界负对照**真的咬得住，所以补了第三刀。

### 顺带查明（不是 bug，记录以免下次重复怀疑）

- `helper 体内有 sink` 形态会被标，来自 `methodSinkParamMap` 的跨函数传播：
  helper 的形参确实流进了 sink，标是对的，与 helper 是否被认成纯塑形无关。
- 名字级传播的精度边界仍在：`discard(k) { return "fixed.md"; }` 丢弃形参，
  结果仍会被判污染。这是「看得见就传播」的名级近似，修它需要形参-实参位置对齐
  与返回值依赖分析 —— 记入下一步。

## [3.7.40] — 2026-09-20

### C4d：高阶枚举方法的回调形参

`Object.keys(doc)` 的枚举绑定此前只认 `for (const k of|in …)`。同一种数据流还有
一半写在回调里，那半整片漏：

```ts
Object.keys(doc).forEach((k) => { fs.writeFileSync(outDir + "/" + k, "x"); });
Object.entries(doc).map(([k, v]) => { fs.writeFileSync(outDir + "/" + k, String(v)); });
```

回调形参 = 被枚举到的元素，语义与 for-of 完全等价，没有理由区别对待。现在并入
同一套枚举绑定：接收者支持「根形态」（`Object.keys(doc).forEach`）与「变量形态」
（`const ks = Object.keys(doc); ks.forEach`，走 C4c 那条不动点）。

**绑定规则的边界**（两条都配了负对照钉死）：

- `[k, v]` 解构两个都是元素，都绑；`k, i` **只取第一个** —— 第二个是索引，
  绑了就是误报。
- 方法表只收 `forEach / map / flatMap / filter`。不收 `find/some/every`（谓词语义，
  常与白名单校验同现，绑进去反而给守卫侧喂误报），不收 `reduce`（首参是累加器）。

**一条纠正**：此前备忘写「`for...in` 也不绑定」，最小复现实测是错的 ——
`bindFromEnum` 的正则本就是 `(?:of|in)`，for-in 一直是通的。真缺口只有回调这一处。
备忘里的「下一步」若不先复现就照着做，会改一个已经对的地方。

### C4d-b：回调形态的三处遗漏 + 一处真实误报（同日第二轮）

放宽后立刻在新语料上验了剩余写法，初版有两件事没做对：

| 形态 | 初版 | 现在 |
|---|---|---|
| `forEach(k => …)` 无括号单参 | 漏 | 标记 |
| `forEach(function (k) { … })` ES5 回调 | 漏 | 标记 |
| `doc.sections.forEach((s: any) => …)` 成员链 + 类型标注形参 | 漏 | 标记 |
| `forEach(handleOne)` 回调是**函数引用** | **误标** | 不标记 |

误报那条值得单独看：`handleOne` 是别人函数的名字，不是被枚举的元素，但初版正则
以 `[,)]` 收尾，把它当形参绑进了污点集合 —— 同名的局部变量随即被判成污点。
修法是把**「回调必须内联」**写进正则前提：箭头分支形参后必须见到 `=>`，ES5 分支
必须见到 `function` 关键字，函数引用形态自然落空。

顺带发现形参字符集漏了 `:`：`(s: any) =>` 这种带类型标注的写法在 TS 工程里是常态，
一个冒号就让整环不匹配。现放行 `:.|<>`（类型标注、联合类型与泛型形参），
`=>` 与 `{}` 仍不在集合内，函数体不会被吃进来。

### 验收

| 门 | 结果 |
|---|---|
| fr-007 真实语料 | pre 5 / post 0 **维持**（post 侧含 forEach 形态，放宽后仍未新增误报） |
| fr-016 真实语料 | pre 7 / post 0 **维持** |
| taintpath 闸门 | **59/59**（新增 E 族 15 条：9 mark / 1 suppressed / 5 no-taint） |
| 定向用例 | **143 passed / 7 个测试文件**（新增 C4d 组 12 条：7 正 5 负；taint-guard、structural、ssrf-loop、project-ir、C/Go/Java 提取组全绿） |
| TS 盲测 | 105 项目，按 path_traversal 口径：**LOST 0 / ADDED 9** —— 9 条全部来自新增语料 `taintpath_E`，其余 104 个项目**零漂移**（另有 2 条 resource 类别的 No Input Sanitization 随新语料首次出现，与本类判定无关） |
| tsc | 零错误 |

### R7 第四次：门自身必须有覆盖

generated 全量 .ts 里 `.forEach/.map/.flatMap/.filter` 回调形参 **0 处**（A–D 族都没有），
所以「LOST 0 / ADDED 0」对这项能力仍然是空过。新增 `taintpath_E`（10 条：
6 mark / 1 suppressed / 3 no-taint）后，该门才重新咬得住。

## [3.7.39] — 2026-09-20

### C4b：项目自有的「纯塑形」helper —— 污点穿过自建封装

fr-016 里 `iterateAsyncApiComponents` / `iterateComponents` 在 3.7.38 之后仍看不到，
原因是污点断在最后一跳：

```
const filename = getFileNamePath(componentDirPath, componentName, ext);
// getFileNamePath(a, b, c) { return path.join(a, b) + `.${c}`; }
writeToFileByExtension(componentData, filename);
```

`componentName` 已被 `Object.keys` 污染，但 `getFileNamePath` 不在 C4 的塑形词表里
（那是 node:path 家族 + String 原型方法的**固定清单**，覆盖不到每个项目自己的封装）。

修法不是放宽词表，而是**按函数体证明它只做塑形**，三条判据全中才传播：

1. 有形参、且有带表达式的 `return`（void / 只写文件的函数不算）
2. 函数体内**没有**文件 sink —— 含 sink 说明它不只是塑形
3. 每个 return 表达式里：所有调用都在塑形白名单内，且所有自由标识符都是自己的形参

判据③里的**字符过滤方法刻意不算证据**（新增方法学规则 **R11**）：C4 的内联规则把
`.replace/.trim/...` 当塑形，但那是「看得见整个实参窗口」时的取舍；helper 形式看不见，
而 `.replace(/[^a-z0-9]/gi, "")` 恰恰是净化函数的标准写法。helper 侧的证据集必须比
内联侧更严。有界两轮不动点，允许 helper 调已认定的 helper，不追环。

### C4c：迭代已被污染的聚合

`const ks = Object.keys(o); for (const k of ks)` —— 被迭代对象已是**被污染的变量**
而非根表达式，枚举绑定此前只按根匹配，这种「先收集、再迭代」的写法一根都收不到。
现把枚举绑定并入有界不动点，与塑形传播、单跳赋值一起迭代至收敛（≤3 轮）。

### 验收

| 门 | 结果 |
|---|---|
| fr-016 真实语料 | **pre 5 → 7**（新增的两条正是 C4b 目标，均为真阳性） |
| fr-007 真实语料 | pre 5 / post 0 维持 |
| taintpath 闸门 | **44/44**（新增 D 族 10 条） |
| TS 盲测 | 见下（D 族专为 R7 补，否则这两处空过） |
| 反向验证 | 回退 v3.7.37 后对应用例失败，负对照全绿 |

### R7 的第三次应用：这次也先补了语料

C4b / C4c 在含 C 族的既有盲测语料上**仍然空过** —— 实测 generated 全量 .ts 里
「先收集再迭代」形态 0 处、「自有 path 塑形 helper」0 处。因此本轮把 fr-016 的
helper 形态搬进盲测做成 `taintpath_D`（10 条），重生成基线后才比漂移。

D 族的守卫侧刻意用 `stamp`（不含任何 G-C 后缀）而非 `assertWithinDir`：
若压制真的发生，依据就只能是被调用方自身的证据（G2 tier-0），不是名字。

## [3.7.38] — 2026-09-19

### fr-016：补「文档解析产物」根 + sink 形参继承（召回，两侧各缺一环）

真实语料 fr-016（Redocly/redocly-cli `split` 命令路径穿越，GHSA-657c-g7qc-r9j2）
在连续三轮改动之后仍是 **pre 0 / post 0**。逐段拆开才发现断点是**两个独立缺陷**，
且两侧对称——只补一侧，语料纹丝不动：

- **来源侧**：污点根表里没有「外部文档」。文档本体由上游 `parseYaml` 解析好后
  **作为形参**传入（`channels: Record<string, any>`），函数体内无解析调用，唯一
  本地可见入口是 `for (const channelName of Object.keys(channels))` 这次枚举。
  - 新增根 `document_parse`：`JSON.parse` / `YAML.load` / `parseYaml` … 的解析产物
  - 新增根 `runtime_key_enum`：`Object.keys/values/entries` 的枚举产物
    （内部注释标明它是**性质较弱**的一类根：声明的是「名字不是字面量、而是运行时
    数据结构的产物」，与按传输面声明的前两条不同；是否加害交给守卫判定）
  - `collectTaintedNames` 增加 for-of 绑定收集（含 `[k, v]` 解构）

- **sink 侧**：落盘经 `writeToFileByExtension → writeYaml → fs.writeFileSync`
  两层自有封装，`methodSinkParamMap` 原本只登记「形参 → 本函数体内 fs sink」
  一跳，整层 wrapper 从未入表。现增加一个有界闭包（≤3 轮）：**自己的形参被传进
  已登记函数的 sink 位 ⇒ 继承该 sink 位**。注意这不是 C4b——C4b 是值侧，这是 sink 侧。

### 验收

| 门 | 结果 |
|---|---|
| **fr-016 真实语料** | **pre 5 条 / post 0 条**（此前 0/0）—— 成为继 fr-007 之后**第二个**有判别力的真实语料对 |
| fr-007 真实语料 | pre 5 / post 0 维持（未压掉真阳性） |
| taintpath 闸门 | 24/24 |
| 全组回归 | 87 passed；`tsc` 零错误 |
| TS 盲测 102 项目 | LOST 0 / ADDED 0（见下） |

fr-016 语料同步升级：从 mini 切片（5 个真值文件）换成完整 `packages/cli` 子包，
快照入库 `blind-benchmark/fr-corpus/fr-016-redocly/{pre,post}`（各 1.1M，受保护资产）；
`check-fr-corpus.ts` 登记 `fr-016: { pre: 5, post: 0 }`，此后一条命令即可复核。

### 诚实说明（避免把水印当证据）

G-C 的 `Within` 后缀当初是照着 fr-016 的 `assertWithinDir` 加的，所以 post=0
对 **G-C** 是一种同义反复。真正结实的证据是新增的定向用例：把守卫函数改名为
不含任何 G-C 后缀的 `stamp`、只保留函数体内的 `resolve + startsWith(base + sep)`，
依然被压制 ⇒ 压制依据是被调用方自身的证据（G2 tier-0），不是名字。

### 新增方法学规则 R10

一条污点流要被观测到，**来源侧与 sink 侧必须同时连通**。补一侧时语料往往纹丝
不动，看起来像修补无效。调试须先写最小复现逐段确认通断——总数是唯一结果变量，
任何一侧断着都等于 0，没有定位能力。

### 已知缺口

- C4b：值侧助手（`buildPath(p)`、`getFileNamePath(a,b,c)`）不传播 —— fr-016 的
  `iterateAsyncApiComponents` / `iterateComponents` 仍因此看不到
- C4c：`const names = Object.keys(o); for (const n of names)` —— 迭代**已被污染
  的聚合**（而非直接枚举根）不传播

## [3.7.37] — 2026-09-19

### G2：自定义校验函数的调用点抑制（判别力）

缺口实证（taintpath_B `dispatchToolGuarded`，measured）：

```ts
assertTemplateName(args.name);   // 函数体内是 /^[A-Za-z0-9_-]+$/ —— 真校验
return loadTemplate(args.name);  // 仍被标记（误报）
```

`assertTemplateName` 名字不含路径语义后缀——`Name` 在修 `ensureDir()` 误判时被
整体移出了 G-C 后缀表，于是调用点侧认不出来。这是 G1 收紧词表的已知代价。

修法**不是**把 `Name` 加回词表（那是按名字猜语义，G-C 已经为这份宽松付过代价：
fr-007 pre 侧召回归零），而是看**被调用方函数体内到底有没有校验证据**：

- `pathGuardFunctionNames` 拆两档：tier-0 `direct`（自身含证据）/ tier-1+ `all`（推断）
- `collectSanitizedExprs`：被调用方属 tier-0 ⇒ 把调用实参里的取值表达式收进
  「已净化」集合；sink 实参命中污点但已被净化 ⇒ 不算污点

### 三处精度取舍（全部比 G1 的函数级 selfGuarded 窄）

| 取舍 | 说明 |
|---|---|
| 表达式级，非函数级 | G1 是一个校验词汇压掉整个函数体的所有流；G2 只净化被传进守卫调用的那个表达式，同函数体里另一条未校验的流仍标记 |
| 只认 tier-0 | 推断出来的守卫不用于抑制 —— 升为方法学规则 **R9-no-inferred-suppression**（抑制不可逆，压掉的真阳性不会出现在任何回归统计里） |
| 前缀 `(?:^\|[^\w$.])` | 净化 `name` 不连坐 `other.name`；但 `args.name` 能命中 `path.join(DIR, args.name)` |

### 验收

- taintpath 闸门 **24/24**（`dispatchToolGuarded` mark → suppressed；正对照
  `dispatchToolBare` 仍 mark）
- **fr-007 openhop 真实语料维持 pre 5 / post 0** —— G2 未压掉真阳性
- TS 盲测（102 项目）：**LOST 1 / ADDED 0**，唯一变化就是本条；覆盖力 19 → 18
- `extract-ir-taint-guard.test.ts` 新增 G2 组 6 条（含正/负对照，R6）
- 反向验证：回退 v3.7.36 后 G2 两条正例失败，其余 18 条仍绿
- 新增 `blind-benchmark/check-fr-corpus.ts` —— 把 fr-007 的 pre/post 复测固化成
  一条命令；快照置于 `blind-benchmark/fr-corpus/`（**受保护资产**，不再放 /tmp）

### 已知缺口 G2b

经项目自有 helper 转手的校验证据不生效（`checkName(n)` 内部再调守卫函数）——
只认 tier-0 的代价，与 C4b 同族。缺口是可见的（仍有误报），压掉的真阳性不可见。

## [3.7.36] — 2026-09-19

### C4：污点经路径塑形表达式包装后仍传播

缺口实证（taintpath_A，measured）：`readBasename` / `readResolveOnly` /
`readJoinWrapped` / `readNormalizeWrapped` 四条语义上应标记、实测不标记——
传播只认 `x = <污点>` 直赋，而 `path.join/resolve/normalize/basename` 是真实
工程构造路径的**默认写法**，这条断链等于把最常见形态整片漏掉。

政策是**白名单传播**，不是「RHS 含污点就传播」：
- 只经 path.* 家族与保值的字符串方法（trim/replace/…）传播；拼接与模板字面量
  同样只塑形、不改来源；有界迭代 3 跳（`normalize → join` 这类链式能接上）
- **认不出的调用不传播** ⇒ `const safe = sanitizeName(p)` 天然不污染。
  未知函数默认站在精度一侧——这是白名单相对黑名单的决定性优势
- 代价（记为缺口 C4b）：项目自有 helper（如 `buildPath(p)`）仍不传播

### 两处必须一并改的「假通过」（C4 把它们顶出来了）

C4 之前，下列用例的「不标记」**不是因为判别力对，而是污点根本没走到 sink**
——方法学规则 R7 的第二种形态。C4 一放开它们就会翻成误报：

1. **G-A2 漏 `startsWith(base)`**：原正则要求标识符在 base/root/dir 之外还有
   前导字符，最朴素的 `target.startsWith(base)` 匹配不上。改为取出整个实参再
   判定，并加 `database` 等反例名单（`database` 以 base 结尾但与目录无关）
2. **G-A2 漏字符串字面量形态**：`startsWith("/srv/data")` 同样匹配不上。
   现支持绝对路径字面量（长度 >1，排除 `startsWith("/")`——那只是判绝对路径）

### 闸门改为实时提取（第二处空过）

`check-taintpath.ts` 原默认读 `reports/batch-scan-results.json`——那是别人跑
batch-scan 留下的**陈旧产物**。实测踩到：C4 落地后 4 条 known-gap 已翻正，
闸门仍报「未标记，符合预期」。已改为默认对 `generated/taintpath_*` 实时跑
extractIR（需走报告时显式 `--report`）。

### 验收

- taintpath 闸门 **24/24，失败 0、缺口闭合待更新 0**；4 条 known-gap 转 mark
- fr-007 openhop 真实语料维持 **pre 5 / post 0** —— C4 只补召回，未削弱 G1 判别力
- `extract-ir-taint-structural.test.ts` 新增 C4 组 11 条（7 正 + 4 负对照，R6）
- 反向验证：回退 v3.7.35 后 **7 条正例全失败**，4 条负对照仍绿
- 全组回归 72 passed；`tsc -p tsconfig.json` 零错误

### 实现期踩的一个坑（已入注释）

`taintedViaShaper` 最初写了 `if (tainted.size === 0) return`——而这 4 条
known-gap 的共同形态恰恰是「全函数没有任何直赋污点」，等于整条 C4 不生效。
种子是根模式（taintPattern 恒定并入 UNTRUSTED_ROOT_SRC），不该依赖已有污点。

## [3.7.35] — 2026-09-19

### 重建盲测覆盖：taintpath 语料族（TS 795 空过的终结）

TS 795 盲测对「路径穿越标记」**连续三次零覆盖**——语料里没有任何
`不可信根 → 文件 sink` 的流，`__progmune_path_traversal__` 出现次数前 0 后 0。
于是「3086 flags LOST 0 / ADDED 0」这道硬门在这项能力上一直是空过（3.7.32/33/34
三次验收都把它当作证据）。

- 新增语料族 `generated/taintpath_A`（HTTP 请求面）与 `taintpath_B`
  （MCP 工具实参面 + 跨文件/跨函数传播），共 24 条期望
- 新增生成器 `blind-benchmark/generate-projects-taintpath.ts`
  （**只写自己前缀**，不像 generate-projects.ts 那样清理含 `_` 的目录）
- 新增闸门 `blind-benchmark/check-taintpath.ts` + 期望表
  `blind-benchmark/taintpath-expectations.json`：逐函数断言
  mark / suppressed / no-taint / known-gap 四类，退出码非 0 即失败
- 覆盖力：`__progmune_path_traversal__` **0 → 15 次**；24/24 符合期望
- 已有 100 个项目零漂移：LOST 0 / ADDED 0（总数 3086 → 3109，增量全部来自新语料）
- 升级为方法学规则 **R7-no-vacuous-gate**

### C5：不可信根可以直连 sink（召回）

此前外层要求 `collectTaintedNames` 非空，因此
`fs.readFileSync("/data/" + req.params.name)` —— 真实 Express 工程最常见的形态
——不标记，只有先赋给局部变量才标记。SSRF 侧从来不要求中间变量，这是同一条
数据流上的又一处口径不一致，与 G1 同类。改为：先看 sink 实参窗口有没有污点证据（taint 模式本来就含不可信根），
跨函数传播仍须有具名污点。

- `src/extract-ir-taint-structural.test.ts` 新增 6 条（4 正 + 2 负对照）
- 反向验证：回退 v3.7.34 后其中 4 条失败、2 条负对照仍绿
- fr-007 真实语料维持 pre 5 / post **0**（C5 只补召回，未削弱 G1 判别力）

### 本次暴露、尚未修的两处缺口（已进语料，作为下一轮的验收对象）

- **C4**：污点经表达式包装（`path.join/resolve/normalize/basename`）后不传播。
  语料里 readBasename / readResolveOnly / readJoinWrapped / readNormalizeWrapped
  四条语义上应标记、实测不标记，记为 known-gap（闸门会盯着，一旦补上就提醒更新）
- **G2**（反向）：自定义校验函数名不含路径语义后缀时调用点不被抑制。语料里
  `dispatchToolGuarded` 调了 `assertTemplateName()`（函数体内有字符集白名单），
  仍被标记——因为 `Name` 后缀在修 ensureDir 误判时被移出了守卫词表

## [3.7.34] — 2026-09-19

### G1 PATH_GUARD_EVIDENCE —— 路径穿越的「校验识别」

路径穿越标记此前是 `taint → 文件 sink ⇒ 标记`，**不看中间有没有校验**；SSRF 侧
不是这样（`taint → fetch sink 且无 SSRF_GUARD_EVIDENCE ⇒ 标记`）。两侧数据流同构、
判别力差一档——这正是根集合不敢放宽的真正原因（fr-012/fr-015 的 MISS 由此从
「词表缺口」升级为「机制缺口」）。本版把路径侧改成与 SSRF 对齐：
**`taint → 文件 sink 且无校验证据 ⇒ 标记`**。

守卫形态的种子全部来自语料真实修复，逐条可追溯：

- **G-A 目录包含性**：`resolve(p).startsWith(resolve(root))`、`x.startsWith(baseDir)`
- **G-B 上跳/绝对路径拒绝**：`path.isAbsolute`、`startsWith(".."+sep)`、`=== ".."`
  （种子 = fr-012 gitlab-mcp 下载侧 `localPath` 既有守卫块，index.ts:7968-7977）
- **G-C 独立校验函数**：`assertValidFlowId`（fr-007 openhop）/ `assertWithinDir`（fr-016 Redocly）
  —— 含向调用方**有界传播 3 跳**：校验被抽进被调用函数时，调用方一个校验词汇都没有
- **G-D 锚定字符集白名单**：`/^[A-Za-z0-9_-]+$/`（fr-007 `FLOW_ID_PATTERN`）

明确**不算**守卫：`path.basename`（fr-012 pre 实测反例，漏洞态就有它）、
单独出现的 `join`/`resolve`、长度检查、`if (!p) throw`。

**验收**

- fr-007 openhop 真实语料：**pre 5 条 / post 0 条** —— 真实语料上首次出现
  「修复后流消失」的判别力证据（G1 之前是 5 / 5）
- `src/extract-ir-taint-guard.test.ts` 14 passed；反向验证回退 3.7.33 后 5 条失败
- TS 795 盲测 3086 flags LOST 0 / ADDED 0 —— ⚠️ **空过**：盲测语料里
  `__progmune_path_traversal__` 出现 0 次，无覆盖；真正的门是 fr-007 与定向用例
- `tsc -p tsconfig.json` 零错误

**实现期修掉的两个反例**（都写进代码注释与方法学规则）：

1. `ensureDir()` / `isDirectory()` 曾被 G-C 误判为守卫（后缀 `Dir`），导致 fr-007
   pre 侧 5 条被压成 0、召回归零。已移除 `Dir`/`Name` 后缀并加显式反例名单
2. 「不得标记」类断言会**假通过**：污点经 `path.join(x)` 包装后不再传播，
   sink 处根本没污点。已定为方法学规则 **R6**：负向断言必须配同形状正对照

## [3.7.33] — 2026-09-19

### 污点标记管线三处结构性修复（C1/C2/C3，正确性修复，不改变判别逻辑）

从「污点源数据流试点 V1」拆出的**独立正确性条目**——它们只解决「看得见」，
不解决「看得懂」（判别力是 `PATH_GUARD_EVIDENCE`，另一个条目，尚未实现）。

- **C3 污点根按传输面声明**（`UNTRUSTED_ROOTS`）：此前整条链路只锚 Express 形态的 `req|request.(params|query|body|headers|cookies)`，即**根集合只有一种来源**。MCP 工具实参（`params.arguments`）、CLI 参数等来源天然不可见（fr-012 的 `args.file_path`）。改为按传输面声明根，每条附 `why`，不再靠补变量名清单打地鼠
- **C1 sink 形参表纳入顶层函数**：`methodSinkParamMap` 此前只遍历 `sf.getClasses()`，真实 TS 工程大量使用顶层函数声明（MCP handler / Nuxt runtime binding），跨函数一跳对它们完全不生效——fr-012 的 `markdownUpload` 正因如此从未入表
- **C2 跨函数传播识别裸调用**：调用匹配此前要求 `obj.sink(`（成员调用），新增 `directCallRe` 覆盖 `func(` 形态
- **验收**：
  - TS 795 盲测 **3086 flags LOST 0 / ADDED 0**
  - ⚠️ **但这是空过（vacuous pass）**：实测整份 generated 语料重跑后 per-function calls 差异 **0**、`__progmune` 标记 **826 vs 826**——盲测语料根本走不到这三个分支。真正的门是新增的定向用例
  - 新增 `src/extract-ir-taint-structural.test.ts` **6 green**；**反向验证**：把 `src/extract-ir.ts` 回退到 3.7.32 后其中 **3 项失败**（MCP 根 / 顶层函数 / 裸调用），确认这三个用例真的锁住了行为，而非同义反复。另 3 项（Express 旧语义仍标记、常量路径不标记、常量裸调用不标记）在修复前后均通过——它们锁的是「不得回归 / 不得过度标记」
- **行为边界**：本条目**不**改变判别逻辑。路径穿越侧仍无「校验识别」，因此放宽根集合后对已校验流同样会标记——这正是试点 V1 记录为未过验收的原因，由后续 `PATH_GUARD_EVIDENCE` 解决

## [3.7.32] — 2026-09-19

### IR 陈旧性判定（两次会话级误判的根因修复）

- **断点**：trust 引擎自动提取是「缺才提取」——项目已有 ir.json 就以文件为准不重生成。源码改了、ir.json 没更新时静默吃旧 IR：fr-005 首扫报 0（`rm ir.json` 后才报出）、污点试点「标记注入但 trust 报 0」同源
- **修复**（`src/ir-staleness.ts` + `src/trust/engine.ts` 集成）：mtime 比对——仅当有源码新于 ir.json 才重提，不做每次全量重提（skyvern 级项目 5-10 分钟成本）
- **三档策略 `PROGMUNE_IR_REEXTRACT`**：auto（陈旧 + 遍历完整 + 源码 ≤5000 文件才自动重提，否则**只警告不重提**）／always（语料复测自担成本）／never（旧语义，但必须打「IR 可能陈旧」警告——**不接受静默**）
- **双闸设计**：完整遍历（不做「找到就早退」——早退会抹掉 truncated 信号，本仓库 22k 源文件实测会把单测推过 30s 超时）+ evidenceComplete + 规模预算闸；stat 一次遍历的常量成本换可靠的 fresh 判定
- **验收**：`src/ir-staleness.test.ts` 12 green + DSH 陷阱回归 + SSRF 死循环锁 35 passed；**TS 795 零漂移（3086 LOST 0/ADDED 0）**；build ✓

## [3.7.31] — 2026-09-18

### 提取器 SSRF 标记正则死循环修复（P0，真实工程可用性故障）

- **现象**：IR 提取阶段对含 `fetch(` 的 TS 文件 100% CPU 挂死——一个 55 行的切片 >480s 未完成，而 108 KB / 5 文件的语料只需 35s。实测 **nuxt-modules/og-image、tinacms/tinacms、zereight/gitlab-mcp 三个独立仓库全部触发**
- **定位**：对挂住进程做 CPU 采样（`sample`），**2193/2193 采样全部落在 `Builtins_RegExpPrototypeExec`**——确定为正则死循环，而非此前怀疑的 OOM / ts-morph 依赖解析
- **根因**（`src/extract-ir.ts` SSRF 分支，3.7.28 引入）：`TS_HTTP_FETCH_SINK` 是**无 `g` 标志**的正则，却用于 `while ((m = TS_HTTP_FETCH_SINK.exec(text)) !== null)` 迭代。非全局正则的 `exec()` 忽略 `lastIndex` 并恒返回首个匹配；当首个 `fetch(` 后的 300 字符窗口不含污点时（真实代码里最常见的「良性 fetch」形态），循环无出口。同文件另 7 处 `while-exec` 循环均带 `g`，仅此一处遗漏
- **修复**：新增 `tsHttpFetchSinkIter()`（同模式 `"g"` 版）专供迭代；布尔探测仍用无标志版本（带 `g` 的 `.test()` 会污染 `lastIndex`）。模式至少匹配 5 字符，不可能零宽匹配
- **影响面**：任何含 `fetch(` 且函数体内无 SSRF 守卫词汇（`localhost|ssrf|hostname|…`）的 TS 工程都会挂死提取阶段——这是面向真实代码的普遍故障，不是基准内部的边缘情况
- **验收**：og-image 480s+ → **48s**；tinacms 300s+ → **57s**；gitlab-mcp 切片 480s+ → **80s**；最小复现 70s+ → **18s**

### 修复回归语料扩样至 17 条（fr-012 ~ fr-017）

- **样本结构**：open-webui 占比 75% → **41%**，独立仓库 3 → **10**（gitlab-mcp ×2、mockoon、og-image、redocly-cli、tinacms）
- **结果**：6 条新语料全部 MISS（pre/post 均 0 违规），全库 **DETECTED 4/17、MISS 13/17、PENDING 0**
- **正向对照**：为排除「0 违规是哑值」，scan `demo-project/` 报出 1 条真实违规（`SSG_AUTH_STATE_VIOLATION`，`token_lifecycle_flow.ts::main`）——引擎是活的
- **注册数据修正**：fr-013 的 parent SHA 末 4 位转置（codeload 404）且原 fix_commit 是纯 CHANGELOG 文档提交，经 PR #624 正文 link 定位到真修复 PR #571；fr-012 锚点错位（其「文件读取」半边由更早的 PR #482 修复）
- **新根因类别**：fr-012（MCP 工具实参 `args.file_path`）、fr-015（`decodeURIComponent` 解码后的对象字段 `font.path`）暴露**污点源词汇表缺口**——与 skyvern/open-webui 已暴露的认证词表缺口同族，共同病灶是「标记管线靠名字识源，不靠数据流语义」
- 详见 `blind-benchmark/REALWORLD_FIX_REGRESSION_V2.md`

### 回归

- 新增 `src/extract-ir-ssrf-loop.test.ts` 2 green ✓（①良性 fetch 必须正常返回——修复前永不返回；②URL 形参流入 fetch 仍必须注入 `__progmune_ssrf_user_url__`）/ build ✓

## [3.7.30] — 2026-09-17

### 提取器性能重构（3.7.28 引入的回归修复）

- **问题**：3.7.28 的标记增强（路径穿越/SSRF）采用独立遍历——对每个函数类节点做 ts-morph getStart/getEnd/getText + 正则扫描，check 自扫（仓库 375 个源文件）从 ~30s 退化到 10 分钟+（SSRF 增强单测 4 分钟 CPU）
- **修复**（`src/extract-ir.ts`）：①标记计算**内联进主循环**——复用主循环已获取的函数文本与形参名（computeMarkerCalls），删除两个独立遍历增强函数；②文件级预过滤（路径穿越只看含 request 模式的文件，SSRF 只看含 fetch sink 的文件）；③主循环跳过 node_modules（lib.d.ts 等声明文件只贡献噪声）；④微型节点（<80 字符）跳过正则扫描
- **行为保持**：fr-007 openhop 标记（flowRoutes + FlowStore.save/get/delete/updateFlow）与 fr-011 mcp-from-openapi 标记（fromURL）重构后逐项一致；**TS 795 零漂移（3086 flags LOST 0 / ADDED 0）**
- **诊断教训**：期间本机 8GB 内存被后台进程耗尽（一个 9 小时 CPU 的幽灵 extractor 进程 + 多个未杀净的扫描进程），计时测量被环境噪声污染——定位靠逐步计时（PT 增强 267ms / SSRF 增强 4min+）与进程审计，最终重构从架构上消除该开销

### 回归

- TS 795 零漂移 ✓ / 标记双语料复验一致 ✓ / 引擎测试 73 green ✓ / build ✓

## [3.7.29] — 2026-09-14

### 失败语料沉淀接通（知识网络入口修复）

- **断点**：信任引擎（trust CLI/agent/patrol/MCP）检出的违规从不写入失败语料库——此前只有 agent-loop 的 planner 失败会入 `.progmune_corpus`，引擎找到的真东西不进库，知识网络永远不喂新数据
- **修复**（`src/trust/engine.ts` `writeTrustFailuresToCorpus`）：每次 evaluateTrust 的违规（cap 50/扫描）经 `recordFailure` 沉淀——intent=`trust-scan:<project>`、severity→SVL 阶梯映射（critical→SVL-4…low→SVL-1）、项目函数名快照（cap 300，语料挖掘词段门控输入）
- **去重**：同日同（项目+规则+函数）sidecar 去重——反复扫描不重复沉淀
- **噪声排除**：`PROTOCOL_CROSS_DOMAIN`/`PLAINTEXT_AUTH_WITHOUT_TLS`（已知高 FP、LLM 域映射抖动的 specific-check）不入语料；真实检出面（PATH_TRAVERSAL/SSRF/AUTHZ_CROSS_USER_WRITE/框架层/SSG）照常沉淀
- **测试隔离**：VITEST/NODE_ENV=test 跳过——单测不污染语料
- **首批入库验证**：本周 10 条真实检出全部入库存（openhop PATH_TRAVERSAL×4 + FASTIFY×1、open-webui SSRF×3 + AUTHZ_CROSS_USER_WRITE×1、mcp-from-openapi SSRF×1）——其中 open-webui 3 条 SSRF 命中的正是 fr-009 修复补丁加固的 web 加载器函数族，交叉验证 A3 扩展
- 语料经 immune-reporter 既有管线脱敏上传 hub（默认脱敏口径不变）

### 回归

- build ✓ / 引擎测试 21 green ✓ / 语料写入全部 best-effort（永不打断扫描）

## [3.7.28] — 2026-09-14

### SSRF 检测 TS 化 + Python 形参污点扩展（A3，修复回归 fr-009/010/011 驱动）

- **TS 提取器 SSRF 标记**（`extract-ir.ts`）：URL 形参/request 污点 → HTTP fetch sink（fetch/axios.*/http.request/ky.*/undici.request/nodeFetch/got），函数内无 SSRF 守卫词汇（private-IP/loopback/denylist/hostname 校验）→ `__progmune_ssrf_user_url__`
- **Python 形参污点扩展**（`extract_ir.py`）：URL 形参（url/target/endpoint/spec_url…）作为污点源（库形态，如 from_url(url)）；守卫抑制词汇（validate_url/safe_http/is_blocked_hostname 等；**不含裸 "ssrf"**——PyGoat 实验模板名 ssrf_lab2.html 会被误抑制）；**is_request_rooted 收紧**：裸名 "request" 仅当它是函数形参才算请求根——此前局部变量命名为 request 会被误判（skyvern _fetch_discovery FP 根因）
- **引擎 IR 层消费**：SSRF 违规直接报出（同 PATH_TRAVERSAL/AUTHZ_CROSS_USER_WRITE 模式）——Python 侧 SSRF 标记此前在引擎管线中是死的，本版点亮
- **修复回归战绩 4/11**：fr-011（mcp-from-openapi TS，引擎级：修复前 SSRF ×1 @ fromURL 真值位置/修复后 0）✅、fr-010（unstructured Python，提取器级：修复前 2 标记命中 partition_md/file_and_type_from_url/修复后 0；整仓 tarball 网络截断，mini 语料验证如实记录）✅、PyGoat ssrf_lab2 引擎级 TP 恢复 ✅；fr-009（open-webui DNS 重绑定）为「守卫存在但不足」类，标记模型边界如实不覆盖
- **skyvern 精化**：_fetch_discovery FP 消除；_download_screenshot 为弱 TP（scheme 校验≠SSRF 防护，如实标注）

### 回归

- TS 795 零漂移（3086 LOST 0/ADDED 0）✓ / Python 盲测 64/64 ✓ / Python 源级金标 SSRF 0 命中 ✓ / open-seo 10 无漂移 ✓ / 引擎测试 73 green ✓ / build ✓ / check 免疫正常 ✓

## [3.7.27] — 2026-09-13

### 归属校验 Python 化（A2，修复回归 fr-005 驱动）

- **跨用户资源写入检测**（`tools/extract_ir.py` 新标记 `__progmune_cross_user_write__`）：函数把请求 payload 里的外来资源 id（folder_id）带着持久化（insert/add/create）却没有资源归属守卫 → 标记。**严格归属守卫词表**（任一出现即抑制）：归属字段比较（user_id/owner_id/user.id）、`has_*/check_*_folder_access` 助手、`get_*_by_id_and_user_id` 限定查询——**不含 `has_permission`**（fr-005 真值函数含特性权限检查，与资源归属无关）；`insert_` 前缀持久化原语不标（归属决策在上游路由层）
- **引擎 IR 层消费**（`src/trust/engine.ts`）：`AUTHZ_CROSS_USER_WRITE` 违规直接报出（同 PATH_TRAVERSAL 模式）；`protocol-detector.ts` 同名规则供 source-level 路径
- **fr-005 闭环验收**：修复前 DETECTED（open-webui main.py::chat_completion，真值位置）；修复后 0 误报（has_folder_write_access 抑制）；chats.py create_new_chat / automations.py（有守卫）均不标
- **修复回归战绩 2/8**（fr-007 路径穿越 TS 化 + fr-005 归属校验 Python 化）

### 回归

- Python 盲测 64/64 零漂移 ✓ / Python 源级金标新规则 0 命中 ✓ / skyvern 24 无漂移 ✓ / 引擎测试 73 green ✓ / build ✓ / check 免疫正常 ✓

## [3.7.26] — 2026-09-13

### 精度修复批次（AI 生成项目验证 V2 + 真实修复回归驱动的引擎改动）

- **FastAPI 认证词表补现代认证形态**（`tools/extract_framework_py.py`）：`current_org`/`current_caller`/`caller_context`（skyvern 146 条误报的根因词族）+ `verified_user`/`admin_user`（open-webui 142 条误报的根因词族）——每个新真实语料都暴露一批框架层词汇缺口；fastapi-realworld 0 FP 保持 + 摘保护反证精确触发
- **词段匹配边界收紧**（`ssg-bridge.ts` Strategy 2）：规则词必须按序出现且首词@词位 0、末词@末位（此前仅要求全部出现即命中）——skyvern 35 条 SSG 误报消灭 16 条、nginx 3 FP→0；**Python 盲测 64/64 零漂移、TS 795 零漂移（3086 flags LOST 0 / ADDED 0）、C 金标 F1=95.7% 不变、Go 盲测 P=R=100%**
- **一次性文件 API 原子化**（`protocols.json`）：`read_text`/`write_text`/`read_bytes`/`write_bytes`/`pathlib.*` 入 `read_file_atomic`/`write_file_atomic` 别名——Path.read_text 族内部完成 open→close，不再报裸读
- **类方法提取修复**（`extract-ir.ts`）：类方法循环此前误置于变量声明循环内——无顶层变量声明的文件（openhop store.ts 复现）方法整体漏提取，有变量声明的文件重复 push；移至文件层 + `cls.isExported()`
- **路径穿越检测 TS 化（A1，修复回归 fr-007 驱动）**：TS 提取器注入 `__progmune_path_traversal__`（request 污点→fs sink 单跳 + 跨函数一跳——调用点污点实参流入项目方法体内的文件 sink）；**引擎 IR 层直接消费标记**（call-sequence 构建过滤 `__progmune_` 前缀，标记到不了 specific-check——Python 标记此前在引擎管线中是死的，本版同时点亮两侧）；规则 `languages` 补 typescript/javascript；domain-validator 补 `PATH_TRAVERSAL` 检查

### 真实安全修复回归 V1（决定性实验，回答「能力 vs 语料」）

- **语料**：8 条真实修复（open-webui 6 Python / openhop 1 TS / SimpleWebAuthn 1 TS，全部 GHSA/CVE + 修复 commit + 真值文件清单），注册表 `blind-benchmark/fix-regression-corpus.json`
- **基线 0/8 检出**——漏报根因七类逐条记录（查询语义 / 策略逻辑分支 / 凭据数据流 / 归属数据流 / 配置通道路由 / 语言面缺口 / 密码学协议语义），见 `blind-benchmark/REALWORLD_FIX_REGRESSION_V1.md`
- **A1 后 fr-007（openhop Flow ID 路径穿越）转 DETECTED**：PATH_TRAVERSAL ×4 命中真值位置（routes.ts flowRoutes + store.ts FlowStore.save/get/delete）；fr-001~006/008 待对应能力扩展
- **AI 生成项目验证 V2**（`blind-benchmark/REALWORLD_AI_GENERATED_V2.md`）：Skyvern ⭐22,971 生产管线扫描 181 条违规逐条人工标注全 FP——框架层认证词汇缺口 144 条 + 词段误报 35 条（其中 16 条把代码里的路径穿越防御/符号链接校验误报为协议违规）；修复后 181→22（剩余 19 条夹心形态词法不可区分 + 2 条 HMAC webhook + 1 条精确名碰撞，见报告 §3.2 与 §5）

### 回归

- 发布门：build ✓ / check 免疫正常 ✓ / Python 盲测 64 零漂移 ✓ / TS 795 零漂移 ✓ / C 金标 F1=95.7% ✓ / Go 盲测 P=R=100% ✓ / 定向 184 tests green（本地全量套件重负载 worker 崩溃为既有环境问题，以 CI 为准）

## [3.7.25] — 2026-09-10

### 失败语料上报链路修复（中央 hub 恢复数据流）

- **诊断**：中央 hub 自 2026-05-18 起零新增（totalCount=12），npm 周下载 1000-2000 但数据全丢——两个断点：① `immune-reporter` 读废弃路径 `failure_corpus/`（语料已统一到 `.progmune_corpus/`）② 端点默认 `localhost:3000`，安装态用户到不了中央 hub
- **修复**：数据源对齐 `.progmune_corpus/{date}/fail_*.json`（`PROGMUNE_PROJECT_DIR`/`PROGMUNE_CORPUS_DIR` 感知，损坏记录跳过）；端点默认 `https://progmune-runtime.fly.dev/report`；`PROGMUNE_HUB=off` 可关闭上报
- **默认脱敏**：函数名 SHA-256 截 12 位（同名同哈希，模式聚合仍有效）；`PROGMUNE_FINGERPRINT_DETAIL=1` 才发送原文函数名；源码与变量值永不上传
- **隐私口径如实披露**：README/落地页/privacy 页——「代码不上传」保持为真，「无遥测」表述改为如实披露脱敏指纹默认上报与关闭方式
- **中央 hub 防护层上线**：字段白名单 + 类型校验（SVL-1~4、时间戳 ±窗口、序列长度上限）；请求体 512KB / 每请求 ≤500 条；实例+时间戳+模式指纹去重；每实例每 10 分钟 ≤5 次；每日 ≤10000 条；可选 `PROGMUNE_HUB_TOKEN` Bearer 认证（客户端 `PROGMUNE_HUB_TOKEN` 环境变量同步支持）
- 回归 12 green；hub 冒烟六场景（正常/畸形/去重/超大/限流/认证）全过

## [3.7.24] — 2026-09-06

### 审计复检三项修复

- **空规则集 fail-closed**：`evaluatePolicy` 对空规则数组直接 BLOCK（合成 `policy_config` 违规）——空数组是 truthy，原实现零规则→零违规→ALLOW；写盘门 / policy CLI / MCP 三路径同步收口，测试锁定
- **loadEnterprisePolicyConfig 解析失败显式携带 configError**（与 loadPolicyConfig 同口径，六条 fail-open 中第 4 条全修）
- **写盘门口径修正**（README 双语 / TIERED_POLICY / AUDIT_RESPONSE）：「写盘策略门」→「**写后回滚门——BLOCK 时文件不残留**」，明确为补偿控制而非写前拦截，写盘与回滚之间进程中断的残留为已知边界
- **落地页 66 金标口径自解释**：「66 金标 检出 64（97%）/ 100% / 0 FP——2 条为注解依赖前置的已知漏检（基线文档单列）」，与发布门 64 一致
- npm gitHead 溯源核对：npm gitHead = tag v3.7.23 commit，三点对齐（发布产物 ↔ tag ↔ 发布 commit）
- 回归 29 green；check 免疫正常

## [3.7.23] — 2026-09-06

### 第三方审计修复批次 + Oracle 隔离政策 + 分资产分级策略

- **治理层 fail-open 修复**（Kimi 行号级审计 P0）：risk 规则 fail-closed（不再伪造 SSL 输入，真实调用提取，无数据/模块不可用 → 显式违规）；kb_coverage 显式化；策略配置解析失败拒绝静默评估（policy CLI exit 2）；**execute 写后回滚门**（项目 opt-in `.progmune-policy.json` 后写盘随即验证，BLOCK 时文件不残留——补偿控制而非写前拦截，写盘与回滚间进程中断为已知边界；策略引擎首次获得写盘强制力）；`PROGMUNE_STRICT=false` 逃生门写入审计事件日志；决策层注释与实现对齐（乘积→加权平均）；证书时间戳贯通 PolicyContext；**潜伏 bug**：certify 的 plsbRecall 恒为 0（metadata 从未有 recall 字段，HIGH 置信度门槛永远不可达）→ 修为 verified/total
- **跨命名空间死规则归位 + 活性守卫**（Kimi 发现 3 系统化）：全量扫描 14 条死规则——4 条归位（logout_without_invalidate/admin_action_without_check/double_commit/check_resource_ownership 挪进 pre 状态所在命名空间）、10 条 printlab 业务链为文档化例外（待跨命名空间状态引用特性）；`protocol-rules-liveness.test.ts` 使死规则永久回归可防
- **P1 批**：SUPPRESS 等全部决策持久化审计事件日志（含 fpRate/envFactor/importance 全输入）；截断序列覆盖率显式降级上报（truncatedSequences + summary 标注）；README 双语边界声明（刻意规避不在防护目标内 / BLOCK 强制力三执行点）；FAQ 澄清 LLM 密钥为可选增强；落地页免疫叙事收敛
- **Oracle 隔离政策**（Hunyuan 定律 5 落地，`docs/ORACLE_ISOLATION_POLICY.md`）：四类评估体系变更（规则/匹配策略/阈值/别名）必须人工确认，AI 只提案；protocols.json 全量 `status: "confirmed"` + 加载端跳过 proposed + `scripts/rule-propose.js` 提案脚手架；evaluateTrust 输出 **oracleIndependence**（confirmedRules / sameSourceAnnotations / confirmedAliases）
- **分资产分级策略**（`docs/TIERED_POLICY.md` + `templates/` 三档 + `progmune-init-policy` bin）：Tier-1 强制（致命资产，写盘门激活）/ Tier-2 标准（violations 阻断，其余 WARN）/ Tier-3 观察（只报告）——「出错代价 × AI 参与度」二维分级，一条命令落地
- **审计回应文档** `docs/AUDIT_RESPONSE_2026-09.md`：逐条回应智谱 + Kimi 两份审查（已修复 12 项 / 事实澄清 5 项 / 设计边界 3 项 / 计划 4 项）
- 发布门：套件全绿（含 policy 新测试 6 项）；Python 盲测 64 / TS 795 / C 应用金标零漂移；check 免疫正常

## [3.7.22] — 2026-09-06

### Java 方法学三连——恢复率裁决 + 真实闭环 + 名碰撞消除

- **提取器恢复率裁决**（tree-sitter-java AST 基准，spring-realworld）：修复三根因（参数注解实参括号 34、通配符泛型 3、构造器 2）+ 调用侧修复（泛型构造调用/注释剔除/多行点链/泛型静态调用）——方法 100%（178/178）、调用边 100%（1216/1216）、0 FP。**词法路线成立，无需 JavaParser 依赖**（与 C/Go 同级别裁决）
- **真实语料协议行标注闭环**（`REALWORLD_JAVA_ANNOTATION_V1.md`）：3 注解 + 1 别名端到端——v1 token 合法流 0 违规 + 摘抽取步反证精确报出；**v2 捕获真实 TP**（spring-realworld `updateUser` 密码明文入库——1581★ 参考实现真实 bug，改密后无法登录；修复变异违规即消）；v3 语料无手工资源管理（MyBatis 托管）维持合成金标
- **接收者限定名匹配（名碰撞根因修复）**：提取器 `className` 捕获（嵌套类感知类名栈）+ 完整点链调用输出；注册层 `Class.method` 限定键（裸名键仅项目内唯一时注册）；匹配层大小写不敏感限定精确匹配（带点调用跳过规范化/词段形态）；变量名≠类名（`jwtService.` vs `DefaultJwtService`）走项目别名（注解合并后重校验加载）——**1 真实 TP / 0 误报**（9 名碰撞消除）
- **P4.6 内联深度恢复**：call-sequence 限定调用末段回退解析（同文件优先 + 接收者-类名双向后缀偏好；规则保留集大小写不敏感前置）——违规归因上移到入口（updateProfile），与 TS/Python「helper 违规归因到入口 flow」语义对齐
- **Spring 现代方言真实语料验证**（`REALWORLD_SPRING_V2.md`，ali-bouali/spring-boot-3-jwt-security，Boot 3 教程标杆）：SecurityFilterChain bean + requestMatchers 静态导入 + **String[] 变量白名单展开**（原保守跳过致公开 mutation 被兜底掩盖漏报）+ auth 词段豁免修复（authenticate/refresh-token）——15 路由 0 issues、摘兜底反证 5 重现、V1 语料复扫无回归
- **audit:realworld fastapi 考核入口修复**（模块名推导 py→fastapi，该框架自工具建立即不可用）+ 全框架语料复扫 14/14 零回归
- 发布门：套件 255 green；Python 盲测 64 / TS 795 / C 应用金标 F1=95.7% 全部零漂移；check 免疫正常（.progmune_allowlist 存量补录）

## [3.7.15 – 3.7.21] — 2026-09-04/05

### 框架真实语料 12/12 收官 + Java/Spring 语言支持 + Java 协议行引擎化

- **框架检测器真实语料全量收官（12/12）**：Fiber 真实生产语料考核（journalist 多层 Register 链传播引擎 12 FP→0 + 反证 9 重现；jiotv_go 能力令牌形态标注）——8 启发式 + 4 结构级全部真实语料验证到 0 协议级 FP + 敏感性反证；CLAUDE.md 转正待办清空
- **audit:realworld 一键考核工具 + 证据档位制**：任意真实开源项目 clone/vendor → 扫描 → JSON 报告 → 金标标注模板（docs/REALWORLD_METHODOLOGY.md）
- **Java/Spring 语言支持（3.7.17-18）**：`extract-ir-java.ts` 提取器（纯 TS 词法）+ Spring 路由覆盖模型（19 路由/12 mutation 全解析、0 issues、anyRequest 兜底翻转反证 10 重现）+ 调用图提取 + SSG 方向决策（`REALWORLD_SPRING_V1.md`）
- **Java 协议行引擎化（3.7.19-21）**：协议行金标 v1 + Spring 方言扩展（requestMatchers/类级 @PreAuthorize）；token 生命周期 / auth-register 哈希先行 / resource 管理（invalidate + 泄漏端）三族引擎回归锁定（docs/java-language-status.md）

## [3.7.14] — 2026-09-02

### Go 提取器修复 + 恢复率裁决 + 框架诚实分层 + 三语料实验

- **提取器两处修复**：①无函数体声明行（`//go:linkname` 类）吞并下一个函数（Getuid/RoundTrip 漏检根因——与 C 3.7.4「# 行吞函数」同族）；②接收者方法 receiver 括号组误当参数组（returnType 取到整签名）——回归测试锁定
- **恢复率裁决**（评审第 3 条落地）：tools/go-fn-list.go（go/parser 金标，同一文件集+只计有体函数）+ scan-go-recovery.ts——stdlib 四包 **2434/2434 = 100.0%** → **维持纯词法，go/parser 桥推迟**
- **命名鸿沟测量**（孵化器理论核心数据）：词段可桥接 0-1.9%——Go stdlib 惯用命名无法桥接内置规则词汇（与 C 命名鸿沟同构）
- **框架诚实分层**（评审第 5 条落地）：「12/13 结构级」→「**12 专用检测器 = 4 结构级（AST：NestJS/FastAPI/Django/Flask）+ 8 启发式（代码串：Express/tRPC/Fastify/Next.js/Koa/Hapi/Gin/Fiber）**」；转正门槛 = 真实项目 FP 数据点；CLAUDE.md 矛盾行修复；落地页/矩阵/README 双语同步
- **Go 三语料实验**（REALWORLD_GO_V1.md，评审第 4 条落地）：stdlib 4 FP 全 FP（readColonFile 词段桥接跨窗口类）；govwa（vendored benchmarks/go-apps/）B 路径 0 flags；**A 路径 demo-real-go-govwa**：真实代码 3 注解（loginAction=verify/SetSession=establish/AuthCheck=guard）→ 0 FP + 植入违规精确定位 + 3 注解/协议——**Go 定位维持注解驱动（Beta）**
- **TS 795 完整复跑**（评审第 6 条落地）：recall 98.5%（有效 100%）/ precision 100% / FP 0——12 个框架探测器全上线后与历史基线一致
- 验证：35 定向测试；Python 盲测 v1.2 64 零漂移；check 免疫正常

## [3.7.13] — 2026-09-02

### Go 语言支持 + Gin/Fiber 框架适配——12/13

- **Go IR 提取器**（`src/extract-ir-go.ts`，纯 TS 词法——与 C 提取器同哲学：零外部工具链，npm 安装态可用，不重蹈 Python 桥的安装态覆辙）：func 签名（多行/接收者方法）、调用提取（obj.Method() 取 Method）、注释注解 `// @progmune(...)` + 文档标签、exported=首字母大写、vendor/testdata/*_test.go 表面过滤、Go 关键字排除、反引号 raw string 掩码；8 个单测
- **注册表接入**：LANGUAGE_EXTRACTORS 第 4 语言（detect .go → extractIRGo）→ extractProjectIR/evaluateTrust 全链路自动生效；**引擎 autoExtractor 补 go**（修复 Go 项目静默走正则回退的同类陷阱——首轮金标全错暴露）
- **Go 协议盲测 v1**（`scan-protocol-golang.ts`，自包含生成+扫描）：3 干净（直连/方法/helper）× 3 植入违规（missing_auth/read_without_open/leak）——**TP 5 / FP 0 / FN 0 → P=100% / R=100%**
- **Gin（第 11 个）**：`gin-detector.ts`——GIN_ROUTE_NO_AUTH（r.POST 中间件链 + Use/Group 组级认证）；Go 方法名大写（r.POST）正则 i 标志修复；"middleware" 词误撞修复（loggerMiddleware 类工具中间件≠认证）
- **Fiber（第 12 个）**：`fiber-detector.ts`——FIBER_ROUTE_NO_AUTH（app.Post 中间件链 + Use）；同款修复
- **引擎**：collectGinViolations/collectFiberViolations（Go 目录结构特殊：cmd/internal/pkg + 根目录 main.go）+ ginCoverage/fiberCoverage
- **文档**：Go 语言行 ❌→✅ 注解驱动（Beta）（README 双语/矩阵双语/CLAUDE.md/落地页 + i18n）；框架 **12/13** 口径（剩余 Spring Boot 需 Java 支持先行）
- **验证**：23 个新单测（Go 提取器 8 + Gin 8 + Fiber 7）；全套件 **204/204**；Python 盲测 v1.2 64 零漂移；C 演示不变；check 免疫正常

## [3.7.12] — 2026-09-01

### Koa + Hapi 框架结构适配——10/13

- **Koa（第 9 个）**：`src/frameworks/koa-detector.ts`（代码串级，镜像 express/koa 中间件模式）——`KOA_ROUTE_NO_AUTH`：mutation 路由注册中间件链无认证名中间件，且文件内无认证 `app.use` 全局中间件；认证名按词表分类（auth/login/permission/jwt/verify/guard…）；GET 读操作与认证入口路径豁免
- **Hapi（第 10 个）**：`src/frameworks/hapi-detector.ts`（路由配置模式）——`HAPI_ROUTE_NO_AUTH`：mutation 路由 options 无 auth 字段或显式 `auth: false`（显式公开 mutation 检出）；`auth: 'strategy'` / `auth: { strategy: 'x' }` 两种形态均识别为受保护；`auth.strategy` 声明被记录
- **引擎接线**：collectKoaViolations / collectHapiViolations + overall `koaCoverage`/`hapiCoverage`（加性 best-effort）；frameworks barrel 补全（11 个适配器模块）
- **验证**：15 个新单测（koa 7 + hapi 8，含显式 auth:false 与 strategy 对象形态）；引擎冒烟：Koa 全局认证中间件 0 误报 APPROVED 90、Hapi 无 auth 路由检出 + login 豁免 APPROVED 87；全套件 **181/181**；Python 盲测 v1.2 64 零漂移
- **文档**：10/13 口径（README 双语/覆盖矩阵双语/CLAUDE.md/落地页 + Koa/Hapi 矩阵行）
- **边界（如实）**：文件级窗口（跨文件全局中间件不可见，与 Express 检测器同款）；认证中间件按名词语汇识别；Hapi 路由窗口 500 字符（超长配置截断）

## [3.7.11] — 2026-09-01

### NestJS 补全——框架适配 8/13

- **三缺口补全**（`src/frameworks/nestjs-detector.ts`）：
  ①**全局 APP_GUARD 守卫识别**——@Module providers 的 `{ provide: APP_GUARD, useClass: X }`（装饰器参数与类属性两种形态）→ 全局认证守卫存在时 mutation 路由不再误报；
  ②**@Public()/@SkipAuth()/@AllowAnon() 豁免装饰器**（类级+方法级）——全局守卫模式下的公开路由标记；**显式绕过全局守卫的 mutation 路由 → NESTJS_NO_AUTH**（消息注明绕过的是哪个全局守卫）；
  ③**守卫名认证分类**——ThrottlerGuard/RateLimit/Logger 等非认证守卫不再算认证（限流≠认证，实测误报源）
- **引擎接线升级**：collectNestJSViolations 从 per-file 切 **项目级一次装载**（analyzeNestJSProject）——全局守卫与 @Public 需要跨文件上下文，per-file 分析无法识别全局守卫（系统性误报根因）；coverage.filesScanned 口径改为分析单元=项目
- **合成金标**（`generate-projects-nestjs.ts` + `scan-protocol-nestjs.ts`）：6 项目（类级守卫/全局 APP_GUARD+@Public login/无守卫/显式绕过/ThrottlerGuard 非认证/敏感 GET 公开）——**TP 12 / FP 0 / FN 0 → P=R=100%**
- **验证**：6 个新单测（含 @Public login 在全局守卫下不报）；引擎冒烟 N2 APPROVED 87（全局守卫正确识别）、N4 BLOCKED（显式绕过 critical 拦截）；全套件 166/166；Python 盲测 v1.2 64 零漂移；C 演示不变
- **文档**：NestJS ⚠️ 部分 → ✅ 结构分析（README 双语/覆盖矩阵双语/CLAUDE.md/落地页「8/13 专用检测器」口径）

## [3.7.10] — 2026-09-01

### 安装态 Python 全链路修复（npm 包正确性）

- **修复**：`tools/extract_ir.py` + 三个框架扫描器（`extract_framework_py.py` / `extract_framework_django.py` / `extract_framework_flask.py`）加入 npm 包 `files` 白名单——**此前安装态（MCP 主产品形态）的 Python IR 提取与框架结构扫描全部静默失效**（脚本不在包内，execSync 失败被 best-effort 吞掉）。M1/M2 验证时发现的既有遗留，非 3.7.8/3.7.9 引入
- **安装态端到端验证**（此前从未有过）：打包 tarball → 临时目录 npm install → 用安装态的 dist 跑 evaluateTrust——FastAPI 合成项目检出 `FASTAPI_ROUTE_NO_AUTH`（框架扫描生效）、Python 盲测项目检出 SSG 违规（IR 提取生效）、**安装态与仓库态 A/B 完全一致**；`tools/__pycache__` 未入包（files 精确文件路径）
- **落地页**：语言覆盖现状更新入版（C 注解驱动 Beta 行 + 框架适配 7/13 行 + 双语 i18n + 证据链接）
- 包体：377 文件（+4 个 .py，约 71.5KB）

## [3.7.9] — 2026-08-28

### Flask / Fastify / Next.js 框架结构适配（M4——框架适配 7/13）

- **Flask（Python 第 3 个）**：`tools/extract_framework_flask.py`（@app.route/@bp.route + methods kwarg、认证装饰器、before_request 认证守卫、Blueprint）+ `src/frameworks/flask-detector.ts`（`FLASK_ROUTE_NO_AUTH`——mutation 路由无认证装饰器且无认证 before_request 守卫）——合成金标 4 项目 P=R=100%；vendored flask 库结构识别冒烟通过；修复 before_request 误放 Assign 节点（应为 Expr 表达式语句）
- **Fastify（TS 第 3 个）**：`src/frameworks/fastify-detector.ts`（代码串级，镜像 express-detector——路由注册 + preHandler/preValidation 认证选项 + addHook 认证钩子；`FASTIFY_ROUTE_NO_AUTH`）；引擎冒烟：钩子保护正确识别（0 误报）；8 个单测
- **Next.js（TS 第 4 个）**：`src/frameworks/nextjs-detector.ts`（App Router 文件级结构——route.ts 的 POST/PUT/PATCH/DELETE 导出 + next-auth/自定义认证调用 + 认证 middleware；`NEXT_ROUTE_NO_AUTH`）——7 个单测；pages/api 旧式 handler 方法不可静态区分（只计数如实）；修复注释内 `app/**/route.ts` 的 `*/` 提前终止块注释陷阱
- **引擎接线**：collectFlaskViolations / collectFastifyViolations / collectNextjsViolations + overall 三个 coverage 字段——全部加性 best-effort；frameworks/index.ts barrel 补 5 个适配器导出
- **验证**：新单测 21 个；全相关套件 160/160；Python 盲测 v1.2 64 零漂移；fastapi/django realworld 0 FP 保持；C 演示不变
- **边界（如实）**：Flask 认证 before_request 按函数名词汇识别（自定义名漏判=漏报方向）；Fastify 代码串级（配置展开不可见）；Next.js 只盯 API 面（route.ts/pages-api，页面组件不检查）；npm 安装态 tools/ 不在包内→Python 框架扫描静默降级（既有遗留）

## [3.7.8] — 2026-08-28

### Django / DRF 框架结构适配（M2）——框架适配第 4 个

- **结构提取（Python AST）**：`tools/extract_framework_django.py`（与 extract_ir.py / extract_framework_py.py 解耦）——urlpatterns 解析（url()/path()/re_path() → FBV / CBV .as_view() / include）、FBV 登录装饰器（login_required/permission_required/staff_member_required/user_passes_test + 自定义 *auth* 装饰器）、CBV 基类与方法（View/generics + LoginRequiredMixin 等混入）、DRF permission_classes（AllowAny/IsAuthenticated/其他类名）与 @api_view（methods + permission_classes kwarg）
- **检测规则**（`src/frameworks/django-detector.ts`）：
  - `DJANGO_VIEW_NO_AUTH`——mutation 视图无保护：FBV 按动词名门控（add/create/update/delete/transfer 等——信息页 home/robots/error 不报）；CBV 按方法含写操作（post/put/patch/delete/create/update/destroy）+ 无认证装饰器/无 LoginRequiredMixin
  - `DRF_PERMISSION_BYPASS`——DRF 视图写方法 + 显式 AllowAny / 空权限类（非认证入口端点）
  - 认证入口词汇豁免（login/signin/regist/token/health 等，视图名+URL 名+pattern）
- **引擎接线**：`collectDjangoViolations`（仅 Python，best-effort）+ `overall.djangoCoverage`——加性零漂移
- **合成金标**（`generate-projects-django.ts` + `scan-protocol-django.ts`）：FBV/CBV/DRF × clean/V1/V2/V2b/V1V2 = 8 项目——**TP 6 / FP 0 / FN 0 → Precision 100% / Recall 100%**
- **真实应用验证**：django-realworld（15 路由结构全识别：DRF generics + permission_classes 接线、RegistrationAPIView/LoginAPIView AllowAny 正确豁免）——**0 FP**；PyGoat 133 路由结构全识别，适配器 2 条 flags 均为故意脆弱 lab（csrf_transfer_monei_api / DoItFast）——如实记录；fastapi-realworld 0 FP 保持
- **修复（子串陷阱）**：`registration` 不含 `register` 子串、`register` 不含 `registr` 子串——认证入口词干统一为 `regist`（FastAPI/Django 两检测器同步）+ 回归测试锁定
- **验证**：19 个新单元测试（django-detector 10 + fastapi 豁免回归）；套件 139/139；Python 盲测 v1.2 64 零漂移；C 演示 SSG 结果不变
- **边界（如实）**：FBV 无法静态区分 HTTP 方法（动词名门控口径，非方法级）；include() 递归不展开（被 include 的应用 urls.py 单独成文件时已覆盖）；自定义 permission 类视为保护（保守）

### FastAPI 框架结构适配（M1）——框架适配第 3 个

- **结构提取（Python AST）**：`tools/extract_framework_py.py`（与 extract_ir.py 解耦，零风险）——路由（@app.get/@router.post/@r.api_route）、依赖注入（Depends()/Security()，含 Annotated[...] 订阅、嵌套调用解析、**装饰器级 dependencies=[...]**（realworld 风格）、认证方案声明（OAuth2PasswordBearer/HTTPBearer/APIKeyHeader 等 8 类）、全局中间件；跳过 tests/deps/venv 等非生产目录
- **检测规则**（`src/frameworks/fastapi-detector.ts`，结构提取与规则判定解耦）：
  - `FASTAPI_ROUTE_NO_AUTH`——写操作路由（post/put/patch/delete）无认证依赖且非认证入口端点（login/register/token/health 词汇豁免）→「每个 API 入口都有门禁」的精确形态；公开读（GET）不检查（realworld 的 tags/文章列表就是公开 GET——只盯 mutation 面把误报压到最低）
  - `FASTAPI_DEAD_AUTH_SCHEME`——声明了认证方案但没有任何路由引用（认证设施是死的，装饰性声明）
- **引擎接线**：`collectFastapiViolations`（仅 Python 项目跑 python3 扫描；best-effort 永不阻断评估）+ `overall.fastapiCoverage`（apps/routes/filesScanned/issuesFound）——加性零漂移
- **合成金标**（`generate-projects-fastapi.ts` + `scan-protocol-fastapi.ts`，镜像 generate-projects-python 方法论）：3 结构风格（直连/APIRouter/认证方案）× 4 违规变体（clean/V1 无认证写路由/V2 死方案/V1V2）= 12 项目——**TP 13 / FP 0 / FN 0 → Precision 100% / Recall 100%**
- **真实应用验证**：fastapi-realworld（19 路由全结构识别：签名 Depends 与装饰器 dependencies= 两种认证接线风格）——**0 FP**；django-realworld/django-unicorn 无 FastAPI 结构 → 适配器静默直通（结果不变）
- **零漂移**：Python 盲测 v1.2 64 违规零漂移；C 演示 SSG 结果不变；相关套件 128/128（含 fastapi-detector 9 个新回归）
- **边界（如实）**：全局中间件不视为认证（add_middleware 通常是 CORS；自定义认证中间件结构不可见）；Depends 目标按 auth-like 词表+方案引用判定（无数据流分析）；npm 安装态下 tools/ 不在包内 → 框架扫描与既有 Python IR 提取一样静默降级（安装态 Python 全链路为既有遗留问题，不随本版引入新差异）

## [3.7.7] — 2026-08-28

### C 注解采纳体验（采纳生死线工具）

- **注解建议引擎**（`src/annotation-suggest.ts`）：确定性启发式（无 LLM）——按函数名词汇（3.7.6 金标 5/5 真实注解反推的词表）× 已注解状态，生成原语注解候选（verify/establish/guard/open/close 角色 + 命名空间/状态转移/注释块模板/置信度/命中理由/掩蔽风险标记）；已注解、规则名、外部函数自动排除；两遍计算 maskRisk（体内调用规则原语或本批同被建议函数）
- **CLI 扫描模式**（`scripts/c-annotate.js --scan <dir> [--write] [--all] [--include-resource]`）：dry-run 默认；--write 自动插入函数定义上方（写入后自动刷新 ir.json 防陈旧）；保守门控（全部实测依据）：establish/掩蔽风险跳过（不提供强制开关）、open/close 跳过（--include-resource 强制）
- **引擎加性字段**：`evaluateTrust.annotationSuggestions`（仅 C 生成；TS/Python 无该字段——零漂移）
- **验收（REALWORLD_C_V7.md）**：无注解 uftpd 副本金标恢复率 **4/4 角色正确**（check_user_pass=verify / handle_PASS=establish / do_RETR / do_STOR=guard）；自动应用 7 条后与手写金标**等价**（真实代码 0 SSG FP、植入违规 2/2 精确定位、NEEDS_REVIEW 72 同分）
- **三个实测安全发现（自动写入的门控依据）**：①掩蔽风险——establish 注解把手握违规的流函数变「原语」（函数内顺序不检查）后植入违规被掩蔽（实测 2 处）；②资源生命周期注解自动应用触发跨函数窗口 FP 类（实测 28 条，open/close 分处不同函数窗口）；③new_session 词汇误判守卫（实测 4 FP，模式收紧为 channel 类）
- 回归：15 个新单元测试；引擎相关套件 98/98；Python 盲测 v1.2 零漂移（64）；C 应用级金标 F1=95.7% 不变；演示重扫 SSG 结果不变

## [3.7.6] — 2026-08-28

### C 生产级路径收官：金标 5/5 + 采纳案例 + 正则层噪声治理

- **金标 4/5（libssh 回调分发认证）**（`demo-real-c-libssh-cb/` + `REALWORLD_C_V6.md`）：真实 `samplesshd-cb.c`（359 行）逐字——现代回调分发 API（`ssh_server_callbacks_struct` 的 `auth_password_function` / `channel_open_request_session_function`，决策记录指定的最优模块）。2 注解 → APPROVED 82、真实代码 0 FP、植入 `cb_session_no_auth` 精确定位；认证完成跃迁在 libssh 内部 + main 循环条件（L3 边界），establish 由演示层 wrapper 表达（V5 wrapper 模式）
- **金标 5/5（uftpd 数据传送授权）**：采纳项目第二个协议——真实 `do_RETR`/`do_STOR` + 2 注解（pre AUTHENTICATED → post AUTHORIZED，镜像 check_resource_ownership 语义）→ 真实代码 0 FP、`ftp_transfer_no_login` 精确定位（fixPath → `establish_login`）；金标累计 5/5 全部 ~2-3 注解/协议
- **发现 G5（规则面缺口入册）**：SSG 状态机 per-namespace——内置 `check_resource_ownership`（data_integrity，pre=[AUTHENTICATED]）永远不可满足（AUTHENTICATED 在 auth 命名空间，src/tests 全仓库零引用）——规则面设计缺口，非引擎缺陷
- **正则层噪声治理（V5 发现 4 落地）**：`PLAINTEXT_AUTH_WITHOUT_TLS` 加 `languages` 门控排除 C（真实语料证据 3 FP / 0 TP：libssh 演示 1 + uftpd 采纳案例 2——FTP/SSH 应用层本就明文，Web/TLS 语义对 C 无意义）；SSH 主机密钥规则保留全语言（libssh 演示 1 TP）。`checkSpecificViolations` 加 `language` 参数、engine 传 `ctx.language`、5 个回归测试；**双零漂移**：Python 盲测 v1.2 64 违规（仅时间戳差）、C 应用级金标 F1=95.7% 不变；uftpd 重扫 PLAINTEXT ×2 消失、libssh 演示 FP 消失 TP 保留
- **标签升级已拍板**：C「⚠️ 研究」→「✅ 注解驱动协议验证（Beta）」——README 双语、覆盖矩阵双语、c-language-status、CLAUDE.md 同步翻新；能力边界如实保留（未注解不检测、TLS 级无覆盖）

### C 定位拍板「注解驱动」+ 库边界机制 + 精度修复

- **定位拍板**（Decision record 定稿）：C = 注解驱动协议验证（研究级）——未注解自动检测 0 TP/3 FP，两条自动检测桥（C 库别名注册表、方言解析器）不排期；文档翻转：README 双语 + 覆盖矩阵双语 C 行「⚠️ 注解驱动（研究级）」
- **库边界机制（孵化器）**：两层——项目原语注解（`@progmune`，不迁移）+ **库边界别名**（`.progmune_aliases.json` → 共享表 `c-aliases.json`，跨项目迁移）。新增：`scripts/c-annotate.js`（注释块模板 + 别名条目建议脚手架）、`scripts/c-alias-propose.js`（别名校验 + 回写提案 + 人工确认门）；引擎 `loadProtocolRules` 合并共享表 **confirmed** 条目（proposed 不生效、不覆盖全局/项目别名、规则不存在跳过）；`c-aliases.json` 入 npm 包
- **库边界演示**（`demo-real-c-libssh/` + `REALWORLD_C_V3.md`）：真实 libssh authentication.c 逐字 + 1 别名 + 1 注解 → SSG 层 0 误报、植入 missing-auth 精确定位；正则防护层同跑：SSH_NO_HOST_KEY_CHECK 为**真发现**（示例确实不验证主机密钥）、PLAINTEXT_AUTH_WITHOUT_TLS 为 FP（Web 语义规则误映射 SSH，如实记录）
- **发现**：多机制认证重试循环的状态机语义缺口（verify 类规则 pre 不可重入——全机制别名映射会误报正常重试流，候选：可重试标记）；fixPath 反向映射（规则名 → 库调用名）候选
- **陷阱修复（DSH 复测发现）**：`evaluateTrust` 的注解合并依赖 ir.json 写盘，而自动提取此前仅 TS/JS 生效——C/Python 项目直接调用时注解静默失效。现在按语言分派提取器自动写盘（C 走合并形态；TS/JS 路径零变化）+ 回归测试；提取器改静态导入（vitest 下 lazy require 的 CJS 互操作不可靠——该分支从未被测试触发过）
- **精度修复**：真实语料 24 FP → 3 FP（-87.5%）

### C 精度修复：真实语料 24 FP → 3 FP（-87.5%）

- **Strategy 1 normalized 门控**：Windows API（ReadFile/WriteFile/DeleteFile）经 CamelCase→snake_case 规范化撞上内置规则名是 11/24 FP 的主导源——normalized 分支套用词段门控同款 projectFunctions 门（外部 API 不桥接；注解桥接不受影响——注解原语必为项目函数；原始名精确匹配不限门控）
- **endState 直接调用溯源**：12/24 FP 是 nginx 回调式生命周期（open 在内联 helper 链、close 在指针注册的回调里——L3 级不可见）——`CallSequence.directCalls` + `validateSequenceWithSSG` 的 `entryDirectCalls` 参数，仅当资源获取调用是入口的直接调用时报告 endState（helper 获取不归因入口）
- **结果**：真实语料四仓库 24 flags → **3 flags**（nginx 14→0、redis 0、libssh 1、openssl 2；残留 3 条是词段桥接按设计命中项目函数）。双回归门全过：Python 盲测 v1.2 64 违规零漂移（仅时间戳差异）、C 应用级金标 **TP 11/FP 1/FN 0 → F1=95.7% 不变**（leak_file 的 endState TP 保留）、引擎相关套件 120/120
- **战略记录**：C 产品定位（自动检测 vs 注解驱动）待拍板——写入 `docs/c-language-status.md` Decision record；证据偏向注解驱动（精度修复后未注解自动检测仍 0 TP），金标扩量延后至定位拍板

## [3.7.5] — 2026-08-27

### C 真实语料验证 + 注解驱动演示 + 引擎修复（DSH 双轮评审合入）

- **修复（DSH）：单行指针返回函数系统性漏提取**——`char *foo(`/`SSL *foo(` 类定义被 `(?:^|\s)` 锚点漏掉（名字前是 `*` 非空白）；改为 lookbehind `(?<![a-zA-Z0-9_])` + 回归测试。openssl 等指针密集型仓库补回 ~1,500 函数（如 openssl 15,539 含指针修复与表面过滤的净效果）
- **修复：P4.6 展开兆级序列**（DSH 实测 openssl 单序列可达 1M+ 调用、全扫描 15–25 分钟）——`buildCallSequences` 预算制展开（`MAX_SEQUENCE_CALLS=2000` 可注入，入口自身调用按序优先、超预算即停，`CallSequence.truncated` 标记，不去重——重复调用对状态机有语义）；openssl 全扫描 **15–25 分钟 → 222s**。零漂移前置实测：Python 盲测语料最大序列 23、TS 自身 IR 最大 824（预算零影响），Python 盲测复跑 64 违规不变。**截断是诚实的召回边界**（超大序列尾部违规不可见，非静默回归）
- **真实语料四仓库**（libssh/redis/nginx/openssl）：24 flags 全部人工标注 FP（0 TP）——误报类别稳定（OS API 桥接 11、回调 endState、包装器词段、跨函数窗口），keyword 白名单方向的观测前提已达标待决策；稳定指标 = 黄金函数恢复率 97–100%

- **真实 C 语料验证 v1**（`blind-benchmark/scan-real-c.ts` + `REALWORLD_C_V1.md`）：生产管线扫 libssh/redis/nginx——表面过滤后 16 flags 逐条人工标注全 FP（真实误报率观测：标记精确率 0%）；「命名鸿沟」发现（exact-name 0 次触发，合成金标 95.7% F1 全靠按名+注解命中）；误报源分类：回调生命周期 endState 12 / OS API 关键词桥接 3 / 跨函数窗口 1
- **提取器非生产表面过滤**（对齐 `tools/extract_ir.py` Python 先例）：`collectCFiles` 跳过 `tests/test/examples/docs/docs_src/scripts/deps/vendor/third_party` 目录与 `test_*.c`/`*_test.c`——libssh 63→1、redis 1→0 条 flags；C 金标恢复率零漂移（97/97/89/98/100/99）
- **注解驱动真实项目演示**（`demo-real-c-redis/` + `REALWORLD_C_V2.md`）：真实 redis acl.c 代码 + 3 条注解 → 合法流 APPROVED 85 零误报、植入 missing-auth-check 精确定位；标注成本 ~3 注解/协议——**注解驱动是 C 生产化的现实形态，可行性已验证**
- **引擎修复①（CamelCase 注解规则不可触达）**：注解合并同步注册 normalized 形态（加性，snake_case 注解零变化）
- **引擎修复②（注解合并晚于序列构建）**：P4.5 合并移到 `extractCallSequencesFromProject` 之前——有函数体的注解原语不再被内联掉、post 状态生效；与盲测 harness 语义对齐
- **引擎修复③（fixPath 输出真实函数名）**：`StateAnnotation.displayName` 机制——注解合并记录真实函数名，BFS 展开项目原语优先（stable sort 零漂移）+ 渲染映射；修复建议从通用规则名（`verify_token`）变为项目真实函数（`checkPasswordBasedAuth`），sdk 修复解析直接插入真实调用。三处边界如实记录：establish 赋值状态机不可见（L4 不投入）、模块认证 hook 在状态机外、单条 medium 违规不翻转 APPROVED（决策阈值层独立议题）
- **零漂移验证**：Python 协议盲测 v1.2 复跑 64 违规（报告仅时间戳差异）；引擎相关套件 113/113 + 2 个新回归测试（tests/trust/engine.test.ts）
- **如实记录**：C 语言状态标签维持「研究」；不修项（按评估决策）——establish 赋值不可见（L4 不投入）、medium 违规不翻转 APPROVED（累计扣分设计逻辑，非缺陷）

## [3.7.4] — 2026-08-26

### 新增：C 语言 IR 提取（注册表第三语言）

- **`src/extract-ir-c.ts`**：纯 TS C 提取器（无子进程桥、无原生依赖）——函数签名（含多行、`static`/`inline`/`__attribute__`、指针/数组/函数指针参数）、调用列表（成员调用取 `->`/`.` 后的调用名，`goto` 合成 `goto_<label>`）、`@progmune`/`@protocol` 注解与 `@purpose/@tags/@requires/@produces/@useWhen/@inputs/@outputs` 文档标签（C 注释块镜像 Python 装饰器语法）；注释/字符串感知的括号计数（修复 v2 提取器已知缺口，未改动 `sequence-extractor`——C 金标基准管线保持不动）
- **`LANGUAGE_EXTRACTORS` 注册 `c`**（detect `.c`/`.h`，extract `extractIRC`）——agent 循环、execute() 的 ir.json 写入与 MCP 自动生效；C 项目从纯正则回退切换到 IR-first 序列验证 + SSG 状态机，C 函数名进入词段匹配门控（仅项目函数）；协议行与 protocols.json 规则名（`verify_password` 等）按名命中
- **端到端验证**：临时 C 项目上 extractProjectIR → evaluateTrust 走通——4 条植入违规全部精确定位（内置 auth×2 / db×1 + 自定义 pay 命名空间注解×1），合法链零误报（NEEDS_REVIEW 72 分）；**应用级 C 金标 v1**（`blind-benchmark/scan-protocol-c-app.ts`，镜像 Python 盲测方法学）：10 clean × 7 违规 → **P=87.5% / R=100% / F1=93.3%**（唯一 FP 为跨函数窗口边界，与 Python 盲测 T2×S5 同类）
- **规模化提取**（`blind-benchmark/scan-protocol-c.ts`）：6 个 vendored 仓库（curl 5068 / libssh 3989 / nginx 3199 / openssl 15896 / nghttp2 1315 / redis 10170 函数，3.7.4 发布时代码状态——后续版本口径见 3.7.5）秒级提取，黄金函数恢复率 89–100%；旧 TLS 级金标上 SSG 命中 0/38（口径差异：SSG 无 TLS 规则，如实记录）；nginx 3 FP 为 `ngx_*` 前缀包装器撞词段匹配（引擎层问题，记录待议，未动 SSG 桥避免 TS/Python 漂移）
- **修复：签名正则指数级回溯**——v2 风格类型 token 循环对 `name = ssh_userauth_kbdint_getname(...)` 类行穷举标识符切分（44 字符缓冲 ~11s），改为候选迭代（跳过关键字/类型名候选，返回类型从缓冲区前缀推导）；libssh 提取 >15min（病态）→ 1.8s，回归测试已加
- **评审修复轮（detect/extract 口径、死代码、TU 绑定等）**：①`hasSourceFiles` SKIP_DIRS 补 `benchmarks`（与 extract 口径一致，本仓库自身不再误标 C）；②`#if 0` 死代码块预处理剥离（真实仓库不平衡花括号不再腐蚀函数体计数）；③顶层 `#` 行只跳自身不再吞相邻函数（openssl 14,394→15,896 函数，黄金函数恢复率升至 89–100%）；④`buildCallSequences` 同文件定义优先绑定（跨文件同名 static 不再 last-wins 错绑，入口判定文件化；Python 盲测 v1.2 复测零漂移——报告与基线逐字节一致仅时间戳不同）；⑤提取器取消调用去重（状态机重复调用有语义，双 close/重复 logout 可检出，与 TS/Python 提取器一致）；⑥删死代码 `isCProject`；⑦混合 TS+C 项目回归测试。应用级 C 金标扩至 v2（11 clean × 11 违规 + helper 中介风格 + 逐命名空间分解）：**TP 11/11 FP 1 FN 0 → P=91.7% / R=100% / F1=95.7%**（唯一 FP 为 do_logout 跨函数窗口边界）。已知系统性风险文档化：C 前缀包装器（`ngx_*` 等）撞词段匹配（nginx 3 FP），缓解方案（前缀剥离/连续词段）留待下一轮并强制盲测复跑
- **限制如实记录**：函数指针分发静态不可见（L3 结论不变）、宏/K&R/C++ 不解析、无数据流/指针分析（L4 无计划）；提取器遍历跳过 vendored `benchmarks/`；`docs/c-language-status.md` 已更新（新路线小节 + 基准结果 + Decision record）

## [3.7.3] — 2026-08-24

### 中央免疫 Hub 上线 + 失败语料统一

- **中央 Hub 重新部署**（`progmune-runtime` 应用，`server/hub.js`）：fly.toml 补 443 TLS 端口（此前仅 80，https 不可达），`https://progmune-runtime.fly.dev/report` 生效；数据落持久卷 `progmune_data`（`/app/immune_hub_data`），Dashboard `GET /api/dashboard` 可用（含 5 月历史 12 条指纹 + 冒烟测试 1 条）
- **上报链路打通**：`PROGMUNE_HUB` 指向中央 hub；`immune-reporter` 实测可连（游标增量上报，无新指纹时正常返回）；端到端 POST 冒烟通过（received:1 / total:1）
- **统一失败语料写入路径**：`failure-collector.ts` 的 `CORPUS_DIR` 由仓库根 `failure-corpus/` 改为项目级 `.progmune_corpus/emitter-failures/`（与 `failure-corpus.ts` 同规则：`PROGMUNE_CORPUS_DIR || <PROGMUNE_PROJECT_DIR|cwd>/.progmune_corpus`），消除两套语料并存；dist 已重建
- **部署配置瘦身**：根 Dockerfile 改为零依赖（hub 仅需 `server/` + `public/`，去掉 npm install 与 dist 拷贝）；`.dockerignore` 补 benchmarks/、.progmune_corpus/、dist/ 等大目录（构建上下文 1.1G → 数百 KB）
- **Hub 接口扩展**：`/api/dashboard` 新增 `topPatternsWeek`（本周高频错误模式 Top10）+ 全接口 CORS（`Access-Control-Allow-Origin: *`），供落地页跨域实时拉取

### 落地页新增「失败语料飞轮」板块（05）

- 三卡飞轮叙事（失败入库 → 中央汇聚 → 反馈增强）+ **实时本周高频错误模式 Top 10**（浏览器端 fetch `progmune-runtime.fly.dev/api/dashboard`，SVL 分级徽章 + 调用序列 + 次数；空态/不可达有兜底文案）
- 中英文切换覆盖（113 i18n 键）；序号顺延：使用→06、路线图→07、社区→08；导航新增「飞轮」入口

### 文档全量一致性审计

- 全仓文档与当前进度核对并修正：
  - **CLAUDE.md**：Current coverage reality 更新至 2026-08-24（TS 795 gold 98.5%/100%、Python ✅ 生产级、C ⚠️）；"Python/Go/Java planned"→"TS + Python production"；"Don't add TS rules"禁令改按现行基准表述；P0-P3 标注历史阶段；架构表补 `src/call-sequence.ts`（P4.6）、Protocol Detector 标注为正则回退；SDK 导出修正为 verify/explain/getCompatibility
  - **README 双语**：P0-P3 数字统一为权威口径（+31 规则/+86 轨迹/+13 检测器/+11 防护，另 +19 检测）；21→27 命名空间；架构图 Protocol Detector 标注正则回退 + 补 P4.6 调用序列层
  - **覆盖矩阵双语**：C 列 Connection 按图例降 ⚠️（极高误报率），汇总 ✅×4/⚠️×4；IR 层补 3.7.1 恢复 IR-first + 词段门控注记；日期 08-24
  - **BASELINE_PROTOCOL_PYTHON_v1.md**：标题升 v1.2（文件名兼容保留）；风格表补 S5 行
  - **BASELINE_v6.md**：reset_password"已检出/未覆盖"矛盾消歧（md5 形状已检出、其他形状无规则）；TS precision 99.1%（8-15 波次）与 100%（8-16 打磨后）口径注明
  - **QUICK_START.md**：npx 子命令（发布包中不存在）改为真实入口（MCP / GitHub Action / 仓库 CLI）；覆盖表对齐覆盖矩阵
  - **API_REFERENCE.md**：按真实表面重写——SDK 仅 verify/explain/getCompatibility（verify 为同步单参、VerificationResult 字段如实列出）；npm bin = MCP server（工具清单）；仓库 CLI scripts 表；环境变量表保留
  - **RUNTIME_ARCHITECTURE.md**：7 protocol definitions→27 命名空间/148 规则；业务指标表过时数字（FPR 97%、F1 27-41%）改为现行基准（0 FP、TS 98.5%/100%、C F1 16.5%）
  - **项目全解.html**：hero 版本 v3.2.0→v3.7.2；21→27 命名空间（2 处）；85.2% F1 旧数字→现行基准；5.7 基准表补协议盲测 v1.2 行；6.1 产品形态补社区双渠道机器人
  - **投资人白皮书_v3.2.html**：Python"未激活"→✅；144→148 规则（2 处）；PrintLab 案例对齐最终态（46→0 违规、44→87 APPROVED）；P2 待办 Python/Go→Go/Java；里程碑表补 3.7 行；"当前能力（v3.2）"标注最新 npm 3.7.2
  - **新增产品落地页 `index.html`**：产品介绍（为什么 / 是什么 / 核心能力 / 覆盖矩阵 / 使用方法 / 社区反馈）+ 双群二维码 + 自动回复说明 + 联系邮箱 shenlian1983@qq.com + 官网 tuxingren.xyz；自包含单文件（内联 CSS，无外部依赖），图片相对路径，可直接部署至 tuxingren.xyz
  - **落地页上线 Fly.io**：新增 `web/` 静态站部署目录（nginx:alpine + fly.toml，app `progmune-web`，sin 区域，2 台机器）；`fly certs add tuxingren.xyz` 已绑定域名证书，DNS 待用户按记录配置（A `149.248.206.6` / AAAA `2a09:8280:1::17a:e05f:0`）；踩坑记录：Fly 远程构建不解析符号链接（web/ 内用真实文件副本）、hkg 区域已弃用（改用 sin）、文件权限需 644（nginx 用户可读）
  - **落地页迭代**：新增中英文切换（data-i18n + localStorage）；新增「下一步方向」板块（6 个轻量方向卡：更多语言 / Trust API SaaS / 协议扩展 / CI/CD 插件 / 行业基线 / 公开基准，依据 `docs/development-plan.md`）；移除 tuxingren.xyz 全部引用（官网行 + 页脚链接 + i18n 键，待换新域名）；去除联系卡片"自动回复"行

### 修复

- `src/sdk.ts` `RUNTIME_VERSION` 1.0.0 → 3.7.2（verify() 输出的运行时版本与发布版本对齐）

## [3.7.2] — 2026-08-23

### 新增：社区双渠道自动回复机器人（微信 + WhatsApp）

- **微信公众号自动回复 Bot**（`wechat-bot/`）：零依赖 Node webhook——公众号开发者模式服务器配置（sha1 签名校验、安全模式 AES-256-CBC 加解密、被动回复 5s 窗口）、关键词规则自动回复（与 whatsapp-bot 同规则）、关注欢迎语；`Dockerfile`/`fly.toml` 部署模板 + 本地冒烟文档
- **WhatsApp 自动回复 Bot**（`whatsapp-bot/`，补录）：零依赖 Node webhook——Meta webhook 握手、Graph API 回复、可选 `X-Hub-Signature-256` 签名校验、关键词规则自动回复；`Dockerfile`/`fly.toml` 部署模板 + 本地冒烟文档
- **「群」指令升级为二维码图片消息**：新增合成图 `assets/community-qr.png`（微信 + WhatsApp 群码并排）；公众号侧经 access_token + 临时素材上传回图片消息（3 天有效、到期自动重传，未配置 `WEIXIN_APP_SECRET` 时回文字版指引）；WhatsApp 侧直接发送图片链接
- README（中英）「社区与反馈」章节注明双渠道自动回复已上线：关注公众号 / 向官方号码发送「帮助」查看全部指令
- 回复规则双端同步维护；版本号硬编码于规则内，发版后需同步（`RULES` 数组）

### 修复：微信安全模式 AES 加解密 IV 规范

- 对齐官方 WXBizMsgCrypt：**IV = AES 密钥前 16 字节、密文不带 IV 前缀**（此前误按"IV = 密文前 16 字节"导致解密错位 16 字节、`msgLen` 读出乱码、`appid mismatch`）

### 文档

- CHANGELOG 悬空项收口：3.6.0「二维码占位待替换」补注 3.6.1 已换真实群码；3.7.0「合并形态 IR-first 待恢复」补注 3.7.1 已完成；3.4.0「check 失败待单独排期」补注 3.4.1 已修复

## [3.7.1] — 2026-08-23

### 修复：词段匹配门控（仅项目函数适用）

- `ssg-bridge` 的词段匹配（Strategy 2）增加 `projectFunctions` 门控：只对项目函数做词段匹配——它是为改名协议原语设计的（协议原语必然是项目内函数，如 S5 的 `create_active_session`），外部库调用（如 Node 的 `readFileSync`）经词段撞上 `read_file` 是纯噪声
- 外部 API 的语义桥接不受影响：alias 配置（Strategy 0b）与 domain 关键词（Strategy 3）照常工作；未提供集合时保持旧行为（向后兼容）
- 共享集合构造 `collectProjectFunctionNames`（`src/call-sequence.ts`，全名/裸名/小写变体三形态收录），生产引擎与协议盲测扫描器同款传入

### 修复：合并形态 ir.json 恢复 IR-first（3.5.0 起静默回退的回归）

- `extractCallSequencesFromIR` 与项目 IR 注解合并块兼容 `{ typeMap, functions }` 合并对象（execute/MCP 写盘形态）——此前 `Array.isArray` 守卫使所有 TS 项目自 3.5.0 起静默走正则回退，P4.5/P4.6 的 IR-first 语义在合并形态下未生效
- 配合词段门控后实测：自身 1966 函数 451 入口序列，SSG 违规 346→**2**（均真实命中，`writeTrajectoryFile`→`write_file`），Trust 总分 60→83（APPROVED）
- 协议盲测 v1.2 复测零漂移：66 可测金标 64 检出（Recall 97% / Precision 100% / 0 FP），S5 改名检测不受门控影响

## [3.7.0] — 2026-08-23

### 新增：P4.6 跨函数传播（入口展开 + 片段抑制）

- `src/call-sequence.ts`：`buildCallSequences` 共享序列构建——入口函数（不被项目函数调用）的调用链做传递展开（内联被调项目函数体，深度 ≤4、环安全）；非入口函数的孤立片段不再单独验证（违规归因到调用它的入口），消除 helper 片段误报
- 规则名函数与叶子原语（函数体只调外部调用）不内联——协议原语只在调用链内验证，调用名保留给匹配层
- trust 引擎接线：`extractCallSequencesFromIR` 换用 `buildCallSequences`，规则名集合作为展开保留单元；生效范围如实记录——ir.json 为函数数组形态（协议盲测语料 / extractIR 直出）时 P4.6 生效；合并形态 `{ typeMap, functions }`（execute/MCP 写盘）沿用既有回退路径（3.5.0 起的既有行为）——**合并形态的 IR-first 恢复已于 3.7.1 完成**（词段匹配门控 + 形状兼容）
- 边界（与 C 的 L3 同类，如实记录）：展开是语法内联（调用链扁平化），不做数据流/指针/分支分析

### 新增：协议盲测 v1.2（跨函数 + 任意命名变体）

- 语料网格扩至 38 项目：T0–T5 × S1–S5（30）+ T6/T7 × S1–S4（8）；新增违规类 T6 cross_function_precondition、T7 cross_function_cleanup、风格 S5 renamed（无 `@progmune` 注解 + 改名协议函数，词段匹配验证）
- **复测结果：66 可测金标，检出 64（Recall 97%）/ Precision 100% / 0 FP**；2 处漏检为 T2×S5 注解依赖前置约束（无注解项目级前置不可恢复，命名匹配本身正常），金标与基线如实单列
- 回归测试 `tests/python-protocol-benchmark.test.ts` 扩至 6 例（T1 broken / T0 clean 含分离式清洁链 / T5 endState / T6 cross-function / S5 renamed）

### 文档

- 覆盖矩阵（中英）Python 协议行（Auth / Resource Lifecycle）由 ⚠️ 升级 ✅，证据引用协议盲测 v1.2；升级条件（跨函数传播、任意命名验证）全部勾选
- 基线 `BASELINE_PROTOCOL_PYTHON_v1.md` 更新至 v1.2：语料、结果、已知缺口（注解依赖 / LLM 桥接不在测量范围 / P4.6 展开语义边界）如实记录

## [3.6.1] — 2026-08-23

### 文档

- README 社区章节直展双群二维码：微信（`assets/wechat-group.png`）+ WhatsApp（`assets/whatsapp-group.jpg`），中英双语同步
- 微信群码 7 天过期提醒 workflow 文案同步直展形态

## [3.6.0] — 2026-08-23

### 新增：SSG endState 检查（序列末尾资源未释放）

- trust 桥接路径（`src/trust/ssg-bridge.ts`）补齐 endState 检测：函数序列末尾仍有未释放资源状态 → 违规（`endState: true`、`fixPath=[releaseFn]`、追加式修复文案、独立 rule_id `SSG_*_END_STATE_VIOLATION`）
- 与 planner 语义对齐：共享判定 `findHeldResourceStates` + `RESOURCE_NAMESPACE_RE` 入 `ssg-validator.ts`（planner 重构换用，语义不变）
- 边界：仅资源生命周期命名空间（auth/session 合法地以活跃会话结束不检查）；仅本序列新获取的状态（继承自初始态不算泄漏）
- **Python 协议盲测 v1 复测：40/40 全检出（Recall/Precision 100%，0 FP）**，基线 `BASELINE_PROTOCOL_PYTHON_v1.md`

### 新增：Python 协议盲测基准（v1）

- `blind-benchmark/generate-projects-protocol-python.ts` + `scan-protocol-python.ts` + `expand-gold-protocol-python.ts`：6 违规类型 × 4 结构风格 = 24 项目，金标 `annotations-protocol-python-v1.json`
- 测量生产 SSG 桥接校验器（确定性、无 LLM）；回归测试 `tests/python-protocol-benchmark.test.ts`

### 文档

- README 新增「社区与反馈」章节：讨论群二维码（`assets/wechat-group.png`，3.6.0 发布时为占位图，**3.6.1 已替换为真实群码**并直展双群二维码）+ GitHub Issues 通道（中英双语）
- README 删除双峰（Two-Hump）内容：科学基础章节的双峰类比段与 P0-P3 节的双峰报告链接
- 覆盖矩阵（中英）刷新至 2026-08-23 并新增英文版 `coverage-matrix-en.md`；架构图规则数修正 140→148（与 protocols.json 实测一致）

## [3.5.0] — 2026-08-22

### 新增：多语言合并 IR（注册表式提取）

- `src/extract-project-ir.ts`：`LanguageExtractor` 注册表（detect + extract），`extractProjectIR` 合并所有检测到语言的 FunctionInfo——混合项目中 TS 与 Python 函数共存于同一 IR
- agent loop 感知路径（`extractIRWithDelta`）、`execute()` 的 ir.json 写盘、MCP server 统一走合并入口：Python 项目的函数协议链进入 agent 编排范围（此前 agent 侧 IR 仅 TS）
- `extractIRPython` 默认写临时文件（可选 `outPath`），不再覆盖项目根 ir.json；单语言提取失败不中断其余语言，全部失败才抛错（保留 execute 硬失败语义）
- 新增语言（Go/Java/Rust）：实现 detect + extract → `LANGUAGE_EXTRACTORS` 注册一条 → 调用方零改动

### 修复：function-synonyms 本地超时（遗留）

- `runBootstrapValidation` 无参调用结果缓存（同进程复用，语料重度测试 5 次重计算降为 1 次）
- vitest 改用 forks 池 + 4GB 堆上限（本地语料丰富时 threads 池触 V8 自适应堆上限 OOM）；本地 7/7 通过（~24s）

### 验证

- 相关套件 26/26；`npm run check` 0 失败；合并冒烟：progmune-runtime 自身 4043 函数（TS 1949 + Python 2094）

## [3.4.1] — 2026-08-22

### 修复：`npm run check` 四项失败根因

- protocol-registry：protocols.json 解析加包目录回退——在无协议文件的项目目录下运行时，命名空间初始状态不再退化为仅 `_global`（session 记录与 check 重建的世界一致）
- checkLedgerConsistency：只比较 ledger 中记录过的非空快照命名空间（早期 session 的空数组/部分命名空间不参与比较）
- check：历史约定兼容——早期 session 的 `INIT` 初始状态按当前约定（`UNAUTHENTICATED`）规范化比较（只比较、不改盘）
- audit：`.progmune_allowlist` 祖父条款——存量手写代码一次入册，新文件仍受覆盖率约束
- 结果：check 从 4 失败 → 0 失败（免疫状态正常），1313/1313 Ledger 全过

### 新增：P5 操作级安全层 v1

- 权限决策引擎（auto / sandbox / approve / deny 四级）+ patrol / agent 预设
- FsSandbox 白名单（巡逻报告等产品文件）；shell 执行审批门（`--yes` 或交互确认）
- **commit 恒拒绝且不可被 `--yes` 绕过**（修复信任悖论：自动修复/自动合并永不）

## [3.4.0] — 2026-08-21

### 新增：Agent 化 P1–P4.5

- `npm run agent "意图"` — 免疫门在环内的自主实现循环：目标分解 → 8 门验证 → SSG 确定性修复 → 写盘+指纹 → 编译/指纹/测试验证门 → 失败反馈重试（≤3）→ 审计轨迹 + 带指纹 diff
- `npm run patrol -- --project X [--watch]` — 免疫巡逻：trust_check → 违规报告 + 建议补丁（**绝不自动合并**，修复需人工审批）
- 感知层：Git 仓库上下文注入、IR 增量差集、文件变更监听（RepoWatcher）
- 自监督层：项目测试门（npm test / pytest 自动探测，失败摘要注入重试反馈）

### 行为变化：Trust 引擎协议验证语义（P4.5）

- 协议违规收集从「正则扫描文件声明序列」改为「IR 函数体调用序列」：
  - 函数声明顺序不再被当作执行链（消除 auth.ts 类声明误报）
  - 单调用违规文件不再被 `≥4` 阈值跳过（修复 bad_flow 类漏报）
- 合并项目 `@protocol` 注解（IR 优先、缺 namespace 继承内置 JSON，对齐 planner 语义）——项目级前置约束现在生效
- **升级后 trust 检查结果可能与 3.3.x 不同：误报减少、真违规命中增多**

### 修复

- `verifyCompiles` 绝对路径漏匹配——编译验证门静默漏报
- `@protocol` 注解解析早退——文件首函数协议丢失，SSG 误拦正确调用链
- 语义 marker（`__progmune_*`）泄漏进 LLM 可见函数表，被生成为真实调用
- LLM 调用异常静默吞没——改为可见日志（铁律：不许静默绕过）
- `git status --porcelain` 首字符状态列被整串 trim 截断

### 已知问题

- `npm run check` 的 Ledger 不变量 / 回放 / 覆盖率失败为历史遗留（基线核查确认与本次改动无关）——**3.4.1 已修复**（check 根因修复：包目录回退 / 空快照比较 / INIT 规范化 / 覆盖率祖父条款）

## [3.3.8] — 2026-08-18

- README 链接跨平台修复（npm 页面语言切换链接）
