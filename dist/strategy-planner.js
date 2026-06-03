"use strict";
/**
 * Phase 8: Multi-Level Planning — Strategy Layer
 *
 * Selects capability chains from the IR graph WITHOUT calling LLM.
 * Pure graph search: intent → capability matching → ordered chain.
 *
 * The Action Layer (planner.ts) then uses this chain to constrain
 * the LLM's function selection space.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectCapabilityChains = selectCapabilityChains;
exports.formatChainHint = formatChainHint;
const utils_1 = require("./utils");
const feedback_1 = require("./feedback");
const semantic_topology_1 = require("./semantic-topology");
/** Build a capability graph from IR functions. */
function buildCapabilityGraph(ir) {
    const graph = new Map();
    for (const f of ir) {
        if (!f.exported)
            continue;
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
function scoreNode(node, intentLower, keywords) {
    let score = 0;
    let hasMatch = false;
    // Name match
    for (const kw of keywords) {
        if (node.name.toLowerCase().includes(kw)) {
            score += 1;
            hasMatch = true;
        }
        const js = (0, utils_1.jaccardSimilarity)(node.name.toLowerCase(), kw);
        if (js > 0.2) {
            score += js;
            hasMatch = true;
        }
    }
    // Purpose match
    const purposeLower = node.purpose.toLowerCase();
    for (const kw of keywords) {
        if (purposeLower.includes(kw)) {
            score += 2;
            hasMatch = true;
        }
    }
    // Tag match
    for (const tag of node.tags) {
        if (intentLower.includes(tag.toLowerCase())) {
            score += 1.5;
            hasMatch = true;
        }
    }
    // Semantic word overlap in purpose
    const intentWords = intentLower.split(/[\s,，]+/);
    for (const w of intentWords) {
        if (w.length > 2 && purposeLower.includes(w)) {
            score += 0.5;
            hasMatch = true;
        }
    }
    // useWhen scenario match
    if (node.useWhen) {
        for (const scenario of node.useWhen) {
            const scenarioWords = scenario.toLowerCase().split(/[\s,]+/);
            const matchCount = scenarioWords.filter((w) => w.length > 3 && intentLower.includes(w)).length;
            if (matchCount >= 2) {
                score += 3.0;
                hasMatch = true;
            }
            else if (matchCount === 1) {
                score += 1.0;
                hasMatch = true;
            }
        }
    }
    // Require at least one match to be relevant
    if (!hasMatch)
        return 0;
    // Dynamic Credit: multiply by actual success rate
    const successRate = (0, feedback_1.getFailureAdjustedCredit)(node.name);
    const creditFactor = 0.3 + successRate * 0.7;
    return score * creditFactor;
}
/** Find all capability nodes that produce a given capability label.
 *  Falls back to topology similarity if no direct data-flow match. */
function findProducers(graph, capability, allNodes) {
    const producers = [];
    for (const node of graph.values()) {
        if (node.produces.some(p => p === capability || capability.includes(p) || p.includes(capability))) {
            producers.push(node);
        }
    }
    // Topology fallback: find semantically related producers
    if (producers.length === 0) {
        try {
            const topo = (0, semantic_topology_1.getTopology)();
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
        }
        catch { }
    }
    return producers;
}
/** Find all capability nodes that require a given capability label.
 *  Falls back to topology similarity if no direct data-flow match. */
function findConsumers(graph, capability, allNodes) {
    const consumers = [];
    for (const node of graph.values()) {
        if (node.requires.some(r => r === capability || capability.includes(r) || r.includes(capability))) {
            consumers.push(node);
        }
    }
    // Topology fallback
    if (consumers.length === 0) {
        try {
            const topo = (0, semantic_topology_1.getTopology)();
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
        }
        catch { }
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
function selectCapabilityChains(intent, ir, maxChains = 5) {
    const intentLower = intent.toLowerCase();
    const keywords = (0, utils_1.extractKeywords)(intent);
    const graph = buildCapabilityGraph(ir);
    // Score all nodes
    for (const node of graph.values()) {
        node.score = scoreNode(node, intentLower, keywords);
    }
    // Find seed nodes: highest-scoring nodes (prefer producers, allow pure consumers)
    const seeds = [...graph.values()]
        .filter(n => n.score > 1.0 && (n.produces.length > 0 || n.score > 3))
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
    const allNodes = [...graph.values()];
    const chains = [];
    for (const seed of seeds) {
        // Build chain: seed → consumer → consumer...
        const chain = [seed];
        const visited = new Set([seed.name]);
        let totalScore = seed.score;
        // Forward trace: for each produce of the last node, find consumers
        let current = seed;
        let extended = true;
        while (extended && chain.length < 8) {
            extended = false;
            for (const p of current.produces) {
                const consumers = findConsumers(graph, p, allNodes).filter(c => !visited.has(c.name));
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
    const seen = new Set();
    const unique = [];
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
function formatChainHint(chains) {
    if (chains.length === 0)
        return "";
    const lines = ["\n推荐能力链 (Strategy Layer):"];
    for (let i = 0; i < Math.min(chains.length, 3); i++) {
        const c = chains[i];
        lines.push(`  ${i + 1}. ${c.explanation} (★${c.score.toFixed(1)})`);
    }
    return lines.join("\n");
}
