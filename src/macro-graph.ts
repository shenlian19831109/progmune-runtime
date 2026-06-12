/**
 * P5.0: Hierarchical Macro Graph
 *
 * Lifts MacroRepairs from a flat catalog into a composable skill graph.
 * Each MacroNode is a "skill" with preconditions, actions, postconditions,
 * and reward, enabling hierarchical planning.
 *
 * AlphaGo Zero analogy:
 *   Primitive action = single function call
 *   Macro = 定式 (joseki) — a proven sequence that achieves a known outcome
 *   MacroGraph = opening book + pattern library
 *
 * Planner search depth is reduced by an order of magnitude when it
 * can search macro nodes instead of individual actions.
 */

import type { StateAnnotation } from "./ssg-validator";
import { mineMacroRepairs, MacroRepair } from "./macro-repair";
import { PlannerTelemetry } from "./planner-telemetry";

// ═══════════════════════════════════════════════════════════════
// Macro Graph Types
// ═══════════════════════════════════════════════════════════════

export interface MacroNode {
  id: string;
  /** Human-readable name of this skill. */
  name: string;
  /** Protocol namespace. */
  protocol: string;
  /** States required before this skill can be applied. */
  preconditions: string[];
  /** The action sequence this skill executes. */
  actions: string[];
  /** States produced or invalidated after execution. */
  postconditions: string[];
  /** Inferred reward (acceptance-based). */
  reward: number;
  /** How many times this skill was observed/used. */
  frequency: number;
  /** Original macro repair that spawned this node. */
  source?: MacroRepair;
}

export interface MacroEdge {
  from: string;  // source MacroNode id
  to: string;    // target MacroNode id
  /** How often these two macros appear adjacent in trajectories. */
  frequency: number;
  /** How often this transition leads to successful outcome. */
  successRate: number;
}

export interface MacroGraph {
  nodes: Map<string, MacroNode>;
  edges: MacroEdge[];
}

// ═══════════════════════════════════════════════════════════════
// State Inference
// ═══════════════════════════════════════════════════════════════

/** Infer pre/post conditions by running actions through protocol rules. */
function inferConditions(
  actions: string[],
  rules: Map<string, StateAnnotation>
): { preconditions: string[]; postconditions: string[] } {
  const pre = new Set<string>();
  const post = new Set<string>();
  const invalidated = new Set<string>();

  let current = new Set<string>();

  for (const fn of actions) {
    const rule = rules.get(fn);
    if (!rule) continue;

    // Preconditions: states needed before this action
    for (const p of rule.pre_states) {
      if (p.length > 0) pre.add(p);
    }

    // Apply state changes
    if (rule.invalidate) rule.invalidate.forEach(s => { invalidated.add(s); current.delete(s); });
    for (const p of rule.post_states) current.add(p);
  }

  // Postconditions: states active after all actions
  for (const s of current) post.add(s);
  // Final postconditions exclude initial preconditions
  const finalPost = [...post].filter(s => !pre.has(s));

  return {
    preconditions: [...pre],
    postconditions: [...finalPost, ...invalidated].map(s => s),
  };
}

// ═══════════════════════════════════════════════════════════════
// Macro Graph Builder
// ═══════════════════════════════════════════════════════════════

export class MacroGraphBuilder {
  private _graph: MacroGraph = { nodes: new Map(), edges: [] };

  /**
   * Learn macro nodes from telemetry data.
   * Mines MacroRepairs and converts them into MacroNodes with state conditions.
   */
  learnMacros(
    telemetry: PlannerTelemetry,
    rules: Map<string, StateAnnotation>,
    minAcceptance: number = 0.7,
    minFrequency: number = 3
  ): MacroGraph {
    const macros = mineMacroRepairs(telemetry, minAcceptance, minFrequency);

    for (const macro of macros) {
      const { preconditions, postconditions } = inferConditions(macro.actions, rules);
      const nodeId = macro.id;

      if (this._graph.nodes.has(nodeId)) continue;

      this._graph.nodes.set(nodeId, {
        id: nodeId,
        name: macro.actions.join(" → "),
        protocol: macro.protocol,
        preconditions,
        actions: macro.actions,
        postconditions,
        reward: macro.acceptanceRate * 0.7 + macro.executionSuccessRate * 0.3,
        frequency: macro.frequency,
        source: macro,
      });
    }

    // Link macros: find composable pairs (post of A matches pre of B)
    this.linkMacros();

    return this._graph;
  }

  /** Link macros into a composable graph based on state matching. */
  private linkMacros(): void {
    const nodeList = [...this._graph.nodes.values()];

    for (const a of nodeList) {
      for (const b of nodeList) {
        if (a.id === b.id) continue;

        // Check if A's postconditions satisfy B's preconditions
        const overlap = b.preconditions.filter(p => a.postconditions.includes(p));
        if (overlap.length > 0 || a.postconditions.length === 0 || b.preconditions.length === 0) {
          this._graph.edges.push({
            from: a.id, to: b.id,
            frequency: Math.min(a.frequency, b.frequency),
            successRate: a.reward * b.reward,
          });
        }
      }
    }
  }

  /**
   * Compose a chain of macros from start state to goal state.
   *
   * Uses the macro graph to find multi-step skill chains,
   * reducing the planner's search depth compared to action-level BFS.
   */
  compose(
    currentStates: string[],
    targetStates: string[],
    maxDepth: number = 5
  ): MacroNode[][] {
    const chains: MacroNode[][] = [];
    const currentSet = new Set(currentStates);
    const targetSet = new Set(targetStates);

    // Find macros whose preconditions are satisfied by current state
    const startable = [...this._graph.nodes.values()].filter(n =>
      n.preconditions.length === 0 || n.preconditions.every(p => currentSet.has(p))
    );

    // BFS over macro nodes
    const visited = new Set<string>();
    const queue: { macros: MacroNode[]; states: Set<string>; depth: number }[] =
      startable.map(m => ({ macros: [m], states: new Set([...currentStates, ...m.postconditions]), depth: 1 }));

    while (queue.length > 0 && chains.length < 10) {
      const { macros, states, depth } = queue.shift()!;
      if (depth > maxDepth) continue;

      // Check if target reached
      if (targetSet.size > 0 && targetStates.every(t => states.has(t))) {
        chains.push(macros);
        continue;
      }

      // Find next macro
      for (const node of this._graph.nodes.values()) {
        if (macros.some(m => m.id === node.id)) continue; // no cycles

        const preOk = node.preconditions.length === 0 || node.preconditions.every(p => states.has(p));
        if (!preOk) continue;

        const nextStates = new Set(states);
        for (const p of node.postconditions) nextStates.add(p);

        const key = macros.map(m => m.id).join("→") + "→" + node.id;
        if (visited.has(key)) continue;
        visited.add(key);

        queue.push({ macros: [...macros, node], states: nextStates, depth: depth + 1 });
      }
    }

    // Sort by total reward
    chains.sort((a, b) => {
      const rewardA = a.reduce((s, m) => s + m.reward, 0) / a.length;
      const rewardB = b.reduce((s, m) => s + m.reward, 0) / b.length;
      return rewardB - rewardA;
    });

    return chains;
  }

  /** Get all macro chains from the graph. */
  getAllMacroChains(maxDepth: number = 3): MacroNode[][] {
    const chains: MacroNode[][] = [];
    const nodeList = [...this._graph.nodes.values()];

    for (const start of nodeList) {
      // Find chains starting from this node (using graph edges)
      const visited = new Set<string>();
      const queue: { macros: MacroNode[]; depth: number }[] = [{ macros: [start], depth: 1 }];

      while (queue.length > 0 && chains.length < 50) {
        const { macros, depth } = queue.shift()!;
        if (depth > maxDepth) continue;

        if (macros.length > 1) chains.push(macros);

        const last = macros[macros.length - 1];
        const nextEdges = this._graph.edges.filter(e => e.from === last.id);

        for (const edge of nextEdges) {
          const next = this._graph.nodes.get(edge.to);
          if (!next) continue;
          const key = macros.map(m => m.id).join("→") + "→" + next.id;
          if (visited.has(key)) continue;
          visited.add(key);
          queue.push({ macros: [...macros, next], depth: depth + 1 });
        }
      }
    }

    chains.sort((a, b) => {
      const rA = a.reduce((s, m) => s + m.reward, 0) / a.length;
      const rB = b.reduce((s, m) => s + m.reward, 0) / b.length;
      return rB - rA;
    });

    return chains;
  }

  get graph(): MacroGraph { return this._graph; }
  get nodeCount(): number { return this._graph.nodes.size; }
  get edgeCount(): number { return this._graph.edges.length; }
}
