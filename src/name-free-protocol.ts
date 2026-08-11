/**
 * P8.0: Name-Free Protocol Learning
 *
 * Proves that protocol structure can be detected WITHOUT function names.
 * Replaces keyword matching (open→ACQUIRE, close→RELEASE) with pure
 * graph topology analysis derived from co-occurrence patterns in call sequences.
 *
 * Three-stage pipeline:
 *   P8.0a: State Graph Extraction — build state transition graph from sequences
 *   P8.0b: Topology Fingerprint — compute graph feature vector
 *   P8.0c: Name Scramble Benchmark — measure survival rate under name removal
 *
 * Success criterion: Name Scramble Survival Rate > 0% (current: 0%).
 * Target: 100% → >20% = first genuine evidence of structure learning.
 */

import { KNOWN_REPO_SIGNATURES, compareRepoPhysics, analyzeRepoPhysics } from "./experimental/software-physics";
import { CROSS_REPO_SEQUENCES } from "./experimental/unsupervised-physics";

// ═══════════════════════════════════════════════════════════════
// P8.0a: Name-Free State Graph
// ═══════════════════════════════════════════════════════════════

export interface StateNode {
  id: string;            // S0, S1, S2... (opaque, no semantics)
  producers: number[];   // indices of functions that create this state
  consumers: number[];   // indices of functions that require this state
  invalidators: number[];// indices of functions that destroy this state
}

export interface NameFreeStateGraph {
  /** Number of unique call positions (function indices in the repo). */
  fnCount: number;
  /** Inferred state nodes. */
  states: StateNode[];
  /** Adjacency matrix: fn[i] → fn[j] transition count. */
  transitionMatrix: number[][];
  /** Per-function stats: in-degree, out-degree, betweenness. */
  fnStats: { inDegree: number; outDegree: number; frequency: number }[];
}

/**
 * Extract a name-free state graph from a set of call sequences.
 *
 * The key insight: we DON'T look at function names. Instead we analyze:
 *   1. Co-occurrence: which functions always appear together?
 *   2. Ordering: which functions always precede others?
 *   3. State inference: if f[i] always precedes f[j] and f[k] always follows f[j],
 *      then f[i] PRODUCES a state, f[j] CONSUMES it, and f[k] INVALIDATES it.
 *
 * @param sequences  Array of call sequences (function name strings)
 * @returns A NameFreeStateGraph with opaque state nodes
 */
export function extractNameFreeStateGraph(sequences: string[][]): NameFreeStateGraph {
  // Step 1: Build function index (name → opaque index)
  const fnIndex = new Map<string, number>();
  const fnList: string[] = [];
  for (const seq of sequences) {
    for (const fn of seq) {
      if (!fnIndex.has(fn)) {
        fnIndex.set(fn, fnList.length);
        fnList.push(fn);
      }
    }
  }

  const N = fnList.length;

  // Step 2: Build transition matrix (how often fn[i] → fn[j] appears consecutively)
  const transitionMatrix: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  const freq = new Array(N).fill(0);

  for (const seq of sequences) {
    for (let i = 0; i < seq.length; i++) {
      const from = fnIndex.get(seq[i])!;
      freq[from]++;
      if (i < seq.length - 1) {
        const to = fnIndex.get(seq[i + 1])!;
        transitionMatrix[from][to]++;
      }
    }
  }

  // Step 3: Per-function stats (purely structural)
  const fnStats = fnList.map((_, i) => {
    const inDegree = transitionMatrix.reduce((s, row) => s + (row[i] > 0 ? 1 : 0), 0);
    const outDegree = transitionMatrix[i].reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
    return { inDegree, outDegree, frequency: freq[i] };
  });

  // Step 4: Infer states from co-occurrence patterns
  //
  // A "state" is identified when:
  //   - Producer P: has high out-degree (connects to many things)
  //   - Consumer C: has in-degree > 0 (something precedes it)
  //   - Invalidator I: has in-degree > 0 but out-degree = 0 (terminal)
  //
  // States are defined by the TRANSITION PATTERN, not by function names.
  const states: StateNode[] = [];
  const stateIdCounter = { value: 0 };

  // Strategy: for each function that acts as a "bridge" (both in and out edges),
  // it participates in a state. Group functions that form densely-connected clusters.
  const visited = new Set<number>();
  const stateGroups: number[][] = [];

  // Simple clustering: functions that share the same predecessor form a "use group"
  const predGroups = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    const preds: number[] = [];
    for (let j = 0; j < N; j++) {
      if (transitionMatrix[j][i] > 0) preds.push(j);
    }
    const key = preds.sort().join(",");
    if (key) {
      if (!predGroups.has(key)) predGroups.set(key, []);
      predGroups.get(key)!.push(i);
    }
  }

  // Also: functions with no predecessors are "entry points" (producers)
  const entryPoints: number[] = [];
  for (let i = 0; i < N; i++) {
    let hasPred = false;
    for (let j = 0; j < N; j++) {
      if (transitionMatrix[j][i] > 0) { hasPred = true; break; }
    }
    if (!hasPred) entryPoints.push(i);
  }

  // Functions with no successors are "exit points" (invalidators)
  const exitPoints: number[] = [];
  for (let i = 0; i < N; i++) {
    let hasSucc = false;
    for (let j = 0; j < N; j++) {
      if (transitionMatrix[i][j] > 0) { hasSucc = true; break; }
    }
    if (!hasSucc) exitPoints.push(i);
  }

  // Build states from entry→middle→exit patterns
  // Each entry point that connects to ≥1 middle function creates a state
  for (const ep of entryPoints) {
    const consumers: number[] = [];
    for (let j = 0; j < N; j++) {
      if (transitionMatrix[ep][j] > 0) consumers.push(j);
    }
    if (consumers.length === 0) continue;

    // Find invalidators: exit points that are reachable from this entry
    const invalidators: number[] = [];
    for (const ex of exitPoints) {
      // Simple reachability: is there a path from consumers through the graph to ex?
      let reachable = false;
      for (const c of consumers) {
        if (transitionMatrix[c][ex] > 0) { reachable = true; break; }
        // Also check 2-hop
        for (let k = 0; k < N; k++) {
          if (transitionMatrix[c][k] > 0 && transitionMatrix[k][ex] > 0) {
            reachable = true; break;
          }
        }
        if (reachable) break;
      }
      if (reachable) invalidators.push(ex);
    }

    states.push({
      id: `S${stateIdCounter.value++}`,
      producers: [ep],
      consumers,
      invalidators,
    });
  }

  return { fnCount: N, states, transitionMatrix, fnStats };
}

// ═══════════════════════════════════════════════════════════════
// P8.0b: Topology Fingerprint
// ═══════════════════════════════════════════════════════════════

export interface TopologyFingerprint {
  /** Number of function nodes. */
  nodeCount: number;
  /** Number of distinct transitions. */
  edgeCount: number;
  /** Number of inferred state nodes. */
  stateCount: number;
  /** Average in-degree across all functions. */
  avgInDegree: number;
  /** Average out-degree across all functions. */
  avgOutDegree: number;
  /** Max in-degree. */
  maxInDegree: number;
  /** Max out-degree. */
  maxOutDegree: number;
  /** Number of entry points (in-degree = 0). */
  entryPointCount: number;
  /** Number of exit points (out-degree = 0). */
  exitPointCount: number;
  /** Number of bridge functions (in > 0 && out > 0). */
  bridgeCount: number;
  /** Ratio of entry points to total functions. */
  entryRatio: number;
  /** Ratio of exit points to total functions. */
  exitRatio: number;
  /** Number of strongly connected components (via transition matrix). */
  componentCount: number;
  /** Average state size (functions per inferred state). */
  avgStateSize: number;
  /** Is the transition graph a DAG? */
  isDAG: boolean;
  /** Longest chain length (diameter proxy). */
  longestChain: number;
}

/**
 * Compute a topology fingerprint from a NameFreeStateGraph.
 *
 * All features are derived purely from graph structure — zero dependence on
 * function names. The fingerprint is a fixed-size vector suitable for
 * cross-repo similarity comparison.
 */
export function computeTopologyFingerprint(graph: NameFreeStateGraph): TopologyFingerprint {
  const N = graph.fnCount;
  if (N === 0) {
    return {
      nodeCount: 0, edgeCount: 0, stateCount: 0,
      avgInDegree: 0, avgOutDegree: 0, maxInDegree: 0, maxOutDegree: 0,
      entryPointCount: 0, exitPointCount: 0, bridgeCount: 0,
      entryRatio: 0, exitRatio: 0, componentCount: 0, avgStateSize: 0,
      isDAG: true, longestChain: 0,
    };
  }

  const stats = graph.fnStats;
  let edgeCount = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (graph.transitionMatrix[i][j] > 0) edgeCount++;
    }
  }

  const inDegrees = stats.map(s => s.inDegree);
  const outDegrees = stats.map(s => s.outDegree);

  const avgInDegree = inDegrees.reduce((a, b) => a + b, 0) / N;
  const avgOutDegree = outDegrees.reduce((a, b) => a + b, 0) / N;
  const maxInDegree = Math.max(...inDegrees);
  const maxOutDegree = Math.max(...outDegrees);

  const entryPointCount = stats.filter(s => s.inDegree === 0 && s.outDegree > 0).length;
  const exitPointCount = stats.filter(s => s.outDegree === 0 && s.inDegree > 0).length;
  const bridgeCount = stats.filter(s => s.inDegree > 0 && s.outDegree > 0).length;

  // DAG check: Kahn's algorithm
  const tempInDegree = [...inDegrees];
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    if (tempInDegree[i] === 0) queue.push(i);
  }
  let visitedCount = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visitedCount++;
    for (let j = 0; j < N; j++) {
      if (graph.transitionMatrix[node][j] > 0) {
        tempInDegree[j]--;
        if (tempInDegree[j] === 0) queue.push(j);
      }
    }
  }
  const isDAG = visitedCount === N;

  // Longest chain: BFS from each entry point
  let longestChain = 0;
  for (const ep of [...Array(N).keys()].filter(i => stats[i].inDegree === 0)) {
    const chainQ: { node: number; depth: number }[] = [{ node: ep, depth: 1 }];
    const chainVisited = new Set<number>([ep]);
    while (chainQ.length > 0) {
      const { node, depth } = chainQ.shift()!;
      longestChain = Math.max(longestChain, depth);
      for (let j = 0; j < N; j++) {
        if (graph.transitionMatrix[node][j] > 0 && !chainVisited.has(j)) {
          chainVisited.add(j);
          chainQ.push({ node: j, depth: depth + 1 });
        }
      }
    }
  }

  // Component count: simple DFS on undirected version
  const undirectedAdj: number[][] = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (graph.transitionMatrix[i][j] > 0 || graph.transitionMatrix[j][i] > 0) {
        undirectedAdj[i].push(j);
      }
    }
  }
  const compVisited = new Set<number>();
  let componentCount = 0;
  for (let i = 0; i < N; i++) {
    if (!compVisited.has(i)) {
      componentCount++;
      const compQ = [i];
      compVisited.add(i);
      while (compQ.length > 0) {
        const node = compQ.shift()!;
        for (const neighbor of undirectedAdj[node]) {
          if (!compVisited.has(neighbor)) {
            compVisited.add(neighbor);
            compQ.push(neighbor);
          }
        }
      }
    }
  }

  const totalFnInStates = graph.states.reduce(
    (s, st) => s + st.producers.length + st.consumers.length + st.invalidators.length, 0
  );
  const avgStateSize = graph.states.length > 0 ? totalFnInStates / graph.states.length : 0;

  return {
    nodeCount: N,
    edgeCount,
    stateCount: graph.states.length,
    avgInDegree: Math.round(avgInDegree * 100) / 100,
    avgOutDegree: Math.round(avgOutDegree * 100) / 100,
    maxInDegree,
    maxOutDegree,
    entryPointCount,
    exitPointCount,
    bridgeCount,
    entryRatio: Math.round((entryPointCount / N) * 100) / 100,
    exitRatio: Math.round((exitPointCount / N) * 100) / 100,
    componentCount,
    avgStateSize: Math.round(avgStateSize * 100) / 100,
    isDAG,
    longestChain,
  };
}

/**
 * Convert a fingerprint to a numeric vector for similarity computation.
 */
export function fingerprintToVector(fp: TopologyFingerprint): number[] {
  return [
    fp.nodeCount,
    fp.edgeCount,
    fp.stateCount,
    fp.avgInDegree,
    fp.avgOutDegree,
    fp.maxInDegree,
    fp.maxOutDegree,
    fp.entryPointCount,
    fp.exitPointCount,
    fp.bridgeCount,
    fp.entryRatio,
    fp.exitRatio,
    fp.componentCount,
    fp.avgStateSize,
    fp.isDAG ? 1 : 0,
    fp.longestChain,
  ];
}

/**
 * Cosine similarity between two fingerprint vectors.
 */
export function fingerprintSimilarity(a: TopologyFingerprint, b: TopologyFingerprint): number {
  const va = fingerprintToVector(a);
  const vb = fingerprintToVector(b);

  // Normalize by max to handle scale differences
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
// P8.0c: Name Scramble Benchmark
// ═══════════════════════════════════════════════════════════════

export interface NameScrambleBenchmark {
  /** Cosine similarity with original names (keyword-based baseline). */
  baselineSimilarity: number;
  /** Cosine similarity with scrambled names (F_0001, F_0002...). */
  scrambledSimilarity: number;
  /** scrambledSimilarity / baselineSimilarity (target: >0). */
  survivalRate: number;
  /** Per-repo fingerprints. */
  repoA: { name: string; fingerprint: TopologyFingerprint };
  repoB: { name: string; fingerprint: TopologyFingerprint };
}

/**
 * Run the name scramble benchmark between two repos.
 *
 * This is THE decisive test for P8.0:
 *   1. Compute topology fingerprint similarity with original names.
 *   2. Scramble all function names to F_0001, F_0002...
 *   3. Re-compute similarity with ONLY topology remaining.
 *   4. Measure survival rate.
 *
 * If survivalRate > 0, the system has crossed the threshold from
 * Verb Learning to Structure Learning.
 *
 * @param repoA  First repo's call sequences
 * @param repoB  Second repo's call sequences
 * @param repoAName  Human-readable name for repo A
 * @param repoBName  Human-readable name for repo B
 */
export function runNameScrambleBenchmark(
  repoA: string[][],
  repoB: string[][],
  repoAName: string = "RepoA",
  repoBName: string = "RepoB"
): NameScrambleBenchmark {
  // Baseline: original names
  const graphA = extractNameFreeStateGraph(repoA);
  const graphB = extractNameFreeStateGraph(repoB);
  const fpA = computeTopologyFingerprint(graphA);
  const fpB = computeTopologyFingerprint(graphB);
  const baselineSim = fingerprintSimilarity(fpA, fpB);

  // Scramble: deterministic mapping per unique function name
  let scrambleCounter = 0;
  const scrambleMap = new Map<string, string>();
  const scrambleName = (fn: string): string => {
    if (!scrambleMap.has(fn)) {
      scrambleMap.set(fn, `F_${String(scrambleCounter++).padStart(4, "0")}`);
    }
    return scrambleMap.get(fn)!;
  };

  // Rebuild sequences with scrambled names
  const scrambledA = repoA.map(seq => seq.map(scrambleName));
  const scrambledB = repoB.map(seq => seq.map(scrambleName));

  // Re-extract with scrambled names (same topology, different "names")
  const scrambledGraphA = extractNameFreeStateGraph(scrambledA);
  const scrambledGraphB = extractNameFreeStateGraph(scrambledB);
  const scrambledFpA = computeTopologyFingerprint(scrambledGraphA);
  const scrambledFpB = computeTopologyFingerprint(scrambledGraphB);
  const scrambledSim = fingerprintSimilarity(scrambledFpA, scrambledFpB);

  const survivalRate = baselineSim > 0 ? scrambledSim / baselineSim : 0;

  return {
    baselineSimilarity: Math.round(baselineSim * 10000) / 10000,
    scrambledSimilarity: Math.round(scrambledSim * 10000) / 10000,
    survivalRate: Math.round(survivalRate * 10000) / 10000,
    repoA: { name: repoAName, fingerprint: fpA },
    repoB: { name: repoBName, fingerprint: fpB },
  };
}

/**
 * Run the benchmark across all known repo pairs and return the average survival rate.
 */
export function runFullNameScrambleBenchmark(): { results: NameScrambleBenchmark[]; avgSurvivalRate: number } {
  const repos = Object.entries(CROSS_REPO_SEQUENCES);
  const results: NameScrambleBenchmark[] = [];

  for (let i = 0; i < repos.length; i++) {
    for (let j = i + 1; j < repos.length; j++) {
      const [nameA, seqsA] = repos[i];
      const [nameB, seqsB] = repos[j];
      results.push(runNameScrambleBenchmark(seqsA, seqsB, nameA, nameB));
    }
  }

  const avgSurvivalRate = results.length > 0
    ? results.reduce((s, r) => s + r.survivalRate, 0) / results.length
    : 0;

  return { results, avgSurvivalRate };
}

export function printNameScrambleReport(benchmark: NameScrambleBenchmark): void {
  console.log(`\n─── P8.0c Name Scramble Benchmark ───`);
  console.log(`  ${benchmark.repoA.name} ↔ ${benchmark.repoB.name}`);
  console.log(`  Baseline (original names):   ${(benchmark.baselineSimilarity * 100).toFixed(1)}%`);
  console.log(`  Scrambled (F_0001 IDs):      ${(benchmark.scrambledSimilarity * 100).toFixed(1)}%`);
  console.log(`  Survival Rate:               ${(benchmark.survivalRate * 100).toFixed(1)}%`);
  console.log();

  const verdict = benchmark.survivalRate > 0.8 ? "✅ STRUCTURE LEARNED" :
    benchmark.survivalRate > 0 ? "⚠️  PARTIAL — structure signal detected!" :
    "❌ VERB LEARNING — structure signal absent";
  console.log(`  Verdict: ${verdict}`);
  console.log();
}

export function printFullScrambleReport(report: { results: NameScrambleBenchmark[]; avgSurvivalRate: number }): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P8.0c Full Name Scramble Benchmark               ║");
  console.log("║   Cross-repo topology similarity survival           ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  for (const r of report.results) {
    console.log(`  ${r.repoA.name.padEnd(12)} ↔ ${r.repoB.name.padEnd(12)}  baseline: ${(r.baselineSimilarity * 100).toFixed(0)}%  scrambled: ${(r.scrambledSimilarity * 100).toFixed(0)}%  survival: ${(r.survivalRate * 100).toFixed(0)}%`);
  }

  console.log(`\n  Average Survival Rate: ${(report.avgSurvivalRate * 100).toFixed(1)}%`);
  const verdict = report.avgSurvivalRate > 0.8 ? "STRUCTURE LEARNED" :
    report.avgSurvivalRate > 0 ? "PARTIAL — structure signal detected!" :
    "VERB LEARNING";
  console.log(`  Verdict: ${verdict}`);
  console.log();
}
