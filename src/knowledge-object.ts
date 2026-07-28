/**
 * Progmune V9 — Knowledge Object System
 * ======================================
 * 将整个 Pipeline 的输出统一为一种对象：Knowledge Object。
 *
 * 一个 Knowledge Object 包含:
 *   - Claim:         我们相信什么
 *   - Status:        Supported / Refuted / Undecided / Conflicting
 *   - Proof:         形式推导链
 *   - Counterexample: 反例（如果有）
 *   - Evidence:      所有独立证据源
 *   - Belief:        综合可信度
 *   - Dependencies:  依赖的其他 Claim
 *   - History:       这个 Claim 的形成历史
 *
 * 核心理念:
 *   Pipeline 输出不再是分散的 JSON 文件。
 *   所有层（Recovery、Reasoning、Belief）写同一个 Knowledge Object。
 *   每个 Claim 知道自己来自哪里、为什么被相信、谁在反对它。
 */

import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

type ClaimStatus = "SUPPORTED" | "REFUTED" | "UNDECIDED" | "CONFLICTING";
type LogicType = "REQUIRES" | "FORBIDS" | "TERMINAL" | "UNIQUE" | "INITIAL";

/** Where a piece of evidence came from */
interface EvidenceOrigin {
  sourceFile: string;
  sourceLine: number;
  extractionMethod: string;
  transformationChain: string[];
}

/** A single step in the proof derivation chain */
interface DerivationStep {
  rule: string;              // "OBSERVATION" | "TRANSITIVITY" | "STATE_MACHINE"
  from: string[];            // IDs of parent steps (empty for OBSERVATION)
  description: string;
}

/** A counterexample that refutes this claim */
interface KnowledgeCounterexample {
  path: string[];            // State sequence violating the claim
  explanation: string;
  method: string;            // "BFS" | "CFG" | "RUNTIME"
  timestamp: string;
}

/** A single independent evidence source */
interface EvidenceSource {
  name: string;
  direction: "SUPPORTING" | "OPPOSING" | "NEUTRAL";
  massFor: number;
  massAgainst: number;
  massUncertain: number;
  reasoning: string;
}

/** The complete Knowledge Object */
interface KnowledgeObject {
  // Identity
  id: string;
  domain: string;

  // The claim
  claim: string;             // e.g. "Production ⇒ Paid"
  logicType: LogicType;
  status: ClaimStatus;

  // Derivation
  proof: {
    isAxiom: boolean;
    derivationDepth: number;
    steps: DerivationStep[];
    origin: EvidenceOrigin;
  };

  // Refutation
  counterexamples: KnowledgeCounterexample[];

  // Independent evidence
  evidence: EvidenceSource[];

  // Belief (computed from evidence)
  belief: {
    score: number;           // 0-100, combined belief
    disbelief: number;       // 0-100
    uncertainty: number;     // 0-100
    level: "HIGH" | "MEDIUM" | "LOW" | "REFUTED";
  };

  // Argument graph
  dependencies: string[];    // IDs of claims this one depends on
  dependents: string[];      // IDs of claims that depend on this one

  // History
  history: {
    discovered: string;      // When first discovered
    lastVerified: string;    // When last verified
    statusChanges: { from: ClaimStatus; to: ClaimStatus; when: string; reason: string }[];
  };
}

/** The complete Knowledge Base */
interface KnowledgeBase {
  timestamp: string;
  projectPath: string;
  summary: {
    totalClaims: number;
    supported: number;
    refuted: number;
    undecided: number;
    conflicting: number;
    averageBelief: number;
    proofDepthRange: { min: number; max: number; avg: number };
  };
  claims: KnowledgeObject[];
  // Cross-claim relationships
  argumentGraph: {
    nodes: string[];           // Claim IDs
    edges: { from: string; to: string; relation: "DEPENDS_ON" | "SUPPORTS" | "OPPOSES" | "CONFLICTS" }[];
  };
}

// ══════════════════════════════════════════════
// V9: KNOWLEDGE OBJECT ASSEMBLY
// ══════════════════════════════════════════════

/**
 * Assemble all pipeline outputs into a unified Knowledge Base.
 * Instead of N separate JSON files, every piece of knowledge
 * goes into one Knowledge Object per claim.
 *
 * V7 provides: proof + provenance + refutation
 * V8 provides: belief + evidence sources
 */
function assembleKnowledgeBase(
  provenanceReport: any,
  beliefReport: any
): KnowledgeBase {
  const claims: KnowledgeObject[] = [];
  const claimIds = new Set<string>();

  // Index belief assessments by predicate+domain
  const beliefIndex = new Map<string, any>();
  for (const ba of beliefReport.assessments || []) {
    const key = `${ba.predicate}::${ba.domain}`;
    beliefIndex.set(key, ba);
  }

  for (const inv of provenanceReport.invariants || []) {
    const id = inv.id;
    // Ensure uniqueness: append domain if ID collides
    const uniqueId = claimIds.has(id) ? `${id}@${inv.domain}` : id;
    claimIds.add(uniqueId);

    const key = `${inv.predicate}::${inv.domain}`;
    const belief = beliefIndex.get(key);

    // ── Determine status ──
    let status: ClaimStatus;
    if (inv.isRefuted) {
      // Check if there's also supporting evidence (conflict)
      const supportingEvidence = (belief?.sources || []).filter(
        (s: any) => s.massFor > 0.5
      );
      if (supportingEvidence.length >= 2) {
        status = "CONFLICTING";  // Both support and refutation exist
      } else {
        status = "REFUTED";
      }
    } else if (belief && belief.combinedBelief >= 75) {
      status = "SUPPORTED";
    } else if (belief && belief.combinedBelief < 50) {
      status = "UNDECIDED";
    } else {
      status = "SUPPORTED";  // Default: survived refutation with reasonable belief
    }

    // ── Build proof steps ──
    const proofSteps: DerivationStep[] = [];
    const derivation = inv.derivation || {};

    // Add OBSERVATION step
    const obsNode = derivation._obsNode || {};
    if (obsNode.conclusion) {
      proofSteps.push({
        rule: "OBSERVATION",
        from: [],
        description: obsNode.conclusion,
      });
    }

    // Add STATE_MACHINE step
    const smNode = derivation._smNode || {};
    if (smNode.conclusion) {
      proofSteps.push({
        rule: "STATE_MACHINE",
        from: proofSteps.length > 0 ? [`OBSERVATION`] : [],
        description: smNode.conclusion,
      });
    }

    // Add the top-level derivation step
    if (derivation.rule && derivation.rule !== "OBSERVATION" && derivation.rule !== "STATE_MACHINE") {
      proofSteps.push({
        rule: derivation.rule,
        from: proofSteps.length > 0 ? [`STATE_MACHINE`] : [],
        description: derivation.conclusion || inv.predicate,
      });
    }

    // ── Collect evidence sources ──
    const evidenceSources: EvidenceSource[] = (belief?.sources || []).map((s: any) => ({
      name: s.name,
      direction: s.massAgainst > s.massFor ? "OPPOSING" : s.massFor > 0.5 ? "SUPPORTING" : "NEUTRAL",
      massFor: s.massFor,
      massAgainst: s.massAgainst,
      massUncertain: s.massUncertain,
      reasoning: s.reasoning,
    }));

    // ── Build knowledge object ──
    const ko: KnowledgeObject = {
      id: uniqueId,
      domain: inv.domain || "unknown",
      claim: inv.predicate,
      logicType: inv.logicType || "REQUIRES",
      status,

      proof: {
        isAxiom: proofSteps.length <= 1,
        derivationDepth: inv.derivationDepth || 1,
        steps: proofSteps,
        origin: {
          sourceFile: derivation.provenance?.sourceFile || "unknown",
          sourceLine: derivation.provenance?.sourceLine || 0,
          extractionMethod: derivation.provenance?.extractionMethod || "unknown",
          transformationChain: derivation.provenance?.transformationChain || [],
        },
      },

      counterexamples: inv.isRefuted ? [{
        path: inv.counterexamplePath || [],
        explanation: inv.counterexampleExplanation || "",
        method: "BFS",
        timestamp: provenanceReport.timestamp,
      }] : [],

      evidence: evidenceSources,

      belief: {
        score: belief?.combinedBelief || 0,
        disbelief: belief?.combinedDisbelief || 0,
        uncertainty: belief?.combinedUncertainty || 0,
        level: inv.isRefuted ? "REFUTED" : belief?.beliefLevel || "HIGH",
      },

      dependencies: [],
      dependents: [],

      history: {
        discovered: provenanceReport.timestamp,
        lastVerified: new Date().toISOString(),
        statusChanges: [],
      },
    };

    claims.push(ko);
  }

  // ── Build argument graph edges ──
  const edges: KnowledgeBase["argumentGraph"]["edges"] = [];

  // Dependencies: claims that share atoms in an implication chain
  for (const c1 of claims) {
    for (const c2 of claims) {
      if (c1.id === c2.id) continue;

      const m1 = c1.claim.match(/(\w+)\s*⇒\s*(\w+)/);
      const m2 = c2.claim.match(/(\w+)\s*⇒\s*(\w+)/);

      // DEPENDS_ON: c1.claim = "A⇒B", c2.claim = "B⇒C" → c1 depends on c2
      if (m1 && m2 && m1[2].toLowerCase() === m2[1].toLowerCase()) {
        edges.push({ from: c1.id, to: c2.id, relation: "DEPENDS_ON" });
        if (!c1.dependencies.includes(c2.id)) c1.dependencies.push(c2.id);
        if (!c2.dependents.includes(c1.id)) c2.dependents.push(c1.id);
      }

      // CONFLICTS: same atoms, opposite directions
      if (m1 && m2 &&
          m1[1].toLowerCase() === m2[2].toLowerCase() &&
          m1[2].toLowerCase() === m2[1].toLowerCase()) {
        edges.push({ from: c1.id, to: c2.id, relation: "CONFLICTS" });
      }
    }

    // SUPPORTS: evidence direction
    for (const ev of c1.evidence) {
      if (ev.direction === "SUPPORTING") {
        // Self-supporting — already captured
      }
      if (ev.direction === "OPPOSING") {
        // OPPOSES: evidence against this claim
        edges.push({ from: `EVIDENCE:${ev.name}`, to: c1.id, relation: "OPPOSES" });
      }
    }
  }

  // Compute summary
  const supported = claims.filter(c => c.status === "SUPPORTED").length;
  const refuted = claims.filter(c => c.status === "REFUTED").length;
  const undecided = claims.filter(c => c.status === "UNDECIDED").length;
  const conflicting = claims.filter(c => c.status === "CONFLICTING").length;
  const avgBelief = Math.round(claims.reduce((s, c) => s + c.belief.score, 0) / claims.length);
  const depths = claims.map(c => c.proof.derivationDepth);

  const kb: KnowledgeBase = {
    timestamp: new Date().toISOString(),
    projectPath: provenanceReport.projectPath || "",
    summary: {
      totalClaims: claims.length,
      supported,
      refuted,
      undecided,
      conflicting,
      averageBelief: avgBelief,
      proofDepthRange: {
        min: depths.length > 0 ? Math.min(...depths) : 0,
        max: depths.length > 0 ? Math.max(...depths) : 0,
        avg: depths.length > 0 ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0,
      },
    },
    claims,
    argumentGraph: {
      nodes: claims.map(c => c.id),
      edges,
    },
  };

  return kb;
}

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

export function buildKnowledgeBase(projectPath: string): KnowledgeBase {
  console.log("🔬 Progmune Knowledge Object System — V9");
  console.log("   Project:", projectPath);

  const provenancePath = path.join(projectPath, ".progmune_provenance.json");
  const beliefPath = path.join(projectPath, ".progmune_belief.json");

  if (!fs.existsSync(provenancePath) || !fs.existsSync(beliefPath)) {
    console.log("   Run V7 and V8 first.");
    return { timestamp: new Date().toISOString(), projectPath, summary: { totalClaims: 0, supported: 0, refuted: 0, undecided: 0, conflicting: 0, averageBelief: 0, proofDepthRange: { min: 0, max: 0, avg: 0 } }, claims: [], argumentGraph: { nodes: [], edges: [] } };
  }

  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf-8"));
  const belief = JSON.parse(fs.readFileSync(beliefPath, "utf-8"));

  const kb = assembleKnowledgeBase(provenance, belief);

  // Print summary
  console.log(`\n   ${kb.summary.totalClaims} claims in Knowledge Base`);
  console.log(`   SUPPORTED:    ${kb.summary.supported}  ← all evidence supports`);
  console.log(`   REFUTED:      ${kb.summary.refuted}   ← counterexample found`);
  console.log(`   CONFLICTING:  ${kb.summary.conflicting}   ← both support & refutation exist`);
  console.log(`   UNDECIDED:    ${kb.summary.undecided}   ← insufficient evidence`);

  // Show the argument graph
  console.log(`\n   Argument Graph: ${kb.argumentGraph.nodes.length} nodes, ${kb.argumentGraph.edges.length} edges`);
  const depEdges = kb.argumentGraph.edges.filter(e => e.relation === "DEPENDS_ON");
  const conflictEdges = kb.argumentGraph.edges.filter(e => e.relation === "CONFLICTS");
  console.log(`   DEPENDS_ON: ${depEdges.length}  |  CONFLICTS: ${conflictEdges.length}`);

  // Show example knowledge objects
  console.log("\n   ── REFUTED Claim ──");
  const refutedClaim = kb.claims.find(c => c.status === "REFUTED");
  if (refutedClaim) {
    console.log(`   ❌ ${refutedClaim.claim}`);
    console.log(`      Status: ${refutedClaim.status} | Belief: ${refutedClaim.belief.score}%`);
    console.log(`      Counterexamples: ${refutedClaim.counterexamples.length}`);
    console.log(`      Evidence sources:`);
    for (const ev of refutedClaim.evidence) {
      const icon = ev.direction === "OPPOSING" ? "↓" : ev.direction === "SUPPORTING" ? "↑" : "→";
      console.log(`        ${icon} ${ev.name}: ${ev.reasoning.slice(0, 80)}`);
    }
  }

  console.log("\n   ── SUPPORTED Claim ──");
  const supportedClaim = kb.claims.find(c => c.status === "SUPPORTED" && c.logicType === "FORBIDS");
  if (supportedClaim) {
    console.log(`   ✅ ${supportedClaim.claim}`);
    console.log(`      Status: ${supportedClaim.status} | Belief: ${supportedClaim.belief.score}%`);
    console.log(`      Proof depth: ${supportedClaim.proof.derivationDepth}`);
    console.log(`      Origin: ${supportedClaim.proof.origin.sourceFile}`);
  }

  return kb;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/knowledge-object.ts <project-path>");
    process.exit(1);
  }

  const kb = buildKnowledgeBase(targetProject);

  const outputPath = path.join(targetProject, ".progmune_knowledge.json");
  fs.writeFileSync(outputPath, JSON.stringify(kb, null, 2));
  console.log(`\n✅ Knowledge Base saved to: ${outputPath}`);
  console.log(`   This single file replaces all previous .progmune_*.json outputs.`);
  console.log(`   Every claim is a Knowledge Object: Claim + Proof + Evidence + Belief + History.`);
}
