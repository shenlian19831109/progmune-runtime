/**
 * P10.0: Protocol Foundation Model — Protocol Embedding Space
 *
 * Upgrades from "hand-crafted similarity" to "learned representation."
 * Uses WL subtree histograms as a dense structural encoding that
 * naturally clusters protocols by their topological family — without
 * any function names, keywords, or manually-designed features.
 *
 * Core capability: given ANY protocol state machine, produce a
 * fixed-size embedding vector that captures its structural identity.
 * Same-family protocols (resource lifecycle, transaction, auth, loop)
 * should naturally cluster in embedding space.
 *
 * This is the bridge from "detecting violations" to "understanding
 * protocols" — the Software World Model foundation.
 */

import { extractWLFingerprint, WLFingerprint, wlSimilarity } from "./wl-fingerprint";
import { inferStateMachine, InferredStateMachine } from "./experimental/state-inference";
import { createProtocolForTopology, ALL_TOPOLOGIES, TopologyName } from "./topology-factory";
import { CROSS_REPO_SEQUENCES } from "./experimental/unsupervised-physics";

// ═══════════════════════════════════════════════════════════════
// Protocol Embedding
// ═══════════════════════════════════════════════════════════════

export interface ProtocolEmbedding {
  /** Protocol name / identifier. */
  name: string;
  /** Human-readable category (auth, file, transaction, etc.). */
  family: string;
  /** WL embedding vector (256-dim). */
  vector: number[];
  /** State machine for reference. */
  stateMachine: InferredStateMachine;
}

export interface EmbeddingSpace {
  embeddings: ProtocolEmbedding[];
  /** Similarity matrix (N×N, cosine). */
  similarityMatrix: number[][];
}

/**
 * Build an embedding for a protocol given its call sequences.
 * The embedding is the WL fingerprint vector — a dense structural
 * encoding that captures subtree patterns, branching topology, and
 * neighborhood structures.
 */
export function embedProtocol(
  name: string,
  family: string,
  sequences: string[][]
): ProtocolEmbedding {
  const sm = inferStateMachine(sequences);
  const wl = extractWLFingerprint(sm, 3);
  return { name, family, vector: wl.vector, stateMachine: sm };
}

/**
 * Build an embedding space from all known protocol topologies
 * plus cross-repo protocols.
 */
export function buildEmbeddingSpace(): EmbeddingSpace {
  const embeddings: ProtocolEmbedding[] = [];

  // 10 synthetic topologies from the topology factory
  for (const topo of ALL_TOPOLOGIES) {
    const rules = createProtocolForTopology(topo);
    if (rules.size === 0) continue;

    // Generate sequences from the topology rules
    const sequences = generateTopologySequences(rules);
    embeddings.push(embedProtocol(topo, topo, sequences));
  }

  // 5 cross-repo protocols (real data)
  for (const [repo, seqs] of Object.entries(CROSS_REPO_SEQUENCES)) {
    embeddings.push(embedProtocol(repo, "cross_repo", seqs));
  }

  // Build similarity matrix
  const N = embeddings.length;
  const matrix: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      matrix[i][j] = i === j ? 1 : cosineSimilarity(embeddings[i].vector, embeddings[j].vector);
    }
  }

  return { embeddings, similarityMatrix: matrix };
}

function generateTopologySequences(rules: Map<string, any>): string[][] {
  const entries = [...rules.entries()];
  const sequences: string[][] = [];

  for (let trial = 0; trial < 5; trial++) {
    const targetLen = 2 + Math.floor(Math.random() * 4);
    const path: string[] = [];
    const stateSet = new Set<string>(["INIT", "IDLE"]);

    const startEntry = entries[Math.floor(Math.random() * entries.length)];
    path.push(startEntry[0]);
    const rule = startEntry[1];
    if (rule.invalidate) rule.invalidate.forEach((s: string) => stateSet.delete(s));
    for (const s of rule.post_states) stateSet.add(s);

    while (path.length < targetLen) {
      const candidates = entries.filter(([, r]) =>
        r.pre_states.every((s: string) => stateSet.has(s))
      );
      if (candidates.length === 0) break;
      const [fn, nextRule] = candidates[Math.floor(Math.random() * candidates.length)];
      path.push(fn);
      if (nextRule.invalidate) nextRule.invalidate.forEach((s: string) => stateSet.delete(s));
      for (const s of nextRule.post_states) stateSet.add(s);
    }
    if (path.length >= 2) sequences.push(path);
  }

  return sequences;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 && normB === 0) return 1;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ═══════════════════════════════════════════════════════════════
// Protocol Retrieval
// ═══════════════════════════════════════════════════════════════

export interface RetrievalResult {
  query: string;
  queryFamily: string;
  matches: { name: string; family: string; similarity: number }[];
}

/**
 * Given an unknown protocol's sequences, find the most similar
 * known protocols in the embedding space.
 */
export function retrieveSimilarProtocols(
  queryName: string,
  queryFamily: string,
  querySequences: string[][],
  space: EmbeddingSpace,
  topK: number = 5
): RetrievalResult {
  const queryEmbedding = embedProtocol(queryName, queryFamily, querySequences);

  const ranked = space.embeddings
    .filter(e => e.name !== queryName)
    .map(e => ({
      name: e.name,
      family: e.family,
      similarity: cosineSimilarity(queryEmbedding.vector, e.vector),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return {
    query: queryName,
    queryFamily,
    matches: ranked,
  };
}

// ═══════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════

export function printEmbeddingSpace(space: EmbeddingSpace): void {
  const names = space.embeddings.map(e => e.name);
  const families = space.embeddings.map(e => e.family);

  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║   P10.0 Protocol Embedding Space                    ║`);
  console.log(`║   ${space.embeddings.length} protocols in ${new Set(families).size} families`);
  console.log(`╚════════════════════════════════════════════════════╝\n`);

  // Within-family vs cross-family similarity
  const familyList = [...new Set(families)];
  console.log(`  ═══ Family Clustering ═══\n`);
  console.log(`  ${'Family'.padEnd(18)} ${'Within'.padEnd(8)} ${'Cross'.padEnd(8)} ${'Gap'.padEnd(8)} ${'Signal'}`);
  console.log(`  ${'─'.repeat(52)}`);

  const allWithin: number[] = [];
  const allCross: number[] = [];

  for (const family of familyList) {
    const indices = space.embeddings
      .map((e, i) => e.family === family ? i : -1)
      .filter(i => i >= 0);

    let within = 0, withinN = 0;
    for (let a = 0; a < indices.length; a++)
      for (let b = a + 1; b < indices.length; b++)
        { within += space.similarityMatrix[indices[a]][indices[b]]; withinN++; }

    let cross = 0, crossN = 0;
    for (const i of indices)
      for (let j = 0; j < space.embeddings.length; j++)
        if (space.embeddings[j].family !== family)
          { cross += space.similarityMatrix[i][j]; crossN++; }

    const withinAvg = withinN > 0 ? within / withinN : 0;
    const crossAvg = crossN > 0 ? cross / crossN : 0;
    const gap = withinAvg - crossAvg;

    if (withinN > 0) allWithin.push(withinAvg);
    for (let n = 0; n < (withinN || 1); n++) allCross.push(crossAvg);

    const signal = gap > 0.1 ? "🟢 STRONG" : gap > 0.03 ? "🟡 WEAK" : gap > 0 ? "⚪ MARGINAL" : "🔴 NONE";
    console.log(`  ${family.padEnd(18)} ${(withinAvg*100).toFixed(0).padStart(3)}%    ${(crossAvg*100).toFixed(0).padStart(3)}%    ${(gap>0?'+':'')}${(gap*100).toFixed(0).padStart(2)}%   ${signal}`);
  }

  const avgWithin = allWithin.length > 0 ? allWithin.reduce((a,b)=>a+b,0)/allWithin.length : 0;
  const avgCross = allCross.length > 0 ? allCross.reduce((a,b)=>a+b,0)/allCross.length : 0;

  console.log(`\n  Avg within-family: ${(avgWithin*100).toFixed(0)}%`);
  console.log(`  Avg cross-family:  ${(avgCross*100).toFixed(0)}%`);
  console.log(`  Clustering effect: ${avgWithin > avgCross ? '+' : ''}${((avgWithin-avgCross)*100).toFixed(0)}%`);

  console.log(`\n  Verdict: ${avgWithin > avgCross + 0.05 ? '✅ NATURAL CLUSTERING — protocol families form in embedding space'
    : avgWithin > avgCross ? '⚠️  WEAK CLUSTERING — families detectable but not well-separated'
    : '❌ NO CLUSTERING — structure exists but families overlap in embedding space'}\n`);
}

export function printRetrievalResult(result: RetrievalResult): void {
  console.log(`\n  ═══ Retrieval: ${result.query} (${result.queryFamily}) ═══`);
  console.log(`  ${'Rank'.padEnd(6)} ${'Protocol'.padEnd(18)} ${'Family'.padEnd(16)} ${'Similarity'}`);
  console.log(`  ${'─'.repeat(54)}`);
  for (let i = 0; i < result.matches.length; i++) {
    const m = result.matches[i];
    const icon = m.family === result.queryFamily ? "✅" : "  ";
    console.log(`  ${String(i+1).padEnd(6)} ${icon} ${m.name.padEnd(16)} ${m.family.padEnd(16)} ${(m.similarity*100).toFixed(0)}%`);
  }
  console.log();
}
