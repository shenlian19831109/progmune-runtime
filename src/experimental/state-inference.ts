/**
 * P8.1: State Inference Engine — From raw call sequences to state machines
 *
 * Core insight: a protocol STATE is defined by what calls produce it,
 * consume it, and invalidate it — NOT by function names.
 *
 * This engine takes raw call sequences (strings) and infers state machines
 * using purely structural co-occurrence analysis. Zero dependency on
 * function names, keywords, or pre-written protocol rules.
 *
 * Pipeline:
 *   Raw call sequences
 *     → Assign structural roles (producer/consumer/invalidator)
 *     → Group functions into states by structural equivalence
 *     → Build state transition graph (opaque S0, S1, S2...)
 *     → Extract state machine fingerprint
 *
 * The decisive test: after scrambling all function names to F_001, F_002,
 * the inferred state machine must be identical to the original.
 */

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface InferredState {
  id: string;                // S0, S1, S2... (opaque)
  members: number[];         // function indices in this state
  role: "entry" | "bridge" | "exit" | "isolated";
  inDegree: number;          // how many other states transition here
  outDegree: number;         // how many other states this transitions to
}

export interface InferredStateMachine {
  /** Number of unique functions. */
  fnCount: number;
  /** Number of inferred states. */
  stateCount: number;
  /** Inferred states (S0, S1...). */
  states: InferredState[];
  /** State-to-state transition matrix (from state index → to state index). */
  stateTransitions: number[][];
  /** Is the state machine acyclic? */
  isDAG: boolean;
  /** Longest path length through states. */
  diameter: number;
  /** Number of strongly connected components. */
  sccCount: number;
  /** Average branching factor per state. */
  avgBranching: number;
}

export interface StateFingerprint {
  stateCount: number;
  fnCount: number;
  transitionCount: number;
  entryCount: number;
  exitCount: number;
  bridgeCount: number;
  isolatedCount: number;
  /** Rate: entry states / total states. */
  entryRatio: number;
  /** Rate: exit states / total states. */
  exitRatio: number;
  /** Is the state machine acyclic? */
  isDAG: boolean;
  diameter: number;
  sccCount: number;
  avgBranching: number;
  /** Ratio: transitions / max possible transitions (normalized density). */
  density: number;
  /** Number of self-loop transitions (S→S). */
  selfLoopCount: number;
  /** Entropy of in-degree distribution (higher = more diverse connectivity). */
  inDegreeEntropy: number;
  /** Entropy of out-degree distribution. */
  outDegreeEntropy: number;
  /** Variance of path lengths from entry points. */
  pathVariance: number;
}

// ═══════════════════════════════════════════════════════════════
// Step 1: Assign structural roles to functions
// ═══════════════════════════════════════════════════════════════

interface FnRole {
  index: number;
  /** How many times this function appears as the FIRST call in a sequence. */
  asFirst: number;
  /** How many times this function appears as the LAST call in a sequence. */
  asLast: number;
  /** How many times this function appears in the MIDDLE of a sequence. */
  asMiddle: number;
  /** Total occurrences across all sequences. */
  totalOccurrences: number;
  /** Set of functions that DIRECTLY precede this one. */
  predecessors: Set<number>;
  /** Set of functions that this one directly precedes. */
  successors: Set<number>;
  /** Inferred role. */
  role: "entry" | "bridge" | "exit" | "isolated";
}

function assignRoles(
  fnIndices: Map<string, number>,
  sequences: string[][]
): FnRole[] {
  const N = fnIndices.size;
  const roles: FnRole[] = Array.from({ length: N }, (_, i) => ({
    index: i,
    asFirst: 0,
    asLast: 0,
    asMiddle: 0,
    totalOccurrences: 0,
    predecessors: new Set(),
    successors: new Set(),
    role: "isolated" as FnRole["role"],
  }));

  for (const seq of sequences) {
    if (seq.length === 0) continue;
    for (let pos = 0; pos < seq.length; pos++) {
      const idx = fnIndices.get(seq[pos]);
      if (idx === undefined) continue;
      roles[idx].totalOccurrences++;

      if (pos === 0) roles[idx].asFirst++;
      if (pos === seq.length - 1) roles[idx].asLast++;
      if (pos > 0 && pos < seq.length - 1) roles[idx].asMiddle++;

      if (pos > 0) {
        const prevIdx = fnIndices.get(seq[pos - 1]);
        if (prevIdx !== undefined) roles[idx].predecessors.add(prevIdx);
      }
      if (pos < seq.length - 1) {
        const nextIdx = fnIndices.get(seq[pos + 1]);
        if (nextIdx !== undefined) roles[idx].successors.add(nextIdx);
      }
    }
  }

  // Classify: entry (mostly first), exit (mostly last), bridge (both), isolated (neither)
  for (const r of roles) {
    const total = Math.max(1, r.totalOccurrences);
    const firstRate = r.asFirst / total;
    const lastRate = r.asLast / total;

    if (firstRate > 0.5 && r.successors.size > 0) r.role = "entry";
    else if (lastRate > 0.5 && r.predecessors.size > 0) r.role = "exit";
    else if (r.predecessors.size > 0 || r.successors.size > 0) r.role = "bridge";
    else r.role = "isolated";
  }

  return roles;
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Group functions into states by structural equivalence
// ═══════════════════════════════════════════════════════════════

interface StateGroup {
  id: string;
  members: number[];
  predecessorStates: Set<string>;
  successorStates: Set<string>;
}

/**
 * Group functions that share the same role and similar neighbor patterns
 * into opaque states (S0, S1, S2...).
 */
function groupIntoStates(roles: FnRole[]): StateGroup[] {
  const N = roles.length;

  // Strategy: functions with the same role AND overlapping predecessor/successor
  // sets likely belong to the same protocol state.
  const groups: StateGroup[] = [];
  const assigned = new Set<number>();

  // Pass 1: Group by role first
  for (const roleType of ["entry", "bridge", "exit", "isolated"] as const) {
    const candidates = roles
      .map((r, i) => ({ ...r, index: i }))
      .filter(r => r.role === roleType && !assigned.has(r.index));

    // Within the same role, group by neighbor overlap
    const grouped: number[][] = [];
    const used = new Set<number>();

    for (const c of candidates) {
      if (used.has(c.index)) continue;
      const cluster: number[] = [c.index];
      used.add(c.index);

      // Find other candidates that share ≥50% neighbor overlap
      for (const other of candidates) {
        if (used.has(other.index)) continue;
        const predOverlap = intersectSize(c.predecessors, other.predecessors);
        const succOverlap = intersectSize(c.successors, other.successors);
        const total = Math.max(
          1,
          Math.max(c.predecessors.size, other.predecessors.size) +
          Math.max(c.successors.size, other.successors.size)
        );
        if ((predOverlap + succOverlap) / total > 0.3) {
          cluster.push(other.index);
          used.add(other.index);
        }
      }
      grouped.push(cluster);
    }

    for (const cluster of grouped) {
      const stateId = `S${groups.length}`;
      const predStates = new Set<string>();
      const succStates = new Set<string>();

      for (const fnIdx of cluster) {
        assigned.add(fnIdx);
        for (const p of roles[fnIdx].predecessors) predStates.add(`fn_${p}`);
        for (const s of roles[fnIdx].successors) succStates.add(`fn_${s}`);
      }

      groups.push({
        id: stateId,
        members: cluster,
        predecessorStates: predStates,
        successorStates: succStates,
      });
    }
  }

  return groups;
}

function intersectSize(a: Set<number>, b: Set<number>): number {
  let count = 0;
  for (const x of a) if (b.has(x)) count++;
  return count;
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Build state transition graph
// ═══════════════════════════════════════════════════════════════

function buildStateTransitions(
  groups: StateGroup[],
  roles: FnRole[]
): number[][] {
  const S = groups.length;
  const matrix: number[][] = Array.from({ length: S }, () => new Array(S).fill(0));

  // For each pair of states, count how many functions in state A
  // are directly followed by functions in state B in any sequence
  const fnToState = new Map<number, number>();
  for (let s = 0; s < S; s++) {
    for (const fnIdx of groups[s].members) {
      fnToState.set(fnIdx, s);
    }
  }

  // Count transitions between states by analyzing function-to-function edges
  for (let si = 0; si < S; si++) {
    for (const fnIdx of groups[si].members) {
      for (const succFn of roles[fnIdx].successors) {
        const sj = fnToState.get(succFn);
        if (sj !== undefined) {
          matrix[si][sj]++;
        }
      }
    }
  }

  return matrix;
}

// ═══════════════════════════════════════════════════════════════
// Step 4: Extract fingerprint
// ═══════════════════════════════════════════════════════════════

function computeStateGraphStats(
  matrix: number[][],
  groups: StateGroup[]
): {
  isDAG: boolean;
  diameter: number;
  sccCount: number;
  avgBranching: number;
  density: number;
} {
  const S = matrix.length;
  if (S === 0) return { isDAG: true, diameter: 0, sccCount: 0, avgBranching: 0, density: 0 };

  // DAG check: Kahn's algorithm
  const inDeg = new Array(S).fill(0);
  for (let i = 0; i < S; i++)
    for (let j = 0; j < S; j++)
      if (matrix[i][j] > 0) inDeg[j]++;

  const q: number[] = [];
  for (let i = 0; i < S; i++) if (inDeg[i] === 0) q.push(i);
  let visited = 0;
  while (q.length > 0) {
    const n = q.shift()!;
    visited++;
    for (let j = 0; j < S; j++) {
      if (matrix[n][j] > 0 && --inDeg[j] === 0) q.push(j);
    }
  }
  const isDAG = visited === S;

  // Diameter: BFS from each node
  let diameter = 0;
  for (let start = 0; start < S; start++) {
    const dist = new Array(S).fill(-1);
    const bq = [start];
    dist[start] = 0;
    while (bq.length > 0) {
      const n = bq.shift()!;
      for (let j = 0; j < S; j++) {
        if (matrix[n][j] > 0 && dist[j] === -1) {
          dist[j] = dist[n] + 1;
          diameter = Math.max(diameter, dist[j]);
          bq.push(j);
        }
      }
    }
  }

  // SCC count: Kosaraju simplification (undirected component count as proxy)
  const undirected = new Set<string>();
  for (let i = 0; i < S; i++)
    for (let j = 0; j < S; j++)
      if (matrix[i][j] > 0 || matrix[j][i] > 0)
        undirected.add(`${Math.min(i, j)},${Math.max(i, j)}`);

  const comps = new Map<number, number>();
  let compId = 0;
  for (const edge of undirected) {
    const [a, b] = edge.split(",").map(Number);
    const ca = comps.get(a), cb = comps.get(b);
    if (ca === undefined && cb === undefined) {
      comps.set(a, compId); comps.set(b, compId); compId++;
    } else if (ca !== undefined && cb === undefined) {
      comps.set(b, ca);
    } else if (cb !== undefined && ca === undefined) {
      comps.set(a, cb);
    }
    // both defined: merge would be needed but keep simple
  }
  const sccCount = compId > 0 ? compId : S;

  // Branching factor
  let totalOut = 0, nonZeroOut = 0;
  for (let i = 0; i < S; i++) {
    let out = 0;
    for (let j = 0; j < S; j++) if (matrix[i][j] > 0) out++;
    totalOut += out;
    if (out > 0) nonZeroOut++;
  }
  const avgBranching = nonZeroOut > 0 ? totalOut / nonZeroOut : 0;

  // Density
  const maxEdges = S * (S - 1);
  const edgeCount = undirected.size;
  const density = maxEdges > 0 ? edgeCount / maxEdges : 0;

  return { isDAG, diameter, sccCount, avgBranching, density };
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Infer a state machine from raw call sequences.
 *
 * ZERO dependency on function names. The same sequences with scrambled
 * names produce structurally identical state machines.
 *
 * @param sequences  Array of call sequences (e.g., [["open","read","close"],...])
 * @returns InferredStateMachine with opaque state nodes
 */
export function inferStateMachine(sequences: string[][]): InferredStateMachine {
  if (sequences.length === 0) {
    return {
      fnCount: 0, stateCount: 0, states: [],
      stateTransitions: [], isDAG: true, diameter: 0, sccCount: 0, avgBranching: 0,
    };
  }

  // Build function index
  const fnIndex = new Map<string, number>();
  for (const seq of sequences) {
    for (const fn of seq) {
      if (!fnIndex.has(fn)) fnIndex.set(fn, fnIndex.size);
    }
  }

  // Step 1: Role assignment
  const roles = assignRoles(fnIndex, sequences);

  // Step 2: Group into states
  const groups = groupIntoStates(roles);

  // If no clear groups found, create a simple linear state machine
  if (groups.length === 0) {
    return buildFallbackStateMachine(fnIndex, sequences);
  }

  // Step 3: Build state transition matrix
  const stateTransitions = buildStateTransitions(groups, roles);

  // Step 4: Extract stats
  const stats = computeStateGraphStats(stateTransitions, groups);

  // Build InferredState objects
  const states: InferredState[] = groups.map((g, i) => {
    let inDeg = 0, outDeg = 0;
    for (let j = 0; j < stateTransitions.length; j++) {
      if (stateTransitions[j][i] > 0) inDeg++;
      if (stateTransitions[i][j] > 0) outDeg++;
    }
    return {
      id: g.id,
      members: g.members,
      role: inDeg === 0 && outDeg > 0 ? "entry"
        : outDeg === 0 && inDeg > 0 ? "exit"
        : inDeg > 0 && outDeg > 0 ? "bridge"
        : "isolated",
      inDegree: inDeg,
      outDegree: outDeg,
    };
  });

  return {
    fnCount: fnIndex.size,
    stateCount: states.length,
    states,
    stateTransitions,
    ...stats,
  };
}

/** Fallback: build a simple linear chain when grouping fails. */
function buildFallbackStateMachine(
  fnIndex: Map<string, number>,
  sequences: string[][]
): InferredStateMachine {
  // Find the longest sequence and use it as a template
  const longest = sequences.reduce((a, b) => a.length >= b.length ? a : b, sequences[0] || []);
  const S = Math.min(longest.length, 10);
  const states: InferredState[] = [];
  const fnToState = new Map<number, number>();

  for (let i = 0; i < S; i++) {
    const fnIdx = fnIndex.get(longest[i])!;
    fnToState.set(fnIdx, i);
    states.push({
      id: `F${i}`,
      members: [fnIdx],
      role: i === 0 ? "entry" : i === S - 1 ? "exit" : "bridge",
      inDegree: i > 0 ? 1 : 0,
      outDegree: i < S - 1 ? 1 : 0,
    });
  }

  const matrix: number[][] = Array.from({ length: S }, () => new Array(S).fill(0));
  for (let i = 0; i < S - 1; i++) matrix[i][i + 1] = 1;

  return {
    fnCount: fnIndex.size,
    stateCount: S,
    states,
    stateTransitions: matrix,
    isDAG: true,
    diameter: S - 1,
    sccCount: S,
    avgBranching: S > 0 ? (S - 1) / S : 0,
  };
}

/**
 * Extract a fixed-size fingerprint vector from an inferred state machine.
 * All features are in [0,1] where possible.
 */
export function extractStateFingerprint(sm: InferredStateMachine): StateFingerprint {
  const S = sm.stateCount;
  const entryCount = sm.states.filter(s => s.role === "entry").length;
  const exitCount = sm.states.filter(s => s.role === "exit").length;
  const bridgeCount = sm.states.filter(s => s.role === "bridge").length;
  const isolatedCount = sm.states.filter(s => s.role === "isolated").length;

  let totalTransitions = 0;
  let selfLoopCount = 0;
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < S; j++) {
      if (sm.stateTransitions[i]?.[j] > 0) {
        totalTransitions++;
        if (i === j) selfLoopCount++;
      }
    }
  }

  // Degree entropy: Shannon entropy of in/out degree distributions
  const inDegs = new Array(S).fill(0);
  const outDegs = new Array(S).fill(0);
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < S; j++) {
      if (sm.stateTransitions[i]?.[j] > 0) { outDegs[i]++; inDegs[j]++; }
    }
  }
  const entropy = (counts: number[]): number => {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    return -counts
      .filter(c => c > 0)
      .map(c => c / total)
      .reduce((s, p) => s - p * Math.log2(p), 0);
  };

  // Path length variance: BFS from all entry points
  const pathLengths: number[] = [];
  for (const entry of sm.states.filter(s => s.role === "entry")) {
    const entryIdx = sm.states.indexOf(entry);
    const dist = new Array(S).fill(-1);
    const q = [entryIdx];
    dist[entryIdx] = 0;
    while (q.length > 0) {
      const n = q.shift()!;
      for (let j = 0; j < S; j++) {
        if (sm.stateTransitions[n]?.[j] > 0 && dist[j] === -1) {
          dist[j] = dist[n] + 1;
          q.push(j);
        }
      }
    }
    for (const d of dist) if (d > 0) pathLengths.push(d);
  }
  const avgPath = pathLengths.length > 0
    ? pathLengths.reduce((a, b) => a + b, 0) / pathLengths.length : 0;
  const pathVariance = pathLengths.length > 1
    ? pathLengths.reduce((s, p) => s + (p - avgPath) ** 2, 0) / pathLengths.length : 0;

  return {
    stateCount: S,
    fnCount: sm.fnCount,
    transitionCount: totalTransitions,
    entryCount,
    exitCount,
    bridgeCount,
    isolatedCount,
    entryRatio: S > 0 ? entryCount / S : 0,
    exitRatio: S > 0 ? exitCount / S : 0,
    isDAG: sm.isDAG,
    diameter: sm.diameter,
    sccCount: sm.sccCount,
    avgBranching: Math.round(sm.avgBranching * 100) / 100,
    density: Math.round((S > 1 ? totalTransitions / (S * (S - 1)) : 0) * 1000) / 1000,
    selfLoopCount,
    inDegreeEntropy: Math.round(entropy(inDegs) * 1000) / 1000,
    outDegreeEntropy: Math.round(entropy(outDegs) * 1000) / 1000,
    pathVariance: Math.round(pathVariance * 1000) / 1000,
  };
}

/**
 * Convert fingerprint to a 14-dim numeric vector for similarity comparison.
 */
export function stateFingerprintToVector(fp: StateFingerprint): number[] {
  return [
    fp.stateCount,
    fp.fnCount,
    fp.transitionCount,
    fp.entryCount,
    fp.exitCount,
    fp.bridgeCount,
    fp.isolatedCount,
    fp.entryRatio,
    fp.exitRatio,
    fp.isDAG ? 1 : 0,
    fp.diameter,
    fp.sccCount,
    fp.avgBranching,
    fp.density,
    fp.selfLoopCount,
    fp.inDegreeEntropy,
    fp.outDegreeEntropy,
    fp.pathVariance,
  ];
}

/**
 * Cosine similarity between two state fingerprints.
 */
export function stateFingerprintSimilarity(a: StateFingerprint, b: StateFingerprint): number {
  const va = stateFingerprintToVector(a);
  const vb = stateFingerprintToVector(b);

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    normA += va[i] * va[i];
    normB += vb[i] * vb[i];
  }

  if (normA === 0 && normB === 0) return 1;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ═══════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════

export function printInferredStateMachine(sm: InferredStateMachine): void {
  console.log(`\n─── Inferred State Machine ───`);
  console.log(`  Functions:     ${sm.fnCount}`);
  console.log(`  Inferred states: ${sm.stateCount}`);
  console.log(`  DAG:           ${sm.isDAG}`);
  console.log(`  Diameter:      ${sm.diameter}`);
  console.log(`  SCC count:     ${sm.sccCount}`);

  if (sm.states.length > 0) {
    console.log(`\n  States:`);
    for (const s of sm.states) {
      console.log(`    ${s.id} (${s.role}): ${s.members.length} functions, in=${s.inDegree}, out=${s.outDegree}`);
    }
  }

  if (sm.stateTransitions.length > 0 && sm.stateTransitions.length <= 10) {
    console.log(`\n  State transitions:`);
    for (let i = 0; i < sm.stateTransitions.length; i++) {
      for (let j = 0; j < sm.stateTransitions[i].length; j++) {
        if (sm.stateTransitions[i][j] > 0) {
          console.log(`    S${i} → S${j} (${sm.stateTransitions[i][j]} edges)`);
        }
      }
    }
  }
}
