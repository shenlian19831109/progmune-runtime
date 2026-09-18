# REALWORLD_FIX_REGRESSION_V2 — 扩样至独立仓库 + 提取器 P0 死循环修复

> 日期：2026-09-18 ｜ 引擎版本：v3.7.30（+ 本轮 P0 修复，尚未发版）
> 语料注册表：`blind-benchmark/fix-regression-corpus.json`（17 条，**全部有结论**）
> 接续：V1（`REALWORLD_FIX_REGRESSION_V1.md`，8 条 / 基线 0/8）

## 一、为什么先扩样而不是先啃 fr-002/fr-003

V1 留下一个方法论硬伤：**8 条里 6 条来自 open-webui**。在这个样本上做任何「检出面」结论，都无法排除「只是这一家的代码风格恰好不合适」。

扩样优先的两个理由：

1. **每进一个新语料都暴露过真 bug**——skyvern → 认证词表缺口（144 条）、open-webui → 词表缺口（142 条）、openhop → 类方法漏提取。扩样本身就是在产出修复，而不是只产出统计数字。
2. fr-002/fr-003 属「该有的检查没有」类，需要**跨路由期望建模**，是新思路不是体力活。给它攒同族案例（本次 fr-016 就是最干净的一个）比直接动手更有胜算。

**结果证明这个判断是对的**——本次扩样最大的产出不是 6 条新的 MISS，而是一个**会让引擎在真实 TS 工程上挂死的 P0 缺陷**（§5）。

## 二、扩样后的样本结构（硬伤已消除）

| | V1 | V2（本次） |
|---|---|---|
| 条目数 | 8 | **17** |
| open-webui 条目数 | 6 | 7 |
| **open-webui 占比** | **75%** | **41%** |
| 独立仓库数 | 3 | **10** |

本次 6 条来自 **5 个独立仓库**（gitlab-mcp ×2、mockoon、og-image、redocly-cli、tinacms），全部避开 n8n / Vendure 大仓（下载不可行）。

## 三、结果总表（fr-012 ~ fr-017）

| # | 项目 | 类型 | 严重度 | 检出 | pre / post 违规 |
|---|---|---|---|---|---|
| fr-012 | gitlab-mcp `upload_markdown` 任意文件读 | 路径穿越 | critical | ❌ **MISS** | 0 / 0 |
| fr-013 | gitlab-mcp 多项安全控制绕过 | 字符串解析语义 | high | ❌ **MISS** | 0 / 0 |
| fr-014 | mockoon 未认证管理 API + 通配 CORS | 缺失鉴权 / 配置 | high | ❌ **MISS** | 0 / 0 |
| fr-015 | nuxt og-image fonts[] SSRF | SSRF | medium | ❌ **MISS** | 0 / 0 |
| fr-016 | redocly-cli split 路径穿越 | 缺失检查 | medium | ❌ **MISS** | 0 / 0 |
| fr-017 | tinacms OAuth 访问控制破坏 | 身份锚点归属 | high | ❌ **MISS** | 0 / 0 |

**6 条新语料全部 MISS。全库状态：INVESTIGATED 17/17，DETECTED 4/17，MISS 13/17，PENDING 0。**

### 两处必须承认的方法论事故（都已修正，记下来避免第三次）

1. **一批「0 违规」结果无效**——早期 mini 语料缺 `tsconfig.json`，ts-morph 直接抛 `FileNotFoundError`，引擎未做实质分析即返回 0。fr-014/015/016/017 的首次结果全部作废，已用合格语料重测。
2. **「0 违规」必须配正向对照**——为确认这批 0 不是哑值，扫了仓库自带的 `demo-project/` 做正向校验：报出 **1 条真实违规**（`SSG_AUTH_STATE_VIOLATION`，`token_lifecycle_flow.ts::main`，"revoke_token requires states [TOKEN_ISSUED] but current auth state is [SESSION_ACTIVE, UNAUTHENTICATED]"）。引擎是活的，0 就是真的 0。

## 四、注册阶段发现并修正的两个数据错误

新语料不是「填表就有用」——**SHA 必须经 `api.github.com` 核验**。本次抓到两类错误：

**fr-013 —— 两处都错**

| 项 | 原注册 | 修正后 |
|---|---|---|
| parent_commit | `6ffb4cc7…6db**d6**` | `1700c74028d3ecde75238708c970dbf7affc7558` |
| fix_commit | `69e784da…`（**只改 CHANGELOG.md 的纯文档提交**，PR #624） | `8d2b486b08bf2ae912806fe99f040c532b029de3`（PR #571「fix: harden MCP safety controls」，16 文件） |

原 parent SHA 末 4 位转置，codeload 直接 404（返回体 `404: Not Found`，14 字节）；原 fix commit 是「把修复写进 changelog」，顺着 PR #624 正文里的 link 才找到真修复 PR #571。

**fr-012 —— 锚点错位**

原注册 fix=PR #554（SSE 传输鉴权，2026-06-22），parent=404a993e。但该 GHSA 的「文件读取」半边由 **PR #482**（2026-05-21）修复，比 404a993e 更早——照原锚点扫，两边都已修或不完整。已重锚定为 `parent=c2577169 / fix=7d19ebf6`。

## 五、本轮最大产出：提取器 SSRF 标记的正则是偶死循环（P0，已修复）

### 现象：规模与耗时完全脱钩

| 语料 | 规模 | 修复前 |
|---|---|---|
| mockoon mini | 108 KB / 5 文件 | ✅ 35s（99 函数） |
| redocly mini | 11.5 KB / 5 文件 | ✅ 27s（19 函数） |
| 空探针（1 函数） | 100 B | ✅ 9–11s（**基线就这么慢**） |
| og-image mini | 28 KB / 2 文件 | ❌ >480s 未完成 |
| tinacms（扁平） | 3.8 KB / 1 文件 | ❌ >300s 未完成 |
| gitlab-mcp 切片 | **55 行 / 1 文件** | ❌ >480s 未完成 |

**一个 55 行的文件比 108 KB 慢一个数量级以上**——不是体积问题，是内容触发的病态。

### 定位：CPU 采样直取热栈

对挂住的进程做 `sample`（macOS）：

```
+ 2193 Builtins_InterpreterEntryTrampoline ...
+  1873 ???  (in <unknown binary>)
+  ! 1110 Builtins_RegExpPrototypeExec  (in node) + 914
```

**2193/2193 采样全部落在正则执行里**——100% CPU 的死循环，不是 I/O 等待，也不是内存问题（早期怀疑的 OOM / ts-morph 依赖解析均被排除）。

### 根因：`src/extract-ir.ts` SSRF 分支

```ts
const TS_HTTP_FETCH_SINK =
  /\b(fetch|axios\.(?:get|post|...)|...|got)\s*\(/;      // ← 无 g 标志

...
while ((m = TS_HTTP_FETCH_SINK.exec(text)) !== null) {   // ← 非全局正则做迭代
  const after = text.slice(...);
  if (taint.test(after)) { markers.push(...); break; }
}
```

**非全局正则的 `exec()` 会忽略 `lastIndex` 并恒返回首个匹配**。因此只要第一个 `fetch(` 之后的 300 字符窗口内不含污点，循环就永远推不动——而「良性 fetch」恰恰是真实代码里最常见的形态。

同一文件里另外 7 处 `while-exec` 循环（行 422 / 424 / 431 / 438 / 462 / 500 / 574）**都带 `g` 标志**，只有这一处漏了。

**影响面**：任何含 `fetch(` 且函数体内无 SSRF 守卫词汇（`localhost|ssrf|hostname|…`）的 TS 工程，都会挂死 IR 提取阶段。实测 **nuxt og-image、tinacms、gitlab-mcp 三个独立仓库全部触发**——这不是语料偶然，是面向真实代码的普遍故障。

### 修复

- `src/extract-ir.ts`：新增 `tsHttpFetchSinkIter()`，用 `new RegExp(source, "g")` 供迭代使用；布尔探测仍用无标志版本（带 `g` 的 `.test()` 会污染 `lastIndex`）。模式至少匹配 5 个字符，不可能零宽匹配，故无需额外推进保护。
- 新增回归测试 `src/extract-ir-ssrf-loop.test.ts`，锁两端：
  1. 良性 fetch（无守卫、无污点）必须正常返回——**修复前永不返回**；
  2. URL 形参直接流入 fetch 仍必须注入 `__progmune_ssrf_user_url__`——**修复不得削弱检出**。

两项均通过（1.9s）。修复后各语料耗时：

| 语料 | 修复前 | 修复后 |
|---|---|---|
| og-image mini | >480s | **48s** |
| tinacms 扁平 | >300s | **57s** |
| gitlab-mcp 切片 | >480s | **80s** |
| 最小复现 `fetch(url, {method})` | >70s | **18s** |

> 环境背景（如实记录，污染计时）：本机 8 GB 内存、swap 已用 8.6/10 GB；gitlab-mcp 全仓（index.ts 单文件 454 KB）扫描被 OOM kill（exit 137），故 fr-012 改用真值函数切片（55 行），完整保留了 `filePath` 形参 → `fs.readFileSync` 的污点链。

## 六、漏报根因：V1 + V2 合并视图

| 根因类别 | 条目 | 本次新增 |
|---|---|---|
| **污点源词汇表缺口** | fr-012（MCP 工具实参 `args.file_path`）、fr-015（解码后的对象字段 `font.path`） | ✅ **2 条，新类别** |
| **缺失检查（该有的调用没有）** | fr-002, fr-003, **fr-016**, **fr-014** | ✅ 2 条 |
| 身份/凭据锚点归属 | fr-004, **fr-017** | ✅ 1 条 |
| 查询语义 | fr-001 | — |
| 配置与通道路由 | fr-006, fr-014（CORS 半边） | — |
| 密码学协议语义 | fr-008 | — |
| 字符串/URL 解析语义 | **fr-013** | ✅ 1 条 |
| 守卫存在但未接在该路径 | fr-009, fr-015 | — |

三个判断：

1. **「污点源词汇表缺口」是新暴露的独立类别**，且与既有观察同构——skyvern 暴露认证词表缺口（144 条）、open-webui 暴露词表缺口（142 条），本次 fr-012/fr-015 暴露的是**污点源**词表缺口。三者的共同病灶是：**标记管线靠名字识源，不靠数据流的语义**。fr-012 的污点是 MCP 工具实参、fr-015 的是 `decodeURIComponent` 解码后的对象字段，两者都不在 `URL_PARAM_NAME` / `req.*` 词汇表里。
2. **「缺失检查」仍是最大类（4 条）**。fr-016 是最干净的样本——整个修复 diff 就是新增一行 `assertWithinDir(dir, file, name)`，用最小噪声证明了这条边界。
3. **fr-013 应作为模型边界显式保留**，不硬凑检出：它的修复是 GraphQL 文本的**字符串解析加固**（处理 `{, mutation{...}}` 逗号前缀），不涉及调用序列也不涉及污点流，确定在检出面外。

fr-017 提供了新角度：**身份锚点的归属**（校验用的 clientID 应来自服务端配置，却取自请求参数）。这与 V1 的 fr-004 不同——fr-004 是「凭据流去哪了」，fr-017 是「拿什么做身份基准」，后者更接近**策略语义**而非数据流，当前引擎没有对应维度。

## 七、结论

1. **扩样的目的达到了，但收获的形态超出预期**：主要产出不是 6 条新的 MISS，而是（a）注册环节的 2 处数据错误、（b）一个会让引擎在真实 TS 工程上挂死的 P0 缺陷、（c）「污点源词汇表缺口」这个新的根因类别。三者都是「把基准做严」才会露出来的东西。
2. **P0 已修复并锁了回归测试**，吞吐不再受限——修复前每加一个新语料都要赌它会不会触发解析病态。
3. **DETECTED 4/17 这个数字要谨慎解读**：4 条检出里有 3 条（fr-007/fr-010/fr-011）是同一类「污点源恰好在词汇表内」的样本。真实世界的漏洞里，污点源的形态远比词汇表丰富——fr-012/fr-015 就是反例。

## 八、下一步（建议顺序）

1. **[P0]** 发版：把 SSRF 正则死循环修复打进 v3.7.31 并在 CHANGELOG 单列（这是面向真实代码的可用性故障，不是基准内部问题）
2. **[P1]** 以 fr-016 为靶子启动「缺失检查」建模：同文件内同类写操作的一致期望推导（一条路径调用了 `assertWithinDir`，其余同形状路径没有 → 报缺失）
3. **[P1]** 「污点源词汇表」专项：把 fr-012（工具实参）与 fr-015（解码对象字段）作为两个靶子，评估从「名字识源」扩展到「形参可达性识源」的成本
4. **[P1]** 把「SHA 必须经 API 核验」「mini 语料必须带 tsconfig」「0 违规必须配正向对照」写成语料入库检查清单——本轮三处事故全部源于此
5. **[P2]** 继续扩样到 25–30 条，目标 open-webui 占比 ≤ 30%
