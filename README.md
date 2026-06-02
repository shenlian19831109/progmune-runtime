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
- [v2.1.0 新特性：抗体与快照](#v210-新特性抗体与快照)
- [Semantic Observatory](#semantic-observatory语义观测台)
- [快速开始](#快速开始)
- [CLI 命令](#cli-命令)
- [MCP 工具](#mcp-工具)
- [全球免疫网络](#全球免疫网络-global-immune-network)
- [许可证](#许可证)

---

## 核心命题：AI 生成的程序必须具备免疫系统

LLM 在生成代码时会产生“幻觉”——调用不存在的函数、违反类型约束、跳过关键的业务步骤。传统的提示工程和事后校验无法根除这些问题，因为它们将 LLM 置于系统的中心，缺乏第一性原理的约束。

Progmune 提出**程序免疫学（Program Immunology）**范式，为生成式程序建立一套可识别、可记忆、可进化的防御体系：

1.  **天然免疫**：快速识别并拒绝违反符号存在性、类型兼容性和数据流规则的代码。
2.  **获得性免疫**：从过去的失败案例中学习，生成特异性的防御规则，主动预防未来同类错误。
3.  **免疫记忆**：将成功和失败的模式沉淀为结构化的知识，使系统随着使用持续进化，越用越可靠。

**详细理论框架请参阅《[Program Immunology 白皮书](./WHITEPAPER.md)》。**

---

## 架构概览：一个会学习、会记忆、会防御的运行时

Progmune 的架构受生物免疫系统启发，分为核心防御层：

| 生物免疫系统 | 程序免疫 (Progmune) | 核心职责 |
|:-------------|:--------------------|:---------|
| **天然免疫** | **约束引擎** (IR + SVL-1~SVL-3) | 快速、自动地拒绝调用不存在的函数、类型错误和数据流问题。 |
| **获得性免疫** | **语义状态图 (SSG)** | 通过可编程的状态机，精确拦截非法业务逻辑跃迁（如“未认证即签发令牌”）。 |
| **免疫记忆** | **三层记忆 + Failure Corpus** | 工作记忆、情景记忆和语义记忆协同；失败基因组记录每次语义异常、修复路径和适应轨迹。 |
| **抗体生成** | **Antibody Registry** | **v2.1.0 新增**：从失败中自动挖掘修复模式，生成 ACL-1~4 置信度分级的免疫规则。 |
| **免疫观测** | **Semantic Observatory** | 终端原生语义观测工具——时间线、认知回放、状态机追踪、基因组热力图。 |

---

## v2.1.0 新特性：抗体与快照

在 v2.1.0 版本中，Progmune 实现了从“被动拦截”到“主动防御”的跨越：

*   **抗体注册表 (Antibody Registry)**：系统自动从 `Failure Corpus` 中提取修复模式。高置信度（ACL-4）的抗体可触发“免疫快跑”，绕过 LLM 直接应用验证过的修复路径。
*   **语义快照引擎 (Snapshot Engine)**：在规划时自动捕获 IR 状态。支持通过 `diff` 命令对比不同时间点的 IR 差异，解决因环境漂移导致的生成失败。
*   **BFS 协议修复**：SSG 验证器现在使用广度优先搜索寻找多步修复路径，能够自动补全复杂的协议缺失（如 `INIT` -> `EMAIL_OK` -> `PWD_HASHED`）。

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

### 2. 配置

```bash
npx progmune-runtime setup "你的API密钥"
```

### 3. 验证

```bash
npx progmune-runtime test
```

---

## 许可证

MIT License。

Progmune 正在重新定义 AI 辅助编程——不是“让模型更聪明”，而是“让程序真相主导生成”。

---

# Progmune Runtime

**Program Immunology: Constraint-Guided Program Synthesis Runtime**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Stage: Technical Preview](https://img.shields.io/badge/Stage-Technical_Preview-orange)]()

Progmune is not an AI programming assistant, but an immune system for generative programs. It demotes LLMs from open-world code generators to heuristic searchers strictly constrained by the Program Truth Layer (IR).

---

## v2.1.0 New Features: Antibodies & Snapshots

v2.1.0 marks a major leap from "passive interception" to "active defense":

*   **Antibody Registry**: Automatically extracts repair patterns from the `Failure Corpus`. High-confidence (ACL-4) antibodies trigger "Immune Fast-Path," bypassing the LLM to apply validated fixes directly.
*   **Semantic Snapshot Engine**: Captures the exact IR state during planning. Supports `diff` commands to track IR evolution and debug environment drift.
*   **BFS Protocol Repair**: The SSG validator now uses Breadth-First Search to find multi-hop repair paths, automatically filling complex protocol gaps.

---

## Architecture Overview

| Biological Immune System | Program Immunology (Progmune) | Core Responsibility |
|:-------------------------|:------------------------------|:--------------------|
| **Innate Immunity**      | **Constraint Engine** (IR + SVL-1~3) | Rejects non-existent functions, type errors, and dataflow issues. |
| **Adaptive Immunity**    | **Semantic State Graph (SSG)** | Intercepts illegal business logic transitions (e.g., "issue token before auth"). |
| **Immune Memory**        | **Three-Layer Memory**        | Working, episodic, and semantic memory collaborate to make the system smarter with use. |
| **Antibody Generation**  | **Antibody Registry**         | **New in v2.1.0**: Mines repair patterns and generates ACL-1~4 graded immune rules. |

---

## Semantic Validity Levels (SVL)

| Level | Name                 | Guarantee                                      |
|:------|:---------------------|:-----------------------------------------------|
| SVL-1 | Symbolic Existence   | Never calls functions that do not exist in the project |
| SVL-2 | Type Validity        | Parameter count and types strictly match       |
| SVL-3 | Dataflow Correctness | Variables are declared before use, no circular references |
| SVL-4 | Protocol Legality    | Business step order must adhere to state transition rules |

---

## Quick Start

```bash
npm install -g progmune-runtime
npx progmune-runtime setup "YOUR_API_KEY"
npx progmune-runtime test
```

---

## License

MIT License.

Progmune is redefining AI-assisted programming—not by "making models smarter," but by "letting program truth govern generation."
