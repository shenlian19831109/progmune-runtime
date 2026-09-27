# Real-World Audit — fastapi @ skyvern

> 语料：/tmp/skyvern（vendored /tmp/skyvern）。生成：2026-09-11。
> 方法：真实语料 → 检测器扫描 → **逐条人工金标标注** → 反证实验。

## 扫描

| 项 | 值 |
|----|----|
| 文件 | 1371 |
| 路由/过程 | 412 |
| issues | 2 {"FASTAPI_ROUTE_NO_AUTH":2} |

## 逐条标注（人工）

| # | 规则 | 路由 | 文件 | 标注(TP/FP/加固类/能力令牌) | 依据 |
|---|------|------|------|------------------------------|------|
| 1 | FASTAPI_ROUTE_NO_AUTH | POST /webhook | /tmp/skyvern/skyvern/forge/sdk/routes/agent_protocol.py |  | 
| 2 | FASTAPI_ROUTE_NO_AUTH | POST /webhook/ | /tmp/skyvern/skyvern/forge/sdk/routes/agent_protocol.py |  | 

## 反证实验清单（人工执行）

1. **敏感性**：摘掉某条受保护 mutation 的认证 → 应报（若无反应 = 失明）
2. **0 flags 空洞检查**：语料金标是否全受保护（若全保护则 0 flags 正确；否则漏报）
3. **register/login 公开**：豁免词表是否正确放过
