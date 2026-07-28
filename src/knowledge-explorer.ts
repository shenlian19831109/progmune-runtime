/**
 * Progmune V10 — Knowledge Explorer
 * ==================================
 * 系统不再只验证已有命题，而是主动生成待验证的命题。
 *
 * Question 来源（从最自然的开始）:
 *   1. Graph Topology Gaps — 知识图上的孤立节点和缺失边
 *   2. Knowledge Conflicts — CONFLICTING 状态触发追问
 *   3. Structural Incompleteness — 状态机中的传递缺口
 *
 * 流程:
 *   Question → Hypothesis Generator → Candidate Claims
 *   → Proof (verify) → Counterexample (refute) → Belief (evaluate)
 *   → Retain or Discard → Knowledge Completion
 */

import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

interface Question {
  id: string;
  text: string;              // Human-readable: "Does shipped require paid?"
  source: "GRAPH_GAP" | "CONFLICT" | "INCOMPLETENESS" | "TRANSITIVE_HOLE";
  domain: string;
  entities: string[];        // Which atoms are involved
  generatedAt: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
}

interface Hypothesis {
  id: string;
  questionId: string;
  claim: string;             // e.g. "shipped ⇒ paid"
  reasoning: string;         // Why this is a plausible hypothesis
  source: "TRANSITIVE_CHAIN" | "GRAPH_NEIGHBOR" | "DOMAIN_TEMPLATE" | "SYMMETRY";
  confidence: number;        // Prior confidence before verification
}

interface VerificationResult {
  hypothesisId: string;
  claim: string;
  // Proof check
  proofExists: boolean;      // Can we construct a derivation?
  proofChain: string[];       // IDs of supporting claims
  // Counterexample check
  hasCounterexample: boolean;
  counterexamplePath?: string[];
  // Belief assessment
  beliefScore: number;
  beliefLevel: "HIGH" | "MEDIUM" | "LOW";
  // Decision
  verdict: "RETAIN" | "DISCARD" | "NEEDS_HUMAN";
  explanation: string;
}

interface ExplorerReport {
  timestamp: string;
  questions: Question[];
  hypotheses: Hypothesis[];
  verifications: VerificationResult[];
  summary: {
    questionsGenerated: number;
    hypothesesGenerated: number;
    retained: number;
    discarded: number;
    needsHuman: number;
  };
}

// ══════════════════════════════════════════════
// L1: QUESTION GENERATOR — From Graph Topology
// ══════════════════════════════════════════════

/**
 * Generate questions from the Knowledge Graph's structural properties.
 *
 * Source 1: GRAPH_GAP
 *   For every pair of states (A, B) in a state machine,
 *   if there is no claim about their relationship (neither A⇒B nor B⇒A nor ¬(A→B)),
 *   generate: "What is the relationship between A and B?"
 *
 * Source 2: CONFLICT
 *   For every CONFLICTING claim, generate: "Why is this claim conflicting?
 *   Is the invariant wrong, or is the state machine incomplete?"
 *
 * Source 3: TRANSITIVE_HOLE
 *   If we have A⇒B and B⇒C as claims, but no claim for A⇒C,
 *   generate: "Does A require C?" (this is the transitive closure question)
 */
function generateQuestions(
  claims: any[],
  stateMachines: any[]
): Question[] {
  const questions: Question[] = [];
  let qId = 1;

  // ── Source 1: GRAPH_GAP ──
  // For each state machine, find pairs of states with no defined relationship
  for (const machine of stateMachines) {
    const states = (machine.states || []).map((s: string) => s.toLowerCase());
    const domain = machine.entity;

    // Get all existing claims about this domain's states
    const domainClaims = claims.filter((c: any) =>
      c.domain === domain ||
      domain.includes(c.domain) ||
      c.domain.includes(domain)
    );

    // Build the set of known relationships
    const knownRelations = new Set<string>();
    for (const c of domainClaims) {
      const pred = (c.claim || c.predicate || "").toLowerCase();
      const implies = pred.match(/(\w+)\s*⇒\s*(\w+)/);
      const forbids = pred.match(/¬\((\w+)\s*→\s*(\w+)\)/);
      if (implies) {
        knownRelations.add(`${implies[1]}⇒${implies[2]}`);
      }
      if (forbids) {
        knownRelations.add(`¬(${forbids[1]}→${forbids[2]})`);
      }
    }

    // For every pair of states, check if relationship is known
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        const a = states[i];
        const b = states[j];

        const hasAB = knownRelations.has(`${a}⇒${b}`) || knownRelations.has(`¬(${a}→${b})`);
        const hasBA = knownRelations.has(`${b}⇒${a}`) || knownRelations.has(`¬(${b}→${a})`);

        if (!hasAB && !hasBA && a !== b) {
          questions.push({
            id: `Q-${qId++}`,
            text: `${a} 和 ${b} 之间是否存在先决关系？`,
            source: "GRAPH_GAP",
            domain,
            entities: [a, b],
            generatedAt: new Date().toISOString(),
            priority: "MEDIUM",
          });
        }
      }
    }
  }

  // ── Source 2: CONFLICT ──
  const conflicting = claims.filter((c: any) => c.status === "CONFLICTING");
  for (const c of conflicting) {
    questions.push({
      id: `Q-${qId++}`,
      text: `为什么 "${c.claim || c.predicate}" 存在证据冲突？不变量错了还是状态机有缺口？`,
      source: "CONFLICT",
      domain: c.domain,
      entities: [],
      generatedAt: new Date().toISOString(),
      priority: "HIGH",
    });
  }

  // ── Source 3: TRANSITIVE_HOLE ──
  const requiresClaims = claims.filter((c: any) =>
    (c.logicType === "REQUIRES" || (c.claim || c.predicate || "").includes("⇒")) &&
    c.status !== "REFUTED" && c.status !== "CONFLICTING"
  );

  for (const c1 of requiresClaims) {
    const m1 = (c1.claim || c1.predicate || "").match(/(\w+)\s*⇒\s*(\w+)/);
    if (!m1) continue;
    const a = m1[1].toLowerCase();
    const b = m1[2].toLowerCase();

    for (const c2 of requiresClaims) {
      if (c1.id === c2.id) continue;
      const m2 = (c2.claim || c2.predicate || "").match(/(\w+)\s*⇒\s*(\w+)/);
      if (!m2) continue;
      const b2 = m2[1].toLowerCase();
      const c = m2[2].toLowerCase();

      // Chain: A⇒B and B⇒C → check if A⇒C exists
      if (b === b2 && a !== c) {
        const alreadyExists = requiresClaims.some((existing: any) => {
          const m = (existing.claim || existing.predicate || "").match(/(\w+)\s*⇒\s*(\w+)/);
          return m && m[1].toLowerCase() === a && m[2].toLowerCase() === c;
        });

        if (!alreadyExists) {
          // Don't duplicate
          const alreadyAsked = questions.some(q =>
            q.source === "TRANSITIVE_HOLE" &&
            q.entities.includes(a) && q.entities.includes(c)
          );
          if (!alreadyAsked) {
            questions.push({
              id: `Q-${qId++}`,
              text: `${a} 是否要求 ${c}？（通过 ${b} 传递）`,
              source: "TRANSITIVE_HOLE",
              domain: c1.domain,
              entities: [a, b, c],
              generatedAt: new Date().toISOString(),
              priority: "HIGH",
            });
          }
        }
      }
    }
  }

  return questions;
}

// ══════════════════════════════════════════════
// L2: HYPOTHESIS GENERATOR
// ══════════════════════════════════════════════

/**
 * For each question, generate candidate hypotheses.
 *
 * TRANSITIVE_HOLE: "Does A require C (via B)?"
 *   → Hypothesis: "A ⇒ C" (derived from A⇒B and B⇒C via transitivity)
 *
 * GRAPH_GAP: "What is the relationship between A and B?"
 *   → Hypothesis 1: "A ⇒ B"
 *   → Hypothesis 2: "B ⇒ A"
 *   → For each, check if it's plausible based on graph neighborhood
 *
 * CONFLICT: "Why is this conflicting?"
 *   → Hypothesis: re-state the existing claim for re-verification
 */
function generateHypotheses(
  questions: Question[],
  claims: any[]
): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];
  let hId = 1;

  // Index existing claims by their atoms for quick lookup
  const claimIndex = new Map<string, any[]>();
  for (const c of claims) {
    const pred = (c.claim || c.predicate || "").toLowerCase();
    const m = pred.match(/(\w+)\s*⇒\s*(\w+)/);
    if (m) {
      const key = `${m[1]}⇒${m[2]}`;
      if (!claimIndex.has(key)) claimIndex.set(key, []);
      claimIndex.get(key)!.push(c);
    }
  }

  for (const q of questions) {
    switch (q.source) {
      case "TRANSITIVE_HOLE": {
        // "Does A require C (via B)?"
        const [a, b, c] = q.entities;
        // Hypothesis: A ⇒ C
        hypotheses.push({
          id: `H-${hId++}`,
          questionId: q.id,
          claim: `${a} ⇒ ${c}`,
          reasoning: `传递链: ${a}⇒${b} 且 ${b}⇒${c}，因此 ${a}⇒${c} 可能成立`,
          source: "TRANSITIVE_CHAIN",
          confidence: 60, // Prior: transitivity is sound but premises might be noisy
        });
        break;
      }

      case "GRAPH_GAP": {
        // "What is the relationship between A and B?"
        const [a, b] = q.entities;

        // Hypothesis 1: A ⇒ B
        // Check if A has other outgoing prerequisites (suggests A is "later" in lifecycle)
        const aOutgoing = claims.filter((c: any) => {
          const m = (c.claim || c.predicate || "").match(/(\w+)\s*⇒\s*(\w+)/);
          return m && m[1].toLowerCase() === a;
        });
        const bOutgoing = claims.filter((c: any) => {
          const m = (c.claim || c.predicate || "").match(/(\w+)\s*⇒\s*(\w+)/);
          return m && m[1].toLowerCase() === b;
        });

        // Heuristic: the state with MORE outgoing prerequisites is "later" (more dependent)
        // The later state should require the earlier state
        if (bOutgoing.length > aOutgoing.length) {
          hypotheses.push({
            id: `H-${hId++}`,
            questionId: q.id,
            claim: `${b} ⇒ ${a}`,
            reasoning: `${b} 有 ${bOutgoing.length} 个先决条件，${a} 有 ${aOutgoing.length} 个。${b} 更可能是后置状态。`,
            source: "GRAPH_NEIGHBOR",
            confidence: 40,
          });
        } else if (aOutgoing.length > bOutgoing.length) {
          hypotheses.push({
            id: `H-${hId++}`,
            questionId: q.id,
            claim: `${a} ⇒ ${b}`,
            reasoning: `${a} 有 ${aOutgoing.length} 个先决条件，${b} 有 ${bOutgoing.length} 个。${a} 更可能是后置状态。`,
            source: "GRAPH_NEIGHBOR",
            confidence: 40,
          });
        } else {
          // Both have similar outgoing counts — try both directions
          hypotheses.push({
            id: `H-${hId++}`,
            questionId: q.id,
            claim: `${a} ⇒ ${b}`,
            reasoning: `图结构无法确定方向，试探性假设 ${a}⇒${b}`,
            source: "GRAPH_NEIGHBOR",
            confidence: 25,
          });
          hypotheses.push({
            id: `H-${hId++}`,
            questionId: q.id,
            claim: `${b} ⇒ ${a}`,
            reasoning: `图结构无法确定方向，试探性假设 ${b}⇒${a}`,
            source: "GRAPH_NEIGHBOR",
            confidence: 25,
          });
        }
        break;
      }

      case "CONFLICT": {
        // Re-state the conflicting claim as a hypothesis for re-verification
        const conflictingClaim = claims.find((c: any) =>
          c.status === "CONFLICTING" && c.domain === q.domain
        );
        if (conflictingClaim) {
          hypotheses.push({
            id: `H-${hId++}`,
            questionId: q.id,
            claim: conflictingClaim.claim || conflictingClaim.predicate,
            reasoning: "重新验证冲突的不变量——检查是否有新的证据改变结论",
            source: "DOMAIN_TEMPLATE",
            confidence: 50,
          });
        }
        break;
      }
    }
  }

  return hypotheses;
}

// ══════════════════════════════════════════════
// L3: VERIFICATION — Proof + Counterexample + Belief
// ══════════════════════════════════════════════

/**
 * Verify each hypothesis against the existing knowledge.
 *
 * For a hypothesis "A ⇒ C":
 *   1. Proof: can we derive it from existing claims via transitivity?
 *   2. Counterexample: does the state machine allow A without C?
 *   3. Belief: what do the independent evidence sources say?
 */
function verifyHypotheses(
  hypotheses: Hypothesis[],
  claims: any[],
  stateMachines: any[]
): VerificationResult[] {
  const results: VerificationResult[] = [];

  // Index valid transitions for counterexample checking
  const machineTransitions = new Map<string, Set<string>>();
  for (const machine of stateMachines) {
    const validSet = new Set<string>();
    for (const vt of machine.validTransitions || []) {
      validSet.add(vt.toLowerCase());
    }
    machineTransitions.set(machine.entity, validSet);
  }

  for (const hyp of hypotheses) {
    const m = hyp.claim.match(/(\w+)\s*⇒\s*(\w+)/);
    if (!m) continue;
    const a = m[1].toLowerCase();
    const c = m[2].toLowerCase();

    // ── Proof check: can we derive A⇒C from existing claims? ──
    const existingAB = claims.filter((cl: any) => {
      const pred = (cl.claim || cl.predicate || "").toLowerCase();
      const pm = pred.match(/(\w+)\s*⇒\s*(\w+)/);
      return pm && pm[2].toLowerCase() === c;
    });

    const existingBC = claims.filter((cl: any) => {
      const pred = (cl.claim || cl.predicate || "").toLowerCase();
      const pm = pred.match(/(\w+)\s*⇒\s*(\w+)/);
      return pm && pm[1].toLowerCase() === a;
    });

    const proofExists = existingAB.length > 0 || existingBC.length > 0;
    const proofChain = [
      ...existingAB.map((cl: any) => cl.id),
      ...existingBC.map((cl: any) => cl.id),
    ];

    // ── Counterexample check: does any state machine allow A without C? ──
    let hasCounterexample = false;
    let cePath: string[] | undefined;

    for (const [domain, validTransitions] of machineTransitions) {
      // Simple check: is there a direct transition to A from any state that is NOT C?
      for (const vt of validTransitions) {
        const [from, to] = vt.split("→");
        if (to === a && from !== c) {
          hasCounterexample = true;
          cePath = [from, to];
          break;
        }
      }
      if (hasCounterexample) break;
    }

    // ── Belief assessment (simplified) ──
    let beliefScore: number;
    let beliefLevel: "HIGH" | "MEDIUM" | "LOW";

    if (hasCounterexample) {
      beliefScore = 15;
      beliefLevel = "LOW";
    } else if (proofExists) {
      beliefScore = hyp.confidence + 20;
      beliefLevel = beliefScore >= 75 ? "HIGH" : "MEDIUM";
    } else {
      beliefScore = hyp.confidence;
      beliefLevel = beliefScore >= 50 ? "MEDIUM" : "LOW";
    }

    // ── Verdict ──
    let verdict: VerificationResult["verdict"];
    let explanation: string;

    if (hasCounterexample) {
      verdict = "DISCARD";
      explanation = `存在反例：${cePath?.join(" → ")} 绕过了 ${c}。假设不成立。`;
    } else if (proofExists && beliefScore >= 60) {
      verdict = "RETAIN";
      explanation = `可通过 ${proofChain.join(", ")} 推导。置信度 ${beliefScore}%。`;
    } else if (proofExists) {
      verdict = "NEEDS_HUMAN";
      explanation = `推导成立但置信度不足（${beliefScore}%）。建议人工确认。`;
    } else {
      verdict = "NEEDS_HUMAN";
      explanation = `无法从现有知识推导。需要额外证据。`;
    }

    results.push({
      hypothesisId: hyp.id,
      claim: hyp.claim,
      proofExists,
      proofChain,
      hasCounterexample,
      counterexamplePath: cePath,
      beliefScore,
      beliefLevel,
      verdict,
      explanation,
    });
  }

  return results;
}

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

export function explore(projectPath: string): ExplorerReport {
  console.log("🔬 Progmune Knowledge Explorer — V10");
  console.log("   Project:", projectPath);

  const kbPath = path.join(projectPath, ".progmune_knowledge.json");
  const statePath = path.join(projectPath, ".progmune_state_machines.json");

  if (!fs.existsSync(kbPath)) {
    console.log("   Run V9 first: npx ts-node src/knowledge-object.ts");
    return { timestamp: new Date().toISOString(), questions: [], hypotheses: [], verifications: [], summary: { questionsGenerated: 0, hypothesesGenerated: 0, retained: 0, discarded: 0, needsHuman: 0 } };
  }

  const kb = JSON.parse(fs.readFileSync(kbPath, "utf-8"));
  const states = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf-8")) : { machines: [] };

  const claims = kb.claims || [];
  const machines = states.machines || [];

  console.log(`   Loaded ${claims.length} claims, ${machines.length} state machines`);

  // ── L1: Generate Questions ──
  console.log("\nL1 · Generating Questions...");
  const questions = generateQuestions(claims, machines);

  const bySource: Record<string, number> = {};
  for (const q of questions) { bySource[q.source] = (bySource[q.source] || 0) + 1; }
  console.log(`   ${questions.length} questions generated`);
  for (const [src, count] of Object.entries(bySource)) {
    console.log(`     ${src}: ${count}`);
  }

  // Show top questions
  for (const q of questions.filter(q => q.priority === "HIGH").slice(0, 3)) {
    console.log(`   ❓ ${q.id}: ${q.text}`);
  }

  // ── L2: Generate Hypotheses ──
  console.log("\nL2 · Generating Hypotheses...");
  const hypotheses = generateHypotheses(questions, claims);
  console.log(`   ${hypotheses.length} hypotheses generated`);

  // ── L3: Verify ──
  console.log("\nL3 · Verifying Hypotheses...");
  const verifications = verifyHypotheses(hypotheses, claims, machines);

  const retained = verifications.filter(v => v.verdict === "RETAIN");
  const discarded = verifications.filter(v => v.verdict === "DISCARD");
  const needsHuman = verifications.filter(v => v.verdict === "NEEDS_HUMAN");

  console.log(`   ${retained.length} RETAINED · ${discarded.length} DISCARDED · ${needsHuman.length} NEEDS HUMAN`);

  // Show retained
  console.log("\n   ── RETAINED (new knowledge) ──");
  for (const v of retained.slice(0, 5)) {
    console.log(`   ✅ ${v.claim}`);
    console.log(`      ${v.explanation}`);
  }

  // Show discarded
  console.log("\n   ── DISCARDED (refuted) ──");
  for (const v of discarded.slice(0, 3)) {
    console.log(`   ❌ ${v.claim}`);
    console.log(`      ${v.explanation}`);
  }

  // Show needs human
  if (needsHuman.length > 0) {
    console.log("\n   ── NEEDS HUMAN REVIEW ──");
    for (const v of needsHuman.slice(0, 3)) {
      console.log(`   ⚠️  ${v.claim}`);
      console.log(`      ${v.explanation}`);
    }
  }

  const report: ExplorerReport = {
    timestamp: new Date().toISOString(),
    questions,
    hypotheses,
    verifications,
    summary: {
      questionsGenerated: questions.length,
      hypothesesGenerated: hypotheses.length,
      retained: retained.length,
      discarded: discarded.length,
      needsHuman: needsHuman.length,
    },
  };

  return report;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/knowledge-explorer.ts <project-path>");
    process.exit(1);
  }

  const report = explore(targetProject);

  const outputPath = path.join(targetProject, ".progmune_exploration.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Exploration report saved to: ${outputPath}`);

  console.log("\n═══ Knowledge Explorer Summary ═══");
  console.log(`  Questions:     ${report.summary.questionsGenerated}`);
  console.log(`  Hypotheses:    ${report.summary.hypothesesGenerated}`);
  console.log(`  Retained:      ${report.summary.retained}  ← new knowledge`);
  console.log(`  Discarded:     ${report.summary.discarded}  ← refuted`);
  console.log(`  Needs human:   ${report.summary.needsHuman}  ← requires review`);
  console.log();
}
