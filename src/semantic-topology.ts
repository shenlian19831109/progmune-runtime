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

interface TopologyNode {
  name: string;
  file: string;
  tags: Set<string>;
  purposeWords: Set<string>;
  produces: Set<string>;
  requires: Set<string>;
}

interface TopologyEdge {
  source: string;
  target: string;
  weight: number;        // 0-1 similarity
  reason: string;        // why they're linked
}

export class SemanticTopology {
  private nodes = new Map<string, TopologyNode>();
  private edges = new Map<string, TopologyEdge[]>();
  private similarityCache = new Map<string, number>();

  /** Build topology from IR data */
  build(ir: any[]): void {
    this.nodes.clear();
    this.edges.clear();
    this.similarityCache.clear();

    // 1. Create nodes
    for (const f of ir) {
      if (!f.exported && !f.external) continue;
      this.nodes.set(f.name, {
        name: f.name,
        file: f.file || "",
        tags: new Set((f.tags || []).map((t: string) => t.toLowerCase())),
        purposeWords: new Set(
          (f.purpose || "").toLowerCase().split(/[\s,，]+/).filter((w: string) => w.length > 2)
        ),
        produces: new Set(f.produces || []),
        requires: new Set(f.requires || []),
      });
    }

    // 2. Build edges: file co-occurrence
    const byFile = new Map<string, string[]>();
    for (const [name, node] of this.nodes) {
      if (!byFile.has(node.file)) byFile.set(node.file, []);
      byFile.get(node.file)!.push(name);
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
        if (nameA >= nameB) continue;
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
        if (nameA >= nameB) continue;
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
          if (nameA === nameB) continue;
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

  private addEdge(a: string, b: string, weight: number, reason: string): void {
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    if (!this.edges.has(a)) this.edges.set(a, []);
    if (!this.edges.has(b)) this.edges.set(b, []);
    this.edges.get(a)!.push({ source: a, target: b, weight, reason });
    this.edges.get(b)!.push({ source: b, target: a, weight, reason });
    this.similarityCache.set(key, Math.max(this.similarityCache.get(key) || 0, weight));
  }

  /** Get similarity between two functions (0-1). */
  similarity(funcA: string, funcB: string): number {
    if (funcA === funcB) return 1.0;
    const key = funcA < funcB ? `${funcA}::${funcB}` : `${funcB}::${funcA}`;
    return this.similarityCache.get(key) || 0;
  }

  /** Find top N most similar functions to a given function. */
  findSimilar(funcName: string, topN: number = 5): { name: string; similarity: number }[] {
    const edges = this.edges.get(funcName) || [];
    return edges
      .sort((a, b) => b.weight - a.weight)
      .slice(0, topN)
      .map(e => ({ name: e.target, similarity: e.weight }));
  }

  /** Semantic match: two capability labels are related via topology. */
  capabilityMatch(produce: string, require: string): boolean {
    // Direct match
    if (produce === require) return true;
    if (produce.includes(require) || require.includes(produce)) return true;
    // Topology check: are there functions producing 'produce' that are connected
    // to functions requiring 'require'?
    const producers = [...this.nodes.values()].filter(n => n.produces.has(produce));
    const consumers = [...this.nodes.values()].filter(n => n.requires.has(require));
    for (const p of producers) {
      for (const c of consumers) {
        if (this.similarity(p.name, c.name) > 0.2) return true;
      }
    }
    return false;
  }

  /** Get node count */
  get size(): number { return this.nodes.size; }
}

// ── Persistence cache: avoid O(n²) rebuild on every run ──
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const CACHE_DIR = path.resolve(__dirname, "..", ".progmune");
const TOPO_CACHE = path.join(CACHE_DIR, "topology.json");

function irHash(ir: any[]): string {
  return crypto.createHash("md5")
    .update(JSON.stringify(ir.map((f: any) => f.name + f.file)))
    .digest("hex");
}

function serializeTopology(topo: SemanticTopology, hash: string): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const data = {
      hash,
      nodes: [...topo["nodes"].entries()].map(([name, n]: [string, any]) => ({
        name, file: n.file, tags: [...n.tags], purposeWords: [...n.purposeWords],
        produces: [...n.produces], requires: [...n.requires],
      })),
      edges: [...topo["edges"].entries()].map(([name, edges]: [string, any]) => ({
        name, edges: edges.map((e: any) => ({ source: e.source, target: e.target, weight: e.weight, reason: e.reason })),
      })),
    };
    fs.writeFileSync(TOPO_CACHE, JSON.stringify(data));
  } catch { /* best-effort cache write */ }
}

function deserializeTopology(): SemanticTopology | null {
  try {
    if (!fs.existsSync(TOPO_CACHE)) return null;
    const data = JSON.parse(fs.readFileSync(TOPO_CACHE, "utf-8"));
    const topo = new SemanticTopology();
    for (const n of data.nodes) {
      topo["nodes"].set(n.name, {
        name: n.name, file: n.file,
        tags: new Set(n.tags), purposeWords: new Set(n.purposeWords),
        produces: new Set(n.produces), requires: new Set(n.requires),
      });
    }
    for (const e of data.edges) {
      topo["edges"].set(e.name, e.edges);
      for (const edge of e.edges) {
        const key = edge.source < edge.target ? `${edge.source}::${edge.target}` : `${edge.target}::${edge.source}`;
        topo["similarityCache"].set(key, Math.max(topo["similarityCache"].get(key) || 0, edge.weight));
      }
    }
    return topo;
  } catch { return null; }
}

// Singleton
let _topology: SemanticTopology | null = null;
let _topoHash: string | null = null;

export function getTopology(ir?: any[]): SemanticTopology {
  if (!_topology && ir) {
    const hash = irHash(ir);
    // Try disk cache first
    try {
      if (fs.existsSync(TOPO_CACHE)) {
        const cached = JSON.parse(fs.readFileSync(TOPO_CACHE, "utf-8"));
        if (cached.hash === hash) {
          _topology = deserializeTopology();
          if (_topology) {
            _topoHash = hash;
            console.error("[Topology] 从缓存加载 (%d 节点)", _topology.size);
            return _topology;
          }
        }
      }
    } catch { /* fall through to build */ }

    // Build from scratch
    const start = Date.now();
    _topology = new SemanticTopology();
    _topology.build(ir);
    _topoHash = hash;
    console.error("[Topology] 构建完成 (%d 节点, %dms)", _topology.size, Date.now() - start);
    serializeTopology(_topology, hash);
  }
  return _topology || new SemanticTopology();
}

export function rebuildTopology(ir: any[]): SemanticTopology {
  _topology = new SemanticTopology();
  _topology.build(ir);
  _topoHash = irHash(ir);
  serializeTopology(_topology, _topoHash);
  return _topology;
}
