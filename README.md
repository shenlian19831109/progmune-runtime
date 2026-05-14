
# Progmune Runtime（免序）

**程序免疫学 · 约束导向的程序合成运行时**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Stage: Technical Preview](https://img.shields.io/badge/Stage-Technical_Preview-orange)]()

Progmune（免序）不是一个 AI 编程助手，而是一个**约束导向的程序合成运行时**。它从人脑的双系统记忆与预测编码机制中汲取灵感，将大语言模型（LLM）降级为受严格约束的启发式搜索器，确保生成的代码仅使用项目中真实存在的函数、类型兼容、数据流安全，并满足声明式的协议约束。

---

## 为什么需要 Progmune？

大语言模型在生成代码时会产生“幻觉”——调用不存在的函数、使用错误的类型、输出看似合理但语义错误的程序。传统的“事后校验”只是补救，无法根除幻觉。  
Progmune 的核心理念来自认知神经科学：**人脑通过互补学习系统（海马体-皮层）快速学习新事实而不遗忘旧知识，通过预测编码持续修正错误，通过前额叶监控过滤不适当行为**。将这套机制工程化为 AI 编程基础设施，就是从“概率生成”到“可验证工程”的范式转变。

---

## 架构与工作流程

用户意图 (从 AI 代理发出)
↓
Planner (LLM 担任受限提议器)
↓
IR (程序真相层: 函数签名、类型、调用图、协议)
↓
Action Runtime (确定性 API: call, ifElse, assign, output)
↓
约束校验器 (符号正确性、类型兼容、变量流向、协议一致性)
↓
代码发射器 (Python / TypeScript)
↓
运行时反馈闭环 (记录成功率，影响后续规划)

---

## 核心功能与保证

### ✅ 系统保证 (Guarantees)

| 保证项 | 说明 |
|--------|------|
| 符号正确性 | 绝不生成项目中不存在的函数调用 |
| 类型兼容性 | 参数数量、类型跨语言归一化校验（Python/TypeScript） |
| 控制流正确性 | 稳定生成包含 `if/else` 分支的完整逻辑 |
| 变量流向安全 | 防止使用未初始化变量、循环引用 |
| 协议一致性 | 通过声明式合约（如“登录必须先验证密码”）强制业务步骤顺序 |
| 线性可伸缩 | 已通过 338 函数规模压力测试，性能无衰减 |

### ❌ 系统明确不保证 (Non-Goals)

- 业务逻辑正确性（如金额计算是否准确）
- 算法复杂度或最优性
- 安全漏洞的绝对避免（如注入、权限绕过）
- 完整应用逻辑验证

**系统仅保证 `program validity`（符号正确性、类型兼容性、数据流安全、协议一致性）。**

---

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- 一个有效的 LLM API 密钥（DeepSeek 或 OpenAI 兼容接口）

### 1. 安装

```bash
npm install -g progmune-runtime
```
或直接通过 npx 运行（无需安装）：

```bash
npx progmune-runtime
```

### 2. 配置 LLM API 密钥

```bash
export LLM_API_KEY="你的DeepSeek或OpenAI密钥"
```

### 3. 验证安装

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx progmune-runtime
```
返回包含 `generate_verified_code` 工具的 JSON 表示成功。

### 4. 生成代码

需要提供一个包含 Python 源码的本地项目路径：

```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"generate_verified_code","arguments":{"intent":"实现login函数，验证密码后生成JWT并返回","projectPath":"/absolute/path/to/test-semantic-guard"}}}' | npx progmune-runtime
```

## 集成到 MCP 客户端

### Claude Code

在 `~/.claude/settings.json` 中添加：

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
重启 Claude Code，然后直接说“帮我实现一个登录函数”即可自动调用。

### Manus / 其他支持 MCP 的客户端

| 字段 | 值 |
|---|---|
| Name | progmune |
| Transport | STDIO |
| Command | npx |
| Args | progmune-runtime |
| Env | LLM_API_KEY=你的密钥 (如果支持) |

## 使用案例

### 案例：带条件判断的登录函数

用户意图: “实现一个登录函数，验证密码后生成 JWT 并返回”

生成代码 (示例):

```python
from auth import verify_password, generate_jwt

def main():
    pwd_ok = verify_password("用户输入的密码", "存储的哈希")
    if pwd_ok:
        token = generate_jwt({"user_id": "123"})
        return token
    else:
        return "密码错误"
```

## 全球免疫网络 (Global Immune Network)

Progmune 可将本地脱敏后的错误指纹安全上报至中央免疫服务器，实现“群体免疫”。
上报前，请设置中央服务器地址：

```bash
export PROGMUNE_HUB="https://progmune-runtime.fly.dev/report"
```

之后只需两条命令即可预览和上报：

```bash
# 查看待上报的脱敏错误指纹（仅函数名、SVL级别、状态迁移）
npx ts-node src/report.ts preview

# 执行安全上报
npx ts-node src/report.ts report
```

**隐私保护**：只上传函数名序列、SVL级别、状态迁移，绝不包含任何代码片段、变量值或用户数据。

## 如何贡献：提交语义失败案例

Progmune 的核心护城河在于不断积累的语义失败语料库 (Semantic Failure Corpus)。您在使用过程中遇到的“看似合法但实际危险的生成”，对我们完善语义状态图 (SSG) 至关重要。

### 提交方式

GitHub Issues：在仓库 Issues 页面选择 Semantic Failure Report 模板，填写意图、错误代码片段、期望的正确行为等。

### 脱敏处理

请删除所有敏感信息（如真实 API 密钥、内部 IP、用户数据等），只保留结构化错误模式。

### 成为贡献者

您的名字将被列入 CONTRIBUTORS.md。

## 许可证

MIT License。详见 LICENSE 文件。

Progmune 正在重新定义 AI 辅助编程——不是“让模型更聪明”，而是“让程序真相主导生成”。
加入我们的技术预览，一起构建可验证的 AI 编码未来。
