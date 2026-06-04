/**
 * Phase 8: Multi-Level Planning — Strategy Layer
 *
 * Selects capability chains from the IR graph WITHOUT calling LLM.
 * Pure graph search: intent → capability matching → ordered chain.
 *
 * The Action Layer (planner.ts) then uses this chain to constrain
 * the LLM's function selection space.
 */

import { jaccardSimilarity, extractKeywords } from "./utils";
import { getFailureAdjustedCredit } from "./feedback";
import { getTopology } from "./semantic-topology";
import { getConstraints, applyConstraints } from "./planner-constraints";
import { getEdgeConfidence } from "./failure-corpus";
import type { FunctionInfo } from "./extract-ir";

interface CapabilityNode {
  name: string;
  purpose: string;
  tags: string[];
  requires: string[];
  produces: string[];
  useWhen: string[];
  score: number;
  /** Whether requires/produces come from explicit annotations (JSDoc/@protocol) */
  hasExplicitMeta: boolean;
}

interface CapabilityChain {
  nodes: CapabilityNode[];
  score: number;           // cumulative relevance
  explanation: string;     // human-readable chain description
}

/** Build a capability graph from IR functions. */
function buildCapabilityGraph(ir: FunctionInfo[]): Map<string, CapabilityNode> {
  const SKIP_FILES = new Set(["src/strategy-planner.ts", "src/planner.ts"]);
  const graph = new Map<string, CapabilityNode>();
  for (const f of ir) {
    if (!f.exported) continue;
    if (SKIP_FILES.has(f.file)) continue; // skip planner internals
    graph.set(f.name, {
      name: f.name,
      purpose: f.purpose || "",
      tags: f.tags || [],
      requires: f.requires || [],
      produces: f.produces || [],
      useWhen: f.useWhen || [],
      score: 0,
      hasExplicitMeta: !(f as any)._requiresDerived && !(f as any)._producesDerived
        && (f.requires || []).length > 0 && (f.produces || []).length > 0,
    });
  }
  return graph;
}

/** Score a capability node against an intent.
 *  Returns 0 for irrelevant nodes (no keyword match at all). */
function scoreNode(node: CapabilityNode, intentLower: string, keywords: string[]): number {
  let score = 0;
  let hasMatch = false;
  // Name match
  const nameWords = node.name.replace(/([A-Z])/g, " $1").toLowerCase().split(/[\s_]+/).filter(w => w.length > 1);
  for (const kw of keywords) {
    // Substring match
    if (node.name.toLowerCase().includes(kw)) {
      score += 1;
      hasMatch = true;
      // Exact word match: e.g., "extract" in "extractIR" → +100% bonus
      if (nameWords.includes(kw)) score += 2;
    }
    const js = jaccardSimilarity(node.name.toLowerCase(), kw);
    if (js > 0.2) { score += js; hasMatch = true; }
  }
  // Purpose match
  const purposeLower = node.purpose.toLowerCase();
  for (const kw of keywords) {
    if (purposeLower.includes(kw)) { score += 2; hasMatch = true; }
  }
  // Tag match
  for (const tag of node.tags) {
    if (intentLower.includes(tag.toLowerCase())) { score += 1.5; hasMatch = true; }
  }
  // Semantic word overlap in purpose
  const intentWords = intentLower.split(/[\s,，]+/);
  for (const w of intentWords) {
    if (w.length > 2 && purposeLower.includes(w)) { score += 0.5; hasMatch = true; }
  }
  // useWhen scenario match
  if (node.useWhen) {
    for (const scenario of node.useWhen) {
      const scenarioWords = scenario.toLowerCase().split(/[\s,]+/);
      const matchCount = scenarioWords.filter((w: string) => w.length > 3 && intentLower.includes(w)).length;
      if (matchCount >= 2) { score += 3.0; hasMatch = true; }
      else if (matchCount === 1) { score += 1.0; hasMatch = true; }
    }
  }
  // Require at least one match to be relevant
  if (!hasMatch) return 0;
  // Bonus: explicit annotations are more reliable than derived ones
  if (node.hasExplicitMeta) score *= 1.3;
  // L3: Dynamic Credit — multiply by actual success rate
  const successRate = getFailureAdjustedCredit(node.name);
  const creditFactor = 0.3 + successRate * 0.7;
  score *= creditFactor;
  // Rule → Planner: apply mined rule constraints
  const constraints = getConstraints();
  const { multiplier } = applyConstraints(node.name, node.purpose, constraints);
  return score * multiplier;
}

/** Pick the highest-scoring node from a list. */
function topByScore(nodes: CapabilityNode[]): CapabilityNode | undefined {
  return nodes.sort((a, b) => b.score - a.score)[0];
}

/** Shared logic for finding nodes that produce or consume a capability label.
 *  Falls back to topology similarity if no direct data-flow match.
 *
 *  @param field - which side of the data-flow edge to match on
 *  @param isProducer - when true the field value acts as the "produce" side
 *    of capabilityMatch; when false it acts as the "require" side. */
function findRelated(
  graph: Map<string, CapabilityNode>,
  capability: string,
  allNodes: CapabilityNode[],
  field: "produces" | "requires",
  isProducer: boolean,
): CapabilityNode[] {
  const results: CapabilityNode[] = [];
  for (const node of graph.values()) {
    if (node[field].some(v => v === capability || capability.includes(v) || v.includes(capability))) {
      results.push(node);
    }
  }
  // Topology fallback: find semantically related nodes via capabilityMatch
  if (results.length === 0) {
    try {
      const topo = getTopology();
      for (const node of allNodes) {
        if (node[field].length > 0) {
          for (const v of node[field]) {
            const matched = isProducer
              ? topo.capabilityMatch(v, capability)
              : topo.capabilityMatch(capability, v);
            if (matched && !results.includes(node)) {
              results.push(node);
              break;
            }
          }
        }
      }
    } catch { /* topology fallback unavailable — non-critical */ }
  }
  return results;
}

/** Find all capability nodes that produce a given capability label. */
function findProducers(graph: Map<string, CapabilityNode>, capability: string, allNodes: CapabilityNode[]): CapabilityNode[] {
  return findRelated(graph, capability, allNodes, "produces", true);
}

/** Find all capability nodes that require a given capability label. */
function findConsumers(graph: Map<string, CapabilityNode>, capability: string, allNodes: CapabilityNode[]): CapabilityNode[] {
  return findRelated(graph, capability, allNodes, "requires", false);
}

/**
 * Select the best capability chain for an intent.
 *
 * Algorithm:
 * 1. Score all nodes against intent
 * 2. Find top producers (nodes whose produces matches intent keywords)
 * 3. For each producer, trace forward: producer → consumer → consumer...
 * 4. Score each chain and return top N
 */
export function selectCapabilityChains(
  intent: string,
  ir: FunctionInfo[],
  maxChains: number = 5
): CapabilityChain[] {
  // Guard: null/undefined/empty intent
  if (!intent || typeof intent !== "string" || !intent.trim()) return [];

  // Ensure semantic topology is built (cached after first build)
  const startTopo = Date.now();
  getTopology(ir);
  const topoMs = Date.now() - startTopo;

  const intentLower = intent.toLowerCase();
  const keywords = extractKeywords(intent);
  const graph = buildCapabilityGraph(ir);

  // Score all nodes
  const startScore = Date.now();
  for (const node of graph.values()) {
    node.score = scoreNode(node, intentLower, keywords);
  }

  // Dynamic threshold: tighten for large IR to prevent score dilution
  let dynamicThreshold = graph.size > 500 ? 2.0 : graph.size > 200 ? 1.5 : 1.0;

  // Fallback: if no seeds found, halve threshold
  let seeds = [...graph.values()]
    .filter(n => n.score > dynamicThreshold && (n.produces.length > 0 || n.score > dynamicThreshold + 2))
    .sort((a, b) => b.score - a.score);
  if (seeds.length === 0 && dynamicThreshold > 0.3) {
    dynamicThreshold *= 0.5;
    seeds = [...graph.values()]
      .filter(n => n.score > dynamicThreshold && (n.produces.length > 0 || n.score > dynamicThreshold + 1))
      .sort((a, b) => b.score - a.score);
  }
  // Best-effort fallback: when no keyword matches at all, try nodes with capability edges
  if (seeds.length === 0) {
    seeds = [...graph.values()]
      .filter(n => n.produces.length > 0 || n.requires.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }
  // Ultimate fallback: just take any exported nodes
  if (seeds.length === 0) {
    seeds = [...graph.values()].slice(0, 3);
  }
  seeds = seeds.slice(0, graph.size > 1000 ? 10 : graph.size > 500 ? 20 : 15);

  const allNodes = [...graph.values()];
  const chains: CapabilityChain[] = [];
  const BEAM_WIDTH = graph.size > 500 ? 3 : 5;
  const MAX_CHAIN_LEN = parseInt(process.env.PROGMUNE_MAX_CHAIN_LEN || "5", 10);
  const SCORE_FLOOR = graph.size > 1000 ? 0.2 : 0;

  // ── Capability Ranking: preload edge confidence from session history ──
  const edgeConfMap = new Map<string, number>();
  for (const ec of getEdgeConfidence()) {
    edgeConfMap.set(`${ec.producer}→${ec.consumer}`, ec.confidence);
  }

  for (const seed of seeds) {
    // ── Priority-queue (beam) search: forward trace ──
    interface BeamEntry {
      chain: CapabilityNode[];
      visited: Set<string>;
      totalScore: number;
      leapDecay: number;
      deadEnd: boolean;
    }

    let beam: BeamEntry[] = [{
      chain: [seed],
      visited: new Set<string>([seed.name]),
      totalScore: seed.score,
      leapDecay: 1.0,
      deadEnd: false,
    }];
    let bestEntry: BeamEntry | null = null;

    for (let depth = 0; depth < MAX_CHAIN_LEN && beam.length > 0; depth++) {
      const nextBeam: BeamEntry[] = [];

      for (const entry of beam) {
        if (entry.deadEnd || entry.chain.length >= MAX_CHAIN_LEN) {
          // Dead-end or max length: finalize this branch
          if (!bestEntry || (entry.totalScore / entry.chain.length) > (bestEntry.totalScore / bestEntry.chain.length)) {
            bestEntry = entry;
          }
          continue;
        }

        const current = entry.chain[entry.chain.length - 1];
        let expanded = false;

        // Strategy 1: direct data flow (produces → requires)
        for (const p of current.produces) {
          const consumers = findConsumers(graph, p, allNodes)
            .filter(c => !entry.visited.has(c.name) && c.score >= SCORE_FLOOR);
          for (const consumer of consumers) {
            const newVisited = new Set(entry.visited);
            newVisited.add(consumer.name);
            // Capability Ranking: edge confidence × consumer score
            const edgeKey = `${current.name}→${consumer.name}`;
            const edgeConf = edgeConfMap.get(edgeKey) ?? 0.5; // Laplace prior for unseen edges
            const rankedScore = consumer.score * (0.5 + edgeConf * 0.5);
            nextBeam.push({
              chain: [...entry.chain, consumer],
              visited: newVisited,
              totalScore: entry.totalScore + rankedScore,
              leapDecay: 1.0,
              deadEnd: consumer.score === 0 && consumer.produces.length === 0,
            });
            expanded = true;
          }
        }

        // Strategy 2: semantic leap — topology similarity
        if (!expanded) {
          try {
            const topo = getTopology();
            const similar = topo.findSimilar(current.name, 10)
              .filter(s => !entry.visited.has(s.name) && s.similarity > 0.25);
            for (const s of similar.slice(0, 3)) {
              const bestMatch = graph.get(s.name);
              if (bestMatch && bestMatch.score >= SCORE_FLOOR) {
                const newVisited = new Set(entry.visited);
                newVisited.add(bestMatch.name);
                nextBeam.push({
                  chain: [...entry.chain, bestMatch],
                  visited: newVisited,
                  totalScore: entry.totalScore + bestMatch.score * entry.leapDecay,
                  leapDecay: entry.leapDecay * 0.7, // decay 30% per leap
                  deadEnd: false,
                });
                expanded = true;
              }
            }
          } catch { /* semantic leap unavailable — non-critical */ }
        }

        // Dead-end: no consumers found → finalize this branch
        if (!expanded) {
          if (!bestEntry || (entry.totalScore / entry.chain.length) > (bestEntry.totalScore / bestEntry.chain.length)) {
            bestEntry = entry;
          }
        }
      }

      // Beam pruning: keep top BEAM_WIDTH by average score
      nextBeam.sort((a, b) => (b.totalScore / b.chain.length) - (a.totalScore / a.chain.length));
      beam = nextBeam.slice(0, BEAM_WIDTH);
    }

    // Any remaining beam entries compete for best
    for (const entry of beam) {
      if (!bestEntry || (entry.totalScore / entry.chain.length) > (bestEntry.totalScore / bestEntry.chain.length)) {
        bestEntry = entry;
      }
    }

    if (!bestEntry || bestEntry.chain.length < 1) continue;

    const chain = bestEntry.chain;
    let totalScore = bestEntry.totalScore;
    const visited = bestEntry.visited;

    // Backward trace: does seed need something? Find producers.
    if (seed.requires.length > 0) {
      const producers = findProducers(graph, seed.requires[0], allNodes)
        .filter(p => !visited.has(p.name));
      if (producers.length > 0) {
        const bestProducer = topByScore(producers)!;
        chain.unshift(bestProducer);
        totalScore += bestProducer.score;
      }
    }

    if (chain.length >= 1) {
      chains.push({
        nodes: chain,
        score: totalScore / chain.length, // average score
        explanation: chain.map(n => n.name).join(" → "),
      });
    }
  }

  // Sort by score, deduplicate, return top N
  chains.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const unique: CapabilityChain[] = [];
  for (const c of chains) {
    const key = c.explanation;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  const scoreMs = Date.now() - startScore;
  if (graph.size > 200) {
    console.error(`[Strategy] ${graph.size} nodes | topo=${topoMs}ms score=${scoreMs}ms | ${unique.length} chains`);
  }
  return unique.slice(0, maxChains);
}

/** Format chains as a routing hint (not full path).
 *  Only shows top 2 high-confidence next steps per entry,
 *  so the LLM gets guidance without being forced into long chains. */
export function formatChainHint(chains: CapabilityChain[]): string {
  if (chains.length === 0) return "";
  const lines = ["\n建议的下一步调用 (已从历史成功链中验证):"];
  const shown = new Set<string>();
  for (const c of chains.slice(0, 3)) {
    const pairs: string[] = [];
    for (let i = 0; i < c.nodes.length - 1 && pairs.length < 2; i++) {
      const key = `${c.nodes[i].name}→${c.nodes[i + 1].name}`;
      if (!shown.has(key)) {
        shown.add(key);
        pairs.push(`${c.nodes[i].name} → ${c.nodes[i + 1].name}`);
      }
    }
    if (pairs.length > 0) {
      lines.push(`  ${pairs.join("  |  ")} (★${c.score.toFixed(1)})`);
    }
  }
  return lines.join("\n");
}
