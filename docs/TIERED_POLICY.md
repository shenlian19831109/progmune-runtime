# 分资产分级接入——三档策略模板

> 2026-09-06 · Hunyuan 方法论「分资产分级」落地：不要给所有代码上同一套门禁。
> 按「出错代价 × AI 参与度」二维分级，把昂贵的方法论投入压在最致命的代码上。

## 一、分级矩阵

| 档位 | 适用资产 | 出错代价 × AI 参与度 | 待遇 |
|------|---------|---------------------|------|
| **Tier-1 强制** | 鉴权、支付、资源生命周期、凭证处理 | 致命 × 全自动生成 | 全规则 BLOCK + `trust --ci` 硬门 + **写后回滚门**（BLOCK 时文件不残留） |
| **Tier-2 标准** | 业务逻辑、CRUD、常规服务 | 中等 × 辅助生成 | violations 类 BLOCK；confidence/human_review/risk 降 WARN 观察；CI 软门 |
| **Tier-3 观察** | 工具脚本、demo、内部实验 | 低 × 任意 | 全部 WARN——只报告不拦截，保留证据链 |

## 二、落地物

- `templates/.progmune-policy.tier1.json` / `.tier2.json` / `.tier3.json`
- `scripts/init-policy.js --tier 1|2|3 [--dir <目标目录>]`：把模板落到项目根
  （Tier-1 落地即激活**写后回滚门**——execute 写盘随即验证、BLOCK 时文件
  不残留。补偿控制而非写前拦截：写盘与回滚之间进程中断的残留为已知边界）

## 三、与强制力边界的关系

README「BLOCK 的强制力由集成方承担」的三处 OS 级执行点中，**写后回滚门
仅 Tier-1 激活**（opt-in 哲学：只有声明为致命资产的项目才付出验证成本）。
Tier-2/3 的报告证据链完整保留，供升级审计。

## 四、模板差异速览

| 规则 | Tier-1 | Tier-2 | Tier-3 |
|------|--------|--------|--------|
| confidence（证书置信度） | block | warn | warn |
| provenance（来源链完整） | block | block | warn |
| human_review（人工复核） | block | warn | warn |
| fingerprint（指纹核验） | warn | warn | warn |
| violations（状态机违规） | block | block | warn |
| kb_coverage（知识库覆盖） | warn | warn | warn |
| risk（风险模式） | block | warn | warn |
