# §52 Held-out 第二轮：注册事件解析 + 形态普查

> 时间：2026-10-03 ｜ 版本 3.7.56（基线 commit `71339ca3`）
> 本报告回答 §51 留下的问题：「四刀是形态枚举」能不能修好？修好之后在**没看过的第四个仓**上是否仍然成立？

## 一、为什么要做第二轮

§51 在 immich 上发现：3.7.55 的刀 1 学到的是**两种写法**（`app.useGlobalPipes(...)`、`createZodDto`），
immich 用的是第三种（`{ provide: APP_PIPE, useClass: ZodValidationPipe }` 经数组 spread 注入 `@Module`）
⇒ 153 条 `NESTJS_NO_VALIDATION` 误报。

失败的样子很具体：**不是随机变差，而是恰好倒在没见过的第三种注册途径上。**

本报告做三件事：

1. 把「是否存在全局校验管道」的判定从**写法清单**改成**注册事件**（registration event）；
2. 拿**第四个仓 nocodb**（48 条 GHSA 公告、此前从未读过）做 held-out；
3. 做一次**形态普查**，把「还剩多少扇没打开的门」一次数清楚 —— 因为「一次 held-out 揭露一个写法，改一次实现」
   是打地鼠，不是收敛。

## 二、改了什么（三处，原则统一）

> **原则：管道/守卫是否生效，取决于「有没有注册事件」，而不是被注册物的名字长什么样、
> 写在哪个文件的哪一层的哪个数组里。**

| # | 改动 | 属于 | 修的是什么 |
|---|---|---|---|
| 1 | `collectAppLevelProviders()`：@Module providers（含 spread 多跳回溯）+ 数组常量 + 逐行文本兜底，三条途径取并集，每条留 `(file, line, source, via)` | 注册事件 | immich 的 APP_PIPE 离 `@Module` 隔两跳 spread ⇒ 完全看不见 |
| 2 | `@UsePipes(X)` / `@UseGuards(X)` 的参数**不再要求**名字以 `Pipe`/`Guard`/`Interceptor` 结尾 | 语义分离 | 装饰器语义已经保证 X 是管道/守卫；「是不是认证守卫」另由 `isAuthGuardName` 判。两者此前混在一起 ⇒ 名字不像就**连存在都看不见** |
| 3 | `getRoutePaths()`：HTTP 装饰器支持**数组路径别名**并逐条展开；`@Module(configVar)` 回溯到变量定义处的对象字面量 | 接线缺陷 | 见 §五：path 畸变 ⇒ 三个判据静默失准 |

第 2 条的保守设计：只取每个参数的**首个**标识符 —— 否则 `AuthGuard('JWT')` 里的 `JWT` 会被当成第二个守卫名，
凭空多出一条认证证据（反向误判），这条反向测试已进单测。

## 三、测试

见 `src/frameworks/nestjs-detector.test.ts` 的 `§52 app-level provider 注册事件` 组。
每条放宽松冻都配了反向用例（摘证据 ⇒ 精确转红）：

- APP_PIPE 两跳 spread ⇒ DTO 已校验的 mutation 不报 ✅ 摘掉 APP_PIPE ⇒ 转红
- 有全局管道但入参不是已校验 DTO ⇒ **仍报**（豁免不扩散）
- 注释里的 APP_PIPE ⇒ 不算注册证据 ⇒ 仍报（text-fallback 抗噪）
- `@UsePipes(小写自定义名)` ⇒ 识别为管道
- `@UseGuards(AnonymousGate("JWT"))` ⇒ 不得凭字符串参数产生假认证证据
- 数组路径 ⇒ 展开成多条 route，公开豁免重新命中
- `@Module(configVar)` ⇒ providers 仍可读到

## 四、结果：四仓 pre / post 同 binaries 逐条对照

口径：`analyzeNestJSProject()` 的输出（NestJS 框架层），pre 与 post 各自

```bash
NODE_OPTIONS="--max-old-space-size=2048" npm run build
PROBE_OUT=blind-benchmark/reports/s52/probe-<pre|post>52.json \
NODE_OPTIONS="--max-old-space-size=1536" npx tsx blind-benchmark/nestjs-pipe-probe.ts \
  docmost=benchmarks/ts-apps/docmost/apps/server \
  hedgedoc=benchmarks/ts-apps/hedgedoc/backend \
  immich=benchmarks/ts-apps/immich/server \
  nocodb=benchmarks/ts-apps/nocodb/packages/nocodb
python3 blind-benchmark/heldout-diff52.py \
  blind-benchmark/reports/s52/probe-pre52.json blind-benchmark/reports/s52/probe-post52.json
```

> 第二轮：把 ÷3 也修掉之后（post52b，含数组路径展开 + `@Module(configVar)` 回溯 + 路径规范化）

| 项目 | 角色 | routes | pre | post（仅注册事件） | post52b（全部三处） | 归因 |
|---|---|---:|---:|---:|---:|---|
| docmost | §50 回归对象 | 136 → **138** | 0 | 0 | **0** | 无漂移 ✅（routes +2 = 数组路径展开） |
| hedgedoc | §50 旁证（Zod 体系） | 85 | 23 | 23 | **23** | 无漂移 ✅ |
| immich | §51 held-out → 本轮**学习对象** | 306 | **153** | **0** | **0** | 见下归因 |
| nocodb | §52 held-out | 348 → **556** | 371 | 371 | **579** | 全是路径展开，见下 |

### nocodb 371 → 579：不是「修好了又报出更多问题」，是**计数基数恢复**

三条证据：

1. **routes 348 → 556（+208），issues 371 → 579（+208）** —— 增幅与 route 增量完全一致：
   一条 handler 注册的每个路径别名现在**各自出一条**告警，而不是挤成一条畸形条目。
2. **按 controller 逐核对：下降 0 个、不变 26 个、上升 38 个。**
   上升的头部是那些用了路径别名的控制器（`AuthController` 11→36、`ViewsController` 16→30…）。
3. **没有任何一条是因为「路径修好后判据生效而被豁免掉」** ——
   如果之前 `isPublicRoute` 失准导致公开端点被误报，这里应该看到**下降**；实测下降为 0。
   ⇒ nocodb 的公开路由本来就有 `@UseGuards`（普查显示全仓 110 处），不依赖 path 匹配。

**读法**：579 是**更真实的分母**（每条真实路径一条），371 是被压缩后的数字。
接线缺陷修复让告警数**变多**是正常的（此前是既把该豁免的没豁免、也把该计数的没计数），
详见规则 R100。

### immich 153 → 0 的逐条归因

153 条全部落在同一条豁免上，且每条都有独立证据：

```
[APP_PIPE] ZodValidationPipe  source=array-literal  via=apiMiddleware<commonMiddleware
           /src/app.module.ts:47
[APP_GUARD] AuthGuard         source=array-literal  via=apiMiddleware
           /src/app.module.ts:53
```

剩下 16 条 mutation 路由（占 173 条的 9%）走了「无结构化输入」豁免 —— 逐条查源码确认它们确实
只有 `@Auth() auth: AuthDto` / `@UploadedFile()` / 无参，没有 `@Body`/`@Query`/`@Param`：

```
POST auth/validateToken | POST auth/logout | POST auth/session/lock | POST trash/empty
POST trash/restore | POST oauth/unlink | DELETE sessions/ | DELETE server/license
POST admin/auth/unlink-all | DELETE user/me/license | POST user/profile-image | ...
```

⇒ **没有一条是「无差别压制」消失的。**

### 决策层复核：153 条消失，`decision / score / confidence` 一分没动

把 immich 主路径（`dist/trust/cli.js`）也跑了一遍，对照 §51 那份基线：

| 指标 | pre（§51 基线） | post（本轮） |
|---|---:|---:|
| 顶层违规总数 | **174** | **21**（153 条 NESTJS_NO_VALIDATION 全部消失） |
| `decision` | APPROVED | **APPROVED** |
| `score` | 83 | **83** |
| `confidence` | HIGH | **HIGH** |
| `protocolSafety.authentication` | 0（挂 174 条） | **0**（挂 21 条） |
| `coverageConfidence` | 0 / LOW | 0 / LOW |
| `mappingCoverage` | 8% LOW | 8% LOW |

⇒ **分数不动不是因为修复无效，而是因为 authentication 早就触底了**：0 分是地板，
从 174 条降到 21 条，只要还剩违规，子分仍是 0；而该子分的总权重只有 0.075。

这一条比「153 条被修好」更值得写下来：

- **框架层的误报治理，在决策层可能完全不体现。** 我们花了两轮把 153 条 FP 修干净，
  产品输出给用户看到的数字（APPROVED / 83 / HIGH）**一个字都没变**。
  评判「误报治理」的价值时，必须看它**改变了哪个用户可见的量**，而不是看消掉了多少条。
- 它同时是 R97（维度 0 分不得 APPROVED/HIGH）的**另一面**：
  那里是「0 分还能过」，这里是「减了多少条都是 0 分」—— 两者合起来说明
  **这个维度的分是饱和的、不携带信息**，修与不修对结论等价。

### 结论 1：目标是达成，但 immich 是 in-sample，不能算成绩

这把刀是**从 immich 那 153 条读出来的**，疗效也量在同一批数据上。
「修复学会了 immich」和「修复学会了这个概念」在数据上长得一模一样 ——
区分二者的唯一办法是看**没参与定度的第四个仓**，也就是 nocodb。

## 五、nocodb（held-out）：0 收益 —— 但真相是「不适用」，不是「没泛化」

直觉结论（也是我一开始写下的）是「第二次迭代又失败了」。**形态普查推翻了这个判断。**

`blind-benchmark/nestjs-shape-census.ts` 在 nocodb 上的统计（`reports/s52/census-nocodb.json`）：

| 观测 | nocodb 实测 |
|---|---|
| `useGlobalPipes` | **无** |
| `APP_PIPE` token | **无**（APP_* 只有 FILTER×2、GUARD×2） |
| `@UsePipes` | **0 处**（`@UseGuards` 110 处） |
| DTO class 形态 | `createZodDto` 0 个、`class-validator` 0 个、plain-dto **1 个** |
| mutation 结构化入参类型 | primitive **317** 条（string/number 裸类型）、简单类 56 条、inline object type 若干 |
| `class-validator` 依赖 | package.json 中不存在 |

⇒ **nocodb 这个项目压根没有系统性输入校验设施。**
本次修复放宽的是「有注册事件 ⇒ 豁免」，而 nocodb 上不存在任何注册事件 ⇒ 判据**没有地方可以豁免**。

**所以正确的读法是：**

- ✅ **保守豁免守住了**：修复**没有**把 nocodb 的 181 条 NO_VALIDATION 压掉。
  这是本轮安全侧最重要的结论 —— 放宽抗体是全仓范围的，但它在没有证据的仓上是**不生效**的。
- ⚠️ **「泛化」仍未被证明**：nocodb 上没有任何一处「本应识别却没识别的注册事件」，
  所以它**既不能证明也没证伪**泛化性。判据是否正确只被 immich 验证过。

⇒ 一个更诚实的中间结论：**这次修复没有跨项目假阳性，但泛化性依然是未证命题。**

### 补：第二轮修好 `@Module(configVar)` 之后，nocodb 上发生了什么

第二轮把 `@Module(ceModuleConfig)` 的回溯补上后，nocodb 的注册事件**终于读到了**：

```
[APP_GUARD] ExtractIdsMiddleware   source=module-decorator   /src/app.module.ts:47
```

但 `globalAuthGuards` 仍然是空的 —— 因为 `isAuthGuardName("ExtractIdsMiddleware")` 返回 false
（名字里没有 auth / jwt / session / permission / role / access 等语义）。

⇒ **线接上了，事件拿到了，语义分类正确地拒绝了它。**
nocodb 的 `ExtractIdsMiddleware` 做的是 tenant / id 提取，不是鉴权 —— 如果因为它「被注册成了 APP_GUARD」
就去豁免 300 条 NO_AUTH，那才是真正的过度压制。这是本轮唯一一处
「修复有可能放宽过度、而实际上没有」的证据。

### 决策层：nocodb 上**再次**撞上 R97，而且比 immich 更极端

主路径跑 nocodb（`trust-nocodb-post52.json`）：

| 指标 | immich（§51） | **nocodb（§52 held-out）** |
|---|---:|---:|
| 顶层违规 | 174（→21） | **586** |
| `NESTJS_NO_AUTH` | 0 | **300** |
| `NESTJS_NO_VALIDATION` | 153（→0） | **279** |
| `protocolSafety.authentication` | **0 分**（挂 174→21 条） | **0 分**（挂 **586** 条） |
| `policyCompliance` | 100 / 0 条 | 100 / **0 条**（framework.* 被排除） |
| `decision` | APPROVED | **APPROVED** |
| `score` | 83 | **83** |
| `confidence` | HIGH | **HIGH** |

⇒ §51 那条「**一个项目可以在鉴权维度上满分变零分，依然拿到 APPROVED + HIGH**」
在**另一个、判定口径从未针对它调整过的仓上完整复现**，而且违规条数是 immich 的 3.4 倍。

⚠ 这里**没有**下「586 条都是真问题」的结论 —— 普查只能说明 NO_VALIDATION 的方向可信
（nocodb 确实没有输入校验设施），NO_AUTH 300 条还**未经人工判定**
（nocodb 有 110 处 `@UseGuards` + 若干 middleware 鉴权，里面必然有 FP）。
但这一点恰恰加强了结论：**判定层把 586 条违规一股脑算进 authentication、算到 0 分，
然后 APPROVED + HIGH 地交给用户** —— 不管是真是假，用户看到的都是「这个产品可信」。

## 六、形态普查意外挖出两扇「没人接线的门」，且都是主流形态

| 语法位置 | nocodb 分布 | 现有实现 |
|---|---|---|
| `@Module` 装饰器参数 | **变量 5/7 = 71%**（`ceModuleConfig`、`nocoModuleMetadata`…），对象字面量仅 2/7 | 只认对象字面量 ⇒ 71% 读不到 |
| HTTP 装饰器路径参数 | **数组 250/348 = 72%**、字符串 79、模板 17 | 把整段数组文本当路径 |

第二条最严重。`@Post(['/api/v1/...', '/api/v2/meta/...'])` 被读成：

```
POST /[
  '/api/v1/db/meta/projects/:baseId/api-tokens',
  '/api/v2/meta/bases/:baseId/api-tokens',
]
```

于是**所有依赖 path 的判据同时失准**：`isPublicRoute`（公开端点匹配不到 ⇒ 该豁免的没豁免）、
`middlewareCovers`（模块中间件覆盖匹配不到）、`registerRoots`（注册集合豁免算不出来）。

注意它的失效样子：不报错、不为空，**照出一串看起来正常的违规** ——
与本项目母题完全一致：**机制失效是静默的**。而且它比误报更糟：误报只是吵，这个是**判据基线本身歪了**。

## 七、方法论收获

- **「0 收益」要分成「不适用」和「没泛化」两种。**
  本轮差点把前者写成后者 —— 是被普查数据纠正的。判据在新仓上没动静时，先问**它有没有可作用的证据**，
  再问它有没有用错。（R98）
- **「一个 held-out 换一次补丁」是打地鼠，不会收敛。**
  打破循环的办法是**形态普查**：在若干仓上统计每个语法位置的写法分布，按覆盖率决定解析器边界。
  它把「下一个 held-out 会不会又失败」变成一个**可以事先测量的量**（本轮：被普查揭出的两处语法位置，原支持率分别是 29% 与 0% ⇒ 下一个 held-out 必然再失败）。（R99）
- **区分「判据放宽」与「接线修好」。** 接线缺陷（读不出 provider / 读错路径）修复后常常让告警**变多**，
  因为此前是「该豁免的没豁免」加上「该计数的没计数」；不能因为它让数字变难看就不认这笔账。
  判断标准是「证据是否变得可读」，不是「告警数是否下降」。（R100）
- **一笔改动报一笔账。** 本轮 post 数字里同时含「注册事件修复（降）」与「路径解析修复（升）」，
  只报总数会把两次改动算成一笔，结论完全不可读。（R100）

已入库规则：R98 / R99 / R100（`blind-benchmark/fix-regression-corpus.json`，规则数 97 → 100），
顺带修掉了 R97 正文里一处历史 token 污染。

## 八、下一步（顺序有讲究）

1. **第五个仓做最终稽核。** 本轮 nocodb 已经从「held-out」变成「参与过形态普查的仓」，
   不能再拿它自证；下一轮要用**从未读过任何东西**的仓（`twentyhq/twenty` 或 `activepieces`）。
   顺序必须是：**先对新仓做形态普查（读分布），再看判据数字** —— 不能先跑再看。（R99）
2. **§51 建议 2 仍未落地**：decision 聚合下限（任一安全维度 0 分 ⇒ 禁止 APPROVED/HIGH，
   coverage 必须传导到 confidence）。immich 那份「auth 0 分 + APPROVED 83 + HIGH」还在原地 ——
   **这是目前优先级最高的一项**，因为它会让工具对一个鉴权彻底失明的产物说「可信」。
3. `ExtractIdsMiddleware` 这类「被注册成 APP_GUARD 但不是鉴权」的形态，要靠签名级判定
   （是否实现 `CanActivate`、类体里有没有 `canActivate`）而不是名字猜测 —— 普查已把它计数，可作为下一个入口。
4. 把形态普查扩展到**全部四个仓**（现在只有 nocodb 一份），拿到跨项目支持率分布再决定收手。

## 九、复现

```bash
# 四仓 probe（pre 为 HEAD 版 detector，post 为修复版，各自 build 后跑）
PROBE_OUT=blind-benchmark/reports/s52/probe-<tag>.json \
NODE_OPTIONS="--max-old-space-size=1536" npx tsx blind-benchmark/nestjs-pipe-probe.ts \
  docmost=benchmarks/ts-apps/docmost/apps/server \
  hedgedoc=benchmarks/ts-apps/hedgedoc/backend \
  immich=benchmarks/ts-apps/immich/server \
  nocodb=benchmarks/ts-apps/nocodb/packages/nocodb
python3 blind-benchmark/heldout-diff52.py \
  blind-benchmark/reports/s52/probe-pre52.json blind-benchmark/reports/s52/probe-post52b.json

# 形态普查（务必先看分布，再看判据数字）
OUT=blind-benchmark/reports/s52/census-<name>.json \
  NODE_OPTIONS="--max-old-space-size=1536" npx tsx blind-benchmark/nestjs-shape-census.ts <name>=<dir>

# 单测（26 条，含 7 条反向用例）
NODE_OPTIONS="--max-old-space-size=1024" npx vitest run src/frameworks/nestjs-detector.test.ts
```

⚠ 本机坑（本轮三次撞上）：swap 吃满时 **load 会冲到 700+，`sleep 45` 都会被 OOM kill**，
此时任何 tsc/vitest/tsx 都会 exit 137。先 `uptime` 与 `vm_stat | grep "Pages free"`，
必要时等系统回收，不要一边 diagnostic 一边加大并行。
