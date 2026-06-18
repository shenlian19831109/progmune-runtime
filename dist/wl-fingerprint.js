"use strict";
/**
 * P8.3a: Weisfeiler-Lehman Graph Kernel for Protocol State Machines
 *
 * Upgrades from 18-dim statistical histogram to subgraph-pattern-based
 * fingerprint. WL iteratively relabels nodes based on their neighborhood
 * multiset, capturing k-hop topology that statistical features miss.
 *
 * Why WL: naturally suited to small graphs, parameter-free, captures
 * branching patterns, cycles, and neighborhood structures without
 * training data. The result is a 256-dim histogram vector.
 *
 * Pipeline:
 *   State Graph (nodes + edges)
 *     → Initialize node labels (degree-based)
 *     → Iterate k times: relabel by neighbor multiset hash
 *     → Collect all labels across all iterations
 *     → Histogram vector (256-dim)
 *
 * Reference: Weisfeiler-Lehman Graph Kernels (Shervashidze et al., JMLR 2011)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wlRelabel = wlRelabel;
exports.extractWLFingerprint = extractWLFingerprint;
exports.wlSimilarity = wlSimilarity;
exports.printWLReport = printWLReport;
// ═══════════════════════════════════════════════════════════════
// WL Relabeling
// ═══════════════════════════════════════════════════════════════
/**
 * Run WL relabeling on a state transition graph.
 *
 * @param adj  Adjacency list (state index → neighbor state indices)
 * @param iterations  Number of WL iterations (default 3)
 * @returns Array of label sequences per iteration (labels[iter][node])
 */
function wlRelabel(adj, iterations = 3) {
    const N = adj.length;
    if (N === 0)
        return [];
    const labels = [];
    let currentLabels = new Array(N).fill(0);
    // Initialize: label = degree (structural role)
    for (let i = 0; i < N; i++) {
        currentLabels[i] = adj[i].length;
    }
    labels.push([...currentLabels]);
    let nextLabelId = Math.max(...currentLabels) + 1;
    const labelMap = new Map();
    for (let iter = 0; iter < iterations; iter++) {
        const newLabels = new Array(N).fill(0);
        for (let node = 0; node < N; node++) {
            // Build neighbor multiset signature: current_label + sorted(neighbor_labels)
            const neighborLabels = [];
            for (const nb of adj[node]) {
                neighborLabels.push(currentLabels[nb]);
            }
            neighborLabels.sort((a, b) => a - b);
            const sig = `${currentLabels[node]}:${neighborLabels.join(",")}`;
            // Assign new label (hash to compact range)
            let label = labelMap.get(sig);
            if (label === undefined) {
                label = nextLabelId++;
                labelMap.set(sig, label);
            }
            newLabels[node] = label;
        }
        currentLabels = newLabels;
        labels.push([...currentLabels]);
    }
    return labels;
}
const DIMS = 256;
/**
 * Extract a WL fingerprint from an inferred state machine.
 *
 * Converts the state transition matrix to an adjacency list,
 * runs WL relabeling, and bins all labels into a fixed-size histogram.
 */
function extractWLFingerprint(sm, iterations = 3) {
    const S = sm.stateCount;
    if (S === 0) {
        return { vector: new Array(DIMS).fill(0), dims: DIMS, uniqueLabels: 0, iterations };
    }
    // Build adjacency list from state transition matrix
    const adj = Array.from({ length: S }, () => []);
    if (sm.stateTransitions.length > 0) {
        for (let i = 0; i < S; i++) {
            const row = sm.stateTransitions[i] || [];
            for (let j = 0; j < row.length; j++) {
                if (row[j] > 0) {
                    adj[i].push(j);
                    // Also add reverse edge for undirected WL (captures symmetric patterns)
                    if (!adj[j].includes(i))
                        adj[j].push(i);
                }
            }
        }
    }
    // If no transitions, use state roles as adjacency
    if (adj.every(a => a.length === 0)) {
        for (let i = 0; i < S - 1; i++) {
            adj[i].push(i + 1);
            adj[i + 1].push(i);
        }
    }
    // Run WL relabeling
    const allLabels = wlRelabel(adj, iterations);
    // Collect all labels across all iterations
    const allValues = [];
    for (const iterLabels of allLabels) {
        allValues.push(...iterLabels);
    }
    // Bin into fixed-size histogram
    const vector = new Array(DIMS).fill(0);
    const uniqueSet = new Set(allValues);
    const maxLabel = Math.max(1, ...allValues);
    for (const label of allValues) {
        const bin = Math.floor((label / maxLabel) * (DIMS - 1));
        vector[Math.min(bin, DIMS - 1)]++;
    }
    // Normalize to unit vector
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
        for (let i = 0; i < DIMS; i++) {
            vector[i] /= norm;
        }
    }
    return {
        vector,
        dims: DIMS,
        uniqueLabels: uniqueSet.size,
        iterations,
    };
}
// ═══════════════════════════════════════════════════════════════
// Similarity
// ═══════════════════════════════════════════════════════════════
/**
 * Cosine similarity between two WL fingerprint vectors.
 */
function wlSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.dims; i++) {
        dot += a.vector[i] * b.vector[i];
        normA += a.vector[i] * a.vector[i];
        normB += b.vector[i] * b.vector[i];
    }
    if (normA === 0 && normB === 0)
        return 1;
    if (normA === 0 || normB === 0)
        return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
// ═══════════════════════════════════════════════════════════════
// Test: does WL discriminate where 18-dim stats fail?
// ═══════════════════════════════════════════════════════════════
function printWLReport(fp) {
    console.log(`  Dims: ${fp.dims}, Unique labels: ${fp.uniqueLabels}, Iterations: ${fp.iterations}`);
    const nonZero = fp.vector.filter(v => v > 0).length;
    console.log(`  Non-zero bins: ${nonZero}/${fp.dims} (${(nonZero / fp.dims * 100).toFixed(0)}%)`);
}
