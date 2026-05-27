# Progmune Runtime（免序）

**程序免疫学：约束引导的程序合成运行时**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Stage: Technical Preview](https://img.shields.io/badge/Stage-Technical_Preview-orange)]()

Progmune（免序）不是一个 AI 编程助手，而是一个面向生成式程序的免疫系统。它将大语言模型（LLM）从开放世界的代码生成器，降级为在程序真相层（IR）严格约束下的启发式搜索器，确保生成的代码不仅在符号和类型上正确，更在行为协议上合法。

---

## 目录

- [核心命题](#核心命题ai-生成的程序必须具备免疫系统)
- [架构概览](#架构概览一个会学习会记忆会防御的运行时)
- [语义有效性级别 (SVL)](#语义有效性级别-svl)
- [Semantic Observatory](#semantic-observatory语义观测台)
- [快速开始](#快速开始)
- [CLI 命令](#cli-命令)
- [MCP 工具](#mcp-工具)
- [LLM 后端配置](#llm-后端配置)
- [全球免疫网络](#全球免疫网络-global-immune-network)
- [常见问题](#常见问题)
- [Action 对象字段说明](#action-对象字段说明)
- [许可证](#许可证)

---

## 核心命题：AI 生成的程序必须具备免疫系统

LLM 在生成代码时会产生"幻觉"——调用不存在的函数、违反类型约束、跳过关键的业务步骤。传统的提示工程和事后校验无法根除这些问题，因为它们将 LLM 置于系统的中心，缺乏第一性原理的约束。

Progmune 提出**程序免疫学（Program Immunology）**范式，为生成式程序建立一套可识别、可记忆、可进化的防御体系：

1. **天然免疫**：快速识别并拒绝违反符号存在性、类型兼容性和数据流规则的代码。
2. **获得性免疫**：从过去的失败案例中学习，生成特异性的防御规则，主动预防未来同类错误。
3. **免疫记忆**：将成功和失败的模式沉淀为结构化的知识，使系统随着使用持续进化，越用越可靠。

**详细理论框架请参阅《[Program Immunology 白皮书](./WHITEPAPER.md)》。**

---

## 架构概览：一个会学习、会记忆、会防御的运行时

Progmune 的架构受生物免疫系统启发，分为三层：

| 生物免疫系统 | 程序免疫 (Progmune) | 核心职责 |
|:-------------|:--------------------|:---------|
| **天然免疫** | **约束引擎** (IR + SVL-1~SVL-3) | 快速、自动地拒绝调用不存在的函数、类型错误和数据流问题。 |
| **获得性免疫** | **语义状态图 (SSG)** | 通过可编程的状态机，精确拦截非法业务逻辑跃迁（如"未认证即签发令牌"），输出结构化修复路径。 |
| **免疫记忆** | **三层记忆 + Failure Corpus** | 工作记忆、情景记忆和语义记忆协同；失败基因组记录每次语义异常、修复路径和适应轨迹。 |
| **抗体生成** | **Antibody Registry** | 从失败中自动挖掘修复模式，按 ACL-1~4 置信度分级，生成候选免疫规则。 |
| **免疫观测** | **Semantic Observatory** | 终端原生语义观测工具——时间线、认知回放、状态机追踪、基因组热力图。 |

### SSG：语义状态图

SSG 是 Progmune 的协议级验证引擎。通过 `@protocol` JSDoc 注解声明函数的前置/后置状态和失效规则：

```typescript
/**
 * 签发 JWT 令牌
 * @protocol pre_states=["PASSWORD_VERIFIED"] post_states=["TOKEN_ISSUED"] invalidate=["PASSWORD_VERIFIED"]
 */
export function generate_jwt(userId: string, expiresIn: number): string
```

当 AI 生成的代码违反协议时，SSG 输出结构化拒绝：被拦截的函数、当前状态、所需状态、缺失步骤和完整修复路径。

### Failure Corpus：AI 失败基因组

每次语义异常被记录为一条基因组记录，包含：违规 SVL 级别、约束类型、SSG 状态快照、修复路径、缺失函数、规划器重试次数。`IntentSession` 将同一意图的所有适应尝试链接为完整的"认知会话"——记录 AI 如何从失败中逐渐学会正确完成任务。

---

## 语义有效性级别 (SVL)

Progmune 定义了 AI 生成代码正确性的分层标准：

| 级别 | 名称 | 保证 |
|:-----|:-----|:-----|
| SVL-1 | 符号存在性 | 绝不调用项目中不存在的函数 |
| SVL-2 | 类型有效性 | 参数数量和类型严格匹配 |
| SVL-3 | 数据流正确性 | 变量先声明后使用，无循环引用 |
| SVL-4 | 协议合法性 | 业务步骤顺序必须遵守状态迁移规则 |

---

## Semantic Observatory（语义观测台）

终端原生的 AI 推理可观测性工具。零依赖，纯 ANSI + Unicode box-drawing。

```bash
# 会话摘要表
ts-node src/semantic-trace.ts

# 单会话完整时间线
ts-node src/semantic-trace.ts <sessionId>

# 逐步认知回放（含适应差异对比）
ts-node src/semantic-trace.ts replay <sessionId>

# 状态机转换追踪（+/− 状态获取/失效标记）
ts-node src/semantic-trace.ts --states <sessionId>

# 失败基因组（SVL 分布条状图）
ts-node src/semantic-trace.ts --genome

# 抗体注册表（ACL-1~4 置信度）
ts-node src/semantic-trace.ts --learned

# 语义热力图（脆弱协议 / 免疫层活跃度 / 约束共现 / 高摩擦任务）
ts-node src/semantic-trace.ts --heatmap
```

### 抗体置信度级别 (ACL)

| 级别 | 标准 | 含义 |
|:-----|:-----|:-----|
| ACL-1 | 单案例观察 | 首次出现的修复模式，仅记录 |
| ACL-2 | 重复观察（2+ 会话） | 同一模式在多个会话中重现，标记关注 |
| ACL-3 | 跨任务验证（4+ 次或 3+ 独立意图） | 高置信候选，可考虑纳入默认规则 |
| ACL-4 | 全局稳定（10+ 次 / 5+ 独立意图） | 已验证的免疫规则，可自动应用 |

---

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- 一个有效的 LLM API 密钥（DeepSeek 或 OpenAI 兼容接口）

### 1. 安装

```bash
npm install -g progmune-runtime
```

### 2. 配置 LLM API 密钥

```bash
# 方式一：快速配置（推荐）
npx progmune-runtime setup "你的DeepSeek或OpenAI密钥"

# 方式二：环境变量
export LLM_API_KEY="你的DeepSeek或OpenAI密钥"
```

支持多模型后端，详见 [LLM 后端配置](#llm-后端配置)。

### 3. 在 MCP 客户端中配置

**Claude Code** — 编辑 `~/.claude/settings.json`：

```json
{
  "mcpServers": {
    "progmune": {
      "command": "npx",
      "args": ["progmune-runtime"],
      "env": {
        "LLM_API_KEY": "你的DeepSeek或OpenAI密钥",
        "LLM_BASE_URL": "https://api.deepseek.com/v1"
      }
    }
  }
}
```

> `env` 字段是必需的。仅设置终端环境变量可能不会被 MCP 子进程继承。

**Manus / 其他客户端**：Command: `npx`, Args: `progmune-runtime`，并在客户端环境变量中配置 `LLM_API_KEY`。

### 4. 验证安装

```bash
npx progmune-runtime test
```

输出示例：
```
🧪 Progmune Runtime 自测试
  ✅ SVL-1: 存在函数通过
  ✅ SVL-1: 不存在函数拦截
  ✅ SVL-2: 参数数量匹配通过
  ✅ SVL-4: 非法跃迁拦截（无 auth）
📊 结果: 11/11 通过 (100%)
```

配置完成后，在对话中直接描述编程需求，AI 代理会自动调用 Progmune 生成安全代码。

---

## CLI 命令

| 命令 | 用途 |
|:-----|:------|
| `progmune-runtime setup <key>` | 配置向导，引导完成 LLM 密钥和 MCP 设置 |
| `progmune-runtime test` | 运行内置自测试（11 项），验证部署是否正常 |
| `progmune-runtime opt-in [enable\|disable\|status]` | 管理免疫网络上报 |
| `progmune-runtime` | 以 MCP 服务器模式运行（供 MCP 客户端调用） |

---

## MCP 工具

Progmune MCP 服务器暴露以下工具：

| 工具 | 描述 |
|:-----|:------|
| `progmune_generate` | 生成类型安全的 Python 代码（需传入 `intent` 和 `projectPath`） |
| `progmune_status` | 查看运行时状态、LLM 调用统计、免疫网络状况 |

**progmune_status 输出示例**：

```json
{
  "version": "2.0.5",
  "llm": { "model": "deepseek-chat", "callCount": 3, "apiKeySet": true },
  "immuneNetwork": { "optIn": true, "hubReachable": true, "totalFailures": 14 }
}
```

---

## LLM 后端配置

通过 `LLM_PROVIDER` 环境变量切换后端：

### DeepSeek（默认）

```bash
export LLM_PROVIDER=deepseek
export LLM_API_KEY="你的密钥"
```

### OpenAI

```bash
export LLM_PROVIDER=openai
export LLM_API_KEY="你的密钥"
export LLM_BASE_URL=https://api.openai.com/v1
export LLM_MODEL=gpt-4
```

### Ollama（本地模型，无需联网）

```bash
export LLM_PROVIDER=ollama
# 默认使用 http://localhost:11434/v1，模型 llama3
# 可通过 LLM_BASE_URL 和 LLM_MODEL 覆盖
```

Ollama 模式不需要 `LLM_API_KEY`，适合完全离线使用。

---

## 全球免疫网络 (Global Immune Network)

Progmune 支持将本地脱敏后的错误指纹上报至中央免疫服务器，实现"群体免疫"。开启上报后，每次 `progmune_generate` 调用会自动上报。

### 开启上报

```bash
npx progmune-runtime opt-in enable
```

### 启动本地 Hub 服务器

```bash
# 启动（默认端口 8080）
node server/hub.js

# 访问仪表板
open http://localhost:8080/
```

仪表板包含实时统计、高频错误模式、SVL 分布和最近免疫事件时间线。

### 配置中央服务器地址

```bash
export PROGMUNE_HUB="http://localhost:8080/report"
```

### 预览和手动上报

```bash
# 预览待上报的脱敏数据
npx ts-node src/report.ts preview

# 手动执行安全上报
npx ts-node src/report.ts report
```

### 隐私保护

只上传函数名序列、SVL 级别、状态迁移，**绝不包含**任何代码片段、变量值或用户数据。

---

## 常见问题

遇到问题？请查阅 [FAQ.md](./FAQ.md)，涵盖：

- 如何获取 API 密钥
- MCP 配置失败的排查步骤
- 免疫网络上报说明
- 数据隐私保障
- 错误调试指南

---

## Action 对象字段说明

当使用 Progmune 的 Action API 时，请遵循以下字段规范：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | `"call" \| "if" \| "assign" \| "return"` | 是 | 动作类型 |
| `function` | `string` | 当 `kind` 为 `"call"` 时 | 被调用的函数名。**注意不是 `fn` 或 `name`** |
| `args` | `Arg[]` | 当 `kind` 为 `"call"` 时 | 参数列表，每个元素为 `{ name: string, type: string, value: any }` |
| `assignTo` | `string` | 否 | 将返回值绑定到的变量名 |
| `condition` | `string` | 当 `kind` 为 `"if"` 时 | 条件变量名，必须是已声明的变量 |

**常见错误**：使用 `action.fn` 代替 `action.function` 会导致校验器报告"函数 'undefined' 不存在"。

---

## 许可证

MIT License。

Progmune 正在重新定义 AI 辅助编程——不是"让模型更聪明"，而是"让程序真相主导生成"。加入我们的技术预览，一起构建可验证的 AI 编码未来。

---

# Progmune Runtime

**Program Immunology: Constraint-Guided Program Synthesis Runtime**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Stage: Technical Preview](https://img.shields.io/badge/Stage-Technical_Preview-orange)]()

Progmune is not an AI programming assistant, but an immune system for generative programs. It demotes Large Language Models (LLMs) from open-world code generators to heuristic searchers strictly constrained by the Program Truth Layer (IR), ensuring that generated code is not only symbolically and type-correct but also behaviorally legal.

---

## Table of Contents

- [Core Proposition](#core-proposition-ai-generated-programs-must-have-an-immune-system)
- [Architecture Overview](#architecture-overview-a-runtime-that-learns-remembers-and-defends)
- [Semantic Validity Levels (SVL)](#semantic-validity-levels-svl)
- [Semantic Observatory](#semantic-observatory)
- [Quick Start](#quick-start)
- [CLI Commands](#cli-commands)
- [MCP Tools](#mcp-tools)
- [LLM Backend Configuration](#llm-backend-configuration)
- [Global Immune Network](#global-immune-network)
- [FAQ](#faq)
- [Action Object Fields](#action-object-fields)
- [License](#license-1)

---

## Core Proposition: AI-Generated Programs Must Have an Immune System

LLMs often hallucinate when generating code—calling non-existent functions, violating type constraints, or skipping critical business steps. Traditional prompt engineering and post-hoc validation cannot eradicate these issues because they place the LLM at the center of the system, lacking first-principle constraints.

Progmune proposes the **Program Immunology** paradigm, establishing an identifiable, memorable, and evolvable defense system for generative programs:

1. **Innate Immunity**: Rapidly identify and reject code that violates symbolic existence, type compatibility, and dataflow rules.
2. **Adaptive Immunity**: Learn from past failure cases to generate specific defense rules, actively preventing similar future errors.
3. **Immune Memory**: Consolidate successful and failed patterns into structured knowledge, allowing the system to continuously evolve and become more reliable with use.

**For a detailed theoretical framework, please refer to the [Program Immunology Whitepaper](./WHITEPAPER.md).**

---

## Architecture Overview: A Runtime That Learns, Remembers, and Defends

Inspired by biological immune systems, Progmune's architecture consists of three layers:

| Biological Immune System | Program Immunology (Progmune) | Core Responsibility |
|:-------------------------|:------------------------------|:--------------------|
| **Innate Immunity** | **Constraint Engine** (IR + SVL-1~SVL-3) | Rapidly and automatically rejects calls to non-existent functions, type errors, and dataflow issues. |
| **Adaptive Immunity** | **Semantic State Graph (SSG)** | Precisely intercepts illegal business logic transitions (e.g., "issue token before authentication") via programmable state machines, outputting structured repair paths. |
| **Immune Memory** | **Three-Layer Memory + Failure Corpus** | Working, episodic, and semantic memory collaborate; the failure genome records every semantic anomaly, repair path, and adaptation trajectory. |
| **Antibody Synthesis** | **Antibody Registry** | Automatically mines repair patterns from failures, graded by ACL-1~4 confidence, generating candidate immune rules. |
| **Immune Observability** | **Semantic Observatory** | Terminal-native semantic observability tool — timeline, cognitive replay, state machine trace, genome heatmap. |

### SSG: Semantic State Graph

SSG is Progmune's protocol-level validation engine. Functions declare pre/post states and invalidation rules via `@protocol` JSDoc annotations:

```typescript
/**
 * Issue JWT token
 * @protocol pre_states=["PASSWORD_VERIFIED"] post_states=["TOKEN_ISSUED"] invalidate=["PASSWORD_VERIFIED"]
 */
export function generate_jwt(userId: string, expiresIn: number): string
```

When AI-generated code violates a protocol, SSG outputs a structured rejection: blocked function, current state, required state, missing steps, and a complete repair path.

### Failure Corpus: AI Failure Genome

Every semantic anomaly is recorded as a genome entry containing: violated SVL level, constraint type, SSG state snapshot, repair path, missing functions, and planner retry count. `IntentSession` links all adaptation attempts for a single intent into a complete "cognitive session" — recording how AI gradually learns to complete tasks correctly.

---

## Semantic Validity Levels (SVL)

Progmune defines a layered standard for the correctness of AI-generated code:

| Level | Name | Guarantee |
|:------|:-----|:----------|
| SVL-1 | Symbolic Existence | Never calls functions that do not exist in the project |
| SVL-2 | Type Validity | Parameter count and types strictly match |
| SVL-3 | Dataflow Correctness | Variables are declared before use, no circular references |
| SVL-4 | Protocol Legality | Business step order must adhere to state transition rules |

---

## Semantic Observatory

Terminal-native AI reasoning observability tool. Zero dependencies, pure ANSI + Unicode box-drawing.

```bash
# Session summary table
ts-node src/semantic-trace.ts

# Full timeline for a single session
ts-node src/semantic-trace.ts <sessionId>

# Step-by-step cognitive replay (with adaptation diffs)
ts-node src/semantic-trace.ts replay <sessionId>

# State machine transition trace (+/− state gain/invalidation)
ts-node src/semantic-trace.ts --states <sessionId>

# Failure genome (SVL bar charts)
ts-node src/semantic-trace.ts --genome

# Antibody registry (ACL-1~4 confidence levels)
ts-node src/semantic-trace.ts --learned

# Semantic heatmap (fragile protocols / immune layer activity / constraint co-occurrence / high-friction intents)
ts-node src/semantic-trace.ts --heatmap
```

### Antibody Confidence Levels (ACL)

| Level | Criteria | Meaning |
|:------|:---------|:--------|
| ACL-1 | Single case observation | First occurrence — record only |
| ACL-2 | Repeated observation (2+ sessions) | Pattern reproduced across sessions — flag for attention |
| ACL-3 | Cross-task validated (4+ occurrences or 3+ distinct intents) | High-confidence candidate — consider as default rule |
| ACL-4 | Globally stable (10+ occurrences / 5+ distinct intents) | Validated immune rule — safe for automatic application |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- A valid LLM API key (DeepSeek or OpenAI compatible)

### 1. Installation

```bash
npm install -g progmune-runtime
```

### 2. Configure LLM API Key

```bash
# Option 1: Setup wizard (recommended)
npx progmune-runtime setup "YOUR_API_KEY"

# Option 2: Environment variable
export LLM_API_KEY="YOUR_DEEPSEEK_OR_OPENAI_KEY"
```

See [LLM Backend Configuration](#llm-backend-configuration) for multi-model support.

### 3. Configure in MCP Client

**Claude Code** — Edit `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "progmune": {
      "command": "npx",
      "args": ["progmune-runtime"],
      "env": {
        "LLM_API_KEY": "YOUR_DEEPSEEK_OR_OPENAI_KEY",
        "LLM_BASE_URL": "https://api.deepseek.com/v1"
      }
    }
  }
}
```

> The `env` field is required. Terminal-level environment variables may not be inherited by MCP subprocesses.

**Manus / Other Clients**: Command: `npx`, Args: `progmune-runtime`, configure `LLM_API_KEY` in the client's environment variables.

### 4. Verify Installation

```bash
npx progmune-runtime test
```

Expected output:
```
🧪 Progmune Runtime 自测试
  ✅ SVL-1: 存在函数通过
  ✅ SVL-1: 不存在函数拦截
  ✅ SVL-2: 参数数量匹配通过
  ✅ SVL-4: 非法跃迁拦截（无 auth）
📊 结果: 11/11 通过 (100%)
```

After configuration, describe your programming needs directly in the conversation, and the AI agent will automatically invoke Progmune to generate secure code.

---

## CLI Commands

| Command | Description |
|:--------|:------------|
| `progmune-runtime setup <key>` | Setup wizard for LLM API key and MCP configuration |
| `progmune-runtime test` | Run 11 built-in self-tests to verify the installation |
| `progmune-runtime opt-in [enable\|disable\|status]` | Manage immune network reporting |
| `progmune-runtime` | Run as MCP server (for MCP clients) |

---

## MCP Tools

| Tool | Description |
|:-----|:------------|
| `progmune_generate` | Generate type-safe Python code (requires `intent` and `projectPath`) |
| `progmune_status` | View runtime status, LLM stats, and immune network health |

**progmune_status example**:

```json
{
  "version": "2.0.5",
  "llm": { "model": "deepseek-chat", "callCount": 3, "apiKeySet": true },
  "immuneNetwork": { "optIn": true, "hubReachable": true, "totalFailures": 14 }
}
```

---

## LLM Backend Configuration

Set `LLM_PROVIDER` environment variable to switch backends:

### DeepSeek (default)

```bash
export LLM_PROVIDER=deepseek
export LLM_API_KEY="your-key"
```

### OpenAI

```bash
export LLM_PROVIDER=openai
export LLM_API_KEY="your-key"
export LLM_BASE_URL=https://api.openai.com/v1
export LLM_MODEL=gpt-4
```

### Ollama (local, no internet required)

```bash
export LLM_PROVIDER=ollama
# Defaults to http://localhost:11434/v1, model llama3
```

Ollama mode does not require `LLM_API_KEY`.

---

## Global Immune Network

Progmune supports securely reporting anonymized error fingerprints to a central immune server to achieve "herd immunity." When opt-in is enabled, each `progmune_generate` call automatically uploads fingerprints.

### Enable Reporting

```bash
npx progmune-runtime opt-in enable
```

### Start Local Hub Server

```bash
node server/hub.js
# Dashboard: http://localhost:8080/
```

The dashboard provides real-time stats, top error patterns, SVL distribution, and event timeline.

### Set Central Server Address

```bash
export PROGMUNE_HUB="http://localhost:8080/report"
```

### Preview and Manual Report

```bash
# Preview anonymized data
npx ts-node src/report.ts preview

# Manual report
npx ts-node src/report.ts report
```

### Privacy Protection

Only function name sequences, SVL levels, and state transitions are uploaded; **no** code snippets, variable values, or user data are ever included.

---

## FAQ

See [FAQ.md](./FAQ.md) for troubleshooting and common issues including API key setup, MCP configuration debugging, and immune network setup.

---

## Action Object Fields

When using Progmune's Action API, follow these field conventions:

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `kind` | `"call" \| "if" \| "assign" \| "return"` | Yes | Action type |
| `function` | `string` | When `kind` is `"call"` | Function name to call. **Not `fn` or `name`** |
| `args` | `Arg[]` | When `kind` is `"call"` | Arguments, each `{ name: string, type: string, value: any }` |
| `assignTo` | `string` | No | Variable to bind the return value to |
| `condition` | `string` | When `kind` is `"if"` | Condition variable name, must be declared |

**Common mistake**: Using `action.fn` instead of `action.function` causes the validator to report "function 'undefined' does not exist."

---

## License

MIT License.

Progmune is redefining AI-assisted programming—not by "making models smarter," but by "letting program truth govern generation." Join our technical preview and build a future of verifiable AI coding together.
