/**
 * P8.1: State Machine Learning — From static call graphs to dynamic state machines
 *
 * Core insight: protocol semantics live in STATE SPACE, not function space.
 * "Authenticate before query" is a state-machine constraint, not a naming convention.
 *
 * Unlike P8.0 (which compares function call graphs), P8.1 compares protocol
 * STATE MACHINES — states + allowed transitions + entry/exit nodes.
 * State machines inherently capture ordering, branching, and lifecycle.
 *
 * Three operations:
 *   1. extractStateMachine:   SSG rules → StateMachineFingerprint (name-free)
 *   2. compareStateMachines:  structural similarity between two state machines
 *   3. renameStates:          scramble state names (for State-Scramble test)
 */

import type { StateAnnotation } from "./ssg-validator";
import { loadDefaultProtocolDefinitions, parseProtocolDefinition } from "./protocol-coverage";

// ═══════════════════════════════════════════════════════════════
// State Machine Fingerprint
// ═══════════════════════════════════════════════════════════════

export interface StateTransition {
  from: string;
  to: string;
}

export interface StateMachineFingerprint {
  /** Number of states in the machine. */
  stateCount: number;
  /** Unique state-to-state transitions (directed edges). */
  transitions: StateTransition[];
  /** Per-state in-degree. */
  inDegrees: Map<string, number>;
  /** Per-state out-degree. */
  outDegrees: Map<string, number>;
  /** Entry states (in-degree == 0 or marked as initial). */
  entryStates: string[];
  /** Exit states (out-degree == 0 or invalidators that consume all). */
  exitStates: string[];
  /** States with self-loops (out-edges that go to themselves). */
  selfLoopStates: string[];
  /** Branching states (out-degree >= 2). */
  branchStates: string[];
  /** Merge states (in-degree >= 2). */
  mergeStates: string[];
  /** Is the state machine acyclic? */
  isDAG: boolean;
  /** Longest path length (diameter). */
  diameter: number;
  /** Number of connected components. */
  componentCount: number;
  /** States in the largest strongly connected component. */
  largestSCCSize: number;
  /** Average branching factor of non-exit states. */
  avgBranchingFactor: number;
}

/**
 * Extract a name-free state machine fingerprint from protocol rules.
 *
 * States are identified by their STRUCTURAL ROLE (entry, exit, branch, merge),
 * not by their semantic names (UNAUTHENTICATED, SESSION_ACTIVE, etc.).
 * Function names (verify_password, close_file) are ENTIRELY IGNORED.
 *
 * @param rules  Map of function → StateAnnotation (from protocols.json)
 * @returns Name-free StateMachineFingerprint
 */
export function extractStateMachine(
  rules: Map<string, StateAnnotation>
): StateMachineFingerprint {
  const stateSet = new Set<string>();
  const edgeSet = new Set<string>();  // "from→to"
  const transitions: StateTransition[] = [];
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  // Collect all states from pre_states, post_states, and invalidate arrays
  for (const [, rule] of rules) {
    for (const s of rule.pre_states) { stateSet.add(s); outDegree.set(s, (outDegree.get(s) || 0)); }
    for (const s of rule.post_states) { stateSet.add(s); inDegree.set(s, (inDegree.get(s) || 0)); }
    if (rule.invalidate) {
      for (const s of rule.invalidate) { stateSet.add(s); }
    }
  }

  // Add INIT as a synthetic state for rules with empty pre_states
  stateSet.add("INIT");

  for (const [, rule] of rules) {
    const pres = rule.pre_states.length > 0 ? rule.pre_states : ["INIT"];

    // Acquire transitions: pre → post
    for (const pre of pres) {
      for (const post of rule.post_states) {
        const key = `${pre}→${post}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          transitions.push({ from: pre, to: post });
          inDegree.set(post, (inDegree.get(post) || 0) + 1);
          outDegree.set(pre, (outDegree.get(pre) || 0) + 1);
        }
      }
    }

    // Invalidation transitions: state → ∅ (modeled as self-removal)
    if (rule.invalidate) {
      for (const inv of rule.invalidate) {
        const key = `${inv}→∅`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          transitions.push({ from: inv, to: "∅" });
          outDegree.set(inv, (outDegree.get(inv) || 0) + 1);
        }
      }
    }
  }

  // Ensure all states have entries in both degree maps
  for (const s of stateSet) {
    if (!inDegree.has(s)) inDegree.set(s, 0);
    if (!outDegree.has(s)) outDegree.set(s, 0);
  }

  // Classify states by structural role
  const entryStates: string[] = [];
  const exitStates: string[] = [];
  const selfLoopStates: string[] = [];
  const branchStates: string[] = [];
  const mergeStates: string[] = [];

  for (const s of stateSet) {
    const inDeg = inDegree.get(s) || 0;
    const outDeg = outDegree.get(s) || 0;

    if (inDeg === 0) entryStates.push(s);
    if (outDeg === 0) exitStates.push(s);
    if (outDeg >= 2) branchStates.push(s);
    if (inDeg >= 2) mergeStates.push(s);

    // Self-loop check
    if (edgeSet.has(`${s}→${s}`)) selfLoopStates.push(s);
  }

  // DAG check: Kahn's algorithm
  const tempInDeg = new Map(inDegree);
  const kahnQueue: string[] = [...stateSet].filter(s => (tempInDeg.get(s) || 0) === 0);
  let visitedCount = 0;
  while (kahnQueue.length > 0) {
    const node = kahnQueue.shift()!;
    visitedCount++;
    for (const t of transitions) {
      if (t.from === node) {
        const newDeg = (tempInDeg.get(t.to) || 1) - 1;
        tempInDeg.set(t.to, newDeg);
        if (newDeg === 0) kahnQueue.push(t.to);
      }
    }
  }
  const isDAG = visitedCount >= stateSet.size;

  // Diameter: BFS from each node
  let diameter = 0;
  const stateList = [...stateSet];
  const adj = new Map<string, string[]>();
  for (const s of stateList) adj.set(s, []);
  for (const t of transitions) {
    adj.get(t.from)?.push(t.to);
  }
  for (const start of stateList) {
    const dist = new Map<string, number>();
    const q = [start];
    dist.set(start, 0);
    while (q.length > 0) {
      const node = q.shift()!;
      const d = dist.get(node)! + 1;
      for (const next of (adj.get(node) || [])) {
        if (!dist.has(next)) {
          dist.set(next, d);
          diameter = Math.max(diameter, d);
          q.push(next);
        }
      }
    }
  }

  // Components: DFS on undirected version
  const undirected = new Map<string, string[]>();
  for (const s of stateList) undirected.set(s, []);
  for (const t of transitions) {
    undirected.get(t.from)?.push(t.to);
    undirected.get(t.to)?.push(t.from);
  }
  const compVisited = new Set<string>();
  let componentCount = 0;
  for (const s of stateList) {
    if (!compVisited.has(s)) {
      componentCount++;
      const q = [s];
      compVisited.add(s);
      while (q.length > 0) {
        for (const n of (undirected.get(q.shift()!) || [])) {
          if (!compVisited.has(n)) { compVisited.add(n); q.push(n); }
        }
      }
    }
  }

  // Average branching factor
  const nonExits = stateList.filter(s => (outDegree.get(s) || 0) > 0);
  const avgBF = nonExits.length > 0
    ? nonExits.reduce((s, x) => s + (outDegree.get(x) || 0), 0) / nonExits.length
    : 0;

  return {
    stateCount: stateSet.size,
    transitions,
    inDegrees: inDegree,
    outDegrees: outDegree,
    entryStates,
    exitStates,
    selfLoopStates,
    branchStates,
    mergeStates,
    isDAG,
    diameter,
    componentCount,
    largestSCCSize: 0, // simplified — SCC detection would need Tarjan's
    avgBranchingFactor: Math.round(avgBF * 100) / 100,
  };
}

/**
 * Rename all states to opaque IDs (S0, S1, S2...).
 * Used for the State-Scramble test: if similarity survives state renaming,
 * the system has genuinely learned state TRANSITION PATTERNS.
 */
export function renameStates(fp: StateMachineFingerprint): StateMachineFingerprint {
  const nameMap = new Map<string, string>();
  let counter = 0;
  const rename = (s: string): string => {
    if (s === "INIT" || s === "∅" || s === "INIT→") return s; // preserve synthetic markers
    if (!nameMap.has(s)) nameMap.set(s, `S${counter++}`);
    return nameMap.get(s)!;
  };

  const renameMap = (m: Map<string, number>): Map<string, number> => {
    const result = new Map<string, number>();
    for (const [k, v] of m) result.set(rename(k), v);
    return result;
  };

  return {
    ...fp,
    transitions: fp.transitions.map(t => ({ from: rename(t.from), to: rename(t.to) })),
    inDegrees: renameMap(fp.inDegrees),
    outDegrees: renameMap(fp.outDegrees),
    entryStates: fp.entryStates.map(rename),
    exitStates: fp.exitStates.map(rename),
    selfLoopStates: fp.selfLoopStates.map(rename),
    branchStates: fp.branchStates.map(rename),
    mergeStates: fp.mergeStates.map(rename),
  };
}

// ═══════════════════════════════════════════════════════════════
// State Machine Comparison
// ═══════════════════════════════════════════════════════════════

export interface StateMachineComparison {
  /** Overall structural similarity score (0-1). */
  similarity: number;
  /** Jaccard similarity of transition patterns (ignoring state names). */
  transitionPatternSimilarity: number;
  /** How similar are the state-count distributions? */
  stateCountRatio: number;
  /** How similar are the in/out degree distributions? */
  degreeProfileSimilarity: number;
  /** How similar are the structural role distributions? */
  roleProfileSimilarity: number;
  /** Do both have the same DAG property? */
  dagMatch: boolean;
}

/**
 * Compare two state machine fingerprints.
 *
 * Comparison is ENTIRELY structural — state names are never used.
 * Two machines are similar if they have:
 *   - Similar numbers of states (±20%)
 *   - Similar transition patterns (edge count, Jaccard on degree profiles)
 *   - Similar structural roles (entry/exit/branch/merge counts)
 *   - Same DAG property
 */
export function compareStateMachines(
  a: StateMachineFingerprint,
  b: StateMachineFingerprint
): StateMachineComparison {
  // 1. State count ratio (penalize large differences)
  const maxSC = Math.max(a.stateCount, b.stateCount);
  const minSC = Math.min(a.stateCount, b.stateCount);
  const stateCountRatio = maxSC > 0 ? minSC / maxSC : 1;

  // 2. Transition pattern: compare edge count
  const maxEdge = Math.max(a.transitions.length, b.transitions.length);
  const minEdge = Math.min(a.transitions.length, b.transitions.length);
  const transitionPatternSimilarity = maxEdge > 0 ? minEdge / maxEdge : 1;

  // 3. Degree profile similarity: compare distributions of in/out degrees
  const aInVals = [...a.inDegrees.values()].sort((x, y) => x - y);
  const bInVals = [...b.inDegrees.values()].sort((x, y) => x - y);
  const aOutVals = [...a.outDegrees.values()].sort((x, y) => x - y);
  const bOutVals = [...b.outDegrees.values()].sort((x, y) => x - y);

  const mean = (arr: number[]) => arr.length > 0 ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
  const maxv = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;
  const minv = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : 0;

  const distSim = (valsA: number[], valsB: number[]): number => {
    const mA = mean(valsA), mB = mean(valsB);
    const maxA = maxv(valsA), maxB = maxv(valsB);
    const minA = minv(valsA), minB = minv(valsB);
    const meanSim = Math.max(mA, mB) > 0 ? Math.min(mA, mB) / Math.max(mA, mB) : 1;
    const rangeSim = Math.max(maxA, maxB) > 0 ? Math.min(maxA, maxB) / Math.max(maxA, maxB) : 1;
    return (meanSim + rangeSim) / 2;
  };

  const inSim = distSim(aInVals, bInVals);
  const outSim = distSim(aOutVals, bOutVals);
  const degreeProfileSimilarity = (inSim + outSim) / 2;

  // 4. Structural role counts
  const roles = [
    a.entryStates.length, a.exitStates.length,
    a.branchStates.length, a.mergeStates.length, a.selfLoopStates.length,
    b.entryStates.length, b.exitStates.length,
    b.branchStates.length, b.mergeStates.length, b.selfLoopStates.length,
  ];

  let roleDot = 0, roleNormA = 0, roleNormB = 0;
  for (let i = 0; i < 5; i++) {
    roleDot += roles[i] * roles[i + 5];
    roleNormA += roles[i] * roles[i];
    roleNormB += roles[i + 5] * roles[i + 5];
  }
  const roleProfileSimilarity = (roleNormA > 0 && roleNormB > 0)
    ? roleDot / (Math.sqrt(roleNormA) * Math.sqrt(roleNormB))
    : 1;

  // 5. DAG match
  const dagMatch = a.isDAG === b.isDAG;

  // Overall: weighted combination
  const similarity =
    stateCountRatio * 0.20 +
    transitionPatternSimilarity * 0.25 +
    degreeProfileSimilarity * 0.25 +
    roleProfileSimilarity * 0.25 +
    (dagMatch ? 0.05 : 0);

  return {
    similarity: Math.round(similarity * 10000) / 10000,
    transitionPatternSimilarity: Math.round(transitionPatternSimilarity * 10000) / 10000,
    stateCountRatio: Math.round(stateCountRatio * 10000) / 10000,
    degreeProfileSimilarity: Math.round(degreeProfileSimilarity * 10000) / 10000,
    roleProfileSimilarity: Math.round(roleProfileSimilarity * 10000) / 10000,
    dagMatch,
  };
}

// ═══════════════════════════════════════════════════════════════
// Convenience: extract from protocol definitions
// ═══════════════════════════════════════════════════════════════

/**
 * Extract state machine fingerprints for all 9 protocol groups.
 */
export function extractAllProtocolStateMachines(): Map<string, StateMachineFingerprint> {
  const defs = loadDefaultProtocolDefinitions();
  const result = new Map<string, StateMachineFingerprint>();
  for (const p of defs) {
    result.set(p.name, extractStateMachine(p.rules));
  }
  return result;
}

/**
 * Compare all protocol pairs and return sorted results.
 */
export function compareAllProtocolStateMachines(): {
  protocolA: string;
  protocolB: string;
  comparison: StateMachineComparison;
}[] {
  const machines = extractAllProtocolStateMachines();
  const results: { protocolA: string; protocolB: string; comparison: StateMachineComparison }[] = [];
  const names = [...machines.keys()];

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      results.push({
        protocolA: names[i],
        protocolB: names[j],
        comparison: compareStateMachines(machines.get(names[i])!, machines.get(names[j])!),
      });
    }
  }

  return results.sort((a, b) => b.comparison.similarity - a.comparison.similarity);
}

export function printStateMachineComparison(comparison: StateMachineComparison): void {
  console.log(`  similarity:               ${(comparison.similarity * 100).toFixed(1)}%`);
  console.log(`  transition pattern:       ${(comparison.transitionPatternSimilarity * 100).toFixed(0)}%`);
  console.log(`  state count ratio:        ${(comparison.stateCountRatio * 100).toFixed(0)}%`);
  console.log(`  degree profile:           ${(comparison.degreeProfileSimilarity * 100).toFixed(0)}%`);
  console.log(`  role profile:             ${(comparison.roleProfileSimilarity * 100).toFixed(0)}%`);
  console.log(`  DAG match:                ${comparison.dagMatch}`);
}
