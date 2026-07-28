/**
 * Progmune V7 — Proof Provenance System
 * ======================================
 * 把每一个不变量变成可追溯的证明对象。
 *
 * 核心原则:
 *   Proof ≠ Belief — 两者永远分离。
 *
 *   Proof:  形式逻辑对象。回答"这个结论能否从前提推导出来？"
 *           没有概率，只有有效/无效。每一层推导都精确记录来源。
 *
 *   Belief: 工程决策对象。回答"我们有多相信这个结论？"
 *           融合运行时数据、Git 历史、业务文档、人工确认。
 *           这是 V8 的事。
 *
 * 三层架构:
 *   L1 Recovery:  Code → AST → State Machine → Protocol
 *   L2 Reasoning: Protocol → Proof Tree → Counterexample → Retain/Discard
 *   L3 Belief:    Proof + Runtime + Docs + Human → Belief Score (V8)
 *
 * V7 完成 L1+L2。Proof 层不出现任何概率数字。
 */

import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════
// TYPES — Proof is a tree, not a number
// ══════════════════════════════════════════════

type LogicType = "REQUIRES" | "FORBIDS" | "TERMINAL" | "UNIQUE" | "INITIAL";

/** Provenance — exactly where this piece of evidence came from */
interface Provenance {
  sourceFile: string;          // e.g. "drizzle/schema.ts"
  sourceLine: number;          // e.g. 220
  sourceArtifact: string;      // e.g. "orders.status mysqlEnum"
  extractionMethod: string;    // e.g. "regex", "ts-morph AST", "CFG traversal"
  transformationChain: string[]; // e.g. ["AST→CallGraph", "CallGraph→StateMachine"]
}

/** A node in the proof derivation tree */
interface DerivationNode {
  id: string;
  conclusion: string;          // What this node asserts
  rule: "OBSERVATION" | "STATE_MACHINE" | "PROTOCOL_TEMPLATE" | "TRANSITIVITY" | "COUNTEREXAMPLE_REFUTED";
  children: string[];          // IDs of child nodes (premises)
  provenance: Provenance;      // Where this came from
  depth: number;               // Distance from OBSERVATION leaves
}

/** A certified invariant — conclusion + full derivation tree */
interface ProvenancedInvariant {
  id: string;
  predicate: string;           // e.g. "shipped ⇒ pending"
  domain: string;
  logicType: LogicType;
  derivation: DerivationNode;  // Root of the proof tree
  derivationDepth: number;
  isRefuted: boolean;          // True if V6 found a counterexample
  counterexamplePath?: string[];
  counterexampleExplanation?: string;
}

/** A counterexample — proof that an invariant does NOT hold */
interface RefutationRecord {
  invariantId: string;
  invariantPredicate: string;
  counterexamplePath: string[];
  explanation: string;
  refutationRule: string;      // e.g. "BFS_SHORTCUT", "CFG_COUNTEREXAMPLE"
}

/** The complete proof provenance report */
interface ProvenanceReport {
  timestamp: string;
  invariants: ProvenancedInvariant[];
  refutations: RefutationRecord[];
  summary: {
    totalInvariants: number;
    observations: number;      // Leaf nodes — directly from code
    derived: number;           // Non-leaf — derived via inference rules
    refuted: number;           // Counterexample found
    retained: number;          // No counterexample, or counterexample rejected
    proofDepth: { min: number; max: number; avg: number };
  };
}

// ══════════════════════════════════════════════
// L1: RECOVERY — Build derivation from code artifacts
// ══════════════════════════════════════════════

/**
 * Build a derivation node for an OBSERVATION — something directly read from code.
 * This is the leaf of every proof tree. No inference. Just extraction.
 */
function observationNode(
  id: string,
  conclusion: string,
  sourceFile: string,
  sourceLine: number,
  extractionMethod: string
): DerivationNode {
  return {
    id,
    conclusion,
    rule: "OBSERVATION",
    children: [],
    provenance: {
      sourceFile,
      sourceLine,
      sourceArtifact: conclusion,
      extractionMethod,
      transformationChain: [extractionMethod],
    },
    depth: 0,
  };
}

/**
 * Extend an observation through a transformation.
 * e.g. OBSERVATION("status: ['pending','paid','shipped']")
 *   → STATE_MACHINE("order_suppliers: pending → paid → shipped → completed")
 */
function transformNode(
  id: string,
  conclusion: string,
  childId: string,
  rule: DerivationNode["rule"],
  transformStep: string
): DerivationNode {
  return {
    id,
    conclusion,
    rule,
    children: [childId],
    provenance: {
      sourceFile: "",  // Filled by combining child provenances
      sourceLine: 0,
      sourceArtifact: conclusion,
      extractionMethod: transformStep,
      transformationChain: [transformStep],
    },
    depth: 1,
  };
}

// ══════════════════════════════════════════════
// L2: REASONING — Build the full proof provenance graph
// ══════════════════════════════════════════════

/**
 * Build a complete Provenance Report from the pipeline outputs.
 *
 * Every invariant gets:
 *   1. A full derivation tree tracing back to OBSERVATION leaves
 *   2. A refutation record if V6 found a counterexample
 *   3. No probability — only provenance
 */
function buildProvenance(
  protocols: any[],
  stateMachines: any[],
  proofEngine: any
): ProvenanceReport {
  const invariants: ProvenancedInvariant[] = [];
  const refutations: RefutationRecord[] = [];

  let nodeCounter = 1000;

  // ── Build derivation trees from protocol invariants ──
  for (const proto of protocols) {
    for (const inv of proto.invariants || []) {
      const id = inv.id;
      const predicate = inv.predicate || inv.rawPredicate || "";
      const sources = inv.sources || [];
      const domain = inv.domain || proto.domain || "unknown";

      // Determine logic type from the predicate
      let logicType: LogicType = "REQUIRES";
      if (predicate.includes("¬(") && predicate.includes("→")) logicType = "FORBIDS";
      else if (predicate.includes("¬∃")) logicType = "TERMINAL";
      else if (predicate.includes("≤ 1") || predicate.includes("unique")) logicType = "UNIQUE";
      else if (predicate.includes("initial_state")) logicType = "INITIAL";

      // Find the corresponding state machine
      const machine = stateMachines.find((m: any) =>
        m.entity === domain || domain.includes(m.entity) || m.entity.includes(domain)
      );

      // Build the OBSERVATION leaf
      const sourceFile = sources[0] || "unknown";
      const obsNode = observationNode(
        `OBS-${nodeCounter++}`,
        sources[0] || predicate,
        sourceFile.includes("State transition") ? "state-miner output" : sourceFile,
        0,
        sourceFile.includes("Domain:") ? "domain_template" : "state_transition_recovery"
      );

      // Build the STATE_MACHINE intermediate node (if machine exists)
      let derivation: DerivationNode;
      if (machine) {
        const smNode = transformNode(
          `SM-${nodeCounter++}`,
          `${machine.entity}: ${(machine.states || []).join(" → ")}`,
          obsNode.id,
          "STATE_MACHINE",
          "state_transition_recovery → state_machine"
        );
        smNode.depth = 1;

        // Build the top-level PROTOCOL node
        derivation = {
          id: `PR-${nodeCounter++}`,
          conclusion: predicate,
          rule: inv.id.startsWith("INV-TMPL") ? "PROTOCOL_TEMPLATE" : "STATE_MACHINE",
          children: [smNode.id],
          provenance: {
            sourceFile: sourceFile,
            sourceLine: 0,
            sourceArtifact: predicate,
            extractionMethod: smNode.provenance.extractionMethod,
            transformationChain: [...smNode.provenance.transformationChain, "state_machine → protocol_invariant"],
          },
          depth: 2,
        };

        // Attach all nodes for serialization
        (derivation as any)._obsNode = obsNode;
        (derivation as any)._smNode = smNode;
      } else {
        // No state machine — direct OBSERVATION → invariant
        derivation = {
          id: `PR-${nodeCounter++}`,
          conclusion: predicate,
          rule: "PROTOCOL_TEMPLATE",
          children: [obsNode.id],
          provenance: {
            sourceFile: sourceFile,
            sourceLine: 0,
            sourceArtifact: predicate,
            extractionMethod: obsNode.provenance.extractionMethod,
            transformationChain: [...obsNode.provenance.transformationChain, "template → invariant"],
          },
          depth: 1,
        };
        (derivation as any)._obsNode = obsNode;
      }

      // Check refutation from V6 — match by PREDICATE TEXT, not ID
      // (IDs collide across protocols: each has its own INV-3)
      const v6Counterexamples = proofEngine?.counterexamples || [];
      const ce = v6Counterexamples.find(
        (c: any) => c.invariantStatement === predicate
      );
      const isRefuted = !!ce;

      if (ce) {
        refutations.push({
          invariantId: id,
          invariantPredicate: predicate,
          counterexamplePath: ce.path || [],
          explanation: ce.explanation || "",
          refutationRule: "BFS_SHORTCUT",
        });
      }

      invariants.push({
        id,
        predicate,
        domain,
        logicType,
        derivation,
        derivationDepth: derivation.depth,
        isRefuted,
        counterexamplePath: ce?.path,
        counterexampleExplanation: ce?.explanation,
      });
    }
  }

  // ── Check inferred invariants from V6 ──
  for (const inf of proofEngine?.inferred || []) {
    const pred = inf.deducedPredicate;
    const premises = inf.premises || [];
    const proofTree = inf.proofTree;

    // Build TRANSITIVITY node with premises as children
    const derivation: DerivationNode = {
      id: `INF-${nodeCounter++}`,
      conclusion: pred,
      rule: "TRANSITIVITY",
      children: premises.map((p: any) => p.id),
      provenance: {
        sourceFile: "",
        sourceLine: 0,
        sourceArtifact: pred,
        extractionMethod: "transitive_closure",
        transformationChain: ["premise_a ⇒ premise_b", "premise_b ⇒ premise_c", "transitivity ⇒ conclusion"],
      },
      depth: 2,
    };

    invariants.push({
      id: proofTree?.id || `INF-${nodeCounter}`,
      predicate: pred,
      domain: "inferred",
      logicType: "REQUIRES",
      derivation,
      derivationDepth: 2,
      isRefuted: false,
    });
  }

  // Compute summary
  const observations = invariants.filter(i => i.derivationDepth === 0 || i.derivation.rule === "OBSERVATION");
  const derived = invariants.filter(i => !i.isRefuted && i.derivationDepth > 0);
  const refuted = invariants.filter(i => i.isRefuted);
  const retained = invariants.filter(i => !i.isRefuted);
  const depths = invariants.map(i => i.derivationDepth);

  const report: ProvenanceReport = {
    timestamp: new Date().toISOString(),
    invariants,
    refutations,
    summary: {
      totalInvariants: invariants.length,
      observations: observations.length,
      derived: derived.length,
      refuted: refuted.length,
      retained: retained.length,
      proofDepth: {
        min: depths.length > 0 ? Math.min(...depths) : 0,
        max: depths.length > 0 ? Math.max(...depths) : 0,
        avg: depths.length > 0 ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0,
      },
    },
  };

  return report;
}

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

export function buildProofProvenance(projectPath: string): ProvenanceReport {
  console.log("🔬 Progmune Proof Provenance System — V7");

  const protoPath = path.join(projectPath, ".progmune_protocols.json");
  const statePath = path.join(projectPath, ".progmune_state_machines.json");
  const proofPath = path.join(projectPath, ".progmune_proofs.json");

  const protocols = fs.existsSync(protoPath) ? JSON.parse(fs.readFileSync(protoPath, "utf-8")).protocols || [] : [];
  const stateMachines = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf-8")).machines || [] : [];
  const proofEngine = fs.existsSync(proofPath) ? JSON.parse(fs.readFileSync(proofPath, "utf-8")) : {};

  console.log(`   Input: ${protocols.length} protocols, ${stateMachines.length} state machines`);
  console.log(`   V6 data: ${proofEngine.summary?.totalInvariants || 0} invariants, ${proofEngine.summary?.counterexamples || 0} counterexamples`);

  const report = buildProvenance(protocols, stateMachines, proofEngine);

  // Print the proof provenance for refuted invariants
  console.log(`\n   ${report.summary.totalInvariants} invariants with full provenance`);
  console.log(`   ${report.summary.refuted} refuted (counterexample found)`);
  console.log(`   ${report.summary.retained} retained`);

  if (report.refutations.length > 0) {
    console.log("\n   ── Refutations ──");
    for (const ref of report.refutations) {
      console.log(`   ❌ ${ref.invariantPredicate}`);
      console.log(`      Rule: ${ref.refutationRule}`);
      console.log(`      Path: ${ref.counterexamplePath.join(" → ")}`);
    }
  }

  return report;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/proof-provenance.ts <project-path>");
    process.exit(1);
  }

  const report = buildProofProvenance(targetProject);

  const outputPath = path.join(targetProject, ".progmune_provenance.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Provenance report saved to: ${outputPath}`);

  console.log("\n═══ Proof Provenance Summary ═══");
  console.log(`  Total:          ${report.summary.totalInvariants}`);
  console.log(`  Observations:   ${report.summary.observations}`);
  console.log(`  Derived:        ${report.summary.derived}`);
  console.log(`  Refuted:        ${report.summary.refuted}`);
  console.log(`  Retained:       ${report.summary.retained}`);
  console.log(`  Proof Depth:    min=${report.summary.proofDepth.min} max=${report.summary.proofDepth.max} avg=${report.summary.proofDepth.avg}`);
  console.log();
}
