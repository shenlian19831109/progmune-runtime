"use strict";
/**
 * Knowledge Network — Cross-protocol reference graph
 *
 * Transforms flat Knowledge Units into an interconnected graph.
 * Protocols reference each other: TLS depends_on TCP, HTTP/2 extends HTTP, etc.
 *
 * Usage:
 *   npx ts-node src/knowledge-graph.ts
 *   npx ts-node src/knowledge-graph.ts --tree
 *   npx ts-node src/knowledge-graph.ts --dependents TLS
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildKnowledgeGraph = buildKnowledgeGraph;
exports.getDependents = getDependents;
exports.getDependencies = getDependencies;
const protocol_knowledge_1 = require("./protocol-knowledge");
// Cross-protocol relations that go beyond existing unit.relations
const CROSS_PROTOCOL_EDGES = [
    // Transport layer
    { from: "PROTO-TLS", to: "PROTO-CONN", type: "depends_on", description: "TLS handshake runs over a TCP connection" },
    { from: "PROTO-QUIC", to: "PROTO-CONN", type: "depends_on", description: "QUIC runs over UDP connection" },
    // HTTP stack
    { from: "PROTO-H2", to: "PROTO-HTTP", type: "extends", description: "HTTP/2 extends HTTP/1.1 request semantics" },
    { from: "PROTO-TLS-ALPN", to: "PROTO-TLS", type: "extends", description: "ALPN negotiation extends TLS handshake" },
    { from: "PROTO-TLS-CERT", to: "PROTO-TLS", type: "extends", description: "Certificate validation extends TLS handshake" },
    { from: "PROTO-TLS-SESS", to: "PROTO-TLS", type: "depends_on", description: "Session resumption requires completed handshake" },
    // Auth
    { from: "PROTO-SSH", to: "PROTO-AUTH", type: "depends_on", description: "SSH requires authentication" },
    { from: "PROTO-HTTP", to: "PROTO-AUTH", type: "compatible_with", description: "HTTP can use authentication headers" },
    // Cross-domain
    { from: "PROTO-TLS", to: "PROTO-AUTH", type: "compatible_with", description: "TLS can carry client certificates for authentication" },
    { from: "PROTO-SSH", to: "PROTO-CONN", type: "depends_on", description: "SSH runs over TCP connection" },
];
function buildKnowledgeGraph() {
    const kb = (0, protocol_knowledge_1.buildKnowledgeBase)();
    const nodes = kb.units.map(u => ({
        id: u.id, name: u.name, domain: u.domain, maturity: u.maturity, confidence: u.confidence,
    }));
    // Collect all edges: both intra-unit relations and cross-protocol relations
    const edges = [...CROSS_PROTOCOL_EDGES];
    // Add intra-unit relations
    for (const u of kb.units) {
        for (const r of u.relations || []) {
            edges.push({ from: u.id, to: r.targetId, type: r.type, description: r.description });
        }
    }
    // Build adjacency
    const adj = {};
    const inDeg = {};
    const outDeg = {};
    for (const n of nodes) {
        adj[n.id] = [];
        inDeg[n.id] = 0;
        outDeg[n.id] = 0;
    }
    for (const e of edges) {
        if (!adj[e.from])
            adj[e.from] = [];
        if (!adj[e.to])
            adj[e.to] = [];
        adj[e.from].push(e.to);
        outDeg[e.from] = (outDeg[e.from] || 0) + 1;
        inDeg[e.to] = (inDeg[e.to] || 0) + 1;
    }
    return { nodes, edges, adjacency: adj, inDegree: inDeg, outDegree: outDeg };
}
// ═══════════════════════════════════════════════════════════════
// Queries
// ═══════════════════════════════════════════════════════════════
function getDependents(graph, nodeId) {
    const ids = graph.edges.filter(e => e.to === nodeId).map(e => e.from);
    return graph.nodes.filter(n => ids.includes(n.id));
}
function getDependencies(graph, nodeId) {
    const ids = graph.edges.filter(e => e.from === nodeId).map(e => e.to);
    return graph.nodes.filter(n => ids.includes(n.id));
}
// ═══════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════
function formatTree(graph) {
    const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", r2: "\x1b[31m", c: "\x1b[36m", m: "\x1b[35m" };
    const l = [];
    l.push(`\n${C.b}${C.c}Protocol Knowledge Graph${C.r}\n`);
    // Find root nodes (no incoming edges from other protocols)
    const roots = graph.nodes.filter(n => graph.inDegree[n.id] === 0 || (graph.inDegree[n.id] <= 1 && graph.outDegree[n.id] >= 2));
    const visited = new Set();
    function renderNode(id, prefix, isLast) {
        if (visited.has(id))
            return;
        visited.add(id);
        const n = graph.nodes.find(x => x.id === id);
        if (!n)
            return;
        const connector = isLast ? "└── " : "├── ";
        const matIcon = n.maturity === "stable" ? C.g + "★" + C.r : n.maturity === "validated" ? C.y + "◉" + C.r : C.r2 + "●" + C.r;
        l.push(`${prefix}${connector}${matIcon} ${C.b}${n.name}${C.r} ${C.d}(${n.domain}, ${n.confidence}%)${C.r}`);
        const children = graph.edges.filter(e => e.from === id);
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        children.forEach((e, i) => {
            l.push(`${childPrefix}${i === children.length - 1 ? "└── " : "├── "}${C.d}${e.type}${C.r} → ${e.description.slice(0, 50)}`);
        });
        // Don't recurse into children to avoid cycles — just show direct edges
    }
    // Render starting from connection/transport layer (roots)
    const transportRoots = graph.nodes.filter(n => n.domain === "Connection" || n.domain === "QUIC");
    for (const r of transportRoots) {
        renderNode(r.id, "", true);
    }
    // Then TLS, SSH, HTTP
    const appRoots = graph.nodes.filter(n => ["TLS", "SSH", "HTTP"].includes(n.domain) && !transportRoots.includes(n));
    for (const r of appRoots) {
        if (!visited.has(r.id))
            renderNode(r.id, "", true);
    }
    return l.join("\n") + "\n";
}
function formatMatrix(graph) {
    const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m" };
    const l = [];
    l.push(`\n${C.b}Cross-Reference Matrix${C.r}\n`);
    l.push(`${C.d}Rows point TO columns (row depends_on / extends column)${C.r}\n`);
    const ids = graph.nodes.map(n => n.id);
    const names = graph.nodes.map(n => n.name.slice(0, 8));
    l.push(`         ${names.join("  ")}`);
    l.push(`         ${names.map(() => "──").join("  ")}`);
    for (const n of graph.nodes) {
        const row = ids.map(targetId => {
            const edge = graph.edges.find(e => e.from === n.id && e.to === targetId);
            return edge ? (edge.type === "depends_on" ? "↓ " : edge.type === "extends" ? "↗ " : "· ") : "  ";
        }).join("  ");
        l.push(`${n.name.slice(0, 8).padEnd(8)} ${row}`);
    }
    return l.join("\n") + "\n";
}
// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
    const g = buildKnowledgeGraph();
    const args = process.argv.slice(2);
    const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", c: "\x1b[36m" };
    if (args.includes("--tree")) {
        console.log(formatTree(g));
    }
    else if (args.includes("--matrix")) {
        console.log(formatMatrix(g));
    }
    else if (args.includes("--dependents") && args[1]) {
        const deps = getDependents(g, args[1]);
        console.log(`\nNodes that depend on ${args[1]}:`);
        deps.forEach(d => console.log(`  ${d.name} (${d.domain}, ${d.maturity})`));
    }
    else if (args.includes("--dependencies") && args[1]) {
        const deps = getDependencies(g, args[1]);
        console.log(`\nNodes that ${args[1]} depends on:`);
        deps.forEach(d => console.log(`  ${d.name} (${d.domain}, ${d.maturity})`));
    }
    else {
        // Default: summary
        console.log(`\n${C.b}${C.c}Knowledge Network${C.r}`);
        console.log(`${C.d}${g.nodes.length} nodes, ${g.edges.length} edges${C.r}`);
        // Top nodes by connections
        const ranked = g.nodes.map(n => ({
            name: n.name, domain: n.domain, maturity: n.maturity,
            total: (g.inDegree[n.id] || 0) + (g.outDegree[n.id] || 0),
            in: g.inDegree[n.id] || 0, out: g.outDegree[n.id] || 0,
        })).sort((a, b) => b.total - a.total);
        console.log(`\n  Node                 Domain      In   Out  Total`);
        for (const r of ranked.slice(0, 8)) {
            console.log(`  ${r.name.padEnd(20)} ${r.domain.padEnd(10)} ${String(r.in).padStart(2)}  ${String(r.out).padStart(2)}  ${r.total}`);
        }
        // Cross-references
        console.log(`\n  Cross-protocol edges:`);
        for (const e of g.edges) {
            console.log(`  ${e.from.padEnd(14)} ${e.type.padEnd(14)} → ${e.to.padEnd(14)} ${C.d}${e.description.slice(0, 50)}${C.r}`);
        }
        console.log("");
    }
}
