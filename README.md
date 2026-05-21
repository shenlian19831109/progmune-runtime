# Progmune Runtime（免序）

**程序免疫学：约束引导的程序合成运行时**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Stage: Technical Preview](https://img.shields.io/badge/Stage-Technical_Preview-orange)]()

Progmune（免序）不是一个 AI 编程助手，而是一个面向生成式程序的免疫系统。它将大语言模型（LLM）从开放世界的代码生成器，降级为在程序真相层（IR）严格约束下的启发式搜索器，确保生成的代码不仅在符号和类型上正确，更在行为协议上合法。

---

## 核心命题：AI 生成的程序必须具备免疫系统

LLM 在生成代码时会产生“幻觉”——调用不存在的函数、违反类型约束、跳过关键的业务步骤。传统的提示工程和事后校验无法根除这些问题，因为它们将 LLM 置于系统的中心，缺乏第一性原理的约束。

Progmune 提出**程序免疫学（Program Immunology）**范式，为生成式程序建立一套可识别、可记忆、可进化的防御体系。我们证明了，通过将程序的真实结构（IR）确立为唯一真相源，可以使 AI 生成的代码具备：

1.  **天然免疫**：快速识别并拒绝违反符号存在性、类型兼容性和数据流规则的代码。
2.  **获得性免疫**：从过去的失败案例中学习，生成特异性的防御规则，主动预防未来同类错误。
3.  **免疫记忆**：将成功和失败的模式沉淀为结构化的知识，使系统随着使用持续进化，越用越可靠。

**详细理论框架请参阅《[Program Immunology 白皮书](./WHITEPAPER.md)》。**

---

## 架构概览：一个会学习、会记忆、会防御的运行时

Progmune 的架构受生物免疫系统启发，分为六个核心层：

| 生物免疫系统 | 程序免疫 (Progmune) | 核心职责 |
|:-------------|:--------------------|:---------|
| **天然免疫** | **约束引擎** (IR + SVL-1~SVL-3) | 快速、自动地拒绝调用不存在的函数、类型错误和数据流问题。 |
| **获得性免疫** | **语义状态图 (SSG)** | 通过可编程的状态机，精确拦截非法业务逻辑跃迁（如“未认证即签发令牌”）。 |
| **免疫记忆** | **三层记忆架构** | 工作记忆、情景记忆和语义记忆协同，让系统越用越聪明，相似意图可跳过LLM直接复用验证过的路径。 |
| **抗原呈递** | **Failure Corpus** | 结构化的失败案例库，每一次拦截都转化为可分析的“错误指纹”，为系统进化提供数据基础。 |

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

## 快速开始

### 前置条件

*   [Node.js](https://nodejs.org/) >= 18
*   一个有效的 LLM API 密钥（DeepSeek 或 OpenAI 兼容接口）

### 1. 安装

```bash
npm install -g progmune-runtime
```

### 2. 配置 LLM API 密钥

```bash
export LLM_API_KEY="你的DeepSeek或OpenAI密钥"
```

### 3. 在 MCP 客户端中配置

**Claude Code**: 编辑 `~/.claude/settings.json` 并添加：

```json
{
  "mcpServers": {
    "progmune": {
      "command": "npx",
      "args": ["progmune-runtime"]
    }
  }
}
```

**Manus / 其他客户端**: Command: `npx`, Args: `progmune-runtime`。

配置完成后，在对话中直接描述编程需求，AI 代理会自动调用 Progmune 生成安全代码。

---

## 全球免疫网络 (Global Immune Network)

Progmune 支持将本地脱敏后的错误指纹安全上报至中央免疫服务器，实现“群体免疫”。

**设置中央服务器地址**:

```bash
export PROGMUNE_HUB="https://progmune-runtime.fly.dev/report"
```

**预览待上报的脱敏数据**:

```bash
npx ts-node src/report.ts preview
```

**执行安全上报**:

```bash
npx ts-node src/report.ts report
```

**隐私保护**: 只上传函数名序列、SVL级别、状态迁移，绝不包含任何代码片段、变量值或用户数据。

---

## 如何贡献

Progmune 的核心护城河在于不断积累的语义失败语料库。欢迎通过 GitHub Issues 提交您在使用过程中遇到的“看似合法但实际危险”的生成案例（请务必脱敏），帮助我们完善语义状态图（SSG）协议。

## 许可证

MIT License。

Progmune 正在重新定义 AI 辅助编程——不是“让模型更聪明”，而是“让程序真相主导生成”。加入我们的技术预览，一起构建可验证的 AI 编码未来。

---

# Progmune Runtime

**Program Immunology: Constraint-Guided Program Synthesis Runtime**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Stage: Technical Preview](https://img.shields.io/badge/Stage-Technical_Preview-orange)]()

Progmune is not an AI programming assistant, but an immune system for generative programs. It demotes Large Language Models (LLMs) from open-world code generators to heuristic searchers strictly constrained by the Program Truth Layer (IR), ensuring that generated code is not only symbolically and type-correct but also behaviorally legal.

---

## Core Proposition: AI-Generated Programs Must Have an Immune System

LLMs often 
hallucinate when generating code—calling non-existent functions, violating type constraints, or skipping critical business steps. Traditional prompt engineering and post-hoc validation cannot eradicate these issues because they place the LLM at the center of the system, lacking first-principle constraints.

Progmune proposes the **Program Immunology** paradigm, establishing an identifiable, memorable, and evolvable defense system for generative programs. We demonstrate that by establishing the program's true structure (IR) as the sole source of truth, AI-generated code can achieve:

1.  **Innate Immunity**: Rapidly identify and reject code that violates symbolic existence, type compatibility, and dataflow rules.
2.  **Adaptive Immunity**: Learn from past failure cases to generate specific defense rules, actively preventing similar future errors.
3.  **Immune Memory**: Consolidate successful and failed patterns into structured knowledge, allowing the system to continuously evolve and become more reliable with use.

**For a detailed theoretical framework, please refer to the [Program Immunology Whitepaper](./WHITEPAPER.md).**

---

## Architecture Overview: A Runtime That Learns, Remembers, and Defends

Inspired by biological immune systems, Progmune's architecture consists of six core layers:

| Biological Immune System | Program Immunology (Progmune) | Core Responsibility |
|:-------------------------|:------------------------------|:--------------------|
| **Innate Immunity**      | **Constraint Engine** (IR + SVL-1~SVL-3) | Rapidly and automatically rejects calls to non-existent functions, type errors, and dataflow issues. |
| **Adaptive Immunity**    | **Semantic State Graph (SSG)** | Precisely intercepts illegal business logic transitions (e.g., "issue token before authentication") via programmable state machines. |
| **Immune Memory**        | **Three-Layer Memory Architecture** | Working, episodic, and semantic memory collaborate to make the system smarter with use; similar intentions can reuse validated paths directly, bypassing the LLM. |
| **Antigen Presentation** | **Failure Corpus**            | A structured database of failure cases; each interception is transformed into an analyzable "error fingerprint," providing data for system evolution. |

---

## Semantic Validity Levels (SVL)

Progmune defines a layered standard for the correctness of AI-generated code:

| Level | Name                 | Guarantee                                      |
|:------|:---------------------|:-----------------------------------------------|
| SVL-1 | Symbolic Existence   | Never calls functions that do not exist in the project |
| SVL-2 | Type Validity        | Parameter count and types strictly match       |
| SVL-3 | Dataflow Correctness | Variables are declared before use, no circular references |
| SVL-4 | Protocol Legality    | Business step order must adhere to state transition rules |

---

## Quick Start

### Prerequisites

*   [Node.js](https://nodejs.org/) >= 18
*   A valid LLM API key (DeepSeek or OpenAI compatible interface)

### 1. Installation

```bash
npm install -g progmune-runtime
```

### 2. Configure LLM API Key

```bash
export LLM_API_KEY="YOUR_DEEPSEEK_OR_OPENAI_KEY"
```

### 3. Configure in MCP Client

**Claude Code**: Edit `~/.claude/settings.json` and add:

```json
{
  "mcpServers": {
    "progmune": {
      "command": "npx",
      "args": ["progmune-runtime"]
    }
  }
}
```

**Manus / Other Clients**: Command: `npx`, Args: `progmune-runtime`.

After configuration, describe your programming needs directly in the conversation, and the AI agent will automatically invoke Progmune to generate secure code.

---

## Global Immune Network

Progmune supports securely reporting anonymized error fingerprints to a central immune server to achieve "herd immunity."

**Set Central Server Address**:

```bash
export PROGMUNE_HUB="https://progmune-runtime.fly.dev/report"
```

**Preview Anonymized Data to be Reported**:

```bash
npx ts-node src/report.ts preview
```

**Execute Secure Report**:

```bash
npx ts-node src/report.ts report
```

**Privacy Protection**: Only function name sequences, SVL levels, and state transitions are uploaded; no code snippets, variable values, or user data are ever included.

---

## How to Contribute

The core moat of Progmune lies in its continuously accumulating semantic failure corpus. We welcome you to submit "seemingly legal but actually dangerous" generative cases you encounter (please ensure data is anonymized) via GitHub Issues to help us improve the Semantic State Graph (SSG) protocol.

## License

MIT License.

Progmune is redefining AI-assisted programming—not by "making models smarter," but by "letting program truth govern generation." Join our technical preview and build a future of verifiable AI coding together.

## Action 对象字段说明

当使用 Progmune 的 Action API 时，请遵循以下字段规范：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | `"call" \| "if" \| "assign" \| "return"` | 是 | 动作类型 |
| `function` | `string` | 当 `kind` 为 `"call"` 时 | 被调用的函数名。**注意不是 `fn` 或 `name`** |
| `args` | `Arg[]` | 当 `kind` 为 `"call"` 时 | 参数列表，每个元素为 `{ name: string, type: string, value: any }` |
| `assignTo` | `string` | 否 | 将返回值绑定到的变量名 |
| `condition` | `string` | 当 `kind` 为 `"if"` 时 | 条件变量名，必须是已声明的变量 |

**常见错误**：使用 `action.fn` 代替 `action.function` 会导致校验器报告“函数 'undefined' 不存在”。
