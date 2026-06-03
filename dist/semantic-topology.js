/**
 * Phase 8: Semantic Topology (P1)
 *
 * Builds a similarity graph from IR structural data:
 *   - File co-occurrence (functions in same file are related)
 *   - Tag overlap (shared domain tags)
 *   - Purpose word overlap (Jaccard on purpose text)
 *   - Chain adjacency (producer→consumer links)
 *
 * Replaces simple string matching in capability search.
 */
export class SemanticTopology {
    constructor() {
        this.nodes = new Map();
        this.edges = new Map();
        this.similarityCache = new Map();
    }
    /** Build topology from IR data */
    build(ir) {
        this.nodes.clear();
        this.edges.clear();
        this.similarityCache.clear();
        // 1. Create nodes
        for (const f of ir) {
            if (!f.exported && !f.external)
                continue;
            this.nodes.set(f.name, {
                name: f.name,
                file: f.file || "",
                tags: new Set((f.tags || []).map((t) => t.toLowerCase())),
                purposeWords: new Set((f.purpose || "").toLowerCase().split(/[\s,，]+/).filter((w) => w.length > 2)),
                produces: new Set(f.produces || []),
                requires: new Set(f.requires || []),
            });
        }
        // 2. Build edges: file co-occurrence
        const byFile = new Map();
        for (const [name, node] of this.nodes) {
            if (!byFile.has(node.file))
                byFile.set(node.file, []);
            byFile.get(node.file).push(name);
        }
        for (const names of byFile.values()) {
            for (let i = 0; i < names.length; i++) {
                for (let j = i + 1; j < names.length; j++) {
                    this.addEdge(names[i], names[j], 0.3, "co-file");
                }
            }
        }
        // 3. Build edges: tag overlap
        for (const [nameA, nodeA] of this.nodes) {
            for (const [nameB, nodeB] of this.nodes) {
                if (nameA >= nameB)
                    continue;
                const tagOverlap = [...nodeA.tags].filter(t => nodeB.tags.has(t)).length;
                if (tagOverlap > 0) {
                    const maxTags = Math.max(nodeA.tags.size, nodeB.tags.size) || 1;
                    this.addEdge(nameA, nameB, 0.4 * (tagOverlap / maxTags), "tag");
                }
            }
        }
        // 4. Build edges: purpose word overlap
        for (const [nameA, nodeA] of this.nodes) {
            for (const [nameB, nodeB] of this.nodes) {
                if (nameA >= nameB)
                    continue;
                const shared = [...nodeA.purposeWords].filter(w => nodeB.purposeWords.has(w)).length;
                const total = [...new Set([...nodeA.purposeWords, ...nodeB.purposeWords])].length || 1;
                const jaccard = shared / total;
                if (jaccard > 0.15) {
                    this.addEdge(nameA, nameB, 0.5 * jaccard, "purpose");
                }
            }
        }
        // 5. Build edges: chain adjacency (producer→consumer)
        for (const [nameA, nodeA] of this.nodes) {
            for (const p of nodeA.produces) {
                for (const [nameB, nodeB] of this.nodes) {
                    if (nameA === nameB)
                        continue;
                    if (nodeB.requires.has(p)) {
                        this.addEdge(nameA, nameB, 0.7, `chain:${p}`);
                    }
                    // Fuzzy chain: substring match
                    for (const r of nodeB.requires) {
                        if (p.includes(r) || r.includes(p)) {
                            this.addEdge(nameA, nameB, 0.4, `fuzzy:${p}≈${r}`);
                        }
                    }
                }
            }
        }
    }
    addEdge(a, b, weight, reason) {
        const key = a < b ? `${a}::${b}` : `${b}::${a}`;
        if (!this.edges.has(a))
            this.edges.set(a, []);
        if (!this.edges.has(b))
            this.edges.set(b, []);
        this.edges.get(a).push({ source: a, target: b, weight, reason });
        this.edges.get(b).push({ source: b, target: a, weight, reason });
        this.similarityCache.set(key, Math.max(this.similarityCache.get(key) || 0, weight));
    }
    /** Get similarity between two functions (0-1). */
    similarity(funcA, funcB) {
        if (funcA === funcB)
            return 1.0;
        const key = funcA < funcB ? `${funcA}::${funcB}` : `${funcB}::${funcA}`;
        return this.similarityCache.get(key) || 0;
    }
    /** Find top N most similar functions to a given function. */
    findSimilar(funcName, topN = 5) {
        const edges = this.edges.get(funcName) || [];
        return edges
            .sort((a, b) => b.weight - a.weight)
            .slice(0, topN)
            .map(e => ({ name: e.target, similarity: e.weight }));
    }
    /** Semantic match: two capability labels are related via topology. */
    capabilityMatch(produce, require) {
        // Direct match
        if (produce === require)
            return true;
        if (produce.includes(require) || require.includes(produce))
            return true;
        // Topology check: are there functions producing 'produce' that are connected
        // to functions requiring 'require'?
        const producers = [...this.nodes.values()].filter(n => n.produces.has(produce));
        const consumers = [...this.nodes.values()].filter(n => n.requires.has(require));
        for (const p of producers) {
            for (const c of consumers) {
                if (this.similarity(p.name, c.name) > 0.2)
                    return true;
            }
        }
        return false;
    }
    /** Get node count */
    get size() { return this.nodes.size; }
}
// Singleton
let _topology = null;
export function getTopology(ir) {
    if (!_topology && ir) {
        _topology = new SemanticTopology();
        _topology.build(ir);
    }
    return _topology || new SemanticTopology();
}
export function rebuildTopology(ir) {
    _topology = new SemanticTopology();
    _topology.build(ir);
    return _topology;
}
