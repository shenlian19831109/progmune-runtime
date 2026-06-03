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

interface CapabilityNode {
  name: string;           // function name
  purpose: string;        // what it does
  tags: string[];         // domain tags
  requires: string[];     // capability preconditions
  produces: string[];     // capability outcomes
  useWhen: string[];      // scenarios when to use
  score: number;          // relevance to intent (computed)
}

interface CapabilityChain {
  nodes: CapabilityNode[];
  score: number;           // cumulative relevance
  explanation: string;     // human-readable chain description
}

/** Build a capability graph from IR functions. */
function buildCapabilityGraph(ir: any[]): Map<string, CapabilityNode> {
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
  for (const kw of keywords) {
    if (node.name.toLowerCase().includes(kw)) { score += 1; hasMatch = true; }
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
  // Dynamic Credit: multiply by actual success rate
  const successRate = getFailureAdjustedCredit(node.name);
  const creditFactor = 0.3 + successRate * 0.7;
  return score * creditFactor;
}

/** Find all capability nodes that produce a given capability label.
 *  Falls back to topology similarity if no direct data-flow match. */
function findProducers(graph: Map<string, CapabilityNode>, capability: string, allNodes: CapabilityNode[]): CapabilityNode[] {
  const producers: CapabilityNode[] = [];
  for (const node of graph.values()) {
    if (node.produces.some(p => p === capability || capability.includes(p) || p.includes(capability))) {
      producers.push(node);
    }
  }
  // Topology fallback: find semantically related producers
  if (producers.length === 0) {
    try {
      const topo = getTopology();
      for (const node of allNodes) {
        if (node.produces.length > 0) {
          for (const p of node.produces) {
            if (topo.capabilityMatch(p, capability) && !producers.includes(node)) {
              producers.push(node);
              break;
            }
          }
        }
      }
    } catch {}
  }
  return producers;
}

/** Find all capability nodes that require a given capability label.
 *  Falls back to topology similarity if no direct data-flow match. */
function findConsumers(graph: Map<string, CapabilityNode>, capability: string, allNodes: CapabilityNode[]): CapabilityNode[] {
  const consumers: CapabilityNode[] = [];
  for (const node of graph.values()) {
    if (node.requires.some(r => r === capability || capability.includes(r) || r.includes(capability))) {
      consumers.push(node);
    }
  }
  // Topology fallback
  if (consumers.length === 0) {
    try {
      const topo = getTopology();
      for (const node of allNodes) {
        if (node.requires.length > 0) {
          for (const r of node.requires) {
            if (topo.capabilityMatch(capability, r) && !consumers.includes(node)) {
              consumers.push(node);
              break;
            }
          }
        }
      }
    } catch {}
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

  // Dynamic threshold: tighten for large IR to prevent score dilution
  let dynamicThreshold = graph.size > 500 ? 2.0 : graph.size > 200 ? 1.5 : 1.0;

  // Fallback: if no seeds found, halve threshold
  let seeds = [...graph.values()]
    .filter(n => n.score > dynamicThreshold && (n.produces.length > 0 || n.score > dynamicThreshold + 2))
    .sort((a, b) => b.score - a.score);
  if (seeds.length === 0 && dynamicThreshold > 0.5) {
    dynamicThreshold *= 0.5;
    seeds = [...graph.values()]
      .filter(n => n.score > dynamicThreshold && (n.produces.length > 0 || n.score > dynamicThreshold + 1))
      .sort((a, b) => b.score - a.score);
  }
  seeds = seeds.slice(0, graph.size > 500 ? 30 : 15);

  const allNodes = [...graph.values()];
  const chains: CapabilityChain[] = [];

  for (const seed of seeds) {
    // Build chain: seed → consumer → consumer...
    const chain: CapabilityNode[] = [seed];
    const visited = new Set<string>([seed.name]);
    let totalScore = seed.score;

    // Forward trace: data flow → semantic leap
    let current = seed;
    let extended = true;
    let leapDecay = 1.0; // weight decay for semantic leaps
    while (extended && chain.length < 8) {
      extended = false;
      // Strategy 1: direct data flow (produces → requires)
      for (const p of current.produces) {
        const consumers = findConsumers(graph, p, allNodes).filter(c => !visited.has(c.name));
        if (consumers.length > 0) {
          const bestConsumer = consumers.sort((a, b) => b.score - a.score)[0];
          chain.push(bestConsumer);
          visited.add(bestConsumer.name);
          totalScore += bestConsumer.score;
          current = bestConsumer;
          extended = true;
          leapDecay = 1.0; // reset decay on direct match
          break;
        }
      }
      // Strategy 2: semantic leap — use topology similarity
      if (!extended) {
        try {
          const topo = getTopology();
          const similar = topo.findSimilar(current.name, 10)
            .filter(s => !visited.has(s.name) && s.similarity > 0.2);
          if (similar.length > 0) {
            const bestMatch = graph.get(similar[0].name);
            if (bestMatch && bestMatch.score > 0) {
              chain.push(bestMatch);
              visited.add(bestMatch.name);
              totalScore += bestMatch.score * leapDecay; // decayed score
              current = bestMatch;
              extended = true;
              leapDecay *= 0.7; // each semantic leap loses 30% weight
            }
          }
        } catch {}
      }
    }

    // Backward trace: does seed need something? Find producers.
    if (seed.requires.length > 0) {
      const producers = findProducers(graph, seed.requires[0], allNodes)
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
