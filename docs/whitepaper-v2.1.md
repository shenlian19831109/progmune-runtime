Progmune Runtime

（免序）

面向生成式代码的程序免疫学

*Program Immunology for Generative Code*

技术白皮书 **v2.1**

开源地址：https://github.com/shenlian19831109/progmune-runtime

npm install progmune-runtime

中 文 版

摘要

*Progmune Runtime* 提出了程序免疫学（Program Immunology）——确保 AI 生成代码安全可靠的系统性范式。

受生物免疫系统分层防御机制的启发，Progmune 构建了一个约束导向的程序合成运行时，在多个层级上强制执行语义有效性：从符号存在性和类型兼容性，到数据流正确性和协议合法性。系统将大语言模型从不受约束的代码生成器，降级为在程序实际结构（中间表示）所定义的封闭世界中运行的受限启发式提议器。

v2.1 引入了运行时本体论（Runtime Ontology）——将 Attempt、StateTransition、ConstraintViolation 和 ExecutionSession 提升为第一类可持久化对象，使程序免疫过程从隐式日志变为显式的、可查询、可回放的语义记录。多命名空间语义状态图（SSG）支持 auth、file、db 等独立资源的状态机隔离。抗体推断系统（ACL-1 至 ACL-4）使系统能够从失败语料库中自动提取修复路径，在相似场景下无需 LLM 即可直接生成免疫验证序列。语义观测站（CLI + Web）首次将 AI 程序的"认知过程"——每次尝试、每次违规、每次修复——完整呈现。

1. 问题声明

1.1 AI 代码生成中的开放世界谬误

大语言模型（LLM）在生成代码时，隐含地基于一个开放世界假设运行：训练数据中见过的任何函数、库或 API 模式都被假定在当前上下文中可用。这一假设导致四类典型错误：

符号幻觉（**SVL-1**）：调用目标项目中不存在的函数或变量

类型漂移（**SVL-2**）：参数数量或类型与实际函数签名不匹配

数据流污染（**SVL-3**）：使用未初始化的变量、创建循环引用或引入死代码路径

协议违规（**SVL-4**）：违反业务步骤的必要顺序——例如，在认证用户之前就签发 JWT 令牌

这些错误并非源于推理失败，而是源于模型缺乏对程序真相的确定性访问。

1.2 现有缓解策略的局限性

当前应对这些错误的策略均为反应式：

事后校验（**linter**、测试套件、人工审查）：在错误生成后检测，但无法从源头预防

检索增强生成（**RAG**）：将项目上下文注入 prompt，降低但不消除幻觉。模型仍然是正确性的唯一仲裁者

迭代提示工程：通过精心设计的指令引导模型行为，但无法提供合规性的形式化保证

这三种策略都将 LLM 置于系统的中心，试图从外部修正其输出。它们缺乏第一性原理的约束机制。

1.3 核心命题：AI 生成程序必须具备免疫系统

我们提出一个范式转变：程序免疫学（*Program Immunology*）。AI 生成的代码在进入代码库之前，必须先通过一个免疫层——一个可验证、具备记忆能力的运行时，能够识别、记忆并防御反复出现的错误模式。

这一免疫层由三个相互依赖的能力组成：

天然免疫：基于模式快速拒绝符号、类型和数据流违规——这是系统内置的防御

获得性免疫：从过去的失败中学习（Failure Corpus），生成特异性的防御规则（协议约束与抗体），主动预防未来同类错误

免疫记忆：将成功和失败的模式沉淀为持久知识，使系统能够随使用持续进化，越用越可靠

2. 生物学基础与类比

2.1 生物免疫系统的三层架构

生物免疫系统通过三个递进的层次来保护机体：

物理屏障：皮肤、黏膜。非特异性的、预防性的首道防线

天然免疫：巨噬细胞、树突状细胞。模式识别受体（PRR）快速识别病原体相关分子模式（PAMP）。反应快，但不够精确

获得性免疫：T 细胞、B 细胞。通过基因重排产生高度特异性的受体，识别特定抗原。首次感染后产生免疫记忆，再次暴露时能产生更快、更强的二次应答

2.2 向程序免疫学的映射

  -------------- --------------------------------- ---------------------------------------------------------------------------
  生物免疫系统   程序免疫 **(Progmune)**           映射说明
  物理屏障       沙箱、CI/CD 门禁、权限控制        阻止未验证代码进入生产环境的基础工程设施
  天然免疫       约束引擎（IR + SVL-1 至 SVL-3）   快速自动识别并拒绝幻觉调用、类型错误等——系统内置防御能力
  抗原呈递       Failure Corpus 记录               错误动作序列被捕获后，其错误类型、状态上下文等"抗原特征"被完整记录
  获得性免疫     语义状态图（SSG）+ 抗体推断        从失败语料库中学习，自动推断 ACL 抗体级别，生成特异性协议规则，精确阻止非法状态迁移
  免疫记忆       三层记忆架构                       情景记忆与语义记忆共同构成免疫记忆，ACL-4 抗体可直接跳过 LLM 生成验证序列
  -------------- --------------------------------- ---------------------------------------------------------------------------

2.3 类比的价值与边界

这个类比的价值在于提供了一个清晰的、可扩展的思维框架：解释为什么静态验证器不够用，以及为什么系统需要学习、记忆和进化。然而，也必须明确其边界：程序免疫系统处理的是形式化的、确定性的程序状态，而非复杂的生物化学信号。其学习是基于规则挖掘和模式匹配，而非生物神经元的突触可塑性。

3. 技术架构

Progmune Runtime v2.1 的架构由七个核心层组成，每一层对应特定的验证或学习职责。

3.1 IR（程序真相层）——自我模型

中间表示（IR）是系统的唯一真相来源，从 TypeScript 源文件中静态提取，包含：

符号表（**SymbolTable**）：所有已定义的函数、类、变量及其位置

类型图（**TypeGraph**）：参数类型、返回类型和类型别名

调用图（**CallGraph**）：函数间的调用关系

协议注解（**Protocol Annotations**）：通过 @protocol JSDoc 标签声明的前置状态、后置状态、失效规则和命名空间归属

IR JSON 格式支持外部函数（externalFunctions），将第三方库调用纳入自我模型，使约束引擎能够区分"项目中存在"与"类型声明已知"的函数。

3.2 Runtime Ontology（运行时本体论）——执行语义的形式化 ★v2.1

v2.1 的核心创新：将隐式的运行时概念提升为第一类类型系统。

**Attempt**：单次规划尝试的完整记录，包含唯一 ID、会话归属、生成的 Action[]、StateTransition[]、ConstraintViolation[]、结果（success/constraint_violation/planner_failure）、时间戳、LLM 调用计数和抗体命中记录

**StateTransition**：每次函数调用引起的状态变化——按命名空间（namespace）记录执行前后的状态快照（Record<string, string[]>），以及获取（acquired）和失效（invalidate）的状态

**ConstraintViolation**：结构化违规记录，包含 SVL 级别、违规约束类型、违规动作索引、当前/所需/缺失状态、修复路径和命名空间归属

**ExecutionSession**：完整执行会话，包含所有 Attempt 数组、成功尝试的引用、IR 快照 ID、时间跨度和解决状态

这些类型构成了程序免疫过程的统一数据模型——从规划、验证、修复到持久化的全部信息流，均可序列化、可查询、可回放。

3.3 JSON Action DSL ——确定性合成边界 ★v2.1

v2.1 废弃了基于 new Function() + with(vars) 的 DSL 执行模型，全面采用 JSON 结构化输出：

```json
[{"f":"extractIR","to":"ir","a":[{"n":"root","t":"str","v":"."}]},
 {"f":"validateActionSequence","to":"ok","a":[{"n":"actions","t":"any","v":"$ir"}]},
 {"r":"ok"}]
```

LLM 输出的 JSON 数组通过 parseActionJSON() 解析为 Action[] 类型。$变量名 语法支持变量引用链接。此变更带来了三个关键收益：

（1）消除注入风险：JSON.parse() 天然免疫代码注入，无需沙箱化 eval

（2）格式稳定性：结构化 Schema 使 LLM 输出可预测，成功率从 ~33% 提升至 100%

（3）Schema 预验证：validateActionSchema() 在 IR 验证前先检查 JSON 结构完整性（必填字段、变量名合法性、重复 assignTo 检测等），提前拦截格式错误

Action 的类型定义（call / assign / return / if / for）作为单一权威来源定义在 runtime-types.ts 中，所有模块通过 import type 引用，消除了接口碎片化。

3.4 Constraint Engine ——天然免疫层

此层基于 IR 对动作序列执行快速的、基于规则的验证：

**SVL-1**（符号存在性）：每个被调用的函数都存在于项目中；支持内置白名单（console.log、fetch 等）

**SVL-2**（类型有效性）：参数数量和类型与声明的签名匹配；支持类型规范化（str/int/bool/dict/list 等归一化比较）

**SVL-3**（数据流正确性）：基于声明追踪的确定性变量流向分析——变量在使用前已声明，无自引用赋值、无循环引用

validateAction() 和 validateActionSequence() 返回结构化的 ConstraintViolation[]，包含 svl 级别、违规约束类型、描述和缺失状态。

3.5 Semantic State Graph（SSG）——获得性免疫层 ★v2.1

SSG 建模了系统资源的有效状态及其允许的转移。v2.1 的核心增强是**多命名空间隔离**：

auth 命名空间：
  UNAUTHENTICATED → verify_password → PASSWORD_VERIFIED
  PASSWORD_VERIFIED → generate_jwt → TOKEN_ISSUED
  TOKEN_ISSUED → create_session → SESSION_ACTIVE

file 命名空间：
  → open_file → FILE_OPEN
  FILE_OPEN → read_file / write_file / close_file

db 命名空间：
  → connect_db → DB_CONNECTED
  DB_CONNECTED → query_db / disconnect_db

dev_pipeline 命名空间（内部开发流程）：
  IR_STALE → extractIR → IR_EXTRACTED
  IR_EXTRACTED → validateAction → ACTION_VALIDATED
  ACTION_VALIDATED → validateActionSequence → SEQUENCE_VALIDATED
  SEQUENCE_VALIDATED → emitCode → CODE_EMITTED
  CODE_EMITTED → recordSession → SESSION_RECORDED

每个命名空间维护独立的状态集合。函数通过 protocols.json 或 @protocol JSDoc 注解声明命名空间归属、pre_states、post_states 和可选的 invalidate 规则。SSG 验证器在处理动作树时按命名空间隔离模拟状态转移。

v2.1 的 SSG 验证器输出完整的 per-namespace 状态转移记录（StateTransition），包含执行前后的命名空间快照（Record<string, string[]>）以及获取/失效的状态增量。

3.6 抗体推断系统（Antibody Inference）——免疫记忆的量化 ★v2.1

v2.1 引入了抗体信心等级（Antibody Confidence Level, ACL），使系统能够量化免疫记忆的可信度：

**ACL-4（全局稳定抗体）**：同一修复路径在 ≥10 次失败中验证，跨 ≥5 个不同意图。系统直接跳过 LLM，使用修复路径构建动作序列，零 LLM 调用

**ACL-3（跨任务验证抗体）**：修复路径在 ≥4 次失败或 ≥3 个不同意图中得到验证。系统将修复路径作为提示约束注入 LLM prompt，引导其遵循已知正确顺序

**ACL-2（重复观察）**：相同失败模式被观察到 ≥2 次，开始形成初步抗体

**ACL-1（单次记录）**：首次遇到的失败模式，仅记录不做干预

抗体命中被完整记录在 Attempt.antibodyHit 中，包含级别、签名、修复路径、相似度评分、节省的 LLM 调用数和估算 token 数。getAntibodyStats() 可量化免疫加速的总体节省。

3.7 Immune Memory & Failure Corpus ——免疫记忆层

三层记忆架构：

工作记忆（**Working Memory**）：当前会话的变量绑定和用户意图（每会话清除）

情景记忆（**Episodic Memory**）：最近 N 次成功/失败的动作序列，带时间戳和结果标签（定期剪枝）

语义记忆（**Semantic Memory**）：从频繁成功模式中蒸馏出的路径模板和协议规则（离线巩固）

失败语料库（Failure Corpus）支持两种会话格式：

旧格式（**IntentSession**）：v1.0 兼容，自动通过 normalizeSession() 上转为 ExecutionSession

新格式（**ExecutionSession**）：v2.1 原生，包含完整的 Attempt[] 和 ConstraintViolation[]

失败基因组（**Failure Genome**）从所有会话中聚合分析：按 SVL 级别、约束类型、失败模式、修复路径的多维度统计。getSemanticHeatmap() 输出脆弱协议热点、SVL 活跃度分布、约束共现聚类和高摩擦意图排行。

3.8 SSG 确定性修复（Deterministic Repair） ★v2.1

当 SSG 检测到协议违规且存在已知修复路径（BFS 状态图搜索）时，系统可在不调用 LLM 的情况下自动插入缺失函数。attemptSSGRepair() 在被拦截函数前插入修复序列，重新验证，支持递归修复直到路径完备。这一机制使协议违规的修复从"LLM 重试"降级为"确定性状态转移"。

3.9 Code Emitter ——程序落地层

将验证通过的动作树确定性地翻译为可执行的 TypeScript/Python 代码，处理导入解析、变量作用域、对象字面量生成以及嵌套控制结构的正确缩进。emitCode() 本身受 dev_pipeline 协议的 SSG 约束——只有在 SEQUENCE_VALIDATED 状态下才允许生成代码。

3.10 MCP Server —— AI 工具集成 ★v2.1

Progmune 以 MCP（Model Context Protocol）服务器形式发布，为 Claude 等 AI 编程助手提供以下工具：

**progmune_synthesize**：端到端合成——从意图到可执行代码，经过完整免疫管道

**progmune_validate**：验证动作序列的 SVL 合法性并返回 SSG 状态转移

**progmune_learn**：从失败语料库中查询学习到的修复模式

**progmune_observatory**：访问语义观测站——基因组、热力图、抗体统计

这使得每一行 AI 生成的代码都经过 Progmune 免疫系统的验证后，才进入代码库。

3.11 规划器检查点与中断恢复 ★v2.1

planner.ts 支持执行持久化：每次 LLM 重试后自动保存检查点（checkpoint），包含尝试索引、已累积的会话 Attempts、当前 prompt 状态。plan() 启动时自动检测未完成的检查点并从中断处恢复，避免因网络中断或进程崩溃导致重复的 LLM 调用和 token 浪费。

4. 语义有效性级别（SVL）

SVL 是 AI 生成代码正确性的形式化分类法，为系统提供分层、可量化的验证保证：

  ------------------- ---------------- ------------------------------------------------ ------------------------------------
  级别                名称             描述                                             保证内容
  **SVL-1**           符号存在性       每个被调用的函数、变量和导入在项目中均实际存在   无幻觉 API 调用
  **SVL-2**           类型有效性       参数数量和类型与声明的签名相匹配                 无类型不匹配错误
  **SVL-3**           数据流正确性     变量在使用前已声明；无循环引用或未初始化访问     无 NameError / UnboundLocalError
  **SVL-4**           协议合法性       函数调用序列符合声明的前/后状态转换规则          无非法状态跳转（如认证前签发令牌）
  **SVL-5**（未来）   语义意图正确性   生成代码忠实实现预期业务逻辑                     远期目标；当前版本未声明保证
  ------------------- ---------------- ------------------------------------------------ ------------------------------------

Progmune Runtime v2.1 完整保证 SVL-1 至 SVL-4。SVL-4 通过多命名空间 SSG 和抗体推断系统实现，支持 auth、file、db、dev_pipeline 等独立资源域。SVL-5 为开放性研究方向。

5. 实验评估

5.1 压力测试

在包含 3 至 338 个函数的合成 TypeScript 项目上进行了评估。JSON 结构化输出使 LLM Planner 的格式正确率达到 100%（v1.0 DSL 模式约 33%）。约束验证性能相对于项目规模保持线性增长。

5.2 语义阻断测试

构建了包含 10 个语义意图案例的测试套件。系统在 7-8 个案例中生成正确代码，其余案例被约束引擎正确拦截，阻断率 80-100%。

5.3 SSG 多命名空间隔离测试

构建了包含 auth、file、db 三个命名空间的协议规则集（18 条规则）。SSG 验证器正确拦截了跨命名空间的状态违规：在 auth 命名空间的 generate_jwt 需要 PASSWORD_VERIFIED 状态但当前为 UNAUTHENTICATED 时，系统给出包含命名空间的诊断信息和精确的修复路径（verify_password → PASSWORD_VERIFIED）。

5.4 抗体免疫加速

ACL-4 抗体快速通道在匹配到全局稳定抗体时，完全跳过 LLM 调用，节省 100% 的 token 消耗。ACL-3 抗体通过提示注入引导 LLM 遵循已知正确路径，降低了协议违规重试次数。

5.5 SSG 确定性修复

当协议违规具有已知修复路径时，attemptSSGRepair() 自动插入缺失函数，无需 LLM 重试。在 dev_pipeline 内部开发流程中，当 LLM 跳过 validateAction 直接尝试 emitCode 时，系统自动插入 validateAction → validateActionSequence 修复链。

6. 非目标（Non-Goals）

Progmune Runtime 明确不保证：

业务逻辑正确性（例如，定价计算是否准确）

算法最优性或复杂度

对所有安全漏洞的免疫（例如注入攻击、权限绕过）

生成代码单元之外的整个应用程序功能正确性

系统仅保证由 SVL-1 至 SVL-4 定义的程序有效性。Progmune 是程序有效性运行时，而非业务正确性证明器。

7. 未来方向

全球免疫网络：跨安装实例的脱敏 Failure Corpus 联邦汇聚，实现群体免疫级防御

语义失败基准库（**Semantic Failure Benchmark**）：世界上首个 AI 生成代码可靠性的公开基准，由汇聚的、匿名的失败模式构建

企业语义防火墙：集成到 CI/CD 管道中，作为 AI 生成拉取请求的合并前门禁

确定性验证器（**Rust/WASM**）：在 IDE、CI 和生产环境之间实现位级一致的验证，确保同一段 Action Tree 在任何环境中得到完全一致的合法性判断

观测站 Web UI 增强：交互式状态转移动画回放、抗体效能趋势图、跨项目免疫网络对比

8. 结论

Progmune Runtime v2.1 证明了：通过将 IR 确立为第一性原理，将运行时本体论作为可持久化的语义记录，并使 LLM 成为受多层约束的启发式提议器，我们可以实现具有强语义保证的可验证代码合成。

分层的 SVL 分类法、多命名空间 SSG 协议引擎、ACL 抗体推断系统、SSG 确定性修复机制、持续积累的 Failure Corpus 以及三层记忆架构，共同形成了一种全新的编程基础设施：一个会学习、会记忆、会防御的神经符号编译器运行时。

我们将此称为程序免疫学（*Program Immunology*）。

该系统以开源形式提供：https://github.com/shenlian19831109/progmune-runtime，也可通过 npm install progmune-runtime 安装使用。

ENGLISH VERSION

Abstract

*Progmune Runtime v2.1 introduces Runtime Ontology, multi-namespace SSG, and antibody inference to Program Immunology---a paradigm for ensuring the safety and reliability of AI-generated code.*

Inspired by the layered defense mechanisms of the biological immune system, Progmune establishes a constraint-guided program synthesis runtime that enforces semantic validity at multiple levels: from symbol existence and type compatibility to dataflow correctness and protocol legality. The system demotes large language models from unverified code generators to constrained heuristic proposers, operating within a closed world defined by the program's actual structure (Intermediate Representation).

Version 2.1 introduces Runtime Ontology---elevating Attempt, StateTransition, ConstraintViolation, and ExecutionSession to first-class serializable objects, transforming the immune process from implicit logs into explicit, queryable, replayable semantic records. Multi-namespace Semantic State Graph (SSG) supports isolated state machines for auth, file, db, and other resource domains. The Antibody Confidence Level (ACL-1 through ACL-4) system enables automatic extraction of repair paths from the failure corpus, allowing LLM-free generation of immune-verified sequences in familiar scenarios. The Semantic Observatory (CLI + Web) presents the complete "cognitive process" of AI programming---every attempt, every violation, every repair.

1. Problem Statement

1.1 The Open-World Fallacy in AI Code Generation

Large language models (LLMs) operate under an implicit open-world assumption when generating code: any function, library, or API pattern encountered during training is presumed available in the current context. This assumption yields four distinct classes of errors:

**Symbol Hallucination (SVL-1)**：Invoking functions or variables that do not exist in the target project

**Type Drift (SVL-2)**：Mismatched parameter counts or incompatible types with the actual function signature

**Dataflow Contamination (SVL-3)**：Using uninitialized variables, creating circular references, or introducing dead code paths

**Protocol Violation (SVL-4)**：Violating the required ordering of business steps---for example, issuing a JWT token before authenticating the user

These errors do not arise from reasoning failures. They arise because the model lacks deterministic access to the ground truth of the program.

1.2 Limitations of Current Mitigations

Existing strategies address these errors reactively:

**Post-hoc validation**：Linters, test suites, manual review---detects errors after generation but cannot prevent them at the source

**Retrieval-Augmented Generation (RAG)**：Injects project context into prompts, reducing but not eliminating hallucination; the model remains the sole arbiter of correctness

**Iterative prompt engineering**：Guides model behavior through carefully designed instructions, yet offers no formal guarantee of compliance

All three strategies place the LLM at the center of the system and attempt to correct its output from the outside. They lack a first-principles constraint mechanism.

1.3 Core Proposition: AI-Generated Programs Require an Immune System

*We propose a paradigm shift: Program Immunology. AI-generated code must not be allowed to enter a codebase without passing through an immune layer---a verifiable, memory-equipped runtime that recognizes, remembers, and defends against recurrent error patterns.*

This immune layer comprises three interdependent capabilities:

**Innate Immunity**：Rapid, pattern-based rejection of symbol, type, and dataflow violations---the system's built-in defenses

**Adaptive Immunity**：Learning from past failures (the Failure Corpus) to generate specific, targeted defenses such as protocol constraints and antibodies, proactively preventing future errors

**Immune Memory**：Structuring both successful and failed generation patterns into persistent knowledge, enabling continuous improvement with use

2. Biological Foundations and Analogy

2.1 The Three-Layer Architecture of the Biological Immune System

**Physical Barriers**：Skin, mucous membranes. Non-specific, preemptive first line of defense

**Innate Immunity**：Macrophages, dendritic cells. Pattern recognition receptors (PRRs) rapidly identify pathogen-associated molecular patterns (PAMPs). Fast but coarse-grained

**Adaptive Immunity**：T-cells, B-cells. Generate highly specific receptors through gene rearrangement, producing immunological memory for rapid secondary responses upon re-exposure

2.2 Mapping to Program Immunology

  ------------------------------ ------------------------------------------------------ ----------------------------------------------------------------------------------------------------------------------------
  **Biological Immune System**   **Program Immunology (Progmune v2.1)**                 **Mapping Description**
  **Physical Barriers**          Sandboxes, CI/CD gates, access controls                Infrastructure preventing unverified code from entering production.
  **Innate Immunity**            Constraint Engine (IR + SVL-1 through SVL-3)           Fast, automatic rejection of non-existent function calls and type errors. Built-in defenses.
  **Antigen Presentation**       Failure Corpus recording                               When an erroneous action sequence is captured, its full state context is recorded.
  **Adaptive Immunity**          Multi-Namespace SSG + Antibody Inference (ACL-1~4)     Learns from Failure Corpus, infers antibody confidence levels, generates protocol rules blocking illegal transitions.
  **Immunological Memory**       Three-Tier Memory Architecture + ACL-4 Fast-Path       ACL-4 antibodies skip LLM entirely; episodic + semantic memory enables rapid, LLM-free recall.
  ------------------------------ ------------------------------------------------------ ----------------------------------------------------------------------------------------------------------------------------

2.3 Value and Limits of the Analogy

This analogy provides a clear, extensible framework for understanding why static verification alone is insufficient and why a learning, memory-equipped system is necessary. However, it must be bounded: Program Immunology operates on formal, deterministic program states, not complex biochemical signals. Its "learning" relies on rule mining and pattern matching, not biological synaptic plasticity.

3. Technical Architecture

Progmune Runtime v2.1 is organized into ten core modules, each corresponding to a specific verification or learning responsibility.

3.1 IR (Program Truth Layer)---The "Self" Model

The Intermediate Representation (IR) is the single source of truth, extracted statically from TypeScript source files using ts-morph:

**SymbolTable**：All defined functions, classes, and variables with their locations

**TypeGraph**：Parameter types, return types, and type aliases

**CallGraph**：Caller-callee relationships between functions

**Protocol Annotations**：Pre-states, post-states, invalidation rules, and namespace affiliation declared via @protocol JSDoc tags

The IR JSON format supports external functions (externalFunctions), incorporating third-party library calls into the self-model so the constraint engine can distinguish "exists in project" from "known type declaration."

3.2 Runtime Ontology---Formalizing Execution Primitives ★v2.1

The core innovation of v2.1: implicit runtime concepts elevated to a first-class type system.

**Attempt**：Complete record of a single planning try, with unique ID, session affiliation, generated Action[], StateTransition[], ConstraintViolation[], outcome (success/constraint_violation/planner_failure), timestamp, LLM call count, and antibody hit record

**StateTransition**：Per-namespace state change caused by each function call---snapshots before and after execution (Record<string, string[]>), plus acquired and invalidated state deltas

**ConstraintViolation**：Structured violation record with SVL level, constraint type, action index, current/required/missing states, fix path, and namespace attribution

**ExecutionSession**：Complete execution session containing all Attempts, reference to the successful attempt, IR snapshot ID, time span, and resolution status

These types form a unified data model for the entire immune process---from planning through validation and repair to persistence---fully serializable, queryable, and replayable.

3.3 JSON Action DSL---Deterministic Synthesis Boundary ★v2.1

v2.1 deprecates the new Function() + with(vars) DSL execution model in favor of JSON structured output:

```json
[{"f":"extractIR","to":"ir","a":[{"n":"root","t":"str","v":"."}]},
 {"f":"validateActionSequence","to":"ok","a":[{"n":"actions","t":"any","v":"$ir"}]},
 {"r":"ok"}]
```

LLM output is parsed by parseActionJSON() into Action[] type. The $variable syntax supports variable reference chaining. Three key benefits:

(1) **Injection safety**: JSON.parse() is inherently immune to code injection; no sandboxed eval needed

(2) **Format stability**: Structured schema makes LLM output predictable; success rate improved from ~33% to 100%

(3) **Schema pre-validation**: validateActionSchema() checks JSON structural integrity (required fields, valid variable names, duplicate assignTo detection) before IR-aware validation, catching format errors early

The Action discriminated union (call / assign / return / if / for) is defined as the single source of truth in runtime-types.ts, with all modules importing via import type, eliminating interface fragmentation.

3.4 Constraint Engine---Innate Immunity

**SVL-1 (Symbol Existence)**：Every called function exists in the project; built-in whitelist for console.log, fetch, etc.

**SVL-2 (Type Validity)**：Argument count and types match declared signatures; normalized type comparison (str/int/bool/dict/list)

**SVL-3 (Dataflow Correctness)**：Declaration-tracking deterministic variable flow analysis---variables declared before use, no self-referential assignments, no circular references

validateAction() and validateActionSequence() return structured ConstraintViolation[] with svl level, violated constraint type, description, and missing states.

3.5 Semantic State Graph (SSG)---Adaptive Immunity ★v2.1

The SSG models valid states of system resources and their allowed transitions. The key v2.1 enhancement is **multi-namespace isolation**:

auth namespace:
  UNAUTHENTICATED → verify_password → PASSWORD_VERIFIED
  PASSWORD_VERIFIED → generate_jwt → TOKEN_ISSUED
  TOKEN_ISSUED → create_session → SESSION_ACTIVE

file namespace:
  → open_file → FILE_OPEN
  FILE_OPEN → read_file / write_file / close_file

db namespace:
  → connect_db → DB_CONNECTED
  DB_CONNECTED → query_db / disconnect_db

dev_pipeline namespace (internal development workflow):
  IR_STALE → extractIR → IR_EXTRACTED
  IR_EXTRACTED → validateAction → ACTION_VALIDATED
  ACTION_VALIDATED → validateActionSequence → SEQUENCE_VALIDATED
  SEQUENCE_VALIDATED → emitCode → CODE_EMITTED
  CODE_EMITTED → recordSession → SESSION_RECORDED

Each namespace maintains an independent state set. Functions declare namespace affiliation, pre_states, post_states, and optional invalidate rules via protocols.json or @protocol JSDoc annotations. The SSG validator simulates state transitions with namespace isolation as it processes the Action Tree.

v2.1's SSG validator outputs complete per-namespace StateTransition records, including namespace snapshots before and after execution (Record<string, string[]>) and acquired/invalidated state deltas.

3.6 Antibody Inference System---Quantified Immune Memory ★v2.1

v2.1 introduces Antibody Confidence Levels (ACL) to quantify immune memory reliability:

**ACL-4 (Globally Stable Antibody)**：Same repair path validated across ≥10 failures spanning ≥5 distinct intents. System skips LLM entirely, constructing action sequences directly from the repair path---zero LLM calls

**ACL-3 (Cross-Task Validated Antibody)**：Repair path validated across ≥4 failures or ≥3 distinct intents. System injects the repair path as a prompt constraint, guiding the LLM to follow the known correct ordering

**ACL-2 (Repeated Observation)**：Same failure pattern observed ≥2 times; preliminary antibody forming

**ACL-1 (Single Case)**：First encounter with a failure pattern; recorded for future reference only

Antibody hits are fully recorded in Attempt.antibodyHit with level, signature, fix path, similarity score, LLM calls saved, and estimated tokens saved. getAntibodyStats() quantifies total immune acceleration savings.

3.7 Immune Memory & Failure Corpus---Immunological Memory

Three-Tier Memory Architecture:

**Working Memory**：Current session variable bindings and intent (cleared per session)

**Episodic Memory**：Recent N successful/failed action sequences with timestamps and labels (periodically pruned)

**Semantic Memory**：Distilled path templates and protocol rules extracted from frequent successful patterns (consolidated offline)

The Failure Corpus supports dual session formats:

Legacy format (**IntentSession**)：v1.0 compatible, automatically up-converted via normalizeSession()

Native format (**ExecutionSession**)：v2.1 native, containing complete Attempt[] with ConstraintViolation[]

The Failure Genome aggregates analysis from all sessions: multi-dimensional statistics by SVL level, constraint type, failure pattern, and repair path. getSemanticHeatmap() outputs fragile protocol hotspots, SVL activity distribution, constraint co-occurrence clusters, and high-friction intent rankings.

3.8 SSG Deterministic Repair ★v2.1

When SSG detects a protocol violation with a known repair path (discovered via BFS state graph search), the system can automatically insert missing functions without invoking the LLM. attemptSSGRepair() inserts the repair sequence before the blocked function, re-validates, and supports recursive repair until the path is complete. This downgrades protocol violation repair from "LLM retry" to "deterministic state transition."

3.9 Code Emitter---Program Realization

Translates a verified Action Tree into executable TypeScript or Python code, handling import resolution, variable scoping, object literal generation, and proper indentation of nested control structures. The emitCode() function itself is SSG-constrained by the dev_pipeline protocol---code emission is only permitted in the SEQUENCE_VALIDATED state.

3.10 MCP Server---AI Tool Integration ★v2.1

Progmune ships as an MCP (Model Context Protocol) server, providing AI coding assistants such as Claude with the following tools:

**progmune_synthesize**：End-to-end synthesis---from intent to executable code through the complete immune pipeline

**progmune_validate**：Validate action sequence SVL legality and return SSG state transitions

**progmune_learn**：Query learned repair patterns from the failure corpus

**progmune_observatory**：Access the semantic observatory---genome, heatmap, antibody statistics

This ensures every line of AI-generated code passes through the Progmune immune system before entering the codebase.

3.11 Planner Checkpointing & Interrupt Recovery ★v2.1

planner.ts supports execution persistence: after each LLM retry, a checkpoint is automatically saved containing the attempt index, accumulated session Attempts, and current prompt state. On plan() startup, incomplete checkpoints are automatically detected and execution resumes from the interruption point, avoiding duplicate LLM calls and token waste due to network interruptions or process crashes.

4. Semantic Validity Levels (SVL)

SVL is a formal taxonomy of AI-generated code correctness, providing layered, quantifiable verification guarantees:

  -------------------- ----------------------------- -------------------------------------------------------------------- --------------------------------------
  **Level**            **Name**                      **Description**                                                      **Guarantee**
  **SVL-1**            Symbol Existence              Every called function, variable, and import exists in the project.   No hallucinated APIs.
  **SVL-2**            Type Validity                 Argument count and types match declared signatures.                  No type mismatches.
  **SVL-3**            Dataflow Correctness          Variables are declared before use; no circular references.           No NameError or UnboundLocalError.
  **SVL-4**            Protocol Legality             Function call sequences respect declared state transitions.          No illegal state jumps.
  **SVL-5 (Future)**   Semantic Intent Correctness   Generated code faithfully implements intended business logic.        Aspirational; not currently claimed.
  -------------------- ----------------------------- -------------------------------------------------------------------- --------------------------------------

Progmune Runtime v2.1 fully guarantees SVL-1 through SVL-4. SVL-4 is implemented through the multi-namespace SSG and antibody inference system, supporting independent resource domains (auth, file, db, dev_pipeline). SVL-5 remains an open research challenge.

5. Experimental Evaluation

5.1 Stress Testing

Evaluated on synthetic TypeScript projects ranging from 3 to 338 functions. JSON structured output achieved 100% format correctness for the LLM Planner (compared to ~33% with the v1.0 DSL model). Constraint verification performance remained linear with respect to project size.

5.2 Semantic Blocking Tests

A test suite of 10 semantic intent cases demonstrated 80--100% blocking rate for semantic errors, with correct code generated in 7--8 out of 10 cases.

5.3 Multi-Namespace SSG Isolation

A protocol rule set of 18 rules spanning auth, file, and db namespaces was constructed. The SSG validator correctly intercepted cross-namespace state violations, providing namespace-attributed diagnostics and precise repair paths.

5.4 Antibody Immune Acceleration

ACL-4 antibody fast-path skips LLM calls entirely when matching globally stable antibodies, saving 100% of token consumption. ACL-3 antibodies guide LLMs toward known correct paths through prompt injection, reducing protocol violation retry counts.

5.5 SSG Deterministic Repair

When protocol violations have known repair paths, attemptSSGRepair() automatically inserts missing functions without LLM retries. In the dev_pipeline workflow, when the LLM skips validateAction and attempts emitCode directly, the system auto-inserts the validateAction → validateActionSequence repair chain.

6. Non-Goals

Progmune Runtime explicitly does not guarantee:

Business logic correctness (e.g., whether a pricing calculation is accurate)

Algorithm optimality or complexity

Immunity to all security vulnerabilities (e.g., injection attacks, permission bypasses)

Functional correctness of the entire application beyond the generated code unit

*The system guarantees only program validity as defined by SVL-1 through SVL-4. Progmune is a program validity runtime, not a business correctness prover.*

7. Future Directions

**Global Immune Network**：Federated aggregation of anonymized Failure Corpus data across installations, enabling population-level immunity

**Semantic Failure Benchmark**：The world's first public benchmark for AI-generated code reliability, built from aggregated, anonymized failure patterns

**Enterprise Semantic Firewall**：Integration into CI/CD pipelines as a pre-merge gate for AI-generated pull requests

**Deterministic Verifier (Rust/WASM)**：Bit-identical verification across IDE, CI, and production environments

**Observatory Web UI Enhancements**：Interactive state transition animation replay, antibody efficacy trend charts, cross-project immune network comparison

8. Conclusion

Progmune Runtime v2.1 demonstrates that by establishing IR as the first principle, formalizing Runtime Ontology as serializable semantic records, and constraining LLMs as multi-layer heuristic proposers, we can achieve verifiable code synthesis with strong semantic guarantees.

The layered SVL taxonomy, multi-namespace SSG protocol engine, ACL antibody inference system, SSG deterministic repair mechanism, accumulating Failure Corpus, and three-tier memory architecture together form a new kind of programming infrastructure: a neural-symbolic compiler runtime that learns, remembers, and defends.

*We call this Program Immunology.*

The system is available as open-source at https://github.com/shenlian19831109/progmune-runtime and as an npm package: npm install progmune-runtime.
