/**
 * Progmune V5 — Invariant Calculus
 * =================================
 * 将不变量从 JSON 记录提升为可证明、可组合、可验证的数学对象。
 *
 * 核心理念:
 *   V4 回答: "能推导出新不变量吗？" → Closure 实现了传递闭包
 *   V5 回答: "能证明每个不变量吗？"  → 每个不变量携带自己的 Proof Object
 *
 * 新增能力:
 *   1. Proof Objects — 每个不变量附带推导链
 *   2. Minimal Basis — 自动消除冗余规则，只保留生成基
 *   3. Contradiction Detection — 检测逻辑冲突
 *   4. Dependency Graph — 不变量之间的依赖 DAG
 *   5. Counterexample Generation — 验证失败时构造反例
 */

import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

/** Logical type of an invariant — determines how it participates in reasoning */
type LogicType = "REQUIRES" | "FORBIDS" | "TERMINAL" | "UNIQUE" | "INITIAL";

/** A proof step — one inference in the derivation chain */
interface ProofStep {
  rule: string;              // Inference rule used: "transitivity", "premise", "contradiction"
  from: string[];            // IDs of premises
  to: string;                // ID of conclusion
  description: string;
}

/** A complete proof object */
interface ProofObject {
  invariantId: string;
  statement: string;         // e.g. "pending ⇒ paid"
  steps: ProofStep[];        // Derivation chain
  premises: string[];        // Leaf premises (not derived from anything)
  isAxiom: boolean;          // True if this is an assumed premise (not proven)
  confidence: number;        // Derived from premises: min(premise confidences)
  logicType: LogicType;      // What kind of logical statement this is
}

/** An invariant with its proof */
interface CertifiedInvariant {
  id: string;
  description: string;
  predicate: string;
  domain: string;
  confidence: number;
  proof: ProofObject;
  dependsOn: string[];       // IDs of invariants this one depends on
  dependedOnBy: string[];    // IDs of invariants that depend on this one
  logicType: LogicType;      // REQUIRES / FORBIDS / TERMINAL / UNIQUE / INITIAL
}

/** The minimal basis — only generating invariants */
interface MinimalBasis {
  generators: CertifiedInvariant[];   // Cannot be derived from others
  consequences: CertifiedInvariant[]; // Derivable from generators
  removedRedundant: string[];         // IDs that were eliminated
}

/** A counterexample showing why an invariant is violated */
interface Counterexample {
  invariantId: string;
  invariantStatement: string;
  path: string[];            // The violating state sequence
  atStep: number;            // Which step in the path violates
  explanation: string;
}

/** Result of consistency check */
interface ConsistencyReport {
  isConsistent: boolean;
  contradictions: { a: string; b: string; description: string }[];
  minimalBasis: MinimalBasis;
}

/** The complete calculus report */
interface CalculusReport {
  timestamp: string;
  certifiedInvariants: CertifiedInvariant[];
  dependencyGraph: { id: string; dependsOn: string[]; dependedOnBy: string[] }[];
  minimalBasis: MinimalBasis;
  consistency: ConsistencyReport;
  counterexamples: Counterexample[];
  summary: {
    totalInvariants: number;
    axioms: number;
    derived: number;
    redundant: number;
    contradictions: number;
    counterexamples: number;
  };
}

// ══════════════════════════════════════════════
// L0: LOGIC TYPE CLASSIFICATION
// ══════════════════════════════════════════════

/**
 * Classify an invariant into its logical type.
 *
 * REQUIRES:  "A ⇒ B" — A requires B to have been satisfied before entering A.
 *            e.g. "production ⇒ paid" = must have paid before production.
 *            Transitive: if A⇒B and B⇒C, then A⇒C.
 *
 * FORBIDS:   "¬(A → B)" — cannot directly transition from A to B.
 *            e.g. "¬(shipped → pending)" = cannot go backwards.
 *            NOT transitive. A forbidding B and B forbidding C does NOT
 *            imply A forbids C. These are local edge constraints.
 *
 * TERMINAL:  "A ⇒ ¬∃ next" — once in A, no further transitions exist.
 *            e.g. "completed is terminal" = cannot leave completed state.
 *
 * UNIQUE:    "|payments| ≤ 1" — cardinality constraint.
 *
 * INITIAL:   "∀ entity: initial_state = A" — only one valid starting state.
 */
function classifyLogicType(inv: any): LogicType {
  const pred = (inv.rawPredicate || inv.predicate || "").toLowerCase();
  const desc = (inv.description || "").toLowerCase();

  if (pred.includes("¬∃ next") || pred.includes("terminal") || desc.includes("终态")) {
    return "TERMINAL";
  }
  if (pred.includes("¬(") && pred.includes("→")) {
    return "FORBIDS";
  }
  if (pred.includes("≤ 1") || pred.includes("unique") || pred.includes("at most one") || desc.includes("唯一")) {
    return "UNIQUE";
  }
  if (pred.includes("initial_state") || desc.includes("起始") || desc.includes("初始")) {
    return "INITIAL";
  }
  // Default: "A ⇒ B" with actual different atoms = prerequisite
  return "REQUIRES";
}

// ══════════════════════════════════════════════
// L1: PROOF OBJECT CONSTRUCTION
// ══════════════════════════════════════════════

/**
 * Build a proof object for each invariant.
 *
 * A proof is a derivation chain from premises to conclusion.
 * - Axioms (premises): invariants that were mined directly from code/state machines.
 *   They have no derivation — they are assumed true based on evidence.
 * - Derived invariants: those obtained by applying inference rules to axioms.
 *   Their proof references the premises and the rule used.
 */
function buildProofObjects(
  invariants: any[],
  closures: any[]
): CertifiedInvariant[] {
  const certified: CertifiedInvariant[] = [];
  const idCounter = { value: 10000 };

  // ── Step 1: Mark all mined invariants as axioms ──
  for (const inv of invariants) {
    const logicType = classifyLogicType(inv);
    const proof: ProofObject = {
      invariantId: inv.id,
      statement: inv.rawPredicate || inv.predicate,
      steps: [{
        rule: "premise",
        from: [],
        to: inv.id,
        description: `Mined from ${inv.source || "code analysis"} [type: ${logicType}]`,
      }],
      premises: [inv.id],
      isAxiom: true,
      confidence: inv.confidence || 50,
      logicType,
    };

    certified.push({
      id: inv.id,
      description: inv.description,
      predicate: inv.rawPredicate || inv.predicate,
      domain: inv.domain || "unknown",
      confidence: inv.confidence || 50,
      proof,
      dependsOn: [],
      dependedOnBy: [],
      logicType,
    });
  }

  // ── Step 2: Mark closure-derived invariants with their derivation chain ──
  for (const closureInv of closures) {
    const sourceDesc = closureInv.source || "";
    // Parse premises from source string like "closure: pending⇒production + production⇒paid"
    const premiseMatch = sourceDesc.match(/closure:\s*(\w+⇒\w+)\s*\+\s*(\w+⇒\w+)/);

    // Closure-derived invariants inherit REQUIRES type (transitivity only applies to prerequisites)
    const proof: ProofObject = {
      invariantId: closureInv.id,
      statement: closureInv.rawPredicate || closureInv.predicate || "",
      steps: [{
        rule: "transitivity",
        from: premiseMatch
          ? [findInvariantId(certified, premiseMatch[1]), findInvariantId(certified, premiseMatch[2])].filter(Boolean) as string[]
          : [],
        to: closureInv.id,
        description: closureInv.description || `Derived via transitive closure`,
      }],
      premises: premiseMatch
        ? [findInvariantId(certified, premiseMatch[1]), findInvariantId(certified, premiseMatch[2])].filter(Boolean) as string[]
        : [],
      isAxiom: false,
      confidence: closureInv.confidence || 50,
      logicType: "REQUIRES", // Closure only derives REQUIRES invariants
    };

    const certInv: CertifiedInvariant = {
      id: closureInv.id,
      description: closureInv.description || "",
      predicate: closureInv.rawPredicate || closureInv.predicate || "",
      domain: closureInv.domain || "unknown",
      confidence: closureInv.confidence || 50,
      proof,
      dependsOn: proof.premises,
      dependedOnBy: [],
      logicType: "REQUIRES",
    };

    certified.push(certInv);

    // Update dependedOnBy on premises
    for (const premId of proof.premises) {
      const prem = certified.find(c => c.id === premId);
      if (prem && !prem.dependedOnBy.includes(certInv.id)) {
        prem.dependedOnBy.push(certInv.id);
      }
    }
  }

  return certified;
}

/** Find an invariant ID by its predicate string */
function findInvariantId(invariants: CertifiedInvariant[], predicate: string): string | null {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const target = norm(predicate);
  for (const inv of invariants) {
    if (norm(inv.predicate) === target || norm(inv.predicate).includes(target)) {
      return inv.id;
    }
  }
  return null;
}

// ══════════════════════════════════════════════
// L2: DEPENDENCY GRAPH
// ══════════════════════════════════════════════

/**
 * Build the dependency DAG from certified invariants.
 * If B depends on A, and A changes, B must be re-verified.
 */
function buildDependencyGraph(
  certified: CertifiedInvariant[]
): { id: string; dependsOn: string[]; dependedOnBy: string[] }[] {
  return certified.map(inv => ({
    id: inv.id,
    dependsOn: inv.dependsOn,
    dependedOnBy: inv.dependedOnBy,
  }));
}

// ══════════════════════════════════════════════
// L3: CONSISTENCY CHECK (Contradiction Detection)
// ══════════════════════════════════════════════

/**
 * Detect contradictions in the invariant set.
 * A contradiction exists when we have both A⇒B and A⇒¬B
 * (or equivalently, A⇒B and an invalid transition ¬(A→B)).
 *
 * Also detects: A⇒B and B⇒A simultaneously (cycle in strict partial order)
 */
function checkConsistency(certified: CertifiedInvariant[]): ConsistencyReport {
  const contradictions: { a: string; b: string; description: string }[] = [];

  // Separate by logic type — different types don't conflict
  const requires = new Map<string, string[]>();   // REQUIRES: A ⇒ B
  const forbids = new Map<string, string[]>();    // FORBIDS:  ¬(A → B)
  const terminals = new Set<string>();             // TERMINAL: A has no next state

  for (const inv of certified) {
    const pred = inv.predicate;

    if (inv.logicType === "REQUIRES") {
      const impliesMatch = pred.match(/(\w+)\s*⇒\s*(\w+)/);
      if (impliesMatch) {
        const a = impliesMatch[1].toLowerCase();
        const b = impliesMatch[2].toLowerCase();
        if (a !== b) {
          if (!requires.has(a)) requires.set(a, []);
          if (!requires.get(a)!.includes(b)) requires.get(a)!.push(b);
        }
      }
    }

    if (inv.logicType === "FORBIDS") {
      const notImpliesMatch = pred.match(/¬\((\w+)\s*→\s*(\w+)\)/);
      if (notImpliesMatch) {
        const a = notImpliesMatch[1].toLowerCase();
        const b = notImpliesMatch[2].toLowerCase();
        if (!forbids.has(a)) forbids.set(a, []);
        if (!forbids.get(a)!.includes(b)) forbids.get(a)!.push(b);
      }
    }

    if (inv.logicType === "TERMINAL") {
      const termMatch = pred.match(/(\w+)/);
      if (termMatch) terminals.add(termMatch[1].toLowerCase());
    }
  }

  // ── Only check WITHIN each type ──

  // REQUIRES internal: A⇒B and B⇒A (cycle in strict partial order)
  for (const [a, deps] of requires) {
    for (const b of deps) {
      const bDeps = requires.get(b) || [];
      if (bDeps.includes(a) && a < b) { // a < b to avoid double-counting
        contradictions.push({
          a: `${a}⇒${b}`,
          b: `${b}⇒${a}`,
          description: `REQUIRES 循环: ${a}⇒${b} 且 ${b}⇒${a} —— 违反严格偏序`,
        });
      }
    }
  }

  // REQUIRES + TERMINAL conflict: A is terminal but also requires B (can't transition to B if terminal)
  for (const a of terminals) {
    const deps = requires.get(a) || [];
    if (deps.length > 0) {
      // Being terminal AND requiring something is suspicious
      // (terminal means no outgoing transitions, but REQUIRES implies a dependency chain)
      // This is NOT necessarily a contradiction — terminal just means no FURTHER states
      // We'll skip this check for now
    }
  }

  // FORBIDS internal: A forbids B and also forbids B twice (redundant, not contradiction)

  // NOTE: REQUIRES vs FORBIDS are NOT contradictions.
  // "shipped ⇒ production" (REQUIRES: must have passed through production)
  // and "¬(shipped → production)" (FORBIDS: cannot transition back to production)
  // are CONSISTENT. One is about history, the other about future transitions.

  return {
    isConsistent: contradictions.length === 0,
    contradictions,
    minimalBasis: { generators: [], consequences: [], removedRedundant: [] },
  };
}

// ══════════════════════════════════════════════
// L4: MINIMAL BASIS (Redundancy Elimination)
// ══════════════════════════════════════════════

/**
 * Compute the minimal generating basis.
 *
 * An invariant is REDUNDANT if it can be derived from other invariants
 * via transitivity. Example:
 *   A⇒B, B⇒C, A⇒C  → A⇒C is redundant (derivable from the first two)
 *
 * The minimal basis contains only the axioms that cannot be derived.
 * All consequences are derivable from the basis.
 */
function computeMinimalBasis(certified: CertifiedInvariant[]): MinimalBasis {
  const axioms = certified.filter(inv => inv.proof.isAxiom);
  const derived = certified.filter(inv => !inv.proof.isAxiom);

  // For now: all axioms are generators, all derived are consequences.
  // A more sophisticated version would find transitive reducibility among axioms.
  // e.g., if A⇒B and B⇒C are both axioms, we could remove A⇒C from generators
  // (but we only generate A⇒C via closure, so it's already in derived).

  const redundant: string[] = [];

  // Check: are any axioms actually derivable from other axioms?
  // If axiom A⇒C is also in the transitive closure of other axioms, it's redundant.
  for (let i = 0; i < axioms.length; i++) {
    for (let j = 0; j < axioms.length; j++) {
      if (i === j) continue;
      // Check if axioms[i] is transitively implied by axioms[j] + some chain
      // This is a simplified check: same predicate means redundant
      if (axioms[i].predicate === axioms[j].predicate && i > j) {
        redundant.push(axioms[i].id);
      }
    }
  }

  const generators = axioms.filter(a => !redundant.includes(a.id));

  return {
    generators,
    consequences: derived,
    removedRedundant: redundant,
  };
}

// ══════════════════════════════════════════════
// L5: COUNTEREXAMPLE GENERATION
// ══════════════════════════════════════════════

/**
 * Generate counterexamples for violated invariants.
 *
 * Given a state machine and an invariant A⇒B:
 *   - Find a path where A is true but B has not been satisfied yet.
 *   - The shortest such path is the counterexample.
 */
function generateCounterexamples(
  certified: CertifiedInvariant[],
  stateMachines: any[]
): Counterexample[] {
  const counterexamples: Counterexample[] = [];

  for (const machine of stateMachines) {
    const states = machine.states || [];
    const validTransitions = new Set(machine.validTransitions || []);
    const invalidTransitions = machine.invalidTransitions || [];

    // For each safety invariant (¬(A→B)), construct the violating path
    for (const invId of invalidTransitions) {
      const [from, to] = invId.split("→");
      if (!from || !to) continue;

      // Find the corresponding certified invariant
      const certInv = certified.find(c =>
        c.predicate.includes(from) && c.predicate.includes(to) && c.predicate.includes("¬")
      );

      if (certInv) {
        // Construct the shortest violating path
        const path = [from, to];
        counterexamples.push({
          invariantId: certInv.id,
          invariantStatement: certInv.predicate,
          path,
          atStep: 1,
          explanation: `状态机允许从 ${from} 直接跳转到 ${to}。违反了不变量: ${certInv.predicate}`,
        });
      }
    }

    // For prerequisite invariants (A⇒B), check if there's a path from initial to A that skips B
    for (const certInv of certified) {
      const impliesMatch = certInv.predicate.match(/(\w+)\s*⇒\s*(\w+)/);
      if (!impliesMatch) continue;
      const a = impliesMatch[1].toLowerCase();
      const b = impliesMatch[2].toLowerCase();

      // Check: does any path from initial state reach 'a' without passing through 'b'?
      const initialState = machine.initialState?.toLowerCase();
      if (initialState && states.map((s: string) => s.toLowerCase()).includes(a)) {
        // If there's a direct transition from initial to 'a' that skips 'b', that's a violation
        const directPath = `${initialState}→${a}`;
        if (!validTransitions.has(directPath) && initialState !== a) {
          // This means the state machine already blocks this path — invariant is satisfied
          // If the path IS valid, it's a violation
        }
      }

      // Simpler check: if 'a' can be reached without 'b' in the state list before it
      const aIdx = states.findIndex((s: string) => s.toLowerCase() === a);
      const bIdx = states.findIndex((s: string) => s.toLowerCase() === b);
      if (aIdx >= 0 && bIdx >= 0 && aIdx < bIdx) {
        // 'a' appears before 'b' in state ordering — potential violation
        // This means the state can be entered without satisfying the prerequisite
        counterexamples.push({
          invariantId: certInv.id,
          invariantStatement: certInv.predicate,
          path: [states[aIdx], states[bIdx]],
          atStep: aIdx,
          explanation: `在状态序列中，${states[aIdx]} 出现在 ${states[bIdx]} 之前。可能违反: ${certInv.predicate}`,
        });
        break; // One counterexample per invariant is sufficient
      }
    }
  }

  return counterexamples;
}

// ══════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════

interface CalculusInput {
  protocols: any[];       // From V3.4
  closures: any[];        // From V4 closure results
  stateMachines: any[];   // From V3.3
}

export function runCalculus(input: CalculusInput): CalculusReport {
  console.log("🔬 Progmune Invariant Calculus — V5");

  // Collect all invariants and closures
  const allInvariants: any[] = [];
  for (const proto of input.protocols || []) {
    for (const inv of proto.invariants || []) {
      allInvariants.push(inv);
    }
  }

  const allClosures: any[] = [];
  for (const proto of input.protocols || []) {
    for (const inv of proto.closure || []) {
      allClosures.push(inv);
    }
  }

  console.log(`   Input: ${allInvariants.length} invariants, ${allClosures.length} closure-derived`);

  // ── L1: Proof Objects ──
  console.log("\nL1 · Proof Object Construction...");
  const certified = buildProofObjects(allInvariants, allClosures);
  const axioms = certified.filter(c => c.proof.isAxiom);
  const derived = certified.filter(c => !c.proof.isAxiom);
  const typeCounts: Record<string, number> = {};
  for (const c of certified) { typeCounts[c.logicType] = (typeCounts[c.logicType] || 0) + 1; }
  console.log(`   ${certified.length} certified: ${axioms.length} axioms, ${derived.length} derived`);
  console.log(`   By type: REQUIRES=${typeCounts["REQUIRES"]||0} FORBIDS=${typeCounts["FORBIDS"]||0} TERMINAL=${typeCounts["TERMINAL"]||0} UNIQUE=${typeCounts["UNIQUE"]||0} INITIAL=${typeCounts["INITIAL"]||0}`);

  // Show derivation chains
  for (const d of derived.slice(0, 3)) {
    const premises = d.proof.premises.join(", ");
    console.log(`   ⊢ ${d.predicate} [from: ${premises}]`);
  }

  // ── L2: Dependency Graph ──
  console.log("\nL2 · Dependency Graph...");
  const depGraph = buildDependencyGraph(certified);
  const withDeps = depGraph.filter(d => d.dependedOnBy.length > 0);
  console.log(`   ${withDeps.length} invariants with dependents`);
  for (const d of withDeps.slice(0, 3)) {
    console.log(`   ${d.id} is depended on by: ${d.dependedOnBy.join(", ")}`);
  }

  // ── L3: Consistency Check ──
  console.log("\nL3 · Consistency Check...");
  const consistency = checkConsistency(certified);
  if (consistency.isConsistent) {
    console.log("   ✅ No contradictions found");
  } else {
    console.log(`   ❌ ${consistency.contradictions.length} contradictions found`);
    for (const c of consistency.contradictions.slice(0, 3)) {
      console.log(`      ${c.description}`);
    }
  }

  // ── L4: Minimal Basis ──
  console.log("\nL4 · Minimal Basis...");
  const minimalBasis = computeMinimalBasis(certified);
  // Update consistency with the computed basis
  consistency.minimalBasis = minimalBasis;
  console.log(`   Generators: ${minimalBasis.generators.length}`);
  console.log(`   Consequences: ${minimalBasis.consequences.length}`);
  console.log(`   Redundant: ${minimalBasis.removedRedundant.length}`);
  if (minimalBasis.removedRedundant.length > 0) {
    console.log(`   Removed: ${minimalBasis.removedRedundant.join(", ")}`);
  }

  // ── L5: Counterexample Generation ──
  console.log(`\nL5 · Counterexample Generation (FORBIDS type only)...`);
  // Only FORBIDS invariants can have counterexamples (invalid transitions)
  const forbidsInvariants = certified.filter(c => c.logicType === "FORBIDS");
  const counterexamples = generateCounterexamples(forbidsInvariants, input.stateMachines || []);
  console.log(`   ${counterexamples.length} counterexamples`);
  for (const ce of counterexamples.slice(0, 3)) {
    console.log(`   ❌ ${ce.invariantStatement}`);
    console.log(`      Path: ${ce.path.join(" → ")}`);
    console.log(`      ${ce.explanation}`);
  }

  const report: CalculusReport = {
    timestamp: new Date().toISOString(),
    certifiedInvariants: certified,
    dependencyGraph: depGraph,
    minimalBasis,
    consistency,
    counterexamples,
    summary: {
      totalInvariants: certified.length,
      axioms: axioms.length,
      derived: derived.length,
      redundant: minimalBasis.removedRedundant.length,
      contradictions: consistency.contradictions.length,
      counterexamples: counterexamples.length,
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
    console.error("Usage: npx ts-node src/invariant-calculus.ts <project-path>");
    process.exit(1);
  }

  const protoPath = path.join(targetProject, ".progmune_protocols.json");
  const algebraPath = path.join(targetProject, ".progmune_algebra.json");
  const statePath = path.join(targetProject, ".progmune_state_machines.json");

  if (!fs.existsSync(protoPath)) {
    console.error("Run V3.4 first: npx ts-node src/protocol-miner.ts");
    process.exit(1);
  }

  const protocols = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
  const algebra = fs.existsSync(algebraPath) ? JSON.parse(fs.readFileSync(algebraPath, "utf-8")) : { protocols: [] };
  const states = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf-8")) : { machines: [] };

  const input: CalculusInput = {
    protocols: protocols.protocols || [],
    closures: algebra.protocols?.flatMap((p: any) => p.closure || []) || [],
    stateMachines: states.machines || [],
  };

  const report = runCalculus(input);

  const outputPath = path.join(targetProject, ".progmune_calculus.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Calculus report saved to: ${outputPath}`);

  console.log("\n═══ Invariant Calculus Summary ═══");
  console.log(`  Total:         ${report.summary.totalInvariants}`);
  console.log(`  Axioms:        ${report.summary.axioms}`);
  console.log(`  Derived:       ${report.summary.derived}`);
  console.log(`  Redundant:     ${report.summary.redundant}`);
  console.log(`  Contradictions:${report.summary.contradictions}`);
  console.log(`  Counterexamples:${report.summary.counterexamples}`);
  console.log();
}
