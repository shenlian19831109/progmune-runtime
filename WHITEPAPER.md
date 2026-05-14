# Progmune Runtime（免序）

## 面向生成式代码的程序免疫学

### Program Immunology for Generative Code

### 技术白皮书 v1.0

开源地址：https://github.com/shenlian19831109/progmune-runtime
npm install progmune-runtime

## 中文版

### 摘要

Progmune Runtime 提出了一种新的范式：程序免疫学——确保 AI 生成代码安全可靠的系统性方法。

受生物免疫系统分层防御机制的启发，Progmune 构建了一个约束导向的程序合成运行时，在多个层级上强制执行语义有效性：从符号存在性和类型兼容性，到数据流正确性和协议合法性。系统将大语言模型从不受约束的代码生成器，降级为在程序实际结构（中间表示）所定义的封闭世界中运行的受限启发式提议器。

我们引入语义有效性级别（SVL）作为 AI 生成代码正确性的形式化分类法，并展示了一个能够拦截非法状态迁移的语义状态图（SSG）的工作原型。Progmune 代表了迈向神经符号编译器基础设施的一步——在这里，代码生成不是由统计概率支配，而是由可验证的真相支配。

### 1. 问题声明

#### 1.1 AI 代码生成中的开放世界谬误

大语言模型（LLM）在生成代码时，隐含地基于一个开放世界假设运行：训练数据中见过的任何函数、库或 API 模式都被假定在当前上下文中可用。这一假设导致四类典型错误：

*   **符号幻觉（SVL-1）**：调用目标项目中不存在的函数或变量
*   **类型漂移（SVL-2）**：参数数量或类型与实际函数签名不匹配
*   **数据流污染（SVL-3）**：使用未初始化的变量、创建循环引用或引入死代码路径
*   **协议违规（SVL-4）**：违反业务步骤的必要顺序——例如，在认证用户之前就签发 JWT 令牌

这些错误并非源于推理失败，而是源于模型缺乏对程序真相的确定性访问。

#### 1.2 现有缓解策略的局限性

当前应对这些错误的策略均为反应式：

*   **事后校验**（linter、测试套件、人工审查）：在错误生成后检测，但无法从源头预防
*   **检索增强生成**（RAG）：将项目上下文注入 prompt，降低但不消除幻觉。模型仍然是正确性的唯一仲裁者
*   **迭代提示工程**：通过精心设计的指令引导模型行为，但无法提供合规性的形式化保证

这三种策略都将 LLM 置于系统的中心，试图从外部修正其输出。它们缺乏第一性原理的约束机制。

#### 1.3 核心命题：AI 生成程序必须具备免疫系统

我们提出一个范式转变：程序免疫学（Program Immunology）。AI 生成的代码在进入代码库之前，必须先通过一个免疫层——一个可验证、具备记忆能力的运行时，能够识别、记忆并防御反复出现的错误模式。

这一免疫层由三个相互依赖的能力组成：

*   **天然免疫**：基于模式快速拒绝符号、类型和数据流违规——这是系统内置的防御
*   **获得性免疫**：从过去的失败中学习（Failure Corpus），生成特异性的防御规则（如协议约束），主动预防未来同类错误
*   **免疫记忆**：将成功和失败的模式沉淀为持久知识，使系统能够随使用持续进化，越用越可靠

### 2. 生物学基础与类比

#### 2.1 生物免疫系统的三层架构

生物免疫系统通过三个递进的层次来保护机体：

*   **物理屏障**：皮肤、黏膜。非特异性的、预防性的首道防线
*   **天然免疫**：巨噬细胞、树突状细胞。模式识别受体（PRR）快速识别病原体相关分子模式（PAMP）。反应快，但不够精确
*   **获得性免疫**：T 细胞、B 细胞。通过基因重排产生高度特异性的受体，识别特定抗原。首次感染后产生免疫记忆，再次暴露时能产生更快、更强的二次应答

#### 2.2 向程序免疫学的映射

| 生物免疫系统 | 程序免疫 (Progmune) | 映射说明 |
|---|---|---|
| **物理屏障** | 沙箱、CI/CD 门禁、权限控制 | 阻止未验证代码进入生产环境的基础工程设施 |
| **天然免疫** | 约束引擎（IR + SVL-1 至 SVL-3） | 快速自动识别并拒绝幻觉调用、类型错误等——系统内置防御能力 |
| **抗原呈递** | Failure Corpus 记录 | 错误动作序列被捕获后，其错误类型、状态上下文等"抗原特征"被完整记录 |
| **获得性免疫** | 语义状态图（SSG） | 从失败语料库中学习，生成特异性协议规则（"抗体"），精确阻止非法状态迁移 |
| **免疫记忆** | 三层记忆架构 | 情景记忆与语义记忆共同构成系统免疫记忆，在相似场景下无需 LLM 即可快速响应 |

#### 2.3 类比的价值与边界

这个类比的价值在于提供了一个清晰的、可扩展的思维框架：解释为什么静态验证器不够用，以及为什么系统需要学习、记忆和进化。然而，也必须明确其边界：程序免疫系统处理的是形式化的、确定性的程序状态，而非复杂的生物化学信号。其学习是基于规则挖掘和模式匹配，而非生物神经元的突触可塑性。

### 3. 技术架构

Progmune Runtime 的架构由六个核心层组成，每一层对应特定的验证或学习职责。

#### 3.1 IR（程序真相层）——自我模型

中间表示（IR）是系统的唯一真相来源，从源文件中静态提取，包含：

*   **符号表**（SymbolTable）：所有已定义的函数、类、变量及其位置
*   **类型图**（TypeGraph）：参数类型、返回类型和类型别名
*   **调用图**（CallGraph）：函数间的调用关系
*   **协议注解**（Protocol Annotations，可选）：用于协议感知合成的前置状态、后置状态和失效规则

这是区分自我与非我的基础——系统只允许调用 IR 中明确定义的组件。

#### 3.2 Action Runtime——确定性合成边界

LLM 不再生成原始代码或 JSON 字符串，而是调用一组确定性 API：

```
call(func, ...args)            // 调用函数
callAssign(func, assignTo, ...) // 调用并绑定结果
ifElse(condition, thenFn, elseFn) // 条件分支
assign(target, value)          // 变量赋值
output(value)                  // 返回值
```

这些调用在沙箱化的 JavaScript 上下文中执行，运行时将所有调用捕获为结构化的动作树（Action Tree），从源头消除注入漏洞和格式错误。

#### 3.3 Constraint Engine——天然免疫层

此层基于 IR 对动作树执行快速的、基于规则的验证：

*   **SVL-1**（符号存在性）：每个被调用的函数都存在于项目中
*   **SVL-2**（类型有效性）：参数数量和类型与声明的签名匹配
*   **SVL-3**（数据流正确性）：变量在使用前已声明；无自引用赋值

#### 3.4 Semantic State Graph（SSG）——获得性免疫层

SSG 建模了系统资源的有效状态及其允许的转移。以认证协议为例：

```
UNAUTHENTICATED（未认证）
    ↓  verify_password
AUTHENTICATED（已认证）
    ↓  generate_jwt
TOKEN_ISSUED（令牌已签发）
    ↓  create_session
SESSION_ACTIVE（会话已激活）
```

每个函数声明了 `pre_states`（前置状态）、`post_states`（后置状态）和可选的 `invalidate`（失效状态）规则。SSG 验证器在处理动作树时模拟状态转移，拒绝任何前置状态与当前活跃状态无交集的调用——即使所有其他 SVL 级别均通过。这将验证从静态正确性提升为行为合法性。

#### 3.5 Immune Memory & Failure Corpus——免疫记忆层

**三层记忆架构**

*   **工作记忆**（Working Memory）：当前会话的变量绑定和用户意图（每会话清除）
*   **情景记忆**（Episodic Memory）：最近 N 次成功/失败的动作序列，带时间戳和结果标签（定期剪枝）
*   **语义记忆**（Semantic Memory）：从频繁成功模式中蒸馏出的路径模板和协议规则（离线巩固）

**失败语料库（Failure Corpus）**

每次约束违规都被记录：包含意图、IR 摘要、违反的 SVL 级别、错误详情和 SSG 状态。这构成了一项独特资产：一个结构化、带标签的 AI 程序失败数据库。随时间积累，高频失败模式可被挖掘，自动生成候选的协议约束或 SSG 转换规则。

#### 3.6 Code Emitter——程序落地层

将验证通过的动作树确定性地翻译为可执行的 Python 或 TypeScript 代码，处理导入解析、变量作用域、对象字面量生成以及嵌套控制结构的正确缩进。

### 4. 语义有效性级别（SVL）

SVL 是 AI 生成代码正确性的形式化分类法，为系统提供分层、可量化的验证保证：

| 级别 | 名称 | 描述 | 保证内容 |
|---|---|---|---|
| SVL-1 | 符号存在性 | 每个被调用的函数、变量和导入在项目中均实际存在 | 无幻觉 API 调用 |
| SVL-2 | 类型有效性 | 参数数量和类型与声明的签名相匹配 | 无类型不匹配错误 |
| SVL-3 | 数据流正确性 | 变量在使用前已声明；无循环引用或未初始化访问 | 无 NameError / UnboundLocalError |
| SVL-4 | 协议合法性 | 函数调用序列符合声明的前/后状态转换规则 | 无非法状态跳转（如认证前签发令牌） |
| SVL-5（未来） | 语义意图正确性 | 生成代码忠实实现预期业务逻辑 | 远期目标；当前版本未声明保证 |

Progmune Runtime v1.0 完整保证 SVL-1 至 SVL-3，SVL-4 作为可选协议约束系统实现。SVL-5 为开放性研究方向。

### 5. 实验评估

#### 5.1 压力测试

在包含 3 至 338 个函数的合成 Python 项目上进行了评估。LLM Planner 在所有规模上均实现了 100% 的成功率，平均合成时间约 6 秒，每次意图 1-2 次 LLM 调用。性能相对于项目规模保持线性增长，验证了 IR 截断和约束验证方法的可扩展性。

#### 5.2 语义阻断测试

构建了包含 10 个语义意图案例的测试套件，涵盖登录、注册、缓存查询、批量邮件、角色检查、会话创建、数据导出、账户锁定、令牌刷新和用户注销场景。系统在 7-8 个案例中生成了完全正确、可运行的 Python 代码，其余案例被约束引擎正确拦截，展示了对语义错误 80–100% 的阻断率。

#### 5.3 SSG 协议拦截

构造了一个意图：创建一个带令牌的会话（不指定认证）。LLM 反复尝试在 `verify_password` 之前调用 `generate_jwt`。SSG 验证器拦截了全部三次尝试并给出诊断：

```
[PROGMUNE] L4 PROTOCOL VIOLATION

Function: generate_jwt

Reason: requires AUTHENTICATED state

Current state: UNAUTHENTICATED
Expected transition: verify_password → AUTHENTICATED
```

在三次失败尝试后，系统正确地拒绝发射任何代码。

### 6. 非目标（Non-Goals）

Progmune Runtime 明确不保证：

*   业务逻辑正确性（例如，定价计算是否准确）
*   算法最优性或复杂度
*   对所有安全漏洞的免疫（例如注入攻击、权限绕过）
*   生成代码单元之外的整个应用程序功能正确性

系统仅保证由 SVL-1 至 SVL-4 定义的程序有效性。Progmune 是程序有效性运行时，而非业务正确性证明器。

### 7. 未来方向

*   **全球免疫网络**：跨安装实例的脱敏 Failure Corpus 联邦汇聚，实现群体免疫级防御
*   **语义失败基准库**（Semantic Failure Benchmark）：世界上首个 AI 生成代码可靠性的公开基准，由汇聚的、匿名的失败模式构建
*   **企业语义防火墙**：集成到 CI/CD 管道中，作为 AI 生成拉取请求的合并前门禁
*   **确定性验证器**（Rust/WASM）：在 IDE、CI 和生产环境之间实现位级一致的验证，确保同一段 Action Tree 在任何环境中得到完全一致的合法性判断

### 8. 结论

Progmune Runtime 证明了：通过颠倒 LLM 与程序真相之间的关系——将 IR 确立为第一性原理，并使 LLM 成为受约束的启发式提议器——我们可以实现具有强语义保证的可验证代码合成。

分层的 SVL 分类法、SSG 协议引擎、持续积累的 Failure Corpus 以及三层记忆架构，共同形成了一种全新的编程基础设施：一个会学习、会记忆、会防御的神经符号编译器运行时。

我们将此称为程序免疫学（Program Immunology）。

该系统以开源形式提供：https://github.com/shenlian19831109/progmune-runtime，也可通过 `npm install progmune-runtime` 安装使用。

## ENGLISH VERSION

### Abstract

Progmune Runtime introduces Program Immunology—a new paradigm for ensuring the safety and reliability of AI-generated code.

Inspired by the layered defense mechanisms of the biological immune system, Progmune establishes a constraint-guided program synthesis runtime that enforces semantic validity at multiple levels: from symbol existence and type compatibility to dataflow correctness and protocol legality. The system demotes large language models from unverified code generators to constrained heuristic proposers, operating within a closed world defined by the program's actual structure (Intermediate Representation).

We introduce Semantic Validity Levels (SVL) as a formal taxonomy of AI-generated code correctness, and demonstrate a working Semantic State Graph (SSG) that intercepts illegal state transitions. Progmune represents a step toward neural-symbolic compiler infrastructure where code generation is governed not by statistical likelihood, but by verifiable truth.

### 1. Problem Statement

#### 1.1 The Open-World Fallacy in AI Code Generation

Large language models (LLMs) operate under an implicit open-world assumption when generating code: any function, library, or API pattern encountered during training is presumed available in the current context. This assumption yields four distinct classes of errors:

*   **Symbol Hallucination (SVL-1)**：Invoking functions or variables that do not exist in the target project
*   **Type Drift (SVL-2)**：Mismatched parameter counts or incompatible types with the actual function signature
*   **Dataflow Contamination (SVL-3)**：Using uninitialized variables, creating circular references, or introducing dead code paths
*   **Protocol Violation (SVL-4)**：Violating the required ordering of business steps—for example, issuing a JWT token before authenticating the user

These errors do not arise from reasoning failures. They arise because the model lacks deterministic access to the ground truth of the program.

#### 1.2 Limitations of Current Mitigations

Existing strategies address these errors reactively:

*   **Post-hoc validation**：Linters, test suites, manual review—detects errors after generation but cannot prevent them at the source
*   **Retrieval-Augmented Generation (RAG)**：Injects project context into prompts, reducing but not eliminating hallucination; the model remains the sole arbiter of correctness
*   **Iterative prompt engineering**：Guides model behavior through carefully designed instructions, yet offers no formal guarantee of compliance

All three strategies place the LLM at the center of the system and attempt to correct its output from the outside. They lack a first-principles constraint mechanism.

#### 1.3 Core Proposition: AI-Generated Programs Require an Immune System

We propose a paradigm shift: Program Immunology. AI-generated code must not be allowed to enter a codebase without passing through an immune layer—a verifiable, memory-equipped runtime that recognizes, remembers, and defends against recurrent error patterns.

This immune layer comprises three interdependent capabilities:

*   **Innate Immunity**：Rapid, pattern-based rejection of symbol, type, and dataflow violations—the system's built-in defenses
*   **Adaptive Immunity**：Learning from past failures (the Failure Corpus) to generate specific, targeted defenses such as protocol constraints, proactively preventing future errors
*   **Immune Memory**：Structuring both successful and failed generation patterns into persistent knowledge, enabling continuous improvement with use

### 2. Biological Foundations and Analogy

#### 2.1 The Three-Layer Architecture of the Biological Immune System

*   **Physical Barriers**：Skin, mucous membranes. Non-specific, preemptive first line of defense
*   **Natural Immunity**：Macrophages, dendritic cells. Pattern recognition receptors (PRRs) rapidly identify pathogen-associated molecular patterns (PAMPs). Rapid response, but not precise enough
*   **Acquired Immunity**：T cells, B cells. Generate highly specific receptors through gene rearrangement to recognize specific antigens. After the first infection, immune memory is generated, and a faster and stronger secondary response can be produced upon re-exposure

#### 2.2 Mapping to Program Immunology

| Biological Immune System | Program Immunity (Progmune) | Mapping Description |
|---|---|---|
| **Physical Barriers** | Sandboxes, CI/CD Gates, Access Control | Foundational engineering infrastructure to prevent unverified code from entering production |
| **Innate Immunity** | Constraint Engine (IR + SVL-1 to SVL-3) | Rapidly and automatically identifies and rejects hallucinated calls, type errors, etc. - the system's built-in defense capability |
| **Antigen Presentation** | Failure Corpus Recording | After an error action sequence is captured, its error type, state context, and other "antigenic features" are fully recorded |
| **Adaptive Immunity** | Semantic State Graph (SSG) | Learns from the failure corpus to generate specific protocol rules ("antibodies") to precisely prevent illegal state transitions |
| **Immune Memory** | Three-Layer Memory Architecture | Episodic memory and semantic memory together form the system's immune memory, allowing for rapid response without LLM in similar scenarios |

#### 2.3 Value and Boundaries of the Analogy

The value of this analogy lies in providing a clear, extensible mental framework: explaining why static verifiers are insufficient, and why the system needs to learn, remember, and evolve. However, its boundaries must also be clear: the program immune system deals with formalized, deterministic program states, not complex biochemical signals. Its learning is based on rule mining and pattern matching, not synaptic plasticity of biological neurons.

### 3. Technical Architecture

The architecture of Progmune Runtime consists of six core layers, each corresponding to specific verification or learning responsibilities.

#### 3.1 IR (Program Truth Layer) - Self-Model

The Intermediate Representation (IR) is the system's sole source of truth, statically extracted from source files, including:

*   **SymbolTable**: All defined functions, classes, variables, and their locations
*   **TypeGraph**: Parameter types, return types, and type aliases
*   **CallGraph**: Call relationships between functions
*   **Protocol Annotations** (optional): Pre-states, post-states, and invalidation rules for protocol-aware synthesis

This is the basis for distinguishing self from non-self - the system only allows calling components explicitly defined in the IR.

#### 3.2 Action Runtime - Deterministic Synthesis Boundary

LLMs no longer generate raw code or JSON strings, but instead call a set of deterministic APIs:

```
call(func, ...args)            // Call function
callAssign(func, assignTo, ...) // Call and bind result
ifElse(condition, thenFn, elseFn) // Conditional branch
assign(target, value)          // Variable assignment
output(value)                  // Return value
```

These calls are executed in a sandboxed JavaScript context, and the runtime captures all calls as a structured Action Tree, eliminating injection vulnerabilities and formatting errors at the source.

#### 3.3 Constraint Engine - Innate Immune Layer

This layer performs rapid, rule-based validation of the Action Tree based on the IR:

*   **SVL-1** (Symbol Existence): Every called function exists in the project
*   **SVL-2** (Type Validity): Parameter count and types match the declared signature
*   **SVL-3** (Dataflow Correctness): Variables are declared before use; no self-referential assignments

#### 3.4 Semantic State Graph (SSG) - Adaptive Immune Layer

SSG models the valid states of system resources and their allowed transitions. Taking the authentication protocol as an example:

```
UNAUTHENTICATED
    ↓  verify_password
AUTHENTICATED
    ↓  generate_jwt
TOKEN_ISSUED
    ↓  create_session
SESSION_ACTIVE
```

Each function declares `pre_states`, `post_states`, and optional `invalidate` rules. The SSG validator simulates state transitions when processing the Action Tree, rejecting any calls where the pre-state has no intersection with the current active state - even if all other SVL levels pass. This elevates verification from static correctness to behavioral legality.

#### 3.5 Immune Memory & Failure Corpus - Immune Memory Layer

**Three-Layer Memory Architecture**

*   **Working Memory**: Variable bindings and user intent for the current session (cleared per session)
*   **Episodic Memory**: Recent N successful/failed action sequences, with timestamps and result labels (pruned periodically)
*   **Semantic Memory**: Path templates and protocol rules distilled from frequently successful patterns (consolidated offline)

**Failure Corpus**

Each constraint violation is recorded: including intent, IR summary, violated SVL level, error details, and SSG state. This constitutes a unique asset: a structured, labeled database of AI program failures. Over time, high-frequency failure patterns can be mined to automatically generate candidate protocol constraints or SSG transition rules.

#### 3.6 Code Emitter - Program Landing Layer

Deterministically translates the validated Action Tree into executable Python or TypeScript code, handling import resolution, variable scoping, object literal generation, and correct indentation for nested control structures.

### 4. Semantic Validity Levels (SVL)

SVL is a formal taxonomy for the correctness of AI-generated code, providing layered, quantifiable verification guarantees for the system:

| Level | Name | Description | Guarantee Content |
|---|---|---|---|
| SVL-1 | Symbol Existence | Every called function, variable, and import actually exists in the project | No hallucinated API calls |
| SVL-2 | Type Validity | Parameter count and types strictly match the declared signature | No type mismatch errors |
| SVL-3 | Dataflow Correctness | Variables are declared before use; no circular references or uninitialized access | No NameError / UnboundLocalError |
| SVL-4 | Protocol Legality | Function call sequence conforms to declared pre/post-state transition rules | No illegal state jumps (e.g., issuing token before authentication) |
| SVL-5 (Future) | Semantic Intent Correctness | Generated code faithfully implements the intended business logic | Long-term goal; not guaranteed in current version |

Progmune Runtime v1.0 fully guarantees SVL-1 to SVL-3, with SVL-4 implemented as an optional protocol constraint system. SVL-5 is an open research direction.

### 5. Experimental Evaluation

#### 5.1 Stress Test

Evaluated on synthetic Python projects containing 3 to 338 functions. The LLM Planner achieved 100% success rate across all scales, with an average synthesis time of approximately 6 seconds and 1-2 LLM calls per intent. Performance scaled linearly with project size, validating the scalability of the IR truncation and constraint verification methods.

#### 5.2 Semantic Blocking Test

Built a test suite of 10 semantic intent cases, covering login, registration, cache query, bulk email, role check, session creation, data export, account locking, token refresh, and user logout scenarios. The system generated fully correct, runnable Python code in 7-8 cases, and the remaining cases were correctly intercepted by the constraint engine, demonstrating an 80–100% blocking rate for semantic errors.

#### 5.3 SSG Protocol Interception

Constructed an intent: create a session with a token (without specifying authentication). The LLM repeatedly attempted to call `generate_jwt` before `verify_password`. The SSG validator intercepted all three attempts and provided a diagnosis:

```
[PROGMUNE] L4 PROTOCOL VIOLATION

Function: generate_jwt

Reason: requires AUTHENTICATED state

Current state: UNAUTHENTICATED
Expected transition: verify_password → AUTHENTICATED
```

After three failed attempts, the system correctly refused to emit any code.

### 6. Non-Goals

Progmune Runtime explicitly does not guarantee:

*   Business logic correctness (e.g., whether pricing calculations are accurate)
*   Algorithmic optimality or complexity
*   Immunity to all security vulnerabilities (e.g., injection attacks, privilege escalation)
*   Correctness of the entire application functionality beyond the generated code unit

The system only guarantees program validity as defined by SVL-1 to SVL-4. Progmune is a program validity runtime, not a business correctness prover.

### 7. Future Directions

*   **Global Immune Network**: Federated aggregation of anonymized Failure Corpus across installed instances to achieve collective immunity-level defense
*   **Semantic Failure Benchmark**: The world's first public benchmark for AI-generated code reliability, built from aggregated, anonymized failure patterns
*   **Enterprise Semantic Firewall**: Integrated into CI/CD pipelines as a pre-merge gate for AI-generated pull requests
*   **Deterministic Verifier** (Rust/WASM): Achieves bit-level consistent verification between IDE, CI, and production environments, ensuring that the same Action Tree receives completely consistent legality judgments in any environment

### 8. Conclusion

Progmune Runtime demonstrates that by inverting the relationship between LLMs and program truth—establishing IR as the first principle and making LLMs constrained heuristic proposers—we can achieve verifiable code synthesis with strong semantic guarantees.

The layered SVL taxonomy, SSG protocol engine, continuously accumulating Failure Corpus, and three-layer memory architecture collectively form a new programming infrastructure: a neural-symbolic compiler runtime that learns, remembers, and defends.

We call this Program Immunology.

The system is available as open source: https://github.com/shenlian19831109/progmune-runtime, and can also be installed using `npm install progmune-runtime`.
