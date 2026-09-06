# 第三方安全审计回应（2026-09-06）

> 本文档回应两份独立源码审计：**智谱（Zhipu）《Progmune 源码级安全审计报告》**与
> **Kimi（Moonshot）行号级审计**（均 2026-09-06，基于 v3.7.22 源码）。
> 立场：两份审查方法诚实、结论大多有源码证据。以下逐条回应——**已修复**、
> **事实澄清**、**接受为设计边界**、**计划中**。所有修复已在同日合入 main。

## 一、已修复（本轮 commit 对应）

| 审计发现 | 修复 | commit |
|---|---|---|
| Kimi：risk 规则空 catch 静默放行 + 伪造 `["SSL_CTX_new","SSL_connect"]` 输入 | fail-closed：真实调用提取，无数据/模块不可用 → 显式违规 | `ab0d0dec` |
| Kimi：配置解析失败静默回退默认策略 | 显式 `configError`，policy CLI 拒绝评估（exit 2） | `ab0d0dec` |
| Kimi：execute 写盘与策略引擎脱节 | opt-in **写后回滚门**（`.progmune-policy.json` 时写后即验，BLOCK 时文件不残留——补偿控制，写盘与回滚间进程中断为已知边界） | `ab0d0dec` |
| 智谱/Kimi：PROGMUNE_STRICT=false 逃生门不留痕 | 降级写入审计事件日志 | `ab0d0dec` |
| 智谱：决策层注释（乘积）与实现（加权平均）矛盾 | 注释与实现对齐（0.4/0.25/0.35） | `ab0d0dec` |
| 智谱：证书无时效绑定 | PolicyContext 贯通证书时间戳（CLI + MCP） | `ab0d0dec` |
| Kimi：SUPPRESS 静默抑制无审计 | 全部决策持久化 audit-events.jsonl + SUPPRESS 原因含全输入 | `acf2026e` |
| Kimi：截断序列静默继续验证 | ssgCoverage 显式上报 truncatedSequences + summary 标注 | `acf2026e` |
| Kimi：14 条跨命名空间死规则 | 4 条归位（G5 模式）+ 10 条 printlab 显式例外 + 活性守卫测试 | `24bd895d` |
| 智谱：「免疫系统自我进化」叙事 | 落地页收敛到可实现口径（失败语料库 + 快速通道 + 知识库扩充） | `acf2026e` |
| 智谱：「必须配置 LLM Key 才能运行」 | FAQ 澄清：LLM 是可选增强，确定性核心无外部依赖 | `acf2026e` |
| 智谱/Kimi：BLOCK 无强制力 | README 双语边界声明：三处 OS 级执行点（trust --ci / policy CLI / 写后回滚门）+ 「辅助检查器」定位 | `acf2026e` |

## 二、事实澄清（两份报告中的出入）

1. **「安全命名空间空壳、未见规则定义」（智谱）**——报告自述只读到协议库
   「可见部分约 60 条规则」（实际 148 条）。经全量核验：`session_fixation` 等
   每个命名空间各有 1–2 条规则（如 `logout_without_invalidate`）。方向上
   「规则很薄」成立，事实上「没有规则」不成立。
2. **「悬空状态无规则支撑」（智谱）**——`TLS_CONFIGURED` 被
   `load_tls_config`/`renew_tls_certificate` 引用，`SERVER_STARTED` 被
   `http_create_server` 引用。同一采样问题。
3. **kb_coverage 空 catch「放行」（Kimi）**——核验：catch 后 `stableCount=0`
   → `0 < 3` → **违规照常产生**，该规则实为 fail-closed（本轮已显式化）。
4. **CI gate「形同虚设」（Kimi 的「若」可以解开）**——`bin/progmune-ci.ts:208/243`
   确实调用 `evaluatePolicy` 且走退出码。OS 级 BLOCK 执行点至少两处
   （policy CLI + progmune-ci），非报告所述「仅一处」。
5. **行号偏移（Kimi）**——SUPPRESS 在 decision-engine.ts:255（报告写 195）、
   humanOverride 在 :365（报告写 310）、computeConfidence 无 transitions 分支
   在 certify.ts:228（报告写 155）。机制均属实，行号有偏移。

## 三、接受为设计边界（不与产品定位冲突，不改）

- **不拦截刻意规避**：注解驱动模型的设计目标 = AI 的「意外」协议错误。
  改名/混淆对抗不在防护目标内（任何静态工具同理）——已写入 README 边界声明。
- **指标自报**：795 金标为合成语料、三基准为自跑。第三方可复现评测
  列为企业 POC / 融资的前置条件（见下）。
- **C 未注解自动检测 F1=45.7%**：这是**已公开废弃的模式**——项目发布
  该数字的初衷正是论证转向注解驱动（真实语料 0 TP）。与当前「注解
  驱动 5/5」口径不是同一层级，不应并列比较。
- **test/demo 目录降阈值**：对「部署防线」定位是攻击面，对「辅助检查器」
  定位是合理的上下文分级（生产环境阈值更严）。

## 四、计划中

1. **printlab 业务链跨命名空间依赖**（10 条规则显式例外）——跨命名空间
   状态引用特性（协议库已有 `AUTH_FILE_GATE` 桥状态雏形）。
2. **可复现基准语料公开**——795 金标生成器 + Python 盲测语料随仓公开
   一键复现命令；企业 POC 前置条件。
3. **第二位维护者 / 独立人工审查**——自指困境（「谁来验证验证者」）的
   实质解法；`src/policy/engine.ts` 优先。
4. **证书签名**——时间戳已贯通，密码学签名待 POC 需求触发。

## 五、定位声明

两份审计的最终判定一致且我们接受：**当前形态是「有真实工程价值的辅助
检查器 + 研究项目」，不是「企业部署门禁 / 合规证据」**。治理层修复
（本批 P0/P1）已把 fail-open 路径收口，但「门禁」定位需要：第三方
评测 + 独立审查 + 企业 POC 证据。这正是路线图上的下一步，不是口号。
