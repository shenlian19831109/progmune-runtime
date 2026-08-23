# Changelog

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
