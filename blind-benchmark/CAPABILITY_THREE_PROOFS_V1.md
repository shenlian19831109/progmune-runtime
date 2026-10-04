# 能力三要件审计 V1 — 每项对外宣称的能力，PoC/泛化/精度打表

> 日期：2026-10-04 ｜ 依据：R103（用户战略共识：「能力成立须凑齐三要件，缺一只能说这个案例会了」）
> 口径：PoC = fr-corpus DETECTED（修复前报出+修复后不误报）；泛化 = held-out 项目命中（未参与诊断）；精度 = 真实项目全量误报率测量
> 用途：①对外宣称分级的数据基础（README 能力诚实修正）②「修看不见」候选排期 ③「修冤枉」资源分配

## 一、总表

| 能力 | PoC | 泛化 | 精度 | 档位 | 缺口 |
|---|---|---|---|---|---|
| **SSRF（TS）** | ✓ fr-011 | ✓ immich=GHSA-hq46 位置命中 | ◐ 2 条样本（1 命中+1 未定） | **强** | 精度侧扩样本 |
| **路径穿越（TS）** | ✓✓ fr-007+fr-016 | ◐ docmost 4 条公告 HIT；**immich ZipSlip 未命中** | ◐ 3 条噪声样本 | 中 | **泛化失败样本根因**（修看不见候选 #1） |
| **NestJS 适配** | ✓ realworld 真实 TP | ✓ immich 翻车→§52 修复闭环 | ✓ 两仓（hedgedoc 19 条已定性边界） | **强** | 无（维持复测） |
| **归属校验（Python）** | ✓ fr-005 | ✗ 无 held-out | ✗ 无全量数据 | 弱 | 泛化+精度双缺 |
| **决策门禁（§53）** | n/a（机制非检测） | ✓ 9 项目 3 触发/6 不触发（R101 反例） | ✓ | 强 | 无 |
| **协议状态机（SSG）** | ✗ fr 0 检出 | ✗ | ✗ immich 10 条未核实 | **无档** | 重新定位（注解驱动口径 C 金标 5/5） |
| **排序器** | ✓ 留一仓 AUC 0.895 | ✓ 嵌套 CV/参数网格 | ◐ 产品流头部已验证 | 强（评估口径） | 先验口径迁移偏差未量化 |
| **safeguard 告警流（整体）** | — | — | 加权精确率 5.8%（§49.17） | 证据流定位 | 排序+补标注 |

## 二、逐项证据

### 1. SSRF（TS）——三件套最全，可对外称「强」

- PoC：fr-011 mcp-from-openapi 修复前报出/修复后 0（引擎级）；fr-010 unstructured（Python 提取器级）
- 泛化：**immich（从未参与诊断）SSRF 打在 `OAuthRepository.getProfilePicture`，源码复核确认 `fetch(url)` 无防护 ⇒ = GHSA-hq46 教科书级位置命中**（§51，主路径首次真实公告命中）
- 精度：immich 2 条 SSRF = **1 TP（公告位置）+ 1 FP**（`MachineLearningRepository.check`——url 来自 `this.config.urls` 配置注入，非用户输入；2026-10-04 源码定性）。docmost 0 条。n=2 如实记录：**URL 形参根无法区分配置 URL 与用户 URL 的已知边界**（skyvern `_fetch_discovery` 同类）

### 2. 路径穿越（TS）——PoC 强，泛化有一个失败样本

- PoC：fr-007 openhop（pre 5/post 0）、fr-016 redocly（pre 7/post 0）——真实修复双向验证，全项目最强 PoC
- 泛化：docmost 公告 4 条 HIT/PARTIAL（r4cx/9f58/95f8/54pm——docmost 未参与 fr 诊断，算 held-out）；**但 immich 的 ZipSlip（GHSA-jrp5）未命中**——失败样本在手，根因待析
- 精度：docmost 1 条（readDocmostMetadata，zip-import 攻击面相邻函数）；immich 2 条（SqlGenerator.write/detectPriorInstall，均非公告位置，噪声）
- **缺口（修看不见候选 #1，2026-10-04 已析，判不可点亮）**：immich ZipSlip（GHSA-jrp5-g662-hq92，archive 下载端点）。R20 三问：①pre 无校验 ✓ ②**污点根不在切片内** ✗——污点源是 DB 字段 `asset.originalFileName`（上传存库→另一请求下载读出，**跨请求存储污点**），非 req.*/URL 参数/文档解析键；③fix 是新增校验 ✓（修复后 `filename = sanitize(originalFileName)`，vendored 代码确认）。**结论：结构性够不着（stored-taint 形态），现有管线 req.* 单跳+跨函数一跳追不到数据库回流；任何 DB 字段作污点根都会 FP 爆炸。归入「数据流」漏报大类的新子类：跨请求存储污点。不注册、不点亮，如实记录。**

### 3. NestJS 适配——完整闭环案例（三件套模板）

- PoC：lujakob realworld 真实 TP（DELETE /users/:slug）
- 泛化：docmost（in-sample 修复）→ immich 盲考 **153 条翻车** → 根因（APP_PIPE 第三形态）→ §52 修复 → 0 条。**失败→根因→修复→重验**的完整闭环是三件套的标准走法
- 精度：docmost/hedgedoc 两仓，hedgedoc 剩余 19 条已逐条定性为粒度边界（如实保留）

### 4. 归属校验（Python）——只有 PoC

- PoC：fr-005 open-webui（cross_user_write）
- 泛化/精度：**均无数据**。缺口排期：找一个有"跨用户写"类公告的 Python 项目做 held-out（候选：从 GHSA 库筛 CWE-639/862 的 Python 项目）

### 5. 决策门禁（§53）——机制类能力的验证范式

- 不是检测能力，用「触发/反例」验证：9 真实项目 3 触发（immich/nestjs-realworld/nocodb，auth 均 0 分）/6 不触发——R101 有反例才不是常数。第一版被数据否决后收窄的教训已入档。

### 6. 协议状态机——无档，重新定位

- 三要件全缺：fr 0 检出、无 held-out、immich 10 条 SSG_FILE_STATE_VIOLATION 未核实真伪
- 现状最诚实的定位：**注解驱动（用户声明协议→机器验证序列）有 C 金标 5/5 与 demo 正向对照；自动对照是研究级**。对外叙事按此分级，直到有 PoC 数据再改。

### 7. 排序器——评估口径强，产品口径有一处未量化

- 评估：留一仓 AUC 0.895、嵌套 CV、参数网格 0.810~0.912——评估口径三件套齐
- 产品：docmost 告警流头部效果实测 ✓；**先验迁移偏差未量化**（fp-gold 基于 extractIRWithTypes 口径，产品用 extractIR，告警量差 +9.8%）——列入补核

## 三、缺口排期（按性价比）

1. **P0（5 分钟）：immich 的 `MachineLearningRepository.check` 定性**——SSRF 精度样本补全
2. **P0（半天）：README 能力诚实修正**——按本表档位重写能力宣称（「强」档写清楚证据，「无档」如实标研究级）
3. **P1（修看不见候选 #1）：ZipSlip 失败样本根因**——按 R20 三问（pre 侧有无校验/污点根在不在切片/fix 是不是新增校验）决定能否点亮
4. **P1：归属校验 Python held-out**——筛一个 CWE-639/862 的 Python 项目盲考
5. **P2：排序器先验口径补核**——同一仓库 extractIR vs extractIRWithTypes 对照，量化偏差
6. **P2：协议状态机重新定位落文**——对外叙事从「自动对照」改「注解驱动+研究级自动」，README/POSITIONING 同步

## 四、方法论注记

- 本表是三要件框架（R103）的第一份实例。新能力上线/老能力复查都按此表更新。
- 「PoC 通过 ≠ 能力成立」的两次血泪：docmost 四刀→immich 153 条；数据挑信号 76.9%→25.3%。
- held-out 项目的选择标准（§51）：同形态、够大、有公告可对照、从未参与诊断。
