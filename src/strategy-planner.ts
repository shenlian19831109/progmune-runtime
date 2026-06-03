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

interface CapabilityNode {
  name: string;           // function name
  purpose: string;        // what it does
  tags: string[];         // domain tags
  requires: string[];     // capability preconditions
  produces: string[];     // capability outcomes
  score: number;          // relevance to intent (computed)
}

interface CapabilityChain {
  nodes: CapabilityNode[];
  score: number;           // cumulative relevance
  explanation: string;     // human-readable chain description
}

/** Build a capability graph from IR functions. */
function buildCapabilityGraph(ir: any[]): Map<string, CapabilityNode> {
  const graph = new Map<string, CapabilityNode>();
  for (const f of ir) {
    if (!f.exported) continue;
    graph.set(f.name, {
      name: f.name,
      purpose: f.purpose || "",
      tags: f.tags || [],
      requires: f.requires || [],
      produces: f.produces || [],
      score: 0,
    });
  }
  return graph;
}

/** Score a capability node against an intent. */
function scoreNode(node: CapabilityNode, intentLower: string, keywords: string[]): number {
  let score = 0;
  // Name match
  for (const kw of keywords) {
    if (node.name.toLowerCase().includes(kw)) score += 1;
    score += jaccardSimilarity(node.name.toLowerCase(), kw);
  }
  // Purpose match
  const purposeLower = node.purpose.toLowerCase();
  for (const kw of keywords) {
    if (purposeLower.includes(kw)) score += 2;
  }
  // Tag match
  for (const tag of node.tags) {
    if (intentLower.includes(tag.toLowerCase())) score += 1.5;
  }
  // Semantic word overlap in purpose
  const intentWords = intentLower.split(/[\s,，]+/);
  for (const w of intentWords) {
    if (w.length > 2 && purposeLower.includes(w)) score += 0.5;
  }
  return score;
}

/** Find all capability nodes that produce a given capability label. */
function findProducers(graph: Map<string, CapabilityNode>, capability: string): CapabilityNode[] {
  const producers: CapabilityNode[] = [];
  for (const node of graph.values()) {
    if (node.produces.some(p => p === capability || capability.includes(p) || p.includes(capability))) {
      producers.push(node);
    }
  }
  return producers;
}

/** Find all capability nodes that require a given capability label. */
function findConsumers(graph: Map<string, CapabilityNode>, capability: string): CapabilityNode[] {
  const consumers: CapabilityNode[] = [];
  for (const node of graph.values()) {
    if (node.requires.some(r => r === capability || capability.includes(r) || r.includes(capability))) {
      consumers.push(node);
    }
  }
  return consumers;
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
  ir: any[],
  maxChains: number = 5
): CapabilityChain[] {
  const intentLower = intent.toLowerCase();
  const keywords = extractKeywords(intent);
  const graph = buildCapabilityGraph(ir);

  // Score all nodes
  for (const node of graph.values()) {
    node.score = scoreNode(node, intentLower, keywords);
  }

  // Find seed nodes: highest-scoring nodes that produce something
  const seeds = [...graph.values()]
    .filter(n => n.produces.length > 0 && n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const chains: CapabilityChain[] = [];

  for (const seed of seeds) {
    // Build chain: seed → consumer → consumer...
    const chain: CapabilityNode[] = [seed];
    const visited = new Set<string>([seed.name]);
    let totalScore = seed.score;

    // Forward trace: for each produce of the last node, find consumers
    let current = seed;
    let extended = true;
    while (extended && chain.length < 8) {
      extended = false;
      for (const p of current.produces) {
        const consumers = findConsumers(graph, p).filter(c => !visited.has(c.name));
        if (consumers.length > 0) {
          // Pick best-scoring consumer
          const bestConsumer = consumers.sort((a, b) => b.score - a.score)[0];
          chain.push(bestConsumer);
          visited.add(bestConsumer.name);
          totalScore += bestConsumer.score;
          current = bestConsumer;
          extended = true;
          break;
        }
      }
    }

    // Backward trace: does seed need something? Find producers.
    if (seed.requires.length > 0) {
      const producers = findProducers(graph, seed.requires[0])
        .filter(p => !visited.has(p.name));
      if (producers.length > 0) {
        const bestProducer = producers.sort((a, b) => b.score - a.score)[0];
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
  return unique.slice(0, maxChains);
}

/** Format chains as a hint for the LLM prompt. */
export function formatChainHint(chains: CapabilityChain[]): string {
  if (chains.length === 0) return "";
  const lines = ["\n推荐能力链 (Strategy Layer):"];
  for (let i = 0; i < Math.min(chains.length, 3); i++) {
    const c = chains[i];
    lines.push(`  ${i + 1}. ${c.explanation} (★${c.score.toFixed(1)})`);
  }
  return lines.join("\n");
}
