# §51 Held-out 主路径验证：第三个项目（immich）对照 docmost

> 时间：2026-10-03 ｜ 版本 3.7.56（commit `45e7c518`）｜ 只运行、不改判定逻辑（src 一行未动）

## 一、为什么要做这个

§50（3.7.55）把 docmost 从 `BLOCKED(48)/132 违规` 修到 `APPROVED(87)/6 违规`，四刀修复为：

1. `app.useGlobalPipes(...)` 全局管道识别 + 路由入参类型 ∈ 已校验 DTO 集合
2. 无结构化输入豁免
3. auth 端点豁免扩展
4. policy / protocol 双维度去重

**这四刀的根因是从 docmost 那 126 条误报里读出来的，疗效也量在同一批数据上 ⇒ in-sample。**
唯一跨项目旁证是 hedgedoc 47→32，但它是 Zod 校验体系、形态不同，隔离不了「拟合」。

⇒ 本报告补上缺席的实验：**一个从未看过的第三个项目，一行代码不改直接跑主路径判定。**

## 二、靶子选择与可比性

| 项 | docmost（回归对象） | immich（held-out） |
|---|---|---|
| 形态 | NestJS monorepo `apps/server` | NestJS monorepo `server/` |
| 规模 | 依赖注入 + class-validator DTO | 依赖注入 + `nestjs-zod` / zod 4.4.3 |
| 控制器数 | 同量级 | 43 个（`@Controller` 文件数） |
| 候选理由 | §50 用它定的刀 | 115k★、成熟、**13 条 GHSA 公告**、此前从未读过 |
| 公告相关性 | 18 条 | 13 条，其中含 **Zip Slip / SSRF / 越权 / API Key 提权**，且涉案控制器名字直白（`download` / `shared-link` / `api-key` / `oauth`） |

**同刻纪律（R73）**：docmost 的数字不能引 CHANGELOG（那是另一个时刻的产物），
必须**这次同一个 dist、同一组环境变量重跑**。两个项目串行跑，固证如下。

```bash
# 两个项目串行、同 binaries、同参数
NODE_OPTIONS="--max-old-space-size=1536" PROGMUNE_HUB=off PROGMUNE_MAX_LLM_CALLS=0 \
  node dist/trust/cli.js <dir> --language typescript --json > blind-benchmark/reports/heldout/trust-<name>.json
```

⚠ 本机坑（再次应验）：不限 `--max-old-space-size` 时进程会在 swap 打满的机器上换页，
docmost 一趟跑了 **25 分钟未完成**；限制 heap 后 **27 秒** 跑完。**跑得慢先怀疑 swap，不要先怀疑代码。**

## 三、结果

| 指标 | docmost（回归对象，同刻复跑） | **immich（held-out）** |
|---|---:|---:|
| decision | APPROVED | **APPROVED** |
| score | 87 | **83** |
| confidence | HIGH | **HIGH** |
| 违规总数 | 6 | **174** |
| 其中 `NESTJS_NO_VALIDATION` | 0 | **153（87.9%）** |
| `policyCompliance` | 100 / 0 条 | 100 / **0 条**（framework.* 被排除了） |
| `protocolSafety.authentication` | 52（6 条） | **0（174 条）** |
| ssgCoverage 命中率 | 142/4632 = **3.1%** | 40/11170 = **0.36%** |
| mappingCoverage | 12% LOW（4418 APIs） | **8% LOW（10746 APIs）** |
| coverageConfidence | 0 / LOW | 0 / LOW |
| safeguardAlerts（不进判定） | 1320 / 21 族 | 2574 / 25 族 |

docmost 同刻复跑完全复现了 CHANGELOG（APPROVED 87 / 6 条）⇒ 说明我这边的运行环境与 §50 同刻可比，
**immich 的 174 条不是环境差异**。

## 四、结论 1：四刀没有泛化，而且失败方式很具体

153 条是同一句判词：

```
Mutation route POST albums/ has no @UsePipes for input validation.
```

而 immich **确实有全局校验**——只是注册形态是第三种：

```ts
// server/src/app.module.ts:47
{ provide: APP_PIPE, useClass: ZodValidationPipe },   // nestjs-zod + zod 4.4.3
```

3.7.55 的刀 1 认识两种形态：`app.useGlobalPipes(ValidationPipe)`（docmost）和
`createZodDto` 型 DTO（hedgedoc）。**immich 用的是 provider 注入，两者都不是。**

⇒ **修复学到的是「两种形态」，不是「框架可以在多处注册校验」这个概念。**
这是 in-sample 失败最典型的样子：不是随机变差，而是**恰好倒在第三种形态上**。

## 五、结论 2（本次最意外，且此前没人提过）：判定聚合会吞掉一个维度上的彻底失败

immich 的 `protocolSafety.authentication` **子分 0 分、挂着 174 条违规**，
但总体仍是 **APPROVED 83 + confidence HIGH**。这不是 bug 而是**权重算术**：

```
authentication 权重 0.25 × protocolSafety 权重 0.30 = 0.075
⇒ 该维度从 100 掉到 0，总分也只损失 7.5 分
score = 0.35×100 + 0.30×75 + 0.20×73 + 0.15×70 = 82.6 ≈ 83 ⇒ APPROVED
```

同时 **174 条全部是 `medium`**，没有 critical ⇒ 不触发硬阻断路径。

⇒ **一个项目可以在鉴权维度上满分变零分，依然拿到 APPROVED + HIGH。**

这一点比 docmost 的假 BLOCKED **更值得警惕**：假 BLOCKED 会立刻被人看见并反对，
而「auth 0 分 + APPROVED/HIGH」是**静默通过**——用户看到的结论是「这个产品可信」。
（顺带一提：docmost 修复后残留的 6 条也把 authentication 压到 52 分，同样没有反映到 decision。）

## 六、结论 3：0.36% 观测率下照样出「HIGH」

| 观测指标 | immich |
|---|---|
| SSG 状态机匹配到的调用 | 40 / 11170 = **0.36%** |
| API→语义域映射覆盖率 | 8%（LOW） |
| coverageConfidence | **0 / LOW** |
| 最终 confidence | **HIGH** |

状态机只在 0.36% 的调用上看到东西，其余 99.6% 是**它没看见**，而所有缺席型判据
（NO_VALIDATION / NO_AUTH / SSG_STATE_VIOLATION）都建立在「没看见 ⇒ 没做」上。
这给 §49.6 那条符号 —— **absence of evidence ≠ evidence of absence** —— 提供了最硬的量：
**不是修辞，是「有效观测率 0.36%」。**

## 七、结论 4：召回侧出现主路径**首次**教科书级位置命中（且 Zip Slip 仍然是漏的）

做 held-out 时顺带把 immich 的 13 条公告对了一遍：

| 公告 | 涉案位置 | 主路径是否报到该位置 | 判定 |
|---|---|---|---|
| GHSA-hq46-gw2v-q86p（SSRF，CWE-918，OAuth 头像 URL） | `OAuthRepository.getProfilePicture` | **命中** | 源码复核：`fetch(url)` 无防护；调用者 `auth.service.ts:387` `syncProfilePicture` 直接传 OAuth 返回的 `profile.picture`。**链路无 URL 白名单** |
| GHSA-jrp5-g662-hq92（Zip Slip，archive 下载端点） | `download.controller` 相关 | **未命中** | 两条 PATH_TRAVERSAL 落在 `bin/sync-sql.ts`、`utils/maintenance.ts`，非请求上下文 ⇒ 噪声 |

⇒ §50 记的「**主路径从未命中过任何一条真实公告的位置**」要改成：**有 1 次，且源码复核支持**。
（docmost 18 条 0 命中、fr-corpus 17 条 0 检出仍然成立，只是不能说「从未」。）

⚠ 口径不变：本地源码是**已修复**版本；SSRF 这条当前代码形态仍无防护，
是否需要与公告的官方修复位置交叉复核，按 §49.17 的做法留人工判定。

## 八、下一步建议（顺序有讲究）

1. **先把刀 1 从「形态枚举」升级为「注册事件」**（接线层，不碰判定核心）：
   全局/局部校验管道的注册途径至少四种 ——
   `app.useGlobalPipes()` ／ `APP_PIPE` provider ／ 模块级 `@UsePipes` ／ 路由级管道；
   且实现可以是 `ValidationPipe`（class-validator）或 `ZodValidationPipe`（nestjs-zod）等第三方。
   **任一命中 ⇒ 该路由处于有校验管道的上下文，不应报 NO_VALIDATION。**
2. **定 decision 聚合下限**：任一安全维度打 0 分（或低于阈值）时，
   不得输出 APPROVED/HIGH，至少降级 `NEEDS_REVIEW`；并让 `coverageConfidence=0/LOW`
   与 `mappingCoverage=LOW` **进入 confidence**（现在两者互不相关）。
3. **验证必须用第四个仓**（`twentyhq/twenty` 9 条公告 或 `nocodb/nocodb` 48 条公告），
   **不能回到 immich 上验证**——否则第二个 iteração 又变成 in-sample。
4. 三个测试 + 依赖高危项（外部评审已看见的）顺手修掉。

## 九、方法论收货

- **修复和判据一样，必须在留出数据上验证。** 我们给排序信号做了嵌套交叉验证（R86），
  却把「主路径修复」的疗效量在定度出来的那一个项目上。**同一次矩阵步失败了，只是角色是「修复」而不是「信号」。**
- **「某个维度打 0 分 ⇒ 总分还能 APPROVED」是聚合层的失效**：它检测器层面完全测不出来
  （每条违规单独看都合理），只在把记分权重乘起来那一歩才暴露 —— 与本项目母题一致：**机制失效是静默的。**

复现：

```bash
python3 blind-benchmark/heldout-compare.py \
  blind-benchmark/reports/heldout/trust-docmost.json \
  blind-benchmark/reports/heldout/trust-immich.json
```
