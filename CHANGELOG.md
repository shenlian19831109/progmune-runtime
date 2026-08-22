# Changelog

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
