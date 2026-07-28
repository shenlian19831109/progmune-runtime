/**
 * Progmune V4 — Invariant Algebra
 * ================================
 * 将业务协议提升为可推理、可组合、可证明的代数系统。
 *
 * 核心理念:
 *   Protocol 不只是规则列表。它们是数学对象。
 *   两个 Protocol 可以 Merge、Intersect、Compose。
 *   从一个 Protocol 可以推导出另一个 Protocol（Closure）。
 *   跨实体的一致性可以用 Functor 来描述和验证。
 *
 * 从规则到定理:
 *   输入: 一组 Invariant（谓词逻辑语句）
 *   输出: (1) 闭包 — 自动推导的新不变量
 *         (2) 组合 — 两个 Protocol 合并后的不变量
 *         (3) 函子保持 — 跨实体一致性验证
 *         (4) 定理 — 从 Protocol 系统中可证明的性质
 */

import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

/** A logical expression in our invariant language */
interface Expression {
  kind: "implies" | "not" | "exists" | "forall" | "atom";
  left?: Expression;
  right?: Expression;
  predicate?: string;
  entity?: string;
  quantifier?: string;
}

/** An invariant with its logical structure parsed */
interface ParsedInvariant {
  id: string;
  description: string;
  rawPredicate: string;       // Original: "Production ⇒ Paid"
  source: string;             // Origin: "v3.3_state_machine" | "v3.4_template"
  confidence: number;
  domain: string;
  // Parsed structure
  atom: string;               // Normalized atom: "production"
  requires: string | null;    // Prerequisite atom: "paid" (for implies)
  isTerminal: boolean;        // "no next state exists"
  isUnique: boolean;          // "at most one"
}

/** A protocol as an algebraic object */
interface ProtocolObject {
  name: string;
  domain: string;
  invariants: ParsedInvariant[];
  // Algebraic properties
  atoms: Set<string>;                    // All state atoms
  impliesGraph: Map<string, string[]>;   // A → [B, C, ...]
  closure: ParsedInvariant[];            // Deduced invariants
}

/** A cross-entity functor mapping */
interface FunctorMapping {
  fromEntity: string;
  fromState: string;           // e.g. "paid"
  toEntity: string;
  toState: string;             // e.g. "reserved"
  description: string;
}

/** Validation result */
interface ValidationResult {
  isValid: boolean;
  violatedInvariants: string[];
  deducedInvariants: string[];
  message: string;
}

// ══════════════════════════════════════════════
// L1: PARSER — 将原始谓词解析为结构化表达式
// ══════════════════════════════════════════════

function parseInvariant(raw: any): ParsedInvariant {
  const pred = raw.predicate || "";
  const desc = raw.description || "";

  // Parse "Production ⇒ Paid" pattern
  const impliesMatch = pred.match(/(\w+)\s*⇒\s*(\w+)/);
  // Parse "¬(A → B)" pattern
  const notImpliesMatch = pred.match(/¬\((\w+)\s*→\s*(\w+)\)/);
  // Parse "¬∃ next_state" pattern (terminal)
  const terminalMatch = pred.includes("¬∃ next_state");
  // Parse "at most one" / "unique" pattern
  const uniqueMatch = pred.includes("|payments") || pred.includes("≤ 1");

  let atom = "";
  let requires: string | null = null;
  let isTerminal = false;
  let isUnique = false;

  if (impliesMatch) {
    atom = impliesMatch[1].toLowerCase();
    if (impliesMatch[2] !== atom) { // Skip self-referential
      requires = impliesMatch[2].toLowerCase();
    }
  } else if (notImpliesMatch) {
    atom = notImpliesMatch[1].toLowerCase();
    requires = notImpliesMatch[2].toLowerCase();
  }

  if (terminalMatch) {
    isTerminal = true;
    // Extract atom: "shipped ⇒ ¬∃ next_state" → atom = "shipped"
    const termAtom = pred.match(/(\w+)\s*⇒\s*¬/);
    if (termAtom) atom = termAtom[1].toLowerCase();
  }

  if (uniqueMatch) {
    isUnique = true;
  }

  return {
    id: raw.id || "",
    description: desc,
    rawPredicate: pred,
    source: raw.sources?.[0] || "unknown",
    confidence: raw.confidence || 50,
    domain: raw.domain || "",
    atom,
    requires,
    isTerminal,
    isUnique,
  };
}

// ══════════════════════════════════════════════
// L2: CLOSURE — 推导传递性
// ══════════════════════════════════════════════

/**
 * Given a set of implications A⇒B, B⇒C, deduce A⇒C.
 * This is transitive closure of the implication graph.
 *
 * Also derive:
 *   - If A requires B and B requires C, then A requires C (transitivity)
 *   - If A is terminal and B requires A, then B is also terminal (terminal propagation)
 *   - If A is unique and B requires A, then B is also de-facto unique
 */
function computeClosure(proto: ProtocolObject): ParsedInvariant[] {
  const deduced: ParsedInvariant[] = [];
  const graph = proto.impliesGraph;
  let idCounter = 9000;

  // ── Transitivity: A⇒B ∧ B⇒C ⊢ A⇒C ──
  for (const [a, depsOfA] of graph) {
    for (const b of depsOfA) {
      const depsOfB = graph.get(b);
      if (depsOfB) {
        for (const c of depsOfB) {
          // A ⇒ B and B ⇒ C, so A ⇒ C
          if (!depsOfA.includes(c) && a !== c) {
            const desc = `${a} → ${b} 且 ${b} → ${c}，因此 ${a} ⇒ ${c}`;
            const existing = proto.invariants.find(i =>
              i.atom === a && i.requires === c
            );
            const existingDeduced = deduced.find(i =>
              i.atom === a && i.requires === c
            );
            if (!existing && !existingDeduced) {
              deduced.push({
                id: `DED-${idCounter++}`,
                description: desc,
                rawPredicate: `${a} ⇒ ${c}`,
                source: `closure: ${a}⇒${b} + ${b}⇒${c}`,
                confidence: 70,
                domain: proto.domain,
                atom: a,
                requires: c,
                isTerminal: false,
                isUnique: false,
              });
            }
          }
        }
      }
    }
  }

  // ── Terminal Propagation: A is terminal ∧ B ⇒ A ⊢ B is also on terminal path ──
  const terminalAtoms = new Set(
    proto.invariants.filter(i => i.isTerminal).map(i => i.atom)
  );
  for (const [a, depsOfA] of graph) {
    for (const b of depsOfA) {
      if (terminalAtoms.has(b) && !terminalAtoms.has(a)) {
        const existing = deduced.find(i => i.atom === a && i.isTerminal);
        if (!existing) {
          deduced.push({
            id: `DED-${idCounter++}`,
            description: `${a} ⇒ ${b} 且 ${b} 是终态，因此 ${a} 的路径必然通向终态`,
            rawPredicate: `${a} ⇒ TerminalPath`,
            source: `closure: ${a}⇒${b} + terminal(${b})`,
            confidence: 60,
            domain: proto.domain,
            atom: a,
            requires: null,
            isTerminal: true,
            isUnique: false,
          });
        }
      }
    }
  }

  return deduced;
}

// ══════════════════════════════════════════════
// L3: COMPOSITION — 合并两个 Protocol
// ══════════════════════════════════════════════

/**
 * Compose two protocols into one.
 * If Protocol A covers "Order" and Protocol B covers "Payment",
 * the composed protocol covers "Order + Payment" and preserves
 * the invariants of both.
 *
 * Cross-domain invariants are discovered when:
 *   - A state name appears in both protocols (shared atom)
 *   - An invariant in A's closure implies a constraint on B's domain
 */
function composeProtocols(a: ProtocolObject, b: ProtocolObject): ProtocolObject {
  const sharedAtoms = [...a.atoms].filter(atom => b.atoms.has(atom));

  // Cross-domain invariants: if both protocols share a state atom,
  // the invariants from both apply to the composition
  const crossInvariants: ParsedInvariant[] = [];
  let idCounter = 9500;

  for (const shared of sharedAtoms) {
    const invA = a.invariants.filter(i => i.atom === shared);
    const invB = b.invariants.filter(i => i.atom === shared);

    for (const ia of invA) {
      for (const ib of invB) {
        if (ia.requires && ib.requires && ia.requires !== ib.requires) {
          crossInvariants.push({
            id: `CROSS-${idCounter++}`,
            description: `在 ${a.domain} 和 ${b.domain} 的组合中，${shared} 同时要求 ${ia.requires}（来自 ${a.domain}）和 ${ib.requires}（来自 ${b.domain}）`,
            rawPredicate: `${shared} ⇒ (${ia.requires} ∧ ${ib.requires})`,
            source: `composition: ${a.domain} + ${b.domain} on ${shared}`,
            confidence: Math.min(ia.confidence, ib.confidence) - 10,
            domain: `${a.domain}+${b.domain}`,
            atom: shared,
            requires: null, // Composite: requires both
            isTerminal: ia.isTerminal || ib.isTerminal,
            isUnique: ia.isUnique || ib.isUnique,
          });
        }
      }
    }
  }

  // Merge implies graphs
  const mergedGraph = new Map<string, string[]>();
  for (const [k, v] of a.impliesGraph) {
    mergedGraph.set(k, [...(mergedGraph.get(k) || []), ...v]);
  }
  for (const [k, v] of b.impliesGraph) {
    mergedGraph.set(k, [...(mergedGraph.get(k) || []), ...v]);
  }

  return {
    name: `${a.name} + ${b.name}`,
    domain: `${a.domain}+${b.domain}`,
    invariants: [...a.invariants, ...b.invariants, ...crossInvariants],
    atoms: new Set([...a.atoms, ...b.atoms]),
    impliesGraph: mergedGraph,
    closure: [],
  };
}

// ══════════════════════════════════════════════
// L4: FUNCTOR — 跨实体一致性映射
// ══════════════════════════════════════════════

/**
 * A functor maps states from one entity to another.
 * If Order.paid maps to Inventory.reserved, then:
 *   ∀ transition in Order: ∃ corresponding transition in Inventory
 *
 * Functor preservation check:
 *   For each invariant A⇒B in the source protocol,
 *   check that F(A)⇒F(B) holds in the target protocol.
 *   If not, the functor is NOT preserved → governance violation.
 */
function checkFunctorPreservation(
  source: ProtocolObject,
  target: ProtocolObject,
  mapping: FunctorMapping[]
): ValidationResult {
  const violations: string[] = [];
  const deduced: string[] = [];

  for (const inv of source.invariants) {
    if (!inv.requires || inv.isTerminal) continue;

    // Find the mapping for this invariant's atoms
    const mapFrom = mapping.find(m =>
      m.fromEntity === source.domain &&
      m.fromState === inv.atom
    );
    const mapTo = mapping.find(m =>
      m.fromEntity === source.domain &&
      m.fromState === inv.requires
    );

    if (!mapFrom || !mapTo) continue;

    // Check: does the target protocol have F(A) ⇒ F(B)?
    const targetInv = target.invariants.find(i =>
      i.atom === mapFrom.toState &&
      i.requires === mapTo.toState
    );

    const targetDeduced = target.closure.find(i =>
      i.atom === mapFrom.toState &&
      i.requires === mapTo.toState
    );

    if (targetInv || targetDeduced) {
      // Functor preserved!
      deduced.push(
        `${source.domain}.${inv.atom} ⇒ ${source.domain}.${inv.requires} ` +
        `→ ${target.domain}.${mapFrom.toState} ⇒ ${target.domain}.${mapTo.toState} ✓`
      );
    } else {
      // Functor NOT preserved — possible governance gap
      violations.push(
        `${source.domain}.${inv.atom} ⇒ ${source.domain}.${inv.requires} ` +
        `has no corresponding mapping in ${target.domain}: ` +
        `${mapFrom.toState} ⇒ ${mapTo.toState} is MISSING`
      );
    }
  }

  return {
    isValid: violations.length === 0,
    violatedInvariants: violations,
    deducedInvariants: deduced,
    message: violations.length === 0
      ? `Functor ${source.domain} → ${target.domain} is preserved (${deduced.length} mappings verified)`
      : `Functor NOT preserved: ${violations.length} missing cross-entity constraints`,
  };
}

// ══════════════════════════════════════════════
// L5: THEOREM GENERATION
// ══════════════════════════════════════════════

/**
 * From a protocol system, generate theorems.
 * A theorem is a statement that MUST hold for any AI-generated code
 * that satisfies the discovered protocols.
 *
 * Theorem forms:
 *   1. "Any valid order must pass through payment before production"
 *   2. "No valid order can skip from created directly to shipped"
 *   3. "Every payment callback implies a ledger write"
 */
function generateTheorems(protocols: ProtocolObject[]): string[] {
  const theorems: string[] = [];

  for (const proto of protocols) {
    // Theorem 1: Path existence
    // If there's a chain A→B→C in the impliesGraph, then no valid path skips B
    for (const [a, depsOfA] of proto.impliesGraph) {
      for (const b of depsOfA) {
        const depsOfB = proto.impliesGraph.get(b);
        if (depsOfB) {
          for (const c of depsOfB) {
            if (!depsOfA.includes(c) && a !== c) {
              theorems.push(
                `Theorem (${proto.domain}): 任何有效的 ${a} → ${c} 路径必须经过 ${b}。` +
                `禁止直接从 ${a} 跳转到 ${c}。`
              );
            }
          }
        }
      }
    }

    // Theorem 2: Terminal irreversibility
    const terminals = proto.invariants.filter(i => i.isTerminal);
    for (const t of terminals) {
      theorems.push(
        `Theorem (${proto.domain}): 一旦进入 ${t.atom} 状态，系统不可回退。` +
        `所有前序状态均已完成。`
      );
    }
  }

  // Remove duplicates
  return [...new Set(theorems)];
}

// ══════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════

interface AlgebraReport {
  timestamp: string;
  protocols: ProtocolObject[];
  closureResults: { domain: string; deduced: number }[];
  compositionResult: ProtocolObject | null;
  functorResult: ValidationResult | null;
  theorems: string[];
}

export function runAlgebraEngine(projectPath: string): AlgebraReport {
  console.log("🔬 Progmune Invariant Algebra Engine — V4");
  console.log("   Project:", projectPath);

  // Load protocols from V3.4
  const protoPath = path.join(projectPath, ".progmune_protocols.json");
  if (!fs.existsSync(protoPath)) {
    console.log("   No protocols found. Run V3.4 first.");
    return { timestamp: new Date().toISOString(), protocols: [], closureResults: [], compositionResult: null, functorResult: null, theorems: [] };
  }

  const v34 = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
  const rawProtocols = v34.protocols || [];

  // ── Step 1: Parse all invariants ──
  console.log("\nL1 · Parsing invariants...");
  const protocols: ProtocolObject[] = [];

  for (const rp of rawProtocols) {
    const invariants = (rp.invariants || []).map(parseInvariant);
    const atoms = new Set<string>();
    const impliesGraph = new Map<string, string[]>();

    for (const inv of invariants) {
      if (inv.atom) atoms.add(inv.atom);
      if (inv.requires) {
        atoms.add(inv.requires);
        if (!impliesGraph.has(inv.atom)) impliesGraph.set(inv.atom, []);
        if (!impliesGraph.get(inv.atom)!.includes(inv.requires)) {
          impliesGraph.get(inv.atom)!.push(inv.requires);
        }
      }
    }

    protocols.push({
      name: rp.name || rp.domain,
      domain: rp.domain || "unknown",
      invariants,
      atoms,
      impliesGraph,
      closure: [],
    });
  }

  // ── Step 2: Compute closure for each protocol ──
  console.log("\nL2 · Computing closure...");
  const closureResults: { domain: string; deduced: number }[] = [];

  for (const proto of protocols) {
    const deduced = computeClosure(proto);
    proto.closure = deduced;
    closureResults.push({ domain: proto.domain, deduced: deduced.length });
    if (deduced.length > 0) {
      console.log(`   ${proto.domain}: ${deduced.length} new invariants deduced`);
      for (const d of deduced.slice(0, 3)) {
        console.log(`     ⊢ ${d.description}`);
      }
    }
  }

  // ── Step 3: Composition (if 2+ protocols exist) ──
  console.log("\nL3 · Composition...");
  let compositionResult: ProtocolObject | null = null;

  if (protocols.length >= 2) {
    // Find two protocols with overlapping atoms — those are composable
    let bestA = protocols[0], bestB = protocols[1], bestOverlap = 0;
    for (let i = 0; i < protocols.length; i++) {
      for (let j = i + 1; j < protocols.length; j++) {
        const overlap = [...protocols[i].atoms].filter(a => protocols[j].atoms.has(a)).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestA = protocols[i];
          bestB = protocols[j];
        }
      }
    }

    if (bestOverlap > 0) {
      compositionResult = composeProtocols(bestA, bestB);
      // Compute closure on the composition
      compositionResult.closure = computeClosure(compositionResult);
      console.log(`   Composed ${bestA.domain} + ${bestB.domain}: ${bestOverlap} shared atoms, ${compositionResult.invariants.length} total invariants, ${compositionResult.closure.length} new deductions`);
    } else {
      console.log("   No overlapping atoms — protocols are independent");
    }
  }

  // ── Step 4: Functor check ──
  console.log("\nL4 · Functor preservation...");
  let functorResult: ValidationResult | null = null;

  // Known functor mappings for PrintLab:
  // Order.paid → Inventory.reserved
  // Order.production → Inventory.consumed
  // Order.shipped → Notification.sent
  const mappings: FunctorMapping[] = [
    { fromEntity: "order_suppliers", fromState: "paid", toEntity: "inventory", toState: "reserved", description: "付款 → 库存预留" },
    { fromEntity: "order_suppliers", fromState: "production", toEntity: "inventory", toState: "consumed", description: "生产 → 库存消耗" },
    { fromEntity: "order_suppliers", fromState: "shipped", toEntity: "notifications", toState: "sent", description: "发货 → 通知发送" },
  ];

  const orderProto = protocols.find(p => p.domain.includes("order"));
  const inventoryProto = protocols.find(p => p.domain.includes("inventory"));

  if (orderProto) {
    // For now, check against self (since we don't have inventory protocol)
    // In production, this would check against the actual inventory protocol
    const targetProto = inventoryProto || orderProto; // Fallback to self for demo
    const relevantMappings = mappings.filter(m => m.fromEntity.includes(orderProto.domain));
    if (relevantMappings.length > 0) {
      functorResult = checkFunctorPreservation(orderProto, targetProto, relevantMappings);
      console.log(`   ${functorResult.message}`);
      if (functorResult.violatedInvariants.length > 0) {
        for (const v of functorResult.violatedInvariants.slice(0, 3)) {
          console.log(`     ❌ ${v}`);
        }
      }
    }
  }

  // ── Step 5: Theorem generation ──
  console.log("\nL5 · Theorem generation...");
  const theorems = generateTheorems(protocols);
  console.log(`   ${theorems.length} theorems generated`);
  for (const t of theorems.slice(0, 4)) {
    console.log(`   📐 ${t.slice(0, 120)}...`);
  }

  const report: AlgebraReport = {
    timestamp: new Date().toISOString(),
    protocols,
    closureResults,
    compositionResult,
    functorResult,
    theorems,
  };

  return report;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/invariant-algebra.ts <project-path>");
    process.exit(1);
  }

  const report = runAlgebraEngine(targetProject);

  const outputPath = path.join(targetProject, ".progmune_algebra.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Algebra report saved to: ${outputPath}`);

  const totalDeduced = report.closureResults.reduce((s, c) => s + c.deduced, 0);
  console.log("\n═══ Invariant Algebra Summary ═══");
  console.log(`  Protocols:     ${report.protocols.length}`);
  console.log(`  Deduced:       ${totalDeduced} new invariants via closure`);
  console.log(`  Composed:      ${report.compositionResult ? 'yes' : 'no'}`);
  console.log(`  Functor:       ${report.functorResult?.isValid ? 'preserved' : 'violations found'}`);
  console.log(`  Theorems:      ${report.theorems.length}`);
  console.log();
}
