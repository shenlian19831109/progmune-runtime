# Changelog

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
- trust 引擎接线：`extractCallSequencesFromIR` 换用 `buildCallSequences`，规则名集合作为展开保留单元；生效范围如实记录——ir.json 为函数数组形态（协议盲测语料 / extractIR 直出）时 P4.6 生效；合并形态 `{ typeMap, functions }`（execute/MCP 写盘）沿用既有回退路径（3.5.0 起的既有行为，恢复 IR-first 需先做词段匹配门控的 FP 打磨）
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

- README 新增「社区与反馈」章节：讨论群二维码（`assets/wechat-group.png`，当前为占位图待替换真实群码）+ GitHub Issues 通道（中英双语）
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

- `npm run check` 的 Ledger 不变量 / 回放 / 覆盖率失败为历史遗留（基线核查确认与本次改动无关），待单独排期

## [3.3.8] — 2026-08-18

- README 链接跨平台修复（npm 页面语言切换链接）
