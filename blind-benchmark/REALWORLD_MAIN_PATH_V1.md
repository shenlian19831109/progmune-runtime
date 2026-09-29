# REALWORLD_MAIN_PATH_V1 — 产品主路径（Trust 扫描）在真实 TS 项目上的首次有效性测量

> 日期：2026-09-29 ｜ 引擎：dist 3.7.54 build（9/27，src 未动）｜ 语料：benchmarks/ts-apps/docmost（apps/server，main 分支，9/21 tarball）
> 方法：`node dist/trust/cli.js benchmarks/ts-apps/docmost/apps/server --language typescript --json`（PROGMUNE_HUB=off）
> 背景：§49.17 已测旁路（safeguard 告警）精确率 5.8%；fr-corpus（17 条真实修复）显示协议状态机主路径召回 ≈0。本报告补上主路径缺的最后一块：**真实项目全量扫描的误报率与判定行为**。

## 一、总体结果

```
decision: BLOCKED  score: 48  confidence: LOW
protocolSafety: score 75 (auth 0 / authorization 100 / payment 100 / data_integrity 100 / ledger 100)
违规总数：132（policyCompliance 与 protocolSafety 各计一次 —— 同一批违规双倍扣分）
```

一个 5k+ stars、有专职安全公告历史的成熟 NestJS 项目，被产品主路径判为 **BLOCKED（auth 维度 0 分）**。

## 二、132 条违规逐类判定（逐条读源码）

| rule_id | 条数 | 判定 | 依据 |
|---|---:|---|---|
| NESTJS_NO_VALIDATION | 123 | **系统性失明误报** | PageController 等 22 个 controller 的每个路由都有 class-validator DTO（@IsUUID/@IsString/@IsIn…），适配器未识别。E3 通道（3.7.52 `validatedDtoClassNames`）只进了 safeguard 规则，**没进框架适配器** |
| NESTJS_NO_AUTH | 3 | **语义误报** | auth/setup、auth/password-reset、auth/verify-token 是认证流程自身端点，天生无认证。safeguard 侧 3.7.53 已有 register 集合豁免，适配器没有 |
| SSG_FILE_UPLOAD_STATE_VIOLATION | 4 | 1 真 3 误 | 见下 |
| SSG_RESOURCE_STATE_VIOLATION | 1 | **语义正确（同攻击面）** | 见下 |
| PATH_TRAVERSAL | 1 | 同攻击面相邻发现 | `readDocmostMetadata`（import.utils.ts），两条公告真值在 file.utils.ts / processors——同 zip-import 攻击面不同函数，修复后版本仍报 |

**SSG 状态机 5 条细分**（全部 attachment.service.ts）：

- `uploadImage`（2 条，RESOURCE + FILE_UPLOAD）：源码 `validateFileType(preparedFile.fileExtension, validImageExtensions)` **只校验扩展名**，随后直接 `uploadToDrive`，无内容 sanitize。**语义上真**：这正是 CVE-2026-33193（GHSA-7cq4，MIME spoofing 存储型 XSS）的攻击面。但公告真值修复位置在 `getMimeType`（file.helper.ts，扩展名决定 MIME），**非精确位置命中**，且修复后版本仍报 ⇒ 说明官方修复也没在 uploadImage 做 sanitize。
- `removeUserAvatar` / `removeSpaceIcon` / `removeWorkspaceIcon`（3 条）：独立删除操作，无上传前置。状态机把 `delete_file` 硬编码为上传流程的后续步骤，对 remove 入口函数套用即误报。**建模过严**。

## 三、主路径 vs 旁路：同一张图

| | 告警量（docmost 全量） | 加权精确率 | 官方公告位置命中 | 是否进产品判定 |
|---|---:|---:|---:|---|
| 旁路（safeguard 扫描） | 1202 | 5.8%（90%CI 2.1–8.1） | 8/17（47%，§49.17） | **否**（产品不输出） |
| 主路径（trust 扫描） | 132 | **~1.5%（2/132 有真实语义）** | **0/18** | **是**（BLOCKED/APPROVED） |

主路径召回（交叉验证）：fr-corpus 17 条真实修复，协议状态机 0 检出（DETECTED 全部来自提取器/safeguard 标记）；docmost 18 条公告，主路径 0 位置命中。

## 四、结论

**产品核心 thesis（协议状态机验证真实世界安全属性）在真实 TS 项目上没有数据支持：**

1. **召回 ≈0**：主路径从未命中过任何一条真实公告的位置（fr-corpus + 84 条 GHSA 两侧独立证实）。
2. **精确率 ~1.5%**：比旁路的 5.8% 还低，且 95% 的产出（123 条）是 E3 通道没接到适配器导致的失明误报。
3. **最致命的是判定行为**：旁路的噪声只是"报出来"，主路径把噪声直接变成 `BLOCKED`——成熟项目 auth 0 分、双维度重复扣分。**虚假 BLOCKED 比虚假告警的伤害大一个量级**（后者用户翻过即可，前者直接否决项目）。
4. 一缕真实信号：SSG 状态机在 uploadImage 上发出了语义正确的"缺内容 sanitize"告警，与 CVE-2026-33193 同攻击面——证明状态机的**概念建模方向**是对的（上传→校验→存储序列），错的只是与真实代码形态的接线（校验只认扩展名的现实、remove 类入口、DTO 装饰器跨文件）。

## 五、附带发现（语料与工程）

1. **docmost 语料不完整**：`apps/server/src/ee` 是 submodule（docmost/ee 独立仓库），codeload tarball 不含。§49.17 的 MFA bypass（GHSA-vp6f）MISS 判定受此影响——真值文件 `ee/mfa/services/mfa.service.ts` 不在语料中。**§49.17 的"47% 位置覆盖率"里这条 MISS 的可信度需打折；重核需单独拉 ee 仓库。**
2. **policyCompliance 与 protocolSafety 重复计数同一批违规**（132 = 132），双倍扣分直接把 score 压到 48/BLOCKED。若修复去重，decision 可能变 NEEDS_REVIEW——**重复计数可能正在决定最终判定**。
3. `NESTJS_NO_VALIDATION` 的 `file` 字段填的是类名（"PageController"）而非文件路径，用户无法定位。

## 六、可执行的最小修复（按性价比）

1. **E3 DTO 通道接进 NestJS 适配器**：`validatedDtoClassNames` 已有现成实现，适配器侧识别"路由入参类型 ∈ 已校验 DTO 集合 ⇒ 不报 NO_VALIDATION"。预计压掉 123 条里的绝大部分。工作量小，收益 = 主路径精确率从 1.5% → 两位数。
2. **auth 端点自身豁免**：login/register/setup/password-reset/verify-token 类端点不报 NO_AUTH（safeguard 侧已有同款豁免逻辑可抄）。
3. **policy/protocol 维度去重**：同一违规对象只计一次。
4. **SSG 状态机建模修正**：delete 类操作的前置状态放宽（remove 入口不以 UPLOAD 流程为前置）；或把「缺 sanitize」从"状态违规"改为"证据提示"级。
5. 修复后用同一探针重跑 docmost，对照 decision 变化（预期 48/BLOCKED → NEEDS_REVIEW 或 APPROVED）。

## 七、方法论注记（承 R94 体系）

- **R95（建议新增）：产品判定路径（trust/decision）必须做真实项目全量误报率测量**——合成基准 795 gold P100% 与真实项目 BLOCKED 一个 5k★ 项目可以同时为真。判定引擎的"对错"只能在真实项目上验证。
- 本次测量全部用 dist（3.7.54 build）+ 真实 tarball 语料，可复现：`PROGMUNE_HUB=off PROGMUNE_MAX_LLM_CALLS=0 node dist/trust/cli.js benchmarks/ts-apps/docmost/apps/server --language typescript --json`。

## 八、最小修复落地与验证（2026-09-29，同日）

三处修复（全部 src 接线层，不碰判定核心）：

| # | 修复 | 文件 | 机制 |
|---|---|---|---|
| 1a | 全局 ValidationPipe 识别 + E3 DTO 通道接入 | `src/frameworks/nestjs-detector.ts` + `src/extract-ir.ts`（export `validatedDtoClassNames`） | `app.useGlobalPipes(ValidationPipe)` ⇒ 路由入参类型 ∈ 已校验 DTO 集合（含继承闭包）⇒ 不报 NO_VALIDATION |
| 1b | 无结构化输入豁免 | `nestjs-detector.ts` | 入参无 @Body/@Query/@Param（仅 AuthUser/Req/Res/UploadedFile）⇒ 不报 NO_VALIDATION |
| 2 | auth 端点豁免扩展 | `nestjs-detector.ts` isPublicRoute | + password-reset / reset-password / verify-token / verify / setup / init |
| 3 | 双维度重复计数去重 | `src/trust/engine.ts` | policyCompliance 只吃策略类违规（policy_ref 不以 framework/protocol-safety 开头） |

**效果对照（docmost 全量，同刻同参数）**：

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| decision | BLOCKED | **APPROVED** |
| score | 48 | **87** |
| 违规总数 | 132 | **6** |
| NESTJS_NO_VALIDATION | 123 | **0** |
| NESTJS_NO_AUTH | 3 | **0** |
| policyCompliance | 132（双计） | 0（去重后无策略违规） |
| 残留 6 条 | — | 1 PATH_TRAVERSAL（同攻击面）+ 5 SSG（1 条语义正确撞 CVE-2026-33193 攻击面 + 4 条建模误报） |

**测试**：nestjs-detector 15/15（新增 5 条正反向：全局管道+DTO 豁免、摘 DTO 装饰器转红、摘全局管道转红、继承 DTO、无结构化输入）；trust 全家 93/93。

**踩坑记录**：
1. `param.getType().getText()` 返回 `import(".../page.dto").PageInfoDto`——类型文本以 `import` 开头，取"首个标识符"会取到 `import` 关键字。改为取全部标识符、任一命中集合。
2. 测试断言 route 格式：issue.route 是 `POST pages/create`（无前导斜杠），最初断言写成 `POST /pages/create` 导致 3 个"假通过"（没匹配到恰好等于 false）——**断言格式与实现输出不一致是静默的假绿**，本次修正了断言而不是改输出（对外格式不动）。

**已知边界（不掩饰）**：
- "有全局管道 ⇒ 全路由豁免"未采用——采用"全局管道 + DTO 入参"双条件，全局管道下无 DTO 校验的路由仍报（保守）。
- DTO 无校验装饰器的路由仍报 NO_VALIDATION（真失明场景保留）。
- 反向验证只到 detector 层（转红测试）；trust 层判定变化由 docmost 对照承担。

## 九、跨仓验证：hedgedoc（第二个独立 NestJS 仓，同日）

hedgedoc backend 是**两套 API 面**（public token 鉴权 + private session 鉴权，各一个 AliasController 等）且校验体系是 **Zod**（nestjs-zod `createZodDto`），不是 class-validator——首轮修复对 docmost 全压，对 hedgedoc 只压掉 15 条（34→19），暴露两个新形态缺口：

| 缺口 | 修复 | 效果 |
|---|---|---|
| `useGlobalPipes(setupValidationPipe(logger))`——管道经辅助函数创建，字面 `ValidationPipe` 不在调用处 | 管道检测放宽为 `.useGlobalPipes(` 调用本身 | hedgedoc 全局管道被识别 |
| `class LoginDto extends createZodDto(LoginSchema) {}`——Zod 不产 class-validator 装饰器 | extends 表达式文本含 `createZodDto(` ⇒ 类名入集合（同样只扩 detector 侧） | Zod DTO 入集合 |

**hedgedoc 修复后**：47 → 32 条（NESTJS_NO_VALIDATION 34→19，NESTJS_NO_AUTH 4 条保留）。
**docmost 对表重跑**：6 条逐条不变 ⇒ 新扩展零影响。

hedgedoc 剩余 19 条 NO_VALIDATION 逐条定性：**规则粒度边界，不是失明**——
- `@Param` 裸类型（`alias/:alias`、`tokens/:keyId` 路径参数无 DTO）
- `@Body('displayName') newDisplayName: string`（属性选择式单字段，真无校验）
- 语义上"该路由确实没有结构化校验证据"，属于「有没有校验」vs「需不需要校验」的粒度问题（§49.17 R82 的翻版），如实保留。

剩余 NO_AUTH 4 条（auth/pending-user、users/check、oidc backchannel-logout）是 auth 流程端点新形态——公开注册确认、用户名存在性检查、OIDC 服务端回调。未加入豁免表（只加了 docmost 实测的 6 个形态，按 R66 不预扩词表），留给下一轮实测决定。

**最终测试**：nestjs-detector 17/17（新增 Zod 正反 2 条）+ trust 全家 **95/95**。
