# Progmune Quick Start

5 分钟内验证 AI 生成的代码。当前 npm 版本：3.7.2。

## 1. 安装

```bash
npm install progmune-runtime
```

## 2. 三种使用方式

**A. MCP Server（Claude Code 集成）**——包的 `bin` 入口：

```bash
# 在 Claude Code 的 mcp 配置中指向该命令（stdio 协议，工具清单见 docs/API_REFERENCE.md）
progmune-runtime
```

**B. CI 门禁（GitHub Action）**——仓库级用法：

```yaml
# .github/workflows/progmune.yml
name: Progmune Policy Check
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shenlian19831109/progmune-runtime@main
        with:
          project_path: .
          strict: false
```

**C. 仓库内 CLI**（clone 仓库后）：

```bash
npm install

npm run sdk src/server.ts --explain   # 单文件验证：BLOCK/WARN/ALLOW + 证据链
npm run trust -- --project . --json   # Trust 检查：Score + Decision + Evidence
npm run check                         # 免疫 / 覆盖率体检
npm run dashboard                     # 治理仪表盘
```

## 3. 输出形态

Trust 检查输出 **Decision 优先**：`APPROVED / NEEDS_REVIEW / BLOCKED` + Trust Score（0–100）+ 置信度 + 证据链。Critical 违规 → 硬 BLOCK（与分数无关）。

## 4. 看覆盖范围

[Coverage Matrix](coverage-matrix.md) — 协议 × 语言 × 框架的真实覆盖状态（TS ✅ 生产级、Python ✅、C ⚠️ 研究级——3.7.4 起 IR 提取 + 应用级协议验证可用、Go/Java ❌）。

## 5. 下一步

- [API Reference](API_REFERENCE.md) — SDK（`verify`/`fix`/`explain`）与 MCP 工具
- [Runtime Architecture](RUNTIME_ARCHITECTURE.md) — 完整架构与部署手册
- [基准基线](../blind-benchmark/BASELINE_v6.md) — TS/Python 缺陷检测盲测
- [协议盲测基线](../blind-benchmark/BASELINE_PROTOCOL_PYTHON_v1.md) — Python 协议行 v1.2

---

## What Progmune Checks

| 协议 | 状态 | 证据 |
|------|------|------|
| Auth | TS ✅ / Python ✅ | TS 795 gold；Python 协议盲测 v1.2 66 gold 97%/100%/0 FP |
| TLS/SSL、SSH、HTTP/2、HTTP Request | TS ⚠️ / C ✅ | C gold 基准 F1=16.5%（研究级） |
| Resource Lifecycle | Python ✅ / TS ⚠️ | endState 资源未释放检查 + P4.6 跨函数传播 |
| Payment / Data Integrity / Ledger | TS ✅ | 专用规则 + 基准数据 |

完整矩阵与口径见 [docs/coverage-matrix.md](coverage-matrix.md)。

Progmune 不相信模型声称做了什么——它验证程序实际做了什么。
