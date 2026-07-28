/**
 * Progmune V8 — Belief Layer
 * ===========================
 * Proof 回答 "能否从前提推导出来？" → 形式逻辑，无概率。
 * Belief 回答 "我们有多相信它？"    → 独立证据融合，有概率。
 *
 * 两者永远分离。
 *
 * Belief 来源（独立）:
 *   1. Derivation Depth  — 推导链越深，信念越低（多步推导增加出错概率）
 *   2. Refutation Status — 被反例驳倒 → 信念骤降
 *   3. Git History       — 代码变更频繁的区域，不变量可能已过时
 *   4. Cross-domain Match — 同一模式在多个域中出现 → 更可信
 *   5. Logic Type        — FORBIDS（直接来自状态机声明）比 REQUIRES（推断的）更可靠
 *   6. Human Label       — 人工标注（未来）
 *
 * 组合方法: 每个来源独立给出 mass 分配，Dempster 规则融合。
 * 没有预设权重。信任度从证据之间的互动中涌现。
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

/** A single belief source — one independent perspective */
interface BeliefSource {
  name: string;                    // e.g. "derivation_depth", "git_history"
  massFor: number;                 // 0-1: belief that invariant IS correct
  massAgainst: number;            // 0-1: belief that invariant IS NOT correct
  massUncertain: number;          // 0-1: uncommitted belief
  reasoning: string;              // Why this source gives this mass
}

/** A belief assessment — overlays a provenanced invariant with independent belief */
interface BeliefAssessment {
  invariantId: string;
  predicate: string;
  domain: string;
  logicType: string;
  isRefuted: boolean;
  sources: BeliefSource[];
  // Dempster combination result
  combinedBelief: number;         // 0-1: combined belief FOR
  combinedDisbelief: number;      // 0-1: combined belief AGAINST
  combinedUncertainty: number;    // 0-1: remaining uncertainty
  // Interpretation
  beliefLevel: "HIGH" | "MEDIUM" | "LOW" | "REFUTED";
  explanation: string;
}

/** The complete belief report */
interface BeliefReport {
  timestamp: string;
  assessments: BeliefAssessment[];
  summary: {
    total: number;
    highBelief: number;
    mediumBelief: number;
    lowBelief: number;
    refuted: number;
    averageBelief: number;
  };
}

// ══════════════════════════════════════════════
// BELIEF SOURCES — each is independent
// ══════════════════════════════════════════════

/**
 * Source 1: Derivation Depth
 * 推导链越深，每一步都引入不确定性。OBSERVATION 直接来自代码 → 高信念。
 * 传递闭包推导 → 中信念（两步推导）。
 */
function sourceDerivationDepth(inv: any): BeliefSource {
  const depth = inv.derivationDepth || 1;
  if (depth <= 1) {
    return {
      name: "derivation_depth",
      massFor: 0.85,
      massAgainst: 0.05,
      massUncertain: 0.10,
      reasoning: `推导深度=${depth}（直接来自代码）→ 高信念`,
    };
  } else if (depth === 2) {
    return {
      name: "derivation_depth",
      massFor: 0.60,
      massAgainst: 0.15,
      massUncertain: 0.25,
      reasoning: `推导深度=${depth}（经过一次传递闭包）→ 中信念`,
    };
  } else {
    return {
      name: "derivation_depth",
      massFor: 0.40,
      massAgainst: 0.25,
      massUncertain: 0.35,
      reasoning: `推导深度=${depth}（多步推导）→ 低信念`,
    };
  }
}

/**
 * Source 2: Refutation Status
 * 被 V6 BFS 反例驳倒 → 强反对。
 * 未被驳倒但属于被驳倒的同一个域 → 轻微不确定。
 */
function sourceRefutation(inv: any): BeliefSource {
  if (inv.isRefuted) {
    return {
      name: "refutation_status",
      massFor: 0.0,
      massAgainst: 0.98,
      massUncertain: 0.02,
      reasoning: "V6 BFS 找到了绕过此不变量的具体路径 → 反例是决定性证据",
    };
  }
  return {
    name: "refutation_status",
    massFor: 0.70,
    massAgainst: 0.05,
    massUncertain: 0.25,
    reasoning: "V6 BFS 未找到反例 → 支持（但非穷举验证）",
  };
}

/**
 * Source 3: Logic Type
 * FORBIDS 直接来自状态机的 invalidTransitions → 最高信念。
 * REQUIRES 是推断的 → 中信念。
 * TERMINAL/UNIQUE/INITIAL 来自结构属性 → 中高信念。
 */
function sourceLogicType(inv: any): BeliefSource {
  switch (inv.logicType) {
    case "FORBIDS":
      return {
        name: "logic_type",
        massFor: 0.90,
        massAgainst: 0.02,
        massUncertain: 0.08,
        reasoning: "FORBIDS — 直接来自状态机声明的非法转移 → 极高信念",
      };
    case "TERMINAL":
    case "INITIAL":
      return {
        name: "logic_type",
        massFor: 0.80,
        massAgainst: 0.05,
        massUncertain: 0.15,
        reasoning: `${inv.logicType} — 来自状态机结构属性 → 高信念`,
      };
    case "UNIQUE":
      return {
        name: "logic_type",
        massFor: 0.70,
        massAgainst: 0.10,
        massUncertain: 0.20,
        reasoning: "UNIQUE — 模板匹配，需领域确认 → 中高信念",
      };
    case "REQUIRES":
      return {
        name: "logic_type",
        massFor: 0.50,
        massAgainst: 0.20,
        massUncertain: 0.30,
        reasoning: "REQUIRES — 从转移边推断的先决关系，可能被捷径绕过 → 中信念",
      };
    default:
      return {
        name: "logic_type",
        massFor: 0.40,
        massAgainst: 0.20,
        massUncertain: 0.40,
        reasoning: "未知类型 → 高不确定性",
      };
  }
}

/**
 * Source 4: Git History Freshness
 * 包含该不变量相关代码的文件最近被修改过 → 不变量可能过时。
 * 使用真实的 git log 数据。
 */
function sourceGitHistory(inv: any, projectPath: string): BeliefSource {
  const domain = (inv.domain || "").toLowerCase();
  // Map domain to likely source files
  const domainFiles: Record<string, string[]> = {
    "order_suppliers": ["server/order-logistics-router.ts", "server/order-payment-router.ts", "drizzle/schema.ts"],
    "share_links": ["server/share-db.ts", "server/share-router.ts"],
    "points_log": ["server/db.ts", "drizzle/schema.ts"],
    "notifications": ["server/notifications-db.ts", "server/notifications-router.ts"],
  };

  const files = domainFiles[domain] || [];
  let daysSinceLastChange = 999;

  try {
    for (const file of files) {
      const fullPath = path.join(projectPath, file);
      if (fs.existsSync(fullPath)) {
        const log = execSync(
          `git log -1 --format="%ct" -- "${file}"`,
          { cwd: projectPath, encoding: "utf-8", timeout: 5000 }
        ).trim();
        if (log) {
          const lastChange = new Date(parseInt(log) * 1000);
          const days = Math.floor((Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24));
          daysSinceLastChange = Math.min(daysSinceLastChange, days);
        }
      }
    }
  } catch {
    // git not available
  }

  if (daysSinceLastChange <= 7) {
    return {
      name: "git_history",
      massFor: 0.55,
      massAgainst: 0.15,
      massUncertain: 0.30,
      reasoning: `相关文件 ${daysSinceLastChange} 天前修改 → 不变量可能仍准确，存在过时风险`,
    };
  } else if (daysSinceLastChange <= 30) {
    return {
      name: "git_history",
      massFor: 0.70,
      massAgainst: 0.05,
      massUncertain: 0.25,
      reasoning: `相关文件 ${daysSinceLastChange} 天前修改 → 不变量基本稳定`,
    };
  } else if (daysSinceLastChange < 900) {
    return {
      name: "git_history",
      massFor: 0.80,
      massAgainst: 0.03,
      massUncertain: 0.17,
      reasoning: `相关文件 ${daysSinceLastChange} 天前修改 → 不变量高度稳定`,
    };
  } else {
    return {
      name: "git_history",
      massFor: 0.50,
      massAgainst: 0.05,
      massUncertain: 0.45,
      reasoning: "无 git 历史数据 → 高不确定性",
    };
  }
}

/**
 * Source 5: Cross-domain Pattern Match
 * 同一条不变量模式在多个域中出现 → 更可信。
 */
function sourceCrossDomain(inv: any, allInvariants: any[]): BeliefSource {
  const pred = (inv.predicate || "").toLowerCase();
  // Extract the pattern: "shipped ⇒ pending" → pattern is "X ⇒ Y"
  const pattern = pred.replace(/\w+/g, "X");

  // Count how many other invariants share the same logic structure
  const samePattern = allInvariants.filter((other: any) => {
    if (other.id === inv.id) return false;
    const otherPred = (other.predicate || "").toLowerCase();
    const otherPattern = otherPred.replace(/\w+/g, "X");
    return otherPattern === pattern && other.domain !== inv.domain;
  });

  if (samePattern.length >= 3) {
    return {
      name: "cross_domain",
      massFor: 0.75,
      massAgainst: 0.05,
      massUncertain: 0.20,
      reasoning: `相同模式在 ${samePattern.length} 个其他域中出现 → 跨域一致性强`,
    };
  } else if (samePattern.length >= 1) {
    return {
      name: "cross_domain",
      massFor: 0.60,
      massAgainst: 0.10,
      massUncertain: 0.30,
      reasoning: `相同模式在 ${samePattern.length} 个其他域中出现 → 有一定跨域支持`,
    };
  }
  return {
    name: "cross_domain",
    massFor: 0.45,
    massAgainst: 0.10,
    massUncertain: 0.45,
    reasoning: "此模式仅在当前域出现 → 无法跨域验证",
  };
}

// ══════════════════════════════════════════════
// DEMPSTER-SHAFER COMBINATION
// ══════════════════════════════════════════════

/**
 * Combine two independent belief masses using Dempster's rule.
 *
 * Dempster combination:
 *   m₁₂(A) = (1 / (1 - K)) × Σ_{B∩C=A} m₁(B) × m₂(C)
 *   where K = Σ_{B∩C=∅} m₁(B) × m₂(C)  (conflict mass)
 *
 * For our binary frame {FOR, AGAINST}:
 *   K = m₁(FOR)×m₂(AGAINST) + m₁(AGAINST)×m₂(FOR)
 *
 *   m₁₂(FOR)       = (m₁(FOR)×m₂(FOR) + m₁(FOR)×m₂(UNCERTAIN) + m₁(UNCERTAIN)×m₂(FOR)) / (1-K)
 *   m₁₂(AGAINST)   = (m₁(AGAINST)×m₂(AGAINST) + m₁(AGAINST)×m₂(UNCERTAIN) + m₁(UNCERTAIN)×m₂(AGAINST)) / (1-K)
 *   m₁₂(UNCERTAIN) = (m₁(UNCERTAIN)×m₂(UNCERTAIN)) / (1-K)
 */
function dempsterCombine(sources: BeliefSource[]): { beliefFor: number; beliefAgainst: number; uncertainty: number } {
  if (sources.length === 0) {
    return { beliefFor: 0, beliefAgainst: 0, uncertainty: 1.0 };
  }

  // Start with the first source
  let mFor = sources[0].massFor;
  let mAgainst = sources[0].massAgainst;
  let mUncertain = sources[0].massUncertain;

  // Combine with each subsequent source
  for (let i = 1; i < sources.length; i++) {
    const s = sources[i];

    // Conflict mass K
    const K = mFor * s.massAgainst + mAgainst * s.massFor;

    if (K >= 1.0) {
      // Total conflict — sources completely disagree
      // Fall back to averaging (DS breaks down under total conflict)
      mFor = (mFor + s.massFor) / 2;
      mAgainst = (mAgainst + s.massAgainst) / 2;
      mUncertain = (mUncertain + s.massUncertain) / 2;
    } else {
      // Dempster combination
      const norm = 1.0 / (1.0 - K);
      mFor = (mFor * s.massFor + mFor * s.massUncertain + mUncertain * s.massFor) * norm;
      mAgainst = (mAgainst * s.massAgainst + mAgainst * s.massUncertain + mUncertain * s.massAgainst) * norm;
      mUncertain = (mUncertain * s.massUncertain) * norm;
    }
  }

  // Clamp to [0, 1]
  return {
    beliefFor: Math.max(0, Math.min(1, mFor)),
    beliefAgainst: Math.max(0, Math.min(1, mAgainst)),
    uncertainty: Math.max(0, Math.min(1, mUncertain)),
  };
}

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

export function buildBeliefLayer(projectPath: string): BeliefReport {
  console.log("🔬 Progmune Belief Layer — V8");
  console.log("   Project:", projectPath);

  const provenancePath = path.join(projectPath, ".progmune_provenance.json");
  if (!fs.existsSync(provenancePath)) {
    console.log("   Run V7 first: npx ts-node src/proof-provenance.ts");
    return { timestamp: new Date().toISOString(), assessments: [], summary: { total: 0, highBelief: 0, mediumBelief: 0, lowBelief: 0, refuted: 0, averageBelief: 0 } };
  }

  const v7 = JSON.parse(fs.readFileSync(provenancePath, "utf-8"));
  const allInvariants = v7.invariants || [];

  console.log(`   Loaded ${allInvariants.length} provenanced invariants from V7`);

  const assessments: BeliefAssessment[] = [];

  for (const inv of allInvariants) {
    // Gather all independent belief sources
    const sources: BeliefSource[] = [
      sourceDerivationDepth(inv),
      sourceRefutation(inv),
      sourceLogicType(inv),
      sourceGitHistory(inv, projectPath),
      sourceCrossDomain(inv, allInvariants),
    ];

    // Dempster combination
    let { beliefFor, beliefAgainst, uncertainty } = dempsterCombine(sources);

    // Post-processing: refutation is definitive. If V6 found a concrete
    // counterexample, the invariant is falsified regardless of other sources.
    // Cross-domain pattern may still be valid, but THIS specific invariant is wrong.
    if (inv.isRefuted) {
      beliefFor = Math.min(beliefFor, 0.15);  // Pin to ≤15%
      beliefAgainst = Math.max(beliefAgainst, 0.80);
    }

    // Determine belief level
    let beliefLevel: BeliefAssessment["beliefLevel"];
    if (inv.isRefuted) {
      beliefLevel = "REFUTED";
    } else if (beliefFor >= 0.75) {
      beliefLevel = "HIGH";
    } else if (beliefFor >= 0.50) {
      beliefLevel = "MEDIUM";
    } else {
      beliefLevel = "LOW";
    }

    // Generate explanation
    const explanationParts: string[] = [];
    if (inv.isRefuted) {
      explanationParts.push(`REFUTED by V6: ${inv.counterexampleExplanation || "counterexample found"}`);
    }
    if (beliefLevel === "HIGH") {
      explanationParts.push("多个独立证据源一致支持 → 高信念");
    } else if (beliefLevel === "MEDIUM") {
      const conflicts = sources.filter(s => s.massAgainst > 0.15);
      if (conflicts.length > 0) {
        explanationParts.push(`证据部分冲突: ${conflicts.map(s => s.name).join(", ")} → 中信念`);
      } else {
        explanationParts.push("证据支持但不确定性较高 → 中信念");
      }
    } else if (beliefLevel === "LOW") {
      explanationParts.push("证据弱或不一致 → 低信念，建议人工确认");
    }

    assessments.push({
      invariantId: inv.id,
      predicate: inv.predicate,
      domain: inv.domain,
      logicType: inv.logicType,
      isRefuted: inv.isRefuted || false,
      sources,
      combinedBelief: Math.round(beliefFor * 100),
      combinedDisbelief: Math.round(beliefAgainst * 100),
      combinedUncertainty: Math.round(uncertainty * 100),
      beliefLevel,
      explanation: explanationParts.join("; "),
    });
  }

  // Compute summary
  const highBelief = assessments.filter(a => a.beliefLevel === "HIGH").length;
  const mediumBelief = assessments.filter(a => a.beliefLevel === "MEDIUM").length;
  const lowBelief = assessments.filter(a => a.beliefLevel === "LOW").length;
  const refuted = assessments.filter(a => a.beliefLevel === "REFUTED").length;
  const avgBelief = Math.round(assessments.reduce((s, a) => s + a.combinedBelief, 0) / assessments.length);

  // Print details
  console.log(`\n   Belief Distribution:`);
  console.log(`   HIGH:     ${highBelief} invariants  (≥75% belief)`);
  console.log(`   MEDIUM:   ${mediumBelief} invariants  (50-74%)`);
  console.log(`   LOW:      ${lowBelief} invariants  (<50%)`);
  console.log(`   REFUTED:  ${refuted} invariants`);

  // Show the most interesting cases
  console.log("\n   ── REFUTED invariants (belief collapsed) ──");
  for (const a of assessments.filter(a => a.beliefLevel === "REFUTED")) {
    console.log(`   ❌ ${a.predicate}`);
    console.log(`      Belief: ${a.combinedBelief}% | Disbelief: ${a.combinedDisbelief}% | Uncertainty: ${a.combinedUncertainty}%`);
    console.log(`      ${a.explanation}`);
    for (const s of a.sources) {
      console.log(`        ${s.name}: FOR=${(s.massFor*100).toFixed(0)}% AGAINST=${(s.massAgainst*100).toFixed(0)}% UNCERTAIN=${(s.massUncertain*100).toFixed(0)}% — ${s.reasoning}`);
    }
  }

  console.log("\n   ── HIGH belief invariants (strong consensus) ──");
  for (const a of assessments.filter(a => a.beliefLevel === "HIGH").slice(0, 3)) {
    console.log(`   ✅ ${a.predicate} [${a.combinedBelief}% belief, ${a.combinedUncertainty}% uncertainty]`);
    console.log(`      ${a.explanation}`);
  }

  console.log("\n   ── LOW belief invariants (needs human review) ──");
  for (const a of assessments.filter(a => a.beliefLevel === "LOW").slice(0, 3)) {
    console.log(`   ⚠️  ${a.predicate} [${a.combinedBelief}% belief, ${a.combinedUncertainty}% uncertainty]`);
    console.log(`      ${a.explanation}`);
  }

  const report: BeliefReport = {
    timestamp: new Date().toISOString(),
    assessments,
    summary: { total: assessments.length, highBelief, mediumBelief, lowBelief, refuted, averageBelief: avgBelief },
  };

  return report;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/belief-layer.ts <project-path>");
    process.exit(1);
  }

  const report = buildBeliefLayer(targetProject);

  const outputPath = path.join(targetProject, ".progmune_belief.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Belief report saved to: ${outputPath}`);

  console.log("\n═══ Belief Layer Summary ═══");
  console.log(`  Total:          ${report.summary.total}`);
  console.log(`  HIGH belief:    ${report.summary.highBelief}`);
  console.log(`  MEDIUM belief:  ${report.summary.mediumBelief}`);
  console.log(`  LOW belief:     ${report.summary.lowBelief}`);
  console.log(`  REFUTED:        ${report.summary.refuted}`);
  console.log(`  Average belief: ${report.summary.averageBelief}%`);
  console.log();
}
