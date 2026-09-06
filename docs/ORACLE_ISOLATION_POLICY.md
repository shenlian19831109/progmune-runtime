# Oracle 隔离政策——评估体系人工确认门

> 2026-09-06 · 第三份第三方审查（Hunyuan）的「定律 5」落地：
> **自我改进回路不得优化自己的评估体系；评估体系的变更必须经独立通道（人工确认）。**
> 本文档是 Progmune 的工程政策：AI 只提案，人不签字不生效。

## 一、政策陈述

Progmune 的判定可信度建立在「确定性验证器」之上。验证器的判定**依据**
（协议状态机）与判定**机制**（匹配策略、阈值、规则表）构成评估体系。
为保持 oracle 异构性（判定依据独立于被测代码与生成模型）：

1. **评估体系的四类变更，全部必须人工确认后生效；AI（或任何自动流程）只能提案。**
2. 未确认的提案不参与任何 BLOCK/WARN/ALLOW 判定，只进待确认区。
3. 每个发布版本披露 **Oracle 独立度**：人工确认绑定数 / 总绑定数。

## 二、四类变更与确认通道

| # | 变更类型 | 载体 | 提案形式 | 确认方式 | 未确认时的默认行为 |
|---|---------|------|---------|---------|------------------|
| 1 | 协议规则定义（新增/修改/删除规则、状态、invalidate） | `protocols.json` | `scripts/rule-propose.ts` → `status: proposed` | 人工改 `status: confirmed`（同 c-aliases 模式） | 加载端跳过，不参与判定 |
| 2 | 匹配策略（inferRuleName 策略序、normalize、词段门控） | `src/trust/ssg-bridge.ts` | PR + 说明策略变更的零漂移证据 | 人工 review（第二位审查者优先） | 不合并 |
| 3 | 阈值/权重（decision-engine 分数公式、BLOCK/WARN 线、环境因子） | `src/decision-engine.ts` | PR + 理由注释（为什么这个值） | 人工 review | 不合并 |
| 4 | 别名绑定（库 API → 规则名） | `c-aliases.json` / `.progmune_aliases.json` | 现有 propose 脚本 | **已有 confirmed 门** ✅ | 跳过不加载（现状） |

## 三、现状盘点（2026-09-06）

已有的人工门：

- ✅ **c-aliases**：`status: "confirmed"` 门已实现（`src/trust/ssg-bridge.ts:835-848`），
  confirmed 条目才全项目生效，propose → 人工确认 → 生效闭环完整
- ✅ **注解建议**：`annotation-suggest` 是「填空起点」，maskRisk 自动跳过，
  人工确认后手写生效——哲学与本文一致
- ✅ **自动合成器**：`auto-protocol-synthesizer` 只出报告不写盘（
  `runAutoSynthesis` 返回 SynthesisReport），无自动落盘路径

缺口（本文档生效后的待办）：

- ❌ `protocols.json` 无确认字段——直接编辑即生效（A2 待补）
- ❌ 匹配策略/阈值变更无书面政策约束（本文档即政策；第二位审查者机制挂 P3）
- ❌ Oracle 独立度指标未披露（A3 待补）

## 四、Oracle 独立度指标

```
oracleIndependence = 人工确认的绑定数 / 参与判定的绑定总数
```

- 绑定 = 规则定义 + 别名 + 注解合并（项目注解属「代码作者声明」，单独统计）
- 披露位置：`trust --json` 输出 + 发布说明
- 目标：判定生效的规则/别名 **100% 人工确认**；项目注解在报告中单列
  （其作者与代码同源，为已知边界，见 README「刻意规避」声明）

## 五、落地步骤

1. **A2**：`protocols.json` 全量规则补 `status: "confirmed"`（存量祖父入册，
   与 c-aliases 同哲学）+ 加载端只读 confirmed + 活性守卫收紧
2. **A2**：`scripts/rule-propose.ts` 提案脚手架（复用 c-alias-propose 交互模式）
3. **A3**：evaluateTrust 输出 `oracleIndependence`
4. **P3 挂账**：第二位维护者进入后，变更类型 2/3 的 review 由其承担；
   在此之前由项目负责人人工 review

## 六、与既有文档的关系

- 本文档与 `docs/AUDIT_RESPONSE_2026-09.md` 的「计划中」第 3 条（独立人工审查）互补：
  审查解决「谁来确认」，本文档解决「确认什么、不确认会怎样」
- 反馈回路的自动部分（失败语料库、知识库扩充）**不在本政策管辖内**——
  它们不改变判定标准本身；一旦未来出现「自动调整规则/阈值」的提案，
  自动落入本文档管辖并默认拒绝
