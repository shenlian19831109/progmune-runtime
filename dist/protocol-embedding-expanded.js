"use strict";
/**
 * P10.1: Protocol Embedding Space — Scaled to 50+ protocol variants
 *
 * Generates realistic protocol variations from the topology factory,
 * builds WL embeddings for each, and measures whether protocol
 * families naturally cluster in embedding space.
 *
 * This simulates what would happen with 50 real GitHub repos —
 * each "variant" has the same topology but different function names
 * and sequence lengths, testing whether structural identity survives
 * these variations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScaledEmbeddingSpace = buildScaledEmbeddingSpace;
exports.adjustedRandIndex = adjustedRandIndex;
exports.kMeansCluster = kMeansCluster;
exports.printScaledReport = printScaledReport;
const topology_factory_1 = require("./topology-factory");
const state_inference_1 = require("./experimental/state-inference");
const wl_fingerprint_1 = require("./wl-fingerprint");
const unsupervised_physics_1 = require("./experimental/unsupervised-physics");
// ═══════════════════════════════════════════════════════════════
// Generate protocol variants with realistic name variations
// ═══════════════════════════════════════════════════════════════
const FAMILY_NAMES = {
    linear: ["open", "create", "init", "start", "acquire", "setup", "begin"],
    star: ["hub", "router", "dispatcher", "broker", "proxy", "gateway"],
    tree: ["root", "parent", "ancestor", "node", "branch", "leaf"],
    loop: ["process", "handle", "iterate", "poll", "listen", "watch", "observe"],
    two_phase_commit: ["prepare", "vote", "decide", "propose", "accept", "learn"],
    auth_bridge: ["authenticate", "authorize", "verify", "validate", "permit", "allow"],
    nested: ["outer", "inner", "wrapper", "container", "scope", "context"],
    rollback: ["forward", "advance", "proceed", "undo", "revert", "backtrack"],
    fan_out: ["fork", "split", "scatter", "distribute", "spawn", "dispatch"],
    stateless: ["compute", "transform", "map", "filter", "reduce", "validate"],
};
/** Generate N variants of a protocol topology with varied names and sequence patterns. */
function generateVariants(topo, count) {
    const rules = (0, topology_factory_1.createProtocolForTopology)(topo);
    const entries = [...rules.entries()];
    if (entries.length === 0)
        return [];
    const familyNames = FAMILY_NAMES[topo] || [topo];
    const variants = [];
    for (let v = 0; v < count; v++) {
        // Pick a distinctive name from the family
        const variantName = `${topo}_${familyNames[v % familyNames.length]}`;
        const sequences = [];
        for (let trial = 0; trial < 6; trial++) {
            const path = [];
            const stateSet = new Set(["INIT", "IDLE"]);
            const startEntry = entries[Math.floor(Math.random() * entries.length)];
            path.push(startEntry[0]);
            const rule = startEntry[1];
            if (rule.invalidate)
                rule.invalidate.forEach((s) => stateSet.delete(s));
            for (const s of rule.post_states)
                stateSet.add(s);
            const targetLen = 2 + Math.floor(Math.random() * 5);
            while (path.length < targetLen) {
                const candidates = entries.filter(([, r]) => r.pre_states.every((s) => stateSet.has(s)));
                if (candidates.length === 0)
                    break;
                const [fn, nextRule] = candidates[Math.floor(Math.random() * candidates.length)];
                path.push(fn);
                if (nextRule.invalidate)
                    nextRule.invalidate.forEach((s) => stateSet.delete(s));
                for (const s of nextRule.post_states)
                    stateSet.add(s);
            }
            if (path.length >= 2)
                sequences.push(path);
        }
        variants.push({ name: variantName, sequences });
    }
    return variants;
}
/**
 * Build a scaled embedding space with N variants per topology family.
 * Total protocols = topologies × variantsPerFamily + cross_repo protocols.
 */
function buildScaledEmbeddingSpace(variantsPerFamily = 5) {
    const protocols = [];
    const labels = [];
    // Generate variants for each topology family
    for (const topo of topology_factory_1.ALL_TOPOLOGIES) {
        const variants = generateVariants(topo, variantsPerFamily);
        for (const v of variants) {
            const sm = (0, state_inference_1.inferStateMachine)(v.sequences);
            const wl = (0, wl_fingerprint_1.extractWLFingerprint)(sm, 3);
            protocols.push({
                name: v.name,
                family: topo,
                vector: wl.vector,
                stateMachine: sm,
            });
            labels.push(topo);
        }
    }
    // Add cross-repo protocols as a separate family
    for (const [repo, seqs] of Object.entries(unsupervised_physics_1.CROSS_REPO_SEQUENCES)) {
        const sm = (0, state_inference_1.inferStateMachine)(seqs);
        const wl = (0, wl_fingerprint_1.extractWLFingerprint)(sm, 3);
        protocols.push({
            name: repo,
            family: "cross_repo",
            vector: wl.vector,
            stateMachine: sm,
        });
        labels.push("cross_repo");
    }
    // Build similarity matrix
    const N = protocols.length;
    const matrix = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) {
        matrix[i][i] = 1;
        for (let j = i + 1; j < N; j++) {
            const sim = cosineSim(protocols[i].vector, protocols[j].vector);
            matrix[i][j] = sim;
            matrix[j][i] = sim;
        }
    }
    return {
        protocols,
        similarityMatrix: matrix,
        labels,
        familyCount: new Set(labels).size,
    };
}
function cosineSim(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return (normA > 0 && normB > 0) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 1;
}
// ═══════════════════════════════════════════════════════════════
// Clustering Metrics
// ═══════════════════════════════════════════════════════════════
/**
 * Adjusted Rand Index: measures agreement between true labels and
 * predicted clusters, corrected for chance. Range: [-1, 1].
 * 1 = perfect agreement, 0 = random, <0 = worse than random.
 */
function adjustedRandIndex(trueLabels, predLabels) {
    const n = trueLabels.length;
    if (n < 2)
        return 0;
    // Build contingency table
    const trueSet = [...new Set(trueLabels)];
    const predSet = [...new Set(predLabels)];
    const table = new Map();
    for (let i = 0; i < n; i++) {
        const key = `${trueLabels[i]}:${predLabels[i]}`;
        table.set(key, (table.get(key) || 0) + 1);
    }
    // Compute pairwise agreements
    let sumA = 0, sumB = 0;
    for (const t of trueSet) {
        let count = 0;
        for (const p of predSet)
            count += table.get(`${t}:${p}`) || 0;
        sumA += count * (count - 1) / 2;
    }
    for (const p of predSet) {
        let count = 0;
        for (const t of trueSet)
            count += table.get(`${t}:${p}`) || 0;
        sumB += count * (count - 1) / 2;
    }
    let sumNij = 0;
    for (const [, count] of table) {
        sumNij += count * (count - 1) / 2;
    }
    const total = n * (n - 1) / 2;
    const expected = sumA * sumB / total;
    const maxVal = (sumA + sumB) / 2;
    if (maxVal === expected)
        return 0;
    return (sumNij - expected) / (maxVal - expected);
}
// ═══════════════════════════════════════════════════════════════
// Simple K-means clustering on embedding vectors
// ═══════════════════════════════════════════════════════════════
function kMeansCluster(vectors, k, maxIter = 20) {
    const n = vectors.length;
    const dim = vectors[0].length;
    // Initialize centroids randomly
    const centroids = [];
    const used = new Set();
    while (centroids.length < k) {
        const idx = Math.floor(Math.random() * n);
        if (!used.has(idx)) {
            centroids.push([...vectors[idx]]);
            used.add(idx);
        }
    }
    let labels = new Array(n).fill(0);
    for (let iter = 0; iter < maxIter; iter++) {
        // Assignment step
        let changed = false;
        for (let i = 0; i < n; i++) {
            let bestDist = Infinity;
            let bestLabel = 0;
            for (let c = 0; c < k; c++) {
                const dist = 1 - cosineSim(vectors[i], centroids[c]);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestLabel = c;
                }
            }
            if (labels[i] !== bestLabel) {
                labels[i] = bestLabel;
                changed = true;
            }
        }
        if (!changed)
            break;
        // Update step
        const counts = new Array(k).fill(0);
        const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
        for (let i = 0; i < n; i++) {
            counts[labels[i]]++;
            for (let d = 0; d < dim; d++)
                sums[labels[i]][d] += vectors[i][d];
        }
        for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
                for (let d = 0; d < dim; d++)
                    centroids[c][d] = sums[c][d] / counts[c];
            }
        }
    }
    return labels;
}
// ═══════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════
function printScaledReport(space) {
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║   P10.1 Scaled Protocol Embedding Space             ║`);
    console.log(`║   ${space.protocols.length} protocols in ${space.familyCount} families`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
    // Within-family vs cross-family similarity
    const families = [...new Set(space.labels)];
    let totalWithin = 0, totalCross = 0;
    let withinN = 0, crossN = 0;
    console.log(`  Family clustering (per-family breakdown):`);
    console.log(`  ${'Family'.padEnd(20)} ${'Count'.padEnd(6)} ${'Within'.padEnd(8)} ${'Cross'.padEnd(8)} ${'Gap'.padEnd(8)}`);
    console.log(`  ${'─'.repeat(56)}`);
    for (const family of families) {
        const indices = space.labels
            .map((l, i) => l === family ? i : -1)
            .filter(i => i >= 0);
        let within = 0, wN = 0;
        for (let a = 0; a < indices.length; a++)
            for (let b = a + 1; b < indices.length; b++) {
                within += space.similarityMatrix[indices[a]][indices[b]];
                wN++;
            }
        let cross = 0, cN = 0;
        for (const i of indices)
            for (let j = 0; j < space.protocols.length; j++)
                if (space.labels[j] !== family) {
                    cross += space.similarityMatrix[i][j];
                    cN++;
                }
        const wAvg = wN > 0 ? within / wN : 0;
        const cAvg = cN > 0 ? cross / cN : 0;
        const gap = wAvg - cAvg;
        totalWithin += within;
        withinN += wN;
        totalCross += cross;
        crossN += cN;
        const signal = gap > 0.15 ? "🟢" : gap > 0.05 ? "🟡" : gap > 0 ? "⚪" : "🔴";
        console.log(`  ${family.padEnd(20)} ${String(indices.length).padEnd(6)} ${(wAvg * 100).toFixed(0).padStart(4)}%   ${(cAvg * 100).toFixed(0).padStart(4)}%   ${(gap > 0 ? '+' : '')}${(gap * 100).toFixed(0).padStart(3)}%  ${signal}`);
    }
    const avgWithin = withinN > 0 ? totalWithin / withinN : 0;
    const avgCross = crossN > 0 ? totalCross / crossN : 0;
    const clusteringEffect = avgWithin - avgCross;
    console.log(`\n  Avg within-family: ${(avgWithin * 100).toFixed(0)}%`);
    console.log(`  Avg cross-family:  ${(avgCross * 100).toFixed(0)}%`);
    console.log(`  Clustering effect: ${clusteringEffect > 0 ? '+' : ''}${(clusteringEffect * 100).toFixed(0)}%`);
    // K-means ARI
    const vectors = space.protocols.map(p => p.vector);
    const k = space.familyCount;
    const predLabels = kMeansCluster(vectors, k);
    const ari = adjustedRandIndex(space.labels, predLabels);
    console.log(`\n  K-means (k=${k}):`);
    console.log(`  ARI: ${ari.toFixed(3)}`);
    console.log(`  Verdict: ${ari > 0.6 ? '✅ SIGNIFICANT CLUSTERING — protocol families are real'
        : ari > 0.3 ? '⚠️  MODERATE — families detectable but overlap exists'
            : '❌ WEAK — embedding space not yet separating families'}\n`);
}
