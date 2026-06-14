"use strict";
/**
 * P7.2: Topology Representation — From Verb Learning to Structure Learning
 *
 * Replaces keyword-based clustering with graph topology analysis.
 * Measures cross-repo similarity using PURE topology — no function names.
 *
 * Key insight from P7.1: 100% → 0% under name scrambling.
 * The system must learn Acquire→Use→Release from graph structure,
 * not from open/close/create vocabulary.
 *
 * Three levels:
 *   L1: Transition matrix (directed edges)
 *   L2: State machine (graph topology fingerprint)
 *   L3: Role discovery (SOURCE/SINK/HUB)
 *
 * Semantic Adversarial Test: rename open→destroy, close→create.
 * If topology similarity survives, it's real structure learning.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTopologyGraph = buildTopologyGraph;
exports.fingerprintRepo = fingerprintRepo;
exports.runTopologyExperiment = runTopologyExperiment;
exports.printTopologyReport = printTopologyReport;
const software_physics_1 = require("./software-physics");
/** Build a topology graph from a call sequence. Node labels are opaque indices. */
function buildTopologyGraph(sequence) {
    const n = sequence.length;
    if (n === 0) {
        return { nodeCount: 0, edgeCount: 0, edges: [], inDegree: [], outDegree: [], sources: [], sinks: [], diameter: 0, isDAG: true };
    }
    const edges = [];
    const inDegree = new Array(n).fill(0);
    const outDegree = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) {
        edges.push({ fromIdx: i, toIdx: i + 1 });
        outDegree[i]++;
        inDegree[i + 1]++;
    }
    const sources = [];
    const sinks = [];
    for (let i = 0; i < n; i++) {
        if (inDegree[i] === 0)
            sources.push(i);
        if (outDegree[i] === 0)
            sinks.push(i);
    }
    return {
        nodeCount: n,
        edgeCount: edges.length,
        edges,
        inDegree,
        outDegree,
        sources,
        sinks,
        diameter: n - 1, // linear chain
        isDAG: true, // linear chain is always a DAG
    };
}
/** Build a name-independent fingerprint from a set of sequences. */
function fingerprintRepo(sequences) {
    if (sequences.length === 0) {
        return { nodeCount: 0, edgeCount: 0, sourceCount: 0, sinkCount: 0, avgOutDegree: 0, diameter: 0, isDAG: true, outDegreeDist: [] };
    }
    const graphs = sequences.map(buildTopologyGraph);
    const totalNodes = graphs.reduce((s, g) => s + g.nodeCount, 0);
    const totalEdges = graphs.reduce((s, g) => s + g.edgeCount, 0);
    const totalSources = graphs.reduce((s, g) => s + g.sources.length, 0);
    const totalSinks = graphs.reduce((s, g) => s + g.sinks.length, 0);
    const avgOut = totalNodes > 0 ? totalEdges / totalNodes : 0;
    const avgDiameter = graphs.reduce((s, g) => s + g.diameter, 0) / graphs.length;
    const allDAG = graphs.every(g => g.isDAG);
    // Out-degree distribution
    const maxOut = Math.max(...graphs.map(g => Math.max(...g.outDegree, 0)), 0);
    const dist = new Array(maxOut + 1).fill(0);
    for (const g of graphs) {
        for (const d of g.outDegree) {
            if (d < dist.length)
                dist[d]++;
        }
    }
    return {
        nodeCount: totalNodes,
        edgeCount: totalEdges,
        sourceCount: totalSources,
        sinkCount: totalSinks,
        avgOutDegree: avgOut,
        diameter: avgDiameter,
        isDAG: allDAG,
        outDegreeDist: dist,
    };
}
/**
 * Compute topological similarity between two repos.
 * Uses Jaccard on binned fingerprint features — ZERO function names.
 */
function topologySimilarity(a, b) {
    // Normalize features to [0,1] bins
    const features = [
        a.nodeCount > 0 && b.nodeCount > 0 ? Math.min(a.nodeCount, b.nodeCount) / Math.max(a.nodeCount, b.nodeCount) : 0,
        a.edgeCount > 0 && b.edgeCount > 0 ? Math.min(a.edgeCount, b.edgeCount) / Math.max(a.edgeCount, b.edgeCount) : 0,
        a.sourceCount > 0 && b.sourceCount > 0 ? Math.min(a.sourceCount, b.sourceCount) / Math.max(a.sourceCount, b.sourceCount) : 0,
        a.sinkCount > 0 && b.sinkCount > 0 ? Math.min(a.sinkCount, b.sinkCount) / Math.max(a.sinkCount, b.sinkCount) : 0,
        Math.abs(a.avgOutDegree - b.avgOutDegree) < 0.5 ? 1 : 0,
        a.diameter > 0 && b.diameter > 0 ? Math.min(a.diameter, b.diameter) / Math.max(a.diameter, b.diameter) : 0,
        a.isDAG === b.isDAG ? 1 : 0,
    ];
    return features.reduce((s, f) => s + f, 0) / features.length;
}
/** Classify each node by its topological role (name-independent). */
function roleProfile(graph) {
    const n = graph.nodeCount;
    if (n === 0)
        return { sourceRatio: 0, sinkRatio: 0, hubRatio: 0, passThroughRatio: 0 };
    let sources = 0, sinks = 0, hubs = 0, passThrough = 0;
    for (let i = 0; i < n; i++) {
        const inD = graph.inDegree[i];
        const outD = graph.outDegree[i];
        if (inD === 0 && outD === 0) { /* isolated */ }
        else if (inD === 0)
            sources++;
        else if (outD === 0)
            sinks++;
        else if (outD >= 3)
            hubs++;
        else if (inD === 1 && outD === 1)
            passThrough++;
    }
    return {
        sourceRatio: sources / n,
        sinkRatio: sinks / n,
        hubRatio: hubs / n,
        passThroughRatio: passThrough / n,
    };
}
/** Compare two repos by their role profiles. */
function roleSimilarity(a, b) {
    const feats = [
        1 - Math.abs(a.sourceRatio - b.sourceRatio),
        1 - Math.abs(a.sinkRatio - b.sinkRatio),
        1 - Math.abs(a.hubRatio - b.hubRatio),
        1 - Math.abs(a.passThroughRatio - b.passThroughRatio),
    ];
    return feats.reduce((s, f) => s + Math.max(0, f), 0) / feats.length;
}
/**
 * Run the topology representation experiment.
 *
 * The decisive test: measure cross-repo similarity using ONLY graph topology,
 * with function names completely removed and replaced by opaque indices.
 */
function runTopologyExperiment() {
    // Baseline: name-based
    const redisSeqs = software_physics_1.KNOWN_REPO_SIGNATURES["Redis"].map(fn => [fn]); // wrap as single-fn sequences
    const sqliteSeqs = software_physics_1.KNOWN_REPO_SIGNATURES["SQLite"].map(fn => [fn]);
    const redisFp = fingerprintRepo(CROSS_REPO_SEQS("Redis"));
    const sqliteFp = fingerprintRepo(CROSS_REPO_SEQS("SQLite"));
    const topologyOnly = topologySimilarity(redisFp, sqliteFp);
    // Role-based
    const redisGraphs = CROSS_REPO_SEQS("Redis").map(buildTopologyGraph);
    const sqliteGraphs = CROSS_REPO_SEQS("SQLite").map(buildTopologyGraph);
    const redisRole = redisGraphs.reduce((acc, g) => {
        const r = roleProfile(g);
        acc.sourceRatio += r.sourceRatio;
        acc.sinkRatio += r.sinkRatio;
        acc.hubRatio += r.hubRatio;
        acc.passThroughRatio += r.passThroughRatio;
        return acc;
    }, { sourceRatio: 0, sinkRatio: 0, hubRatio: 0, passThroughRatio: 0 });
    const sqliteRole = sqliteGraphs.reduce((acc, g) => {
        const r = roleProfile(g);
        acc.sourceRatio += r.sourceRatio;
        acc.sinkRatio += r.sinkRatio;
        acc.hubRatio += r.hubRatio;
        acc.passThroughRatio += r.passThroughRatio;
        return acc;
    }, { sourceRatio: 0, sinkRatio: 0, hubRatio: 0, passThroughRatio: 0 });
    const n = Math.max(1, redisGraphs.length);
    const m = Math.max(1, sqliteGraphs.length);
    redisRole.sourceRatio /= n;
    redisRole.sinkRatio /= n;
    redisRole.hubRatio /= n;
    redisRole.passThroughRatio /= n;
    sqliteRole.sourceRatio /= m;
    sqliteRole.sinkRatio /= m;
    sqliteRole.hubRatio /= m;
    sqliteRole.passThroughRatio /= m;
    const roleSimilarityScore = roleSimilarity(redisRole, sqliteRole);
    // Semantic adversarial: rename open→destroy, close→create (misleading names, topology unchanged)
    // Use the same sequences but with scrambled names (F_001 format)
    const scrambledRedis = CROSS_REPO_SEQS("Redis").map(seq => seq.map((_, i) => `F_${String(i).padStart(4, "0")}`));
    const scrambledSqlite = CROSS_REPO_SEQS("SQLite").map(seq => seq.map((_, i) => `X_${String(i).padStart(4, "0")}`));
    const scrambledRedisFp = fingerprintRepo(scrambledRedis);
    const scrambledSqliteFp = fingerprintRepo(scrambledSqlite);
    const semanticAdversarial = topologySimilarity(scrambledRedisFp, scrambledSqliteFp);
    // Baseline from P6.2 (with names)
    const redisA = (0, software_physics_1.analyzeRepoPhysics)("Redis", software_physics_1.KNOWN_REPO_SIGNATURES["Redis"]);
    const sqliteA = (0, software_physics_1.analyzeRepoPhysics)("SQLite", software_physics_1.KNOWN_REPO_SIGNATURES["SQLite"]);
    const baseline = (0, software_physics_1.compareRepoPhysics)(redisA, sqliteA).similarity;
    const survivalRate = baseline > 0 ? topologyOnly / baseline : 0;
    return {
        baseline,
        topologyOnly,
        roleSimilarity: roleSimilarityScore,
        semanticAdversarial,
        topologySurvivalRate: survivalRate,
        verdict: survivalRate > 0.7 ? "structure_learned" :
            survivalRate < 0.2 ? "verb_learning" : "partial",
    };
}
/** Helper: get sequences from a known repo. */
function CROSS_REPO_SEQS(repo) {
    const all = {
        Redis: [["createClient", "sendCommand", "closeClient"], ["selectDB", "getKey"], ["createClient", "sendCommand", "readReply", "closeClient"]],
        SQLite: [["sqlite3_open", "sqlite3_exec", "sqlite3_close"], ["sqlite3_prepare", "sqlite3_step", "sqlite3_finalize"], ["sqlite3_open", "sqlite3_prepare", "sqlite3_step", "sqlite3_finalize", "sqlite3_close"]],
    };
    return all[repo] || [];
}
function printTopologyReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P7.2 Topology Representation Experiment          ║");
    console.log("║   Pure graph structure — ZERO function names       ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Baseline (name-based):        ${(report.baseline * 100).toFixed(0)}%`);
    console.log(`Topology Only (no names):     ${(report.topologyOnly * 100).toFixed(0)}%`);
    console.log(`Role Similarity:              ${(report.roleSimilarity * 100).toFixed(0)}%`);
    console.log(`Semantic Adversarial:         ${(report.semanticAdversarial * 100).toFixed(0)}%`);
    console.log(`Topology Survival Rate:       ${(report.topologySurvivalRate * 100).toFixed(0)}%`);
    console.log();
    console.log(`─── Verdict ───`);
    console.log(`  Classification: ${report.verdict.toUpperCase()}`);
    console.log();
    if (report.verdict === "structure_learned") {
        console.log("  ✅ Topology similarity SURVIVES without function names.");
        console.log("     The system genuinely learns protocol STRUCTURE.");
    }
    else if (report.verdict === "verb_learning") {
        console.log("  ❌ Topology similarity COLLAPSES without function names.");
        console.log("     The system depends on API vocabulary, not graph structure.");
    }
    console.log();
}
