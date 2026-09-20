# 污点源数据流试点 V1 —— 根集合扩展后暴露的真正阻塞

> 日期：2026-09-19 ｜ 引擎：v3.7.31 + 本轮改动（**未提交，未过 0-FP 验收**）
> 接续：`REALWORLD_FIX_REGRESSION_V2.md` §6「污点源词汇表缺口」
> 目标：把 fr-012 / fr-015 从 MISS 转为 DETECTED，验收门 = 两条转 DETECTED **且** TS 795 盲测 3086 flags 零漂移

## 一、结论先行

试点**没有达成验收**，但把「为什么原设计不敢放开污点根集合」这个问题回答清楚了：

> **路径穿越标记没有"校验识别"能力。一旦扩大根集合，它会把所有 taint→文件 sink 的流一律标记，不区分有没有做校验——召回上去了，精度立刻崩。**

这不是实现瑕疵，是**该方向的真正门槛**。SSRF 侧有 `SSRF_GUARD_EVIDENCE` 做机制（有守卫词汇就不标记），路径穿越侧从来没有对应的东西。原来的最小根集合（`req.*`）很可能正是被这个约束逼出来的结果——不是不知道覆盖面窄，是不敢放宽。

## 二、交付：三处结构性修复

改动集中在 `src/extract-ir.ts`（+101/-41），均未依赖变量名：

| # | 缺陷 | 为何致命 | 修复 |
|---|---|---|---|
| 1 | 污点根集合只有 `(?:req\|request)\.(params\|query\|body\|headers\|cookies)` —— Express 专有形态 | MCP 工具实参、CLI 参数、URL 解码产物**天然不可见**。这不是词表小，是根只有一种来源 | 新增 `UNTRUSTED_ROOTS` 表，**按传输面声明根**（判定依据是来源性质，不是变量叫什么），每条附 `why` |
| 2 | `methodSinkParamMap` 只遍历 `sf.getClasses()` 的类方法 | 顶层函数声明从不入表 → 跨函数一跳对真实 TS 工程（大量函数式写法）完全失效。fr-012 的 `markdownUpload` 正是顶层函数 | 同样规则纳入 `sf.getFunctions()` |
| 3 | 跨函数那一跳的正则要求调用前必须有点（`obj.sink(`） | 裸调用 `markdownUpload(...)` 匹配不到，taint 传导中断 | 增加 `directCallRe` 覆盖裸调用 |

## 三、验证结果

### fr-012（gitlab-mcp `upload_markdown` 任意文件读）

| 侧 | 修复前 | 修复后 |
|---|---|---|
| pre（漏洞态） | 0 违规 | **2 条 PATH_TRAVERSAL**（`markdownUpload`、`dispatchTool`，位置正确） |
| post（修复态） | 0 违规 | **2 条 PATH_TRAVERSAL**（同上） |

**pre/post 同数 —— 这个 DETECTED 不成立。**按 V1 既定的方法「扫描修复后确认不误报」，现在两者无区别，说明标记不具备判别力。

根因见 §1：路径穿越是「有 taint→file sink 就标记」，没有像 SSRF 那样的守卫证据豁免。

### 附带发现（2026-09-19 复核后**更正**）

原结论「post 切片不忠真」**是错的**——post 切片就是 fix commit 的完整 `index.ts`（454 697 字节，与快照逐字节一致），
修复确实落在 `markdownUpload` 里。真正的问题是：

> **fr-012 的修复不是路径校验，而是部署模式闸门**：`if (IS_REMOTE && filePath) throw`。
> 本地模式的 `readFileSync(filePath)` 修复后原样保留（本来也不是漏洞）。
> ⇒ pre/post 在污点流层面**本来就应该同数**——这一条**判不了判别力**（`result_reason` 已改 `corpus_mismatch`）。

顺带纠正种子出处：评审提到的 `isAbsolute + startsWith('..')` 在下载侧 `localPath`，
**pre（7968–7977）与 post（8719–8728）完全一致**，是既有代码、不是修复——
但它恰好是真实世界的「已校验」样本，转作 G1 的负样本用例。详见 `PATH_GUARD_EVIDENCE_DESIGN_V1.md` §四·补。

### fr-015（nuxt og-image SSRF）

**试点的第二个目标是错的。**mini 语料（`fonts.ts` + `ssrf.ts`）里**根本没有任何出站 sink**——唯一的 `fetch` 在 `ssrf.ts:260`，而真值链路的 sink 在 `src/runtime/server/util/fetchLocalAsset.ts`（`$fetch`）等未被收录的文件里。

=> **语料切分把 sink 切掉了，再好的分析器也看不见。**这是与 fr-015 同类的方法学缺陷：**mini 语料必须包含 sink 所在文件**，否则该条「MISS」不可判定。

## 四、连带发现的管线风险（与本方向无关，但建议尽快处理）

**trust 引擎读取的是 `<target>/ir.json`（`engine.ts:1439`），若该文件已存在则不重新生成。**实测中目标目录残留了一份 9-18 15:56 的旧 `ir.json`，导致：

- 新标记已经注入 ✓
- 但 trust 消费旧 IR → 报 0 违规 ✗

表现为「改动明明生效却看不出效果」，极容易误导结论。建议：**trust 侧校验 `ir.json` 与源码 mtime，或在 `<target>` 存在陈旧 `ir.json` 时默认重新提取**。此项独立于本试点，值得单独修。

## 五、下一步（按依赖顺序）

1. **先补"校验识别"，再谈召回** —— 给路径穿越加 `PATH_GUARD_EVIDENCE`（normalize + `startsWith('..')` / 根目录包含性校验 / 白名单等），语义对齐 SSRF 侧。注意：**不要把 `basename` 算作守卫**（fr-012 pre 里就有 `path.basename`，会被误当成已校验而压制真值）。
2. **重建忠实的 post 语料** —— 从真实 fix commit 的完整 `index.ts` 取，而不是手工切片，再判 pre/post 是否可分。
3. **补齐 fr-015 语料** —— 把 sink 文件（`fetchLocalAsset.ts` 等）纳入 mini 语料后重跑；若仍 MISS，则它属于「跨文件 ≥2 跳传播」缺口，与本试点的根集合缺口是**两个不同的问题**。
4. **过 TS 795 硬门槛** —— 上述任何一项通过前，本轮改动都不得提交。当前改动已确认会让 fr-012 post 侧多报，未达 0-FP。

## 六、状态

`src/extract-ir.ts` 的改动**保留在工作区但未提交**，也**未跑 TS 795 盲测**。上述任何一项通过前不得入库。

## 七、评审回应与立项拆分（2026-09-19 追加）

外部评审（DeepSeek）对本文件的四条核心意见，以及据此落地的处置：

| 评审意见 | 处置 | 状态 |
|---|---|---|
| 三处结构性修复是真 bug，应与试点结果**解耦**、作为独立的**正确性修复**单独立项；不必等 `PATH_GUARD_EVIDENCE` | 拆为独立条目 **C1/C2/C3**（见下）。验收标准降为「TS 795 零漂移即可入库」——它们让标记管线对真实 TS 工程**看得见**，但不改变判别逻辑 | 代码已完成，待 TS 795 |
| §4 陈旧 `ir.json` 风险**优先出单独小修**，但反对「默认全量重提」 | 已实现 `src/ir-staleness.ts`：mtime 比对 + 成本闸 + 策略阀（详见下节） | ✅ 实现+单测 green，**本次唯一入库候选** |
| 守卫词汇**不必凭空设计**，语料里就有种子 | 见 `PATH_GUARD_EVIDENCE_DESIGN_V1.md` | 设计稿 |
| mini 语料对污点流类条目**结构上不可靠**，应入方法论 | 已写入语料注册表 v2：规则 R1–R4，并给 6 条条目补 `result_reason` | ✅ 已入册 |

### 拆分后的条目清单

| 条目 | 内容 | 验收门 | 状态 |
|---|---|---|---|
| **IR-STALE**（本次） | 引擎侧 `ir.json` 陈旧判定 | 单测 + DSH 陷阱回归组 | ✅ green，待 TS 795 |
| **C1** | `methodSinkParamMap` 补顶层函数（原先只遍历类方法） | TS 795 零漂移 | 代码完成，待跑 |
| **C2** | 跨函数正则补 `directCallRe`（裸调用 `func(` 匹配不到） | TS 795 零漂移 | 代码完成，待跑 |
| **C3** | `UNTRUSTED_ROOTS` 按传输面声明根（每条带 why） | TS 795 零漂移 | 代码完成，待跑 |
| **G1** | `PATH_GUARD_EVIDENCE`（判别力） | TS 795 零漂移 **+** fr-012/fr-015 pre 报出、post 不报 | 设计稿 |

C1–C3 已在 pilotsandbox 里一起改了（`src/extract-ir.ts`），**入库时可整体作为一个正确性提交**，不必与 G1 捆绑。

### ir.json 陈旧修复的实测教训（两个反面教材）

1. **「默认全量重提」不可行**：本仓库自身 5k+ 源文件，`evaluateTrust(process.cwd())` 触发一次性全量提取 → `tests/trust/engine.test.ts` 首个用例直接 30s 超时（原先 **31 passed / 1 failed**）。
2. **「找到第一个更旧即早退」的优化是错的**：早退会把 `truncated` 信号抹掉，导致 `evidenceComplete` 误为真，大仓照样进全量重提。**改成完整遍历 + 明确的规模预算闸**后才收敛（现状 **23 passed**，首个用例 8.2s）。

最终政策（三档）：

| `PROGMUNE_IR_REEXTRACT` | 行为 |
|---|---|
| 未设（**auto**，默认） | 陈旧 且 遍历完整 且 源码 ≤5000 文件 → 自动重提；否则**只警告不还价**（警告里写明陈旧的证据文件与解除方式） |
| `always` | 只要陈旧就重提——语料复测等批量场景用（自担分钟级成本） |
| `never` | 回到旧语义（永不重提），但**必须**打印「IR 可能陈旧」警告——不接受静默 |

修正后 `tests/trust/engine.test.ts` + `src/extract-ir-ssrf-loop.test.ts` 全绿（23 passed，含 DSH 陷阱那条 C 自动提取回归）；新增 `src/ir-staleness.test.ts` 12 项 green。

> ⚠️ 副作用记录：首次跑通时本仓库根目录被自动重提过一次 `ir.json`（gitignored 产物，非源码污染）。此后因规模超预算，根目录只会警告。

**本轮仍然没有提交任何东西。** IR-STALE 是唯一「纯净、无判别力副作用」的候选，但它同样要过 TS 795 才能入库；本轮环境负载下我没有跑完整盲测，这一项留给评审侧验收。
