# Progmune Runtime（免序）

![Progmune Runtime Preview](./social-preview.png)

**程序免疫学：为 AI 生成代码构建可信赖的免疫系统**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Stage: Technical Preview](https://img.shields.io/badge/Stage-Technical_Preview-orange)]()

---

## 💡 核心价值：为什么你需要 Progmune？

在当前的 AI 编程范式中，大语言模型（LLM）常常像一个自信但容易犯错的实习生：它们会凭空捏造不存在的函数（幻觉）、传错参数类型，甚至在用户登录前就签发了认证令牌（协议违规）。

**Progmune Runtime 彻底改变了这一现状。**

它不是另一个试图让 LLM 变得“更聪明”的提示词框架，而是一个**底层的安全运行时（Runtime）**。它将 LLM 降级为一个“提议者”，而将代码的最终决定权交还给**程序真相（IR）**。

**对开发者的直接价值：**
*   **🚫 终结代码幻觉**：生成的代码 100% 保证只调用项目中真实存在的函数。
*   **🛡️ 协议级安全**：自动拦截非法的业务逻辑跳转（例如：未支付成功就发货）。
*   **🧠 越用越聪明**：系统会从失败的生成中学习，自动形成“抗体”，下次遇到类似问题直接修复，无需消耗 LLM token。

---

## 🏗️ 核心架构：程序免疫系统

Progmune 的设计灵感来源于生物免疫系统，构建了多层防御机制：

1.  **天然免疫 (Innate Immunity)**：**约束引擎**。基于项目的中间表示（IR），在毫秒级拦截符号不存在、类型不匹配、变量未初始化的“低级错误”。
2.  **获得性免疫 (Adaptive Immunity)**：**语义状态图 (SSG)**。通过可编程的状态机，精确拦截违反业务协议的非法调用顺序。
3.  **免疫记忆 (Immune Memory)**：**失败语料库 (Failure Corpus)**。记录每一次被拦截的错误，系统从中挖掘模式，生成高置信度的“抗体规则”，实现主动防御。

---

## 📊 语义有效性级别 (SVL)

我们定义了 AI 生成代码的“健康标准”：

| 级别 | 名称 | Progmune 的保证 |
|:-----|:-----|:-----|
| **SVL-1** | 符号存在性 | 绝不调用项目中不存在的函数或变量 |
| **SVL-2** | 类型有效性 | 参数数量和类型严格匹配真实签名 |
| **SVL-3** | 数据流正确性 | 变量先声明后使用，无循环引用 |
| **SVL-4** | 协议合法性 | 严格遵守业务状态机（如：`INIT` -> `AUTH` -> `TOKEN`） |

---

## 🚀 快速上手指南

### 前置条件
*   [Node.js](https://nodejs.org/) >= 18
*   一个有效的 LLM API 密钥（支持 OpenAI 兼容接口，推荐使用具备强推理能力的模型）

### 1. 全局安装

```bash
npm install -g progmune-runtime
```

### 2. 初始化配置

在你的项目根目录下运行 setup，配置你的 API 密钥：

```bash
npx progmune-runtime setup "YOUR_API_KEY"
```
*(提示：你也可以通过设置环境变量 `OPENAI_API_KEY` 来配置)*

### 3. 提取程序真相 (IR)

让 Progmune 扫描你的项目，建立“自我认知”：

```bash
npx progmune-runtime ir .
```
这会在项目目录下生成一个 `.progmune/ir.json` 文件，它是后续所有验证的基础。

### 4. 启动 MCP 服务器 (可选)

如果你使用 Cursor、Claude Desktop 等支持 MCP (Model Context Protocol) 的客户端，可以直接启动 Progmune 作为 MCP 服务器，让你的 AI 助手获得免疫能力：

```bash
npx progmune-runtime start
```

### 5. 运行内置测试

验证系统是否正常工作：

```bash
npx progmune-runtime test
```

---

## 📖 深入阅读

想要了解更多关于“程序免疫学”的理论基础、SSG 状态机的配置方法以及 v2.1.4 的最新特性（如 BFS 协议修复、信用循环），请参阅我们的：

👉 **[《Program Immunology 技术白皮书》](./WHITEPAPER.md)**

---

## 🤝 参与贡献

Progmune 正在重新定义 AI 辅助编程——**让程序真相主导生成**。我们欢迎提交 Issue、Pull Request，或者在 Discussions 中分享你的想法！

## 📄 许可证

本项目采用 MIT License。

---

# Progmune Runtime (English Version)

![Progmune Runtime Preview](./social-preview.png)

**Program Immunology: Building a Trustworthy Immune System for AI-Generated Code**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Stage: Technical Preview](https://img.shields.io/badge/Stage-Technical_Preview-orange)]()

---

## 💡 Core Value: Why You Need Progmune?

In the current AI programming paradigm, Large Language Models (LLMs) often act like confident but error-prone interns: they hallucinate non-existent functions, pass incorrect parameter types, and even issue authentication tokens before a user has logged in (protocol violations).

**Progmune Runtime fundamentally changes this status quo.**

It's not another framework trying to make LLMs "smarter," but a **foundational security runtime**. It demotes LLMs to "proposers," returning the ultimate decision-making power over code to **Program Truth (IR)**.

**Direct Value for Developers:**
*   **🚫 End Code Hallucinations**: 100% guarantee that generated code only calls functions that genuinely exist in your project.
*   **🛡️ Protocol-Level Security**: Automatically intercepts illegal business logic transitions (e.g., shipping before successful payment).
*   **🧠 Smarter with Use**: The system learns from failed generations, automatically forming "antibodies" to fix similar issues directly next time, without consuming LLM tokens.

---

## 🏗️ Core Architecture: The Program Immune System

Progmune's design is inspired by the biological immune system, building multi-layered defense mechanisms:

1.  **Innate Immunity**: **Constraint Engine**. Based on the project's Intermediate Representation (IR), it intercepts "low-level errors" like non-existent symbols, type mismatches, and uninitialized variables in milliseconds.
2.  **Adaptive Immunity**: **Semantic State Graph (SSG)**. Through programmable state machines, it precisely intercepts illegal call sequences that violate business protocols.
3.  **Immune Memory**: **Failure Corpus**. Records every intercepted error, from which the system mines patterns to generate high-confidence "antibody rules," enabling proactive defense.

---

## 📊 Semantic Validity Levels (SVL)

We define the "health standards" for AI-generated code:

| Level | Name | Progmune's Guarantee |
|:-----|:-----|:-----|
| **SVL-1** | Symbolic Existence | Never calls functions or variables that do not exist in the project |
| **SVL-2** | Type Validity | Parameter count and types strictly match the actual signature |
| **SVL-3** | Dataflow Correctness | Variables are declared before use, no circular references |
| **SVL-4** | Protocol Legality | Strictly adheres to business state machines (e.g., `INIT` -> `AUTH` -> `TOKEN`) |

---

## 🚀 Quick Start Guide

### Prerequisites
*   [Node.js](https://nodejs.org/) >= 18
*   A valid LLM API Key (supports OpenAI-compatible interfaces, models with strong reasoning capabilities are recommended)

### 1. Global Installation

```bash
npm install -g progmune-runtime
```

### 2. Initialize Configuration

Run setup in your project root to configure your API key:

```bash
npx progmune-runtime setup "YOUR_API_KEY"
```
*(Hint: You can also configure by setting the environment variable `OPENAI_API_KEY`)*

### 3. Extract Program Truth (IR)

Let Progmune scan your project to establish "self-awareness":

```bash
npx progmune-runtime ir .
```
This will generate a `.progmune/ir.json` file in your project directory, which serves as the basis for all subsequent validations.

### 4. Start MCP Server (Optional)

If you use clients like Cursor, Claude Desktop that support MCP (Model Context Protocol), you can directly start Progmune as an MCP server to give your AI assistant immune capabilities:

```bash
npx progmune-runtime start
```

### 5. Run Built-in Tests

Verify that the system is working correctly:

```bash
npx progmune-runtime test
```

---

## 📖 Further Reading

To learn more about the theoretical foundations of "Program Immunology," how to configure SSG state machines, and the latest features of v2.1.4 (such as BFS Protocol Repair, Credit Loops), please refer to our:

👉 **[《Program Immunology Technical Whitepaper》](./WHITEPAPER.md)**

---

## 🤝 Contribute

Progmune is redefining AI-assisted programming—**letting program truth govern generation**. We welcome issues, pull requests, or sharing your thoughts in discussions!

## 📄 License

This project is licensed under the MIT License.
