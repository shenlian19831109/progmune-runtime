"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MacroGraphBuilder = void 0;
const macro_repair_1 = require("./macro-repair");
// ═══════════════════════════════════════════════════════════════
// State Inference
// ═══════════════════════════════════════════════════════════════
/** Infer pre/post conditions — only preconditions NOT produced by the chain are true preconditions. */
function inferConditions(actions, rules) {
    const allPre = new Set();
    const produced = new Set();
    const invalidated = new Set();
    let current = new Set();
    for (const fn of actions) {
        const rule = rules.get(fn);
        if (!rule)
            continue;
        // Collect all preconditions needed at any step
        for (const p of rule.pre_states) {
            if (p.length > 0)
                allPre.add(p);
        }
        // Apply: invalidate current, then produce
        if (rule.invalidate)
            rule.invalidate.forEach(s => { invalidated.add(s); current.delete(s); });
        for (const p of rule.post_states) {
            current.add(p);
            produced.add(p);
        }
    }
    // True preconditions: needed but NOT produced by any action in the chain
    const preconditions = [...allPre].filter(p => !produced.has(p));
    // Postconditions: active states + invalidated states
    const postconditions = [...current, ...invalidated].filter(s => s.length > 0);
    return { preconditions, postconditions };
}
// ═══════════════════════════════════════════════════════════════
// Macro Graph Builder
// ═══════════════════════════════════════════════════════════════
class MacroGraphBuilder {
    constructor() {
        this._graph = { nodes: new Map(), edges: [] };
    }
    /**
     * Learn macro nodes from telemetry data.
     * Mines MacroRepairs and converts them into MacroNodes with state conditions.
     */
    learnMacros(telemetry, rules, minAcceptance = 0.7, minFrequency = 3) {
        const macros = (0, macro_repair_1.mineMacroRepairs)(telemetry, minAcceptance, minFrequency);
        for (const macro of macros) {
            const { preconditions, postconditions } = inferConditions(macro.actions, rules);
            const nodeId = macro.id;
            if (this._graph.nodes.has(nodeId))
                continue;
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
    linkMacros() {
        const nodeList = [...this._graph.nodes.values()];
        for (const a of nodeList) {
            for (const b of nodeList) {
                if (a.id === b.id)
                    continue;
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
    compose(currentStates, targetStates, maxDepth = 5) {
        const chains = [];
        const currentSet = new Set(currentStates);
        const targetSet = new Set(targetStates);
        // Find macros whose preconditions are satisfied by current state
        const startable = [...this._graph.nodes.values()].filter(n => n.preconditions.length === 0 || n.preconditions.every(p => currentSet.has(p)));
        // BFS over macro nodes
        const visited = new Set();
        const queue = startable.map(m => ({ macros: [m], states: new Set([...currentStates, ...m.postconditions]), depth: 1 }));
        while (queue.length > 0 && chains.length < 10) {
            const { macros, states, depth } = queue.shift();
            if (depth > maxDepth)
                continue;
            // Check if target reached
            if (targetSet.size > 0 && targetStates.every(t => states.has(t))) {
                chains.push(macros);
                continue;
            }
            // Find next macro
            for (const node of this._graph.nodes.values()) {
                if (macros.some(m => m.id === node.id))
                    continue; // no cycles
                const preOk = node.preconditions.length === 0 || node.preconditions.every(p => states.has(p));
                if (!preOk)
                    continue;
                const nextStates = new Set(states);
                for (const p of node.postconditions)
                    nextStates.add(p);
                const key = macros.map(m => m.id).join("→") + "→" + node.id;
                if (visited.has(key))
                    continue;
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
    getAllMacroChains(maxDepth = 3) {
        const chains = [];
        const nodeList = [...this._graph.nodes.values()];
        for (const start of nodeList) {
            // Find chains starting from this node (using graph edges)
            const visited = new Set();
            const queue = [{ macros: [start], depth: 1 }];
            while (queue.length > 0 && chains.length < 50) {
                const { macros, depth } = queue.shift();
                if (depth > maxDepth)
                    continue;
                if (macros.length > 1)
                    chains.push(macros);
                const last = macros[macros.length - 1];
                const nextEdges = this._graph.edges.filter(e => e.from === last.id);
                for (const edge of nextEdges) {
                    const next = this._graph.nodes.get(edge.to);
                    if (!next)
                        continue;
                    const key = macros.map(m => m.id).join("→") + "→" + next.id;
                    if (visited.has(key))
                        continue;
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
    get graph() { return this._graph; }
    get nodeCount() { return this._graph.nodes.size; }
    get edgeCount() { return this._graph.edges.length; }
}
exports.MacroGraphBuilder = MacroGraphBuilder;
