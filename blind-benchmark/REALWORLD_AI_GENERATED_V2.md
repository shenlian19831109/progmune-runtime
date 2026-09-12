# REALWORLD_AI_GENERATED_V2 — AI 生成项目真实语料验证（Python）

> 日期：2026-09-11 ｜ 语料：**Skyvern-AI/skyvern**（⭐22,971，浏览器自动化生产 SaaS，AI-first 公司）
> 方法学：REALWORLD 系列（真实项目 + 生产管线扫描 + 逐条人工标注），V1（TypeScript/open-seo）的 Python 姊妹篇
> 复现：`git -c http.version=HTTP/1.1 clone --depth 1 https://github.com/Skyvern-AI/skyvern.git`，commit `46fc8f0d817f0bfdde73eacc7ae1eb706fd15901`（2026-09-09）
> 扫描：`LLM_API_KEY=<key> npx ts-node src/trust/cli.ts /tmp/skyvern --language python --json`（生产 trust 引擎全链路）

## 一、项目画像

| 维度 | 值 |
|---|---|
| 规模 | **2393 个 .py 文件**（其中 skyvern/ 后端 1095 个）+ skyvern-frontend/skyvern-ts（TS），仓库 5539 文件 / 617MB |
| 形态 | 生产级浏览器自动化 SaaS：FastAPI 后端（**8 个 app、412 条路由**）、Playwright、Alembic 迁移、多租户组织、OAuth（Google/Microsoft）、本地 org API token、MCP server |
| AI 构建证据 | **比 V1 的 open-seo 更强**：①仓库根 `CLAUDE.md`（"provides guidance to Claude Code (claude.ai/code) when working with code in this repository"）+ `AGENTS.md`（"Skyvern Agent Guide — comprehensive guidance for AI agents working with the Skyvern codebase"）②`.claude/skills/`（bump-version 等 agent 技能）③**CI 工作流 `claude-code-review.yml` + `claude.yml`——Claude agent 直接参与生产代码评审** |
| 协议相关性 | 认证（org token / OAuth / MCP bearer）+ 文件上传与下载（浏览器产物、PDF 解析）+ 会话生命周期（browser session 延长/锁定）——协议生命周期验证的理想靶场 |

## 二、扫描结果

```
Trust Score: 43 / Decision: BLOCKED / Confidence: HIGH
违规：181 条 medium（0 critical / 0 high）
Coverage: 0% ±25%（mapping rate 100%：lookup 133 / LLM 兜底 5285 / 总 API 出现 664,362）
FastAPI 结构层：8 apps / 412 routes / 1371 files scanned
```

**181 条违规 = 146 FASTAPI_ROUTE_NO_AUTH（框架层）+ 35 SSG（协议状态机层）。逐条人工标注：181/181 全 FP，0 TP。**

对比 V1：open-seo 的 10 条噪声全部来自 specific-checks 层（JWT_UNSAFE/PLAINTEXT/CROSS_DOMAIN）；Skyvern 上该层 **0 触发**——噪声换了层，全部集中在框架结构层与 SSG 层。

## 三、逐条标注

### 3.1 FASTAPI_ROUTE_NO_AUTH（146 条）——单根因：认证词汇表缺口

对 146 条逐条解析路由签名（`Depends(...)`/`Security(...)`/装饰器 `dependencies=`）：

| 依赖组合 | 数量 | 判定 |
|---|---|---|
| 仅 `org_auth_service.get_current_org` | 96 | **FP** — 词汇表缺口 |
| 仅 `org_auth_service.get_current_caller_context` | 15 | **FP** — 词汇表缺口 |
| caller_context + require_workflow_tagging | 14 | **FP** — 认证依赖在 |
| current_org + require_workflow_tagging | 10 | **FP** — 认证依赖在 |
| current_org + _require_schedules_enabled | 5 | **FP** — 认证依赖在 |
| current_org + _validate_file_size | 4 | **FP** — 认证依赖在 |
| **无任何 Depends（POST /webhook、/webhook/）** | 2 | **FP（机制不可见）** — 见下 |

**144 条**的根因是同一个：`tools/extract_framework_py.py` 的 `AUTH_WORDS` 词表（bearer/permission/current_user/api_key/oauth/jwt…）不认识 Skyvern 的**主力认证依赖名** `get_current_org` / `get_current_caller_context`——这恰是 23k★ 生产 SaaS 的 org-token 认证模型（`local_org_auth_token_service` + `org_auth_token_service`，PyJWT 签名校验）。词表认识 `current_user`（因此用了 `get_current_user_id_or_none` 的路由不误报），却不认识 `current_org`/`caller_context`——**语义差一个词，146 条误报**。

例：`POST /run/tasks`（`run_task`，第 306 行起）签名含 `caller: org_auth_service.CallerContext = Depends(org_auth_service.get_current_caller_context)`，且函数体再做 `PermissionCheckerFactory.get_instance().check(current_org, ...)`——双重保护，仍被报「无认证依赖」。

**剩余 2 条**（`POST /webhook`、`POST /webhook/`，agent_protocol.py:3558 起）确实无 Depends，但函数体内做 **HMAC-SHA256 签名验证**（`generate_skyvern_signature(payload, settings.SKYVERN_API_KEY)` vs 头 `x_skyvern_signature`）——认证机制在函数体内、不在依赖注入层，检测器的 Depends 模型不可见。判定 FP（机制不可见），但见 §4 发现 4 的两个真实加固点。

### 3.2 SSG 协议状态机（35 条）——8 个根因簇，全 FP

| 簇 | 数量 | 命中方式 | 根因 |
|---|---|---|---|
| A `_validate_file_stat`→`validate_file`（file_upload） | 4 | 词段 | broker_server.py 的 workstation grant 加载链。真实语义=**符号链接/属主校验**（`stat.S_ISREG`+`os.getuid`，拒绝非正规文件与越权属主）——文件系统安全防御被词段匹配拉进 file_upload 协议 |
| B `validate_local_file_path`/`validate_pdf_file`→`validate_file`（file_upload） | 12 | 词段 | 工作流块（block.py/pdf_fill/split_pdf/download_file）。真实语义=`validate_local_file_path` 是 **realpath 路径穿越防御**（解析 symlink 与 `..` 后检查 containment，越界即 PermissionError）；`validate_pdf_file` 是 pypdf/pdfplumber 可读性检查。**引擎把代码里写得很好的安全防御误报为协议违规** |
| C `_read_credential_file`→`read_file`（file） | 9 | 词段 | cli/doctor.py 读取凭据文件。真实语义=`path.read_text()` + 正则提取 `cred="…"`。**一次性库 API（Path.read_text）内部完成 open→read→close，状态机看不见 open，报 read without open**——修复建议「补 open_file」对正确代码是错误建议 |
| D `create_copilot_session`/`_session_create_data`→`create_session`（auth） | 8 | 词段 | 真实语义=`create_copilot_session` 创建 **SQLite 内存聊天会话**（`db_path=":memory:"`，copilot LLM 上下文，非认证会话）；`_session_create_data` 是构造 MCP 工具 payload 的 dict。名字撞词，语义跨域 |
| E `_revoke_refresh_token_at_google`→`revoke_token`（auth） | 1 | 词段 | 真实语义=向 Google revoke 端点 POST 已存储的 refresh token。**token 以参数传入、签发发生在更早的 HTTP 请求**——序列内看不到 issue，`pre=[TOKEN_ISSUED]` 对真实 revoke helper 永不可满足（跨请求窗口） |
| F `OwnerFileLock.acquire`（file endState） | 1 | 词段 | fcntl flock 属主锁,**设计性长持有**（进程存活期持有,release() 单独释放）——endState 检查把它当泄漏 |
| G `extend_session`→`extend_session`（session_mgmt） | 1 | 精确 | 真实语义=DB 里 browser session 的**超时延长**（session 在早先请求创建）——跨请求窗口 |

**统一模式**：除 G 外全部经**词段匹配**（"Every rule word must appear as a complete call word segment"）——项目函数名含协议词但语义无关（validate+file / read+file / create+session / revoke+token）。注意：这些**全是项目函数**，C 侧已有的 projectFunctions 门控**不适用**（门控只拦外部库调用）。这是词段匹配风险在 Python 真实语料的第一次规模化观测：此前基线 nginx 3 FP/50（C 侧），此处 35/35。

## 四、关键发现（比 FP 计数重要得多）

### 发现 1：认证词汇表缺口是框架层的新系统性缺陷

V1 发现 2 是**协议层**词汇缺口（Cloudflare Access/OAuth 形态）；V2 是**框架结构层**词汇缺口：`AUTH_WORDS` 认识 current_user 不认识 current_org/caller_context。一个词表差 146 条误报。而 Skyvern 正是「现代 SaaS 认证形态」的教科书：org-token + OAuth + MCP bearer，全部不依赖传统 username/password 词汇。

### 发现 2：词段匹配把「安全防御」误报为「协议违规」（最伤产品叙事的发现）

`validate_local_file_path`（路径穿越防御）、`_validate_file_stat`（符号链接/属主校验）、`validate_workstation_grant`（**hmac.compare_digest 常量时间比较**）——这些是 AI 生成代码里**写得正确甚至优秀的防御代码**，引擎对它们的报法却是「协议状态违规」。一个「AI Trust Decision Engine」把 AI 生成代码的安全防御报成违规并给出错误修复建议（补 open_file），是定位级风险。营销角度这反而是诚实的资产（见 §5-4）。

### 发现 3：AI 生成代码 0 真实协议违规（与 V1 一致的信号）

181 flags 全 FP——高质量 AI 生成代码 + agent 规范（CLAUDE.md/AGENTS.md/CI claude 评审）下，协议纪律是真的。且人工补查发现多处**做对了的加固**：`pyjwt.decode(..., algorithms=["RS256"])` 算法白名单（V1 的 open-seo 缺的正是这个）、`hmac.compare_digest`、realpath 路径穿越防御、OAuth revoke 的超时与状态码检查。

### 发现 4：定位错位——引擎没报的两处真实加固点（人工补查）

1. **webhook HMAC 比较非常量时间 + timestamp 不做新鲜度校验**（agent_protocol.py:3559-3588）：`x_skyvern_signature == generated_signature` 是字符串 `==`（应 `hmac.compare_digest`，CWE-208 类）；`x_skyvern_timestamp` 仅记录不参与验签——签名永不过期、可重放。**影响如实评估：该端点只做校验+日志+返回 200，不改变状态**，重放面限于日志污染/analytics 污染。但这是引擎语义上「该看见的」认证弱点，146 条误报之外它一条没报。
2. **本地 org API key 生命周期 5200 周 + `verify_exp: False`**（org_auth_token_service.py / local_org_auth_token_service.py）：自托管本地 key 按设计永不失效（100 年），解码时显式跳过过期校验。边界性：`_decode_local_api_key_payload` 若被用于认证决策（ensure_local_api_key 链路），过期 token 仍通过解码——需 Skyvern 侧确认设计意图。**按设计决策对待，不判违规。**

### 发现 5：LLM 语义缓存的跨语言复用观察

扫描 llmHits=5285，但磁盘缓存 `.progmune_generated/api-semantic-cache.json` 条目数不变（7675，全部来自 V1 的 TS 扫描）——**V2 的 LLM 命中全部吃 V1 遗留缓存**。名称级缓存跨语言/跨项目复用：好处是省 API 调用，风险是 TS 语境下打的标签被 Python 语境复用（名称在不同语言语义漂移）。观察记档，暂不改动（引擎级改动需盲测复跑为前提）。

## 五、对引擎与产品的启示

1. **FastAPI 提取器 AUTH_WORDS 补 org/caller 词族（P1，谨慎改）**：`get_current_org`/`get_current_caller_context`/`current_caller` 类词入表可消 144 条 FP。但注意词表膨胀的语义漂移风险（FastAPI 结构检测器在 4 个真实语料刚达标 0 FP 并带反证——任何改动需重跑 `npm run audit:realworld` 全语料 + 反证）。
2. **词段匹配收紧（P2，数据点已够）**：C 侧 nginx 3/50 + 本报告 35/35 两个真实数据点都指向「项目函数名含协议词≠协议原语」。候选方向：词段匹配要求**词序**（validate 先于 file）而非集合包含，或要求协议词为名字的**前缀/后缀边界**（`validate_` 开头且 `_file` 结尾），或特定规则挂「需注解确认」门槛。引擎级改动照例先盲测复跑（TS 795 / Python 66 零漂移门槛）。
3. **一次性库 API 生命周期豁免（P2）**：`Path.read_text()` 族（read_text/write_text/read_bytes）内部完成 open→close，应视为完整生命周期而非裸 read。与 C 侧「长生命周期资源」同族问题。
4. **营销素材（本报告即是内容日历素材）**：诚实叙事——「我们扫了 23k★ 的 AI 生成 Python 生产项目：181 个 flags 全部是我们引擎自己的噪声，其中 16 条把代码里的路径穿越防御误报成协议违规。我们如实公布每一个误报的根因。」这是「辅助检查器而非部署门禁」定位的直接证据。
5. **webhook 类认证机制的规则面缺口（P2 产品）**：签名验证型端点（HMAC header）完全落在框架层 Depends 模型之外——至少应识别「函数体内 signature/timestamp 验证」形态，避免把受保护端点报成无认证。

## 六、后续（用户指示：一个语言先一个项目）

- ✅ TypeScript：open-seo 已完成（V1）
- ✅ Python：skyvern 已完成（本报告）
- ⏭ Go/C：AI 生成项目较稀少，可放宽为「AI 辅助」标记（候选：有 CLAUDE.md/AGENTS.md 的 Go 项目）
