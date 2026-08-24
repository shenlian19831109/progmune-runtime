# Progmune API Reference

> 本页描述 npm 包与仓库的真实接口表面（v3.7.2）。npm 包的 `bin` 入口是 **MCP server**（stdio）；SDK（`src/sdk.ts`）为仓库内模块，由仓库内 CLI 脚本消费。

## SDK（`src/sdk.ts`，仓库内模块）

导出：`verify`、`explain`、`getCompatibility`、`RUNTIME_VERSION`。

### `verify(filePath: string): VerificationResult`

同步单参调用，对单个文件产出治理决策：

```typescript
import { verify } from "./src/sdk";

const result = verify("src/server.ts");
// result.decision: "BLOCK" | "WARN" | "ALLOW"
```

**Returns:** `VerificationResult`

```typescript
{
  runtimeVersion: string;                    // 运行时版本
  decision: "BLOCK" | "WARN" | "ALLOW";      // 最终治理决策（SDK 词汇；Trust 引擎用 APPROVED/NEEDS_REVIEW/BLOCKED）
  certificate: Certificate;                  // AI 代码证书
  knowledge: {
    version: string;
    stableProtocols: number;
    totalProtocols: number;
    averageConfidence: number;
  };
  evidence: {
    totalRepos: number;
    totalSequences: number;
    topProtocols: string[];
  };
  risk: {
    level: string;                           // Critical / High / ...
    recommendation: string;
    patterns: Array<{
      name: string; severity: string; confidence: number;
      concept?: string; detail: string;
    }>;
  };
  network?: {                                // 知识网络上下文
    totalNodes: number; totalEdges: number; relatedProtocols: string[];
  };
  timestamp: string;
}
```

### `explain(result: VerificationResult): string`

人类可读的解释文本（证据链 + 修复建议）。

### `getCompatibility()`

返回兼容矩阵 + `sdkVersion` + `protocols` 列表。

---

## MCP Server（npm 包 `bin` 入口）

`progmune-runtime` 命令启动 stdio MCP server（Claude Code 等 MCP 客户端可直接配置）。工具清单（`src/mcp-server.ts` 注册）：

- 核心：`progmune`、`progmune_check`、`progmune_trust_check`、`progmune_score`
- 治理：`progmune_audit`、`progmune_governance_report`、`progmune_certify`、`progmune_policy_check`、`progmune_accountability`、`progmune_provenance`、`progmune_status`、`progmune_plsb`
- 生成与执行：`progmune_generate`、`progmune_scaffold`、`progmune_init`、`progmune_execute`、`progmune_repair`、`progmune_accept`、`progmune_discover`、`progmune_zeroshot`

---

## 仓库内 CLI（npm scripts）

| 命令 | 用途 |
|------|------|
| `npm run sdk <file> --explain` | 单文件验证（BLOCK/WARN/ALLOW + 证据） |
| `npm run trust -- --project <dir> --json` | Trust 检查（Score + Decision + Evidence，CI 友好） |
| `npm run check` | 免疫 / Ledger / 覆盖率体检 |
| `npm run patrol -- --project <dir> [--watch]` | 免疫巡逻（报告 + 建议补丁，绝不自动合并） |
| `npm run agent "<意图>"` | 自主实现循环（8 门验证 + SSG 确定性修复） |
| `npm run certify` / `npm run governance` | 证书 / 治理审计 |
| `npm run dashboard` | 治理仪表盘 |
| `npm run precision:all` | 跨仓库 precision 基准 |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROGMUNE_RANKER` | Ranker mode (`heuristic` or `learning`) | `heuristic` |
| `PROGMUNE_MODEL_WEIGHT` | Learning ranker weight | `0.3` |
| `PROGMUNE_ENFORCE` | Enforcement level (`warn` or `block`) | `warn` |
| `PROGMUNE_PROJECT_DIR` | Project directory for corpus storage | `.` |
