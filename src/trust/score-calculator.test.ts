/**
 * §53 / R97：决策门禁单测
 *
 * 背景（immich + nocodb 实测）：authentication 子协议 0 分（21 / 586 条违规）、
 * coverageConfidence 0% LOW、mappingCoverage 4%~8% LOW —— 三项独立的
 * 「其实没看到什么」的指标全部触底，聚合结果却仍是 83 / APPROVED / HIGH。
 *
 * 本文件的重点不是「门禁会不会触发」，而是**它会不会过冲**：
 *   - 只封顶（不许说通过），不降级（不许把 BLOCKED 抬上来、也不许把 NEEDS_REVIEW 打成 BLOCKED）
 *   - 盲区（0 条违规）不得被当成「查过且干净」加分，也不得被当成「有问题」扣分
 *   - 没有观察 ⇒ 影响的是 confidence 与 decision 上限，不是分数
 */

import { describe, it, expect } from "vitest";
import {
  scoreProtocolSafety,
  determineDecision,
  determineConfidence,
  evaluateDecisionGates,
} from "./score-calculator";
import type { TrustViolation, ProtocolSafetyScore } from "./types";

function v(ruleId: string, severity: TrustViolation["severity"] = "medium"): TrustViolation {
  return {
    rule_id: ruleId,
    severity,
    file: "src/a.ts",
    function: "handler",
    message: "test",
    evidence: "test",
    why: "test",
    fix: "test",
    policy_ref: "protocol-safety.specific",
  } as TrustViolation;
}

/** 造一个「只有 authentication 有观察」的维度（= immich 的真实形态） */
function authOnlyProtocolSafety(violationCount: number): ProtocolSafetyScore {
  return scoreProtocolSafety(Array.from({ length: violationCount }, () => v("AUTH_MISSING")));
}

describe("§53 decision gates — 观察度（protocolSafety.confidence）", () => {
  it("0 条违规的协议是 blind，不是 checked-clean（此前恒为 HIGH）", () => {
    const ps = authOnlyProtocolSafety(21);
    expect(ps.observedProtocols).toEqual(["authentication"]);
    expect(ps.blindProtocols.sort()).toEqual([
      "authorization",
      "data_integrity",
      "ledger",
      "payment",
    ]);
    // 5 个协议只有 1 个有观察 ⇒ 0.2 ⇒ LOW
    expect(ps.confidence).toBe("LOW");
  });

  it("全盲（0 违规）时分数仍为 100，但 confidence 塌到 LOW —— 不加分也不扣分", () => {
    const ps = scoreProtocolSafety([]);
    expect(ps.score).toBe(100);
    expect(ps.observedProtocols).toEqual([]);
    expect(ps.blindProtocols.length).toBe(5);
    expect(ps.confidence).toBe("LOW");
  });
});

describe("§53 decision gates — 安全维度下限", () => {
  it("已观察的安全协议塌方 ⇒ 封顶 NEEDS_REVIEW（且分数不动）", () => {
    const ps = authOnlyProtocolSafety(21);
    expect(ps.details.authentication.score).toBe(0);

    const gates = evaluateDecisionGates({ protocolSafety: ps });
    expect(gates.securityFloorBreach).toBe(true);
    expect(gates.breachedProtocols).toEqual([{ protocol: "authentication", score: 0 }]);

    // 83 分照样 APPROVED —— 门禁把它封住
    expect(determineDecision(83, false, "EXPLAINABLE", gates)).toBe("NEEDS_REVIEW");
  });

  it("反向：盲区不得触发下限（没有观察就没有扣分依据）", () => {
    const ps = scoreProtocolSafety([]);
    const gates = evaluateDecisionGates({ protocolSafety: ps });
    // 全盲：分数都是 100，本来也不会 breach；关键是 breachedProtocols 必须为空
    expect(gates.securityFloorBreach).toBe(false);
    expect(gates.breachedProtocols).toEqual([]);
  });

  it("反向：封顶不是降级 —— 低分 BLOCKED 不会被抬成 NEEDS_REVIEW", () => {
    const ps = authOnlyProtocolSafety(21);
    const gates = evaluateDecisionGates({ protocolSafety: ps });
    expect(determineDecision(30, false, "EXPLAINABLE", gates)).toBe("BLOCKED");
    expect(determineDecision(65, false, "EXPLAINABLE", gates)).toBe("NEEDS_REVIEW");
  });
});

describe("§53 decision gates — 观察度门槛", () => {
  it("coverage LOW **且可测** ⇒ observationIncomplete ⇒ decision 封顶、confidence 封顶 MEDIUM", () => {
    const ps = authOnlyProtocolSafety(1);
    const gates = evaluateDecisionGates({
      protocolSafety: ps,
      coverageLevel: "LOW",
      coverageApplicable: true,
    });
    expect(gates.observationIncomplete).toBe(true);
    expect(determineDecision(95, false, "EXPLAINABLE", gates)).toBe("NEEDS_REVIEW");
    expect(determineConfidence(["HIGH", "HIGH", "HIGH", "HIGH"], "EXPLAINABLE", true)).toBe(
      "MEDIUM"
    );
  });

  it("★ 反向（R98）：coverage LOW 但**不可测** ⇒ 不封顶 —— 没得测 ≠ 测得低", () => {
    // 实测：9 个真实 TS 项目全部没有 protocols.json ⇒ coverage 恒 0% LOW。
    // 若不区分「不适用」与「真的低」，门禁 100% 触发，连「0 违规、auth=100」
    // 的项目也被封顶（实测 6/6 全变 NEEDS_REVIEW）——那是常数不是判据。
    const ps = scoreProtocolSafety([v("AUTH_ONE")]);
    const gates = evaluateDecisionGates({
      protocolSafety: ps,
      coverageLevel: "LOW",
      coverageApplicable: false,
    });
    expect(gates.observationIncomplete).toBe(false);
    expect(gates.reasons.some((r) => r.includes("不适用"))).toBe(true);
    expect(determineDecision(95, false, "EXPLAINABLE", gates)).toBe("APPROVED");
  });

  it("★ 反向：0 违规且 auth=100 的干净项目不得被封顶（过冲防线）", () => {
    // express-realworld / koa-realworld / netflx-web 的真实形态：
    // 0 条违规、authentication=100、coverage 不可测 ⇒ 必须仍是 APPROVED。
    const ps = scoreProtocolSafety([]);
    const gates = evaluateDecisionGates({
      protocolSafety: ps,
      coverageLevel: "LOW",
      coverageApplicable: false,
    });
    expect(gates.securityFloorBreach).toBe(false);
    expect(gates.observationIncomplete).toBe(false);
    expect(determineDecision(90, false, "EXPLAINABLE", gates)).toBe("APPROVED");
  });

  it("反向：观察度充足且无塌方 ⇒ 不封顶（不许把门禁做成一律 NEEDS_REVIEW）", () => {
    const ps = scoreProtocolSafety([v("AUTH_OK_LOW")]);
    // 造一个 authentication 高分、且 5 个协议都有观察的形态
    const allObserved: ProtocolSafetyScore = {
      ...ps,
      observedProtocols: ["authentication", "authorization", "payment", "data_integrity", "ledger"],
      blindProtocols: [],
      confidence: "HIGH",
    };
    const gates = evaluateDecisionGates({
      protocolSafety: allObserved,
      coverageLevel: "HIGH",
      coverageApplicable: true,
    });
    expect(gates.securityFloorBreach).toBe(false);
    expect(gates.observationIncomplete).toBe(false);
    expect(gates.reasons).toEqual([]);
    expect(determineDecision(95, false, "EXPLAINABLE", gates)).toBe("APPROVED");
  });
});

describe("§53 decision gates — 硬门优先级", () => {
  it("critical 仍然压过一切（门禁不得削弱 BLOCKED）", () => {
    const ps = authOnlyProtocolSafety(21);
    const gates = evaluateDecisionGates({ protocolSafety: ps });
    expect(determineDecision(95, true, "EXPLAINABLE", gates)).toBe("BLOCKED");
  });

  it("门禁为 undefined 时行为与改动前完全一致（向后兼容）", () => {
    expect(determineDecision(95, false, "EXPLAINABLE")).toBe("APPROVED");
    expect(determineDecision(70, false, "EXPLAINABLE")).toBe("NEEDS_REVIEW");
    expect(determineDecision(30, false, "EXPLAINABLE")).toBe("BLOCKED");
  });
});
