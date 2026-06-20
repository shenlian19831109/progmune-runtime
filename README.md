# 程序免疫学

## AI 生成代码的协议安全运行时

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![PLSB Recall](https://img.shields.io/badge/PLSB_Recall-92%25-brightgreen)]()

---

### 一句话定位

**Progmune 用协议状态机验证 AI 生成的代码是否绕过了关键安全步骤。** 它不是"帮程序员少写 bug"，而是"证明 AI 生成的代码没有跳过认证、没有忘记释放资源、没有在释放后继续使用指针"。

---

### 解决什么问题

LLM 生成的代码在语法上正确，但在**行为上可能不安全**。三种典型的 AI 代码缺陷：

| 缺陷 | 示例 | 传统工具能发现吗 |
|------|------|-----------------|
| **认证绕过** | AI 跳过 `verify_password` 直接签发 token | Linter ❌ &nbsp;测试 ❌ &nbsp;SAST ❌ |
| **资源泄漏** | AI 打开文件但忘记关闭 | Linter ❌ &nbsp;测试 ⚠️ &nbsp;SAST ❌ |
| **生命周期违规** | AI 在 `free()` 之后继续使用指针 | Linter ❌ &nbsp;测试 ⚠️ &nbsp;SAST ❌ |

这些不是语法错误——它们是**协议状态机违规**。Progmune 在生成阶段检查代码是否遵守正确的协议生命周期。

---

### 工作原理（框架层面）

Progmune 借鉴生物免疫系统的三层防御结构：

```
用户意图（自然语言）
    │
    ▼
LLM Proposer ──► 提议抽象动作序列（不是直接生成代码）
    │
    ▼
┌─────────────────────────────────────────────┐
│  天然免疫 — 约束引擎                        │
│  检查：函数是否存在？类型是否匹配？          │
│  毫秒级拦截幻觉和类型错误                   │
├─────────────────────────────────────────────┤
│  获得性免疫 — 协议安全检测器                │
│  检查：调用序列是否遵守协议状态机？          │
│  拦截认证绕过、资源泄漏、生命周期违规       │
├─────────────────────────────────────────────┤
│  免疫记忆 — 可审计治理                      │
│  记录完整的状态转移链，可回放验证            │
│  回答"AI 生成这段代码时有没有做安全检查？"  │
└─────────────────────────────────────────────┘
    │
    ▼
通过 → 发射可执行代码（带 @progmune-generated 标记）
失败 → 返回 Top-3 修复建议 + BFS 协议修复路径
```

**关键设计：** Progmune 不信任 LLM 的输出。它从项目中提取**程序真相（IR）**——符号表、类型图、调用图和协议注解——然后用这套真相去约束 LLM 的提议。LLM 被降级为"受约束的提议者"，最终决定权在程序真相。

---

### 怎么用

**前置条件：** Node.js >= 18，LLM API key

```bash
npm install -g progmune-runtime

# 1. 提取项目 IR（程序真相）
npx progmune-runtime ir .

# 2. 启动 MCP 服务器（接入 Claude Code / Cursor）
npx progmune-runtime start

# 3. 运行内置测试
npx progmune-runtime test
```

**MCP 工具：**
- `progmune_generate` — 在 IR 约束下生成 TypeScript 代码
- `progmune_repair` — 当代码违反协议时，获取 Top-3 修复方案
- `progmune_check` — 审计现有代码是否遵守协议规范
- `progmune_status` — 查看免疫网络健康状态

---

### 安全检测能力

Progmune 擅长检测**协议生命周期漏洞**——这些是传统 SAST 工具（CodeQL、Semgrep）的盲区：

| 漏洞类别 | 示例 | PLSB 检出率 |
|----------|------|-----------|
| 缺失释放 | open → read → return（缺 close） | 100% |
| 认证绕过 | generate_token → access（缺 verify） | 100% |
| 权限提升 | sudo → execute（缺 capability check） | 100% |
| 释放后使用 | free → use（顺序错误） | 88% |
| 会话固定 | login → create_session（缺 invalidate_old） | 检出 |

**不覆盖的领域：** SQL 注入、XSS、SSRF、RCE —— 这些是代码层面的漏洞，不属于协议生命周期范畴。Progmune 的定位是**协议安全**，不是通用漏洞扫描。

---

### 技术可信性

**可复现的证据：**

| 测试 | 结果 | 说明 |
|------|------|------|
| 双盲名称混淆 | 100% 存活 | 系统不看函数名，看状态机结构 |
| 真实 CVE 检测 | 92% 召回率 | 在已确认真实 CVE 的 PLSB 基准上测量 |
| 零样本修复 | 100% | 从未见过的仓库中修复 PostgreSQL 缺陷 |

**可审计性：** 每个 AI 生成的文件带有 `@progmune-generated` 标记、会话 ID 和规则哈希。Ledger 记录完整的状态转移链。任何时候都可以回放验证——"AI 生成这段代码时有没有经过安全检查？"这个问题是可回答的。

**数据安全：** 免疫记忆（Failure Corpus）存储在本地项目的 `.progmune_corpus/` 目录中。系统不会上传你的代码到外部服务器。IR 提取是纯静态分析——它读取你的代码来建立"程序真相"，但不发送代码内容。

---

### 和传统 SAST 的区别

| | CodeQL / Semgrep | Progmune |
|---|---|---|
| 分析对象 | 代码语法和模式 | **协议状态机** |
| 检查时机 | 代码写完之后 | **生成阶段实时拦截** |
| 原理 | 规则匹配 | **协议结构学习** |
| 生命周期漏洞 | 难以捕获 | **核心能力** |
| 可审计性 | 无 | **完整 Ledger 回放** |

---

### 项目状态

```
当前阶段：V6 — 协议安全运行时
测试通过：26+ 核心套件，零构建错误
PLSB 基准：37 个已验证真实 CVE，13 种弱点分类全覆盖
名称无关：已证明状态机指纹与函数名独立（双盲验证 100%）
```

详细技术内容见：[内部技术白皮书](docs/WHITEPAPER_V5.html)

---

### 许可证

MIT License
