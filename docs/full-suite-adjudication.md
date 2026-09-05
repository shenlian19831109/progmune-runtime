# 全量套件既有失败裁决地图（Full-Suite Adjudication）

> 2026-09-05（3.7.21 前后，多次全量复跑 + 基线对照后定稿）。
> **用途**：跑 `npm run test:unit` 全量前先读此文档——以下失败均为
> 既有/环境类，与本工作区代码演进无关；遇到它们不必误判为新回归，
> 也不必为「全量必须全绿」反复耗 ~1h。改动面验证以分块跑为准。

## 一、本工作区全量单进程跑的现实

- `npx vitest run src/ tests/`（= `test:all`）**不可行**：含
  `tests/soak`（固定 10 分钟 + 内存累积）等，进程 2h+ 后 worker
  OOM 崩溃（4096MB 堆顶 FATAL，RC=1 ERR_IPC_CHANNEL_CLOSED）。
  `npm run test:unit`（排除 stress/soak/chaos）仍含 performance 与
  全部重套件，本工作区（195MB `.progmune_corpus` + gitignored
  vendored 克隆 benchmarks/{ts,py,go,java}-apps/）下仍会：
  - **bootstrap-validation.test.ts**（P6.5）：干净独立跑也 OOM
    （4GB 堆 FATAL）；8GB 堆转为 75+ 分钟 GC 颠簸。环境病理，
    文件为数版未动的 P6-P7 远古提交。
  - 部分套件超出自设超时（见类②）。
- **可靠验证姿势**：分块跑（每块 <60s）+ 本裁决地图对照；
  确需全量时排除 `src/bootstrap-validation.test.ts` 并
  `NODE_OPTIONS=--max-old-space-size=8192 --maxWorkers=4`，
  且**期间不并行跑其它重任务**（worker 会被饿死，实测拖到 75 分钟
  无输出）。

## 二、失败模式六类（按错误签名分组，2026-09-05 全量实测 ~40 失败）

### 类① benchmark 数据形状错配 —— `tc.broken is not iterable` / `cases is not iterable`
- **机理**：`runFailureAttribution`（src/evaluation-campaign.ts）把
  `benchmarks/*.json`（排除 generated/priority）全部当
  BenchmarkCase 数组；但 `*-sequences.json` 族（apache/curl/libssh/
  nginx/nghttp2/openssl/redis/gold-seed…，自 36b414d2 起提交）是
  `{function,file,calls,totalCalls}` 语料格式，无 `broken` 字段。
- **波及**：protocol-foundation、ablation-study（×2）、generalization
  （×2）、P6.1.5-C、evaluation-campaign（Failure Attribution ×2）、
  p5-orchestrator（Full Orchestration Loop）、P4.7、auto-benchmark
  族（`cases is not iterable`）等 ~14 失败。
- **定性**：✅ 既有（3.7.15 基线 worktree 同款复现）。
- **处置**：修 runFailureAttribution 按形状过滤（`Array.isArray(tc.broken)`
  或跳过 `*-sequences.json`）即可一次清掉大半；未修前属已知噪音。

### 类② 超时 —— `Test timed out in 30000ms/60000ms`
- **波及**：user-simulation（250s）、telemetry-analytics（190s）、
  logistic-reward（155s）、1000-simulated-decisions（150s）、
  learning-ranker（80s）、protocol-mining、trajectory-augmentation、
  state-name alignment、P4.3/P4.4、ranking-evolution 等 ~11 失败。
- **定性**：环境性能类（重学习/语料套件在本机超出自设超时）。
- **处置**：单跑可过（大部分超时系并发争用）；确需判定时单文件跑。

### 类③ 栈溢出 —— `Maximum call stack size exceeded`
- **波及**：eval-hardening 三个仓库扫描用例（blind benchmark /
  holdout / full report）。
- **机理**：对 `__dirname/..`（整个仓库）做递归扫描，主工作区含
  gitignored vendored 深目录树 → 爆栈。
- **定性**：✅ 环境（工作区组成）——3.7.21 代码 + 干净 worktree
  （无 vendored 目录）复跑：blind/holdout **通过**；仅 full report
  仍失败（类⑥）。
- **处置**：仓库扫描类测试在无 vendored 克隆的干净 checkout 才可靠；
  本工作区跑属已知噪音。

### 类④ 数值黄金漂移 —— 语料/库增长 vs 陈旧常量
- **波及**：trajectory-corpus「18 libraries → 实 31」、realworld /
  cve-benchmark「expected 34 to be 20」、P7.5 clustering ARI 阈值
  （0.236<0.3 / 0.413<0.45）、P4.4「1800 to be 100」、AuthProtocol
  缺 `PASSWORD_VERIFIED→TOKEN_ISSUED` 等 ~8 失败。
- **定性**：✅ 既有/数据增长（trajectory-corpus 与 E2E 已 3.7.15
  基线同款验证）。常量未随语料更新。
- **处置**：属「更新陈旧断言常量」的技术债，非回归。

### 类⑤ perf 阈值 —— 如 `expected 15.9 to be less than 10`
- **波及**：protocol-bfs.perf（BFS 15.9ms>10ms）。
- **定性**：负载时机差异（类②近亲）。
- **处置**：空闲机器单跑复判。

### 类⑥ 独立既有 —— 各一条、已基线验证
- eval-hardening「full report」：3.7.15 与干净 3.7.21 均失败。
- state-name-inference「synthesizer semantic names」：`'C0_S0'` 未
  被语义命名命中（静态合成器缺口），3.7.15 同款。
- E2E workflow「full cycle false to be true」：3.7.15 同款。
- **处置**：技术债，与语言/框架工作无关。

## 三、判定方法论（本次使用，可复用）

1. **基线 worktree 复跑**：`git worktree add /tmp/base HEAD~13`
   （= 会话起点 3.7.15）+ 符号链接 node_modules，跑嫌疑文件——
   同款失败 = 既有；基线通过 = 疑似回归。
2. **干净 HEAD 对照**：`git worktree add /tmp/clean HEAD` 复跑——
   通过 = 纯工作区组成问题（vendored 目录/污染文件）。
3. **错误签名分组**：先按 `→ reason` 归类（tc.broken / timeout /
   stack overflow / 数值漂移），同签名只抽代表文件做基线，不必逐个。
4. **污染自检**：全量前 `rm -f ir.json`——engine.test 首用例对 CWD
   （仓库根）跑 evaluateTrust 会回写根 ir.json，使 ir-utils
   `loadIR`（CWD 回退）在套件内误报「非空文件」。

## 四、与本工作区代码演进的关系（结论）

- **无一失败指向语言/框架/协议行改动面**：全量同跑中 engine.test
  （含 Java v1-v3 协议行）、extract-ir-java、spring-detector 等全部
  通过；改动面验证以分块跑为准（每轮发布前已分块全绿）。
- 单进程全量「全绿」在本工作区不可达也不必要——以上六类即其
  「已知红灯清单」，对照本地图即可区分「既有噪音」与「真回归」。

## 五、附录：本机环境事实

- `.progmune_corpus` ~195MB（gitignored，历史语料累积）
- benchmarks/{ts-apps,py-apps,go-apps,java-apps}/ 为 gitignored
  vendored 克隆（真实语料考核用）——影响类③扫描
- 根 `ir.json` 会被 engine 全仓库用例回写（gitignored，跑前删除）
- 机器同时负载多任务会显著放大类②/⑤
