/**
 * P9.1+P9.3: Protocol Invariant Mining, Violation Detection & Illegal Transitions
 *
 * Three detection modes:
 *   1. MISSING_STATE:  template has N states, test has M<N (resource leak, auth bypass)
 *   2. MISSING_EDGE:   template has transition A→B, test doesn't (broken lifecycle)
 *   3. ILLEGAL_EDGE:   test has transition that template NEVER allows (use-after-free, double-free)
 *
 * Mode 3 is P9.3: upgrades from "State Completeness" to "Protocol Correctness"
 */

import type { InferredStateMachine } from "./state-inference";
import { inferStateMachine } from "./state-inference";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type InvariantType = "MUST_RELEASE" | "MUST_COMMIT" | "MUST_PRECEDE";

export interface ProtocolInvariant {
  type: InvariantType;
  requiredState: string;
  triggerState: string;
  description: string;
  confidence: number;
}

export type ViolationSubtype = "missing_release" | "missing_prerequisite" | "missing_commit"
  | "illegal_transition" | "broken_lifecycle" | "other";

export interface InvariantViolation {
  invariant: ProtocolInvariant;
  sequence: string[];
  triggerIndex: number;
  description: string;
  violationSubtype: ViolationSubtype;
}

// ═══════════════════════════════════════════════════════════════
// Core Detection: Structural Violation (P9.1)
// ═══════════════════════════════════════════════════════════════

export function detectStructuralViolations(
  testSM: InferredStateMachine,
  templateSM: InferredStateMachine
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  const templateExits = templateSM.states.filter(s => s.role === "exit");
  const templateBridges = templateSM.states.filter(s => s.role === "bridge");

  // ── MODE 1: Missing State Detection ──

  if (templateSM.stateCount > testSM.stateCount) {
    violations.push({
      invariant: {
        type: "MUST_RELEASE",
        triggerState: "entry",
        requiredState: templateExits.map(e => e.id).join("|"),
        description: "Resource acquired must eventually be released",
        confidence: 0.95,
      },
      sequence: [],
      triggerIndex: 0,
      description: `Missing release: template has ${templateSM.stateCount} states, test has ${testSM.stateCount}. ${templateSM.stateCount - testSM.stateCount} state(s) missing — resource leak detected.`,
      violationSubtype: "missing_release",
    });
  }

  if (templateBridges.length > 0) {
    const testBridges = testSM.states.filter(s => s.role === "bridge");
    if (testBridges.length < templateBridges.length) {
      violations.push({
        invariant: {
          type: "MUST_PRECEDE",
          triggerState: "bridge",
          requiredState: "exit",
          description: "Verification bridge must precede privileged action",
          confidence: 0.9,
        },
        sequence: [],
        triggerIndex: 0,
        description: `Missing prerequisite: template has ${templateBridges.length} bridge state(s), test has ${testBridges.length}. Verification step skipped.`,
        violationSubtype: "missing_prerequisite",
      });
    }
  }

  // ── MODE 2: Missing Edge Detection (broken lifecycle) ──

  const templateEdges = extractEdgeSet(templateSM);
  const testEdges = extractEdgeSet(testSM);
  const missingEdges = [...templateEdges].filter(e => !testEdges.has(e));

  if (missingEdges.length > 0 && templateSM.stateCount <= testSM.stateCount + 1) {
    violations.push({
      invariant: {
        type: "MUST_COMMIT",
        triggerState: "bridge",
        requiredState: "exit",
        description: "Transaction must be completed with commit or rollback",
        confidence: 0.85,
      },
      sequence: [],
      triggerIndex: 0,
      description: `Incomplete lifecycle: template has ${templateEdges.size} transitions, test has ${testEdges.size}. Missing ${missingEdges.length} transition(s): ${missingEdges.slice(0,3).join(", ")}.`,
      violationSubtype: "missing_commit",
    });
  }

  // ── MODE 3 (P9.3): Illegal Transition Detection ──

  const illegalEdges = [...testEdges].filter(e => !templateEdges.has(e));

  if (illegalEdges.length > 0) {
    violations.push({
      invariant: {
        type: "MUST_RELEASE",
        triggerState: "any",
        requiredState: "any",
        description: "No transition in the template allows this state change",
        confidence: 0.95,
      },
      sequence: [],
      triggerIndex: 0,
      description: `Illegal transition detected: ${illegalEdges.length} edge(s) present in test but absent from template. Possible use-after-free, double-free, or auth bypass.`,
      violationSubtype: "illegal_transition",
    });
  }

  return violations;
}

function extractEdgeSet(sm: InferredStateMachine): Set<string> {
  const edges = new Set<string>();
  for (let i = 0; i < sm.stateTransitions.length; i++) {
    for (let j = 0; j < (sm.stateTransitions[i] || []).length; j++) {
      if (sm.stateTransitions[i][j] > 0) edges.add(`${i}→${j}`);
    }
  }
  return edges;
}

// ═══════════════════════════════════════════════════════════════
// Invariant Mining (from state machine)
// ═══════════════════════════════════════════════════════════════

import { InferredState } from "./state-inference";

export function mineInvariants(sm: InferredStateMachine): ProtocolInvariant[] {
  const invariants: ProtocolInvariant[] = [];
  if (sm.states.length === 0) return invariants;

  const entryStates = sm.states.filter(s => s.role === "entry");
  const exitStates = sm.states.filter(s => s.role === "exit");
  const bridgeStates = sm.states.filter(s => s.role === "bridge");

  for (const entry of entryStates) {
    for (const exit of exitStates) {
      if (exit.outDegree === 0 && entry.outDegree > 0) {
        if (findPath(sm, entry, exit)) {
          invariants.push({
            type: "MUST_RELEASE",
            triggerState: entry.id,
            requiredState: exit.id,
            description: `${entry.id} ⇒ Eventually ${exit.id} (resource acquired must be released)`,
            confidence: 0.9,
          });
          break;
        }
      }
    }
  }

  for (const bridge of bridgeStates) {
    const reachableExits = exitStates.filter(e => findPath(sm, bridge, e) !== null);
    if (reachableExits.length >= 2) {
      invariants.push({
        type: "MUST_COMMIT",
        triggerState: bridge.id,
        requiredState: reachableExits.map(e => e.id).join(" | "),
        description: `${bridge.id} ⇒ Eventually ${reachableExits.map(e => e.id).join(" | ")}`,
        confidence: 0.85,
      });
    }
  }

  for (const exit of exitStates) {
    const predecessors = bridgeStates.filter(b => findPath(sm, b, exit) !== null);
    if (predecessors.length > 0) {
      invariants.push({
        type: "MUST_PRECEDE",
        triggerState: predecessors.map(p => p.id).join(","),
        requiredState: exit.id,
        description: `${predecessors.map(p => p.id).join(" → ")} must precede ${exit.id}`,
        confidence: 0.8,
      });
    }
  }

  return invariants;
}

function findPath(sm: InferredStateMachine, from: InferredState, to: InferredState): number[] | null {
  const S = sm.states.length;
  const fromIdx = sm.states.indexOf(from);
  const toIdx = sm.states.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return null;

  const visited = new Set<number>();
  const parent = new Map<number, number>();
  const queue = [fromIdx];
  visited.add(fromIdx);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === toIdx) {
      const path = [curr];
      let node = curr;
      while (parent.has(node)) { node = parent.get(node)!; path.unshift(node); }
      return path;
    }
    for (let j = 0; j < S; j++) {
      if (sm.stateTransitions[curr]?.[j] > 0 && !visited.has(j)) {
        visited.add(j);
        parent.set(j, curr);
        queue.push(j);
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Sequence-based invariant checking (for inline use)
// ═══════════════════════════════════════════════════════════════

export function checkInvariants(
  sequence: string[],
  invariants: ProtocolInvariant[]
): InvariantViolation[] {
  if (sequence.length < 2 || invariants.length === 0) return [];
  const sm = inferStateMachine([sequence]);
  const violations: InvariantViolation[] = [];

  for (const inv of invariants) {
    const hasEntry = sm.states.some((s: InferredState) => s.role === "entry");
    const hasExit = sm.states.some((s: InferredState) => s.role === "exit");
    const hasBridge = sm.states.some((s: InferredState) => s.role === "bridge");

    if (hasEntry && !hasExit && inv.type === "MUST_RELEASE") {
      violations.push({
        invariant: inv, sequence, triggerIndex: 0,
        description: `Missing release: ${inv.description}`,
        violationSubtype: "missing_release",
      });
    }
    if (hasExit && !hasBridge && inv.type === "MUST_PRECEDE") {
      violations.push({
        invariant: inv, sequence, triggerIndex: 0,
        description: `Missing prerequisite: ${inv.description}`,
        violationSubtype: "missing_prerequisite",
      });
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════
// P9.3: Illegal Transition Detection (standalone)
// ═══════════════════════════════════════════════════════════════

export interface IllegalTransition {
  /** Source state index in test SM. */
  from: number;
  /** Target state index in test SM. */
  to: number;
  /** Why it's illegal. */
  reason: "not_in_template" | "reversed" | "double_free" | "self_loop_never_allowed";
}

/**
 * Find transitions in testSM that are NEVER allowed in templateSM.
 *
 * This detects:
 *   - use-after-free:  free → use (edge exists in test, not in template)
 *   - double-free:     free → free (self-loop not in template)
 *   - auth resurrection: logout → access (reversed edge)
 *   - rollback→commit  (cross-branch transition)
 */
export function detectIllegalTransitions(
  testSM: InferredStateMachine,
  templateSM: InferredStateMachine
): IllegalTransition[] {
  const templateEdges = extractEdgeSet(templateSM);
  const testEdges = extractEdgeSet(testSM);
  const illegal: IllegalTransition[] = [];

  for (const edge of testEdges) {
    if (templateEdges.has(edge)) continue;
    const [from, to] = edge.split("→").map(Number);

    // Check if the reverse edge exists in template (reversed transition)
    const reverseEdge = `${to}→${from}`;
    const isReversed = templateEdges.has(reverseEdge);

    // Check if it's a self-loop (possible double-free)
    const isSelfLoop = from === to;

    // Check if the template has ANY edge from this node
    const templateHasFrom = [...templateEdges].some(e => e.startsWith(`${from}→`));
    const templateHasTo = [...templateEdges].some(e => e.endsWith(`→${to}`));

    let reason: IllegalTransition["reason"] = "not_in_template";
    if (isSelfLoop && templateEdges.size > 0) reason = "double_free";
    else if (isReversed) reason = "reversed";
    else if (!templateHasFrom && templateHasTo) reason = "not_in_template";

    illegal.push({ from, to, reason });
  }

  return illegal;
}

// ═══════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════

export function printInvariants(invariants: ProtocolInvariant[]): void {
  console.log(`\n─── Mined Protocol Invariants (${invariants.length}) ───`);
  for (const inv of invariants) {
    const icon = inv.type === "MUST_RELEASE" ? "🔒" : inv.type === "MUST_COMMIT" ? "🔐" : "🔑";
    console.log(`  ${icon} [${inv.confidence.toFixed(0)}] ${inv.description}`);
  }
}

export function printViolations(violations: InvariantViolation[]): void {
  if (violations.length === 0) {
    console.log(`  ✅ No invariant violations detected.`);
    return;
  }
  console.log(`\n─── Invariant Violations (${violations.length}) ───`);
  for (const v of violations) {
    const icon = v.violationSubtype === "illegal_transition" ? "🚫" : "❌";
    console.log(`  ${icon} [${v.violationSubtype}] ${v.description}`);
    if (v.sequence.length > 0) console.log(`     Sequence: ${v.sequence.join(" → ")}`);
  }
}
